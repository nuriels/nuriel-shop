/**
 * MAX/Hyp payments — step-up for editing NURIEL's terminal (plan §4.3, DM-SEP-6; server only).
 *
 * A one-time 6-digit code, emailed to the platform admin, approves exactly ONE change:
 * • stepupPurposeHash(actor, purpose, payload) — HMAC-SHA256 under a fixed label over the admin's id, the purpose
 *   and a canonical JSON of the change (sorted keys). Another admin, another purpose or any other value gives
 *   another hash, so the code cannot approve anything else. The hash stays on the server: it is never sent to
 *   the browser (the payload holds the new terminal secrets).
 * • stepupCodeHmac(key, seed, code) — what the DB keeps instead of the code (HMAC with the step-up key of
 *   platform-keys.ts; the seed binds it to the admin and the purpose hash).
 * • createStepupService(rpc, key) — issue / consume through the injected DB caller (platform_stepup_issue /
 *   platform_stepup_consume, migration 208: 10 minutes, at most 5 tries, single use, platform admins only; the DB
 *   compares the HMACs). Before the purpose hash reaches the DB it is HMAC-ed with the step-up key too, so a DB
 *   reader cannot test guesses of the payload against it.
 * • Nothing here logs, and no error or result carries the code, an HMAC or the payload.
 */
import { createHmac, randomInt } from "node:crypto";

export type StepupRpc = (
  fn: "platform_stepup_issue" | "platform_stepup_consume",
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

type StepupPurpose = "platform_terminal_change";

const PURPOSES: readonly string[] = ["platform_terminal_change"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SIX_DIGITS = /^[0-9]{6}$/;
const REASON = /^[a-z][a-z0-9_]{0,39}$/;
const MIN_KEY_BYTES = 32;
const MAX_SEED_CHARS = 512;
const MAX_PAYLOAD_CHARS = 256 * 1024;
const MAX_DEPTH = 32;

const PURPOSE_LABEL = "nuriel/payments/v1/stepup/purpose";
const CODE_LABEL = "nuriel/payments/v1/stepup/code";
const DB_PURPOSE_LABEL = "nuriel/payments/v1/stepup/db-purpose";

const ISSUE_FAILED = "payments: step-up issue failed";
const INPUT_REFUSED = "payments: step-up input refused";

function refuse(): never {
  throw new Error(INPUT_REFUSED);
}

const uuidOrNull = (value: unknown): string | null => {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  return UUID.test(text) ? text : null;
};

const usableKey = (key: unknown): key is Buffer =>
  Buffer.isBuffer(key) && key.length >= MIN_KEY_BYTES;

/** JSON with sorted object keys; only plain JSON values (no Date, Map, class instance, undefined in arrays…) */
function canonicalJson(value: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) refuse();
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : refuse();
    case "object": {
      if (Array.isArray(value)) {
        return `[${Array.from(value, (item: unknown) => canonicalJson(item, depth + 1)).join(",")}]`;
      }
      const proto: unknown = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) refuse();
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((k) => record[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k], depth + 1)}`).join(",")}}`;
    }
    default:
      // undefined, bigint, symbol, function
      return refuse();
  }
}

/** binds a code to one admin, one purpose and one exact change (hex SHA-256 HMAC) */
export function stepupPurposeHash(
  actorId: string,
  purpose: StepupPurpose,
  payload: unknown,
): string {
  const actor = uuidOrNull(actorId) ?? refuse();
  if (typeof purpose !== "string" || !PURPOSES.includes(purpose)) refuse();
  const body = canonicalJson(payload);
  if (body.length > MAX_PAYLOAD_CHARS) refuse();
  return createHmac("sha256", PURPOSE_LABEL)
    .update(`${actor}\n${purpose}\n${body}`, "utf8")
    .digest("hex");
}

/** what the DB keeps instead of the code: HMAC(step-up key, seed + code), hex */
export function stepupCodeHmac(key: Buffer, challengeSeed: string, code: string): string {
  if (!usableKey(key)) refuse();
  if (typeof challengeSeed !== "string" || challengeSeed.length === 0) refuse();
  if (challengeSeed.length > MAX_SEED_CHARS || /[\r\n]/.test(challengeSeed)) refuse();
  if (typeof code !== "string" || !SIX_DIGITS.test(code)) refuse();
  return createHmac("sha256", key)
    .update(`${CODE_LABEL}\n${challengeSeed}\n${code}`, "utf8")
    .digest("hex");
}

/** the RPC result as an object (supabase-js gives parsed JSON; a JSON string or a 1-row array is accepted) */
function asRecord(data: unknown): Record<string, unknown> | null {
  let value = data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (Array.isArray(value) && value.length === 1) value = value[0];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function createStepupService(
  rpc: StepupRpc,
  key: Buffer,
): {
  issue(
    actorId: string,
    purposeHash: string,
  ): Promise<{ challengeId: string; code: string; expiresAt: string }>;
  consume(
    actorId: string,
    challengeId: string,
    purposeHash: string,
    code: string,
  ): Promise<{ ok: boolean; reason?: string }>;
} {
  if (typeof rpc !== "function" || !usableKey(key)) refuse();
  // a private copy: a caller that reuses or wipes its buffer cannot change this service's key
  const hmacKey = Buffer.from(key);
  /** the seed of the code HMAC: the admin and the exact change */
  const seedOf = (actor: string, purposeHash: string) => `${actor}|${purposeHash}`;
  /** the purpose hash as the DB sees it (keyed, so it cannot be checked against guessed payloads) */
  const dbPurposeOf = (actor: string, purposeHash: string) =>
    createHmac("sha256", hmacKey)
      .update(`${DB_PURPOSE_LABEL}\n${actor}\n${purposeHash}`, "utf8")
      .digest("hex");

  return {
    async issue(actorId, purposeHash) {
      const actor = uuidOrNull(actorId);
      if (!actor || typeof purposeHash !== "string" || !HEX64.test(purposeHash)) refuse();
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      let answer: Awaited<ReturnType<StepupRpc>>;
      try {
        answer = await rpc("platform_stepup_issue", {
          _actor: actor,
          _purpose_hash: dbPurposeOf(actor, purposeHash),
          _code_hmac: stepupCodeHmac(hmacKey, seedOf(actor, purposeHash), code),
        });
      } catch {
        throw new Error(ISSUE_FAILED);
      }
      const row = answer?.error ? null : asRecord(answer?.data);
      const challengeId = uuidOrNull(row?.["challenge_id"]);
      const expires = typeof row?.["expires_at"] === "string" ? Date.parse(row["expires_at"]) : NaN;
      if (!challengeId || !Number.isFinite(expires)) throw new Error(ISSUE_FAILED);
      return { challengeId, code, expiresAt: new Date(expires).toISOString() };
    },

    async consume(actorId, challengeId, purposeHash, code) {
      const actor = uuidOrNull(actorId);
      const challenge = uuidOrNull(challengeId);
      if (!actor || !challenge || typeof purposeHash !== "string" || !HEX64.test(purposeHash)) {
        return { ok: false, reason: "invalid" };
      }
      // a code that cannot be right is not sent (it cannot match any HMAC)
      if (typeof code !== "string" || !SIX_DIGITS.test(code))
        return { ok: false, reason: "invalid" };
      let answer: Awaited<ReturnType<StepupRpc>>;
      try {
        answer = await rpc("platform_stepup_consume", {
          _actor: actor,
          _challenge: challenge,
          _purpose_hash: dbPurposeOf(actor, purposeHash),
          _code_hmac: stepupCodeHmac(hmacKey, seedOf(actor, purposeHash), code),
        });
      } catch {
        return { ok: false, reason: "unavailable" };
      }
      if (answer?.error) return { ok: false, reason: "unavailable" };
      const row = asRecord(answer?.data);
      if (!row) return { ok: false, reason: "unavailable" };
      if (row["ok"] === true) return { ok: true };
      const reason = row["reason"];
      return {
        ok: false,
        reason: typeof reason === "string" && REASON.test(reason) ? reason : "refused",
      };
    },
  };
}
