/**
 * Online payments, tenant scope — the platform admin sets up a STORE's terminal (CustomerFile "MAX" tab; the server
 * functions require the platform host and a platform admin, and the DB checks the actor again). Server only.
 * The only caller of platform_store_terminal_save (U17-B4).
 *
 * KEY / PassP are write-only: sealed at once with the tenant key bound to this store (ctx { tenantId, accountId:
 * tenantId }, lead decision Q1) and saved in one DB call with key_id = the cipher's kid (Q2). They are never read
 * back except by credentials.ts for one Hyp request. DEMO: mode "test" and a 00100… terminal only (DM-ENV-3; the DB
 * refuses anything else too), one payment only. The connection check signs a ₪1 page on Hyp — SIGN only, nothing
 * is charged (M01) — and records the result.
 */
import { randomBytes } from "node:crypto";
import type { PaymentMode } from "@/platform/payments/provider";
import {
  buildSignParams,
  encodeParams,
  validateSignResponse,
} from "@/platform/payments/max/protocol";
import { paymentsRpc } from "@/platform/payments/server/db";
import {
  envMode,
  hypEndpoint,
  paymentsReady,
  terminalAllowed,
  type PaymentsEnv,
} from "@/platform/payments/server/env";
import { hypRequest } from "@/platform/payments/server/http";
import { tenantSecretCipher } from "@/platform/payments/server/tenant-keys";
import type { StoreTerminalView, UnreturnedAttemptView } from "@/platform/payments/tenant-views";
import { attemptStateOf } from "@/platform/payments/tenant-views";
import { connectionCheckCredentials } from "./credentials";
import { TenantPaymentError, UNAVAILABLE, asArray, asRecord, int, str, unwrap } from "./db";
import { tenantLog } from "./log";
import { storeTerminalViewOf } from "./owner";

export const TERMINAL_NOT_FOR_ENV =
  "מספר המסוף לא מתאים לסביבה (בסביבת DEMO: מסוף בדיקות שמספרו מתחיל ב-00100)";
const CREDENTIAL_MAX = 256;

export interface StoreTerminalInput {
  terminalNumber?: string | undefined;
  apiKey?: string | undefined;
  apiPassword?: string | undefined;
  enabled?: boolean | undefined;
  clearCredentials?: boolean | undefined;
  force?: boolean | undefined;
}

function readyEnv(): PaymentsEnv {
  const ready = paymentsReady("tenant");
  if (!ready.ok) {
    tenantLog.warn("admin_refused", { why: ready.reason });
    throw new TenantPaymentError(UNAVAILABLE, "unavailable");
  }
  return ready.env;
}

/** DEMO: test only; production: live only (decision ה-4) */
const modeFor = (env: PaymentsEnv): PaymentMode => envMode(env);

export function unreturnedViewOf(data: unknown): UnreturnedAttemptView[] {
  return asArray(data).flatMap((row) => {
    const r = asRecord(row);
    if (!r) return [];
    return [
      {
        orderNumber: str(r["order_number"]),
        amountMinor: int(r["amount_minor"]),
        createdAt: str(r["signed_at"]) ?? str(r["created_at"]),
        expiresAt: str(r["expires_at"]),
        state: attemptStateOf(r["state"]),
        test: r["mode"] === "test",
      },
    ];
  });
}

export async function storeUnreturnedAttempts(
  actorId: string,
  tenantId: string,
): Promise<UnreturnedAttemptView[]> {
  const answer = await paymentsRpc("max_unreturned_attempts", {
    _actor: actorId,
    _tenant: tenantId,
    _limit: 50,
  });
  if (answer.error) {
    tenantLog.warn("unreturned_failed", { code: answer.error.code });
    return [];
  }
  return unreturnedViewOf(answer.data);
}

export async function saveStoreTerminal(
  actorId: string,
  tenantId: string,
  input: StoreTerminalInput,
): Promise<StoreTerminalView> {
  const env = readyEnv();
  const mode = modeFor(env);
  const patch: Record<string, string | boolean | number> = { mode, terminal_max_installments: 1 };
  if (input.terminalNumber !== undefined) {
    const terminal = input.terminalNumber.trim();
    if (!terminalAllowed(env, terminal)) throw new TenantPaymentError(TERMINAL_NOT_FOR_ENV);
    patch["terminal_number"] = terminal;
  }
  const apiKey = input.apiKey?.trim() ?? "";
  const apiPassword = input.apiPassword?.trim() ?? "";
  if (apiKey.length > CREDENTIAL_MAX || apiPassword.length > CREDENTIAL_MAX)
    throw new TenantPaymentError("פרטי המסוף ארוכים מדי");
  if (input.clearCredentials) {
    if (apiKey || apiPassword)
      throw new TenantPaymentError("אפשר למחוק את פרטי המסוף או להחליף אותם — לא את שניהם יחד");
    patch["clear_credentials"] = true;
  } else if (apiKey || apiPassword) {
    let cipher;
    try {
      cipher = tenantSecretCipher(env, mode);
    } catch {
      throw new TenantPaymentError(UNAVAILABLE, "unavailable");
    }
    const ctx = { tenantId, accountId: tenantId };
    if (apiKey) patch["api_key_enc"] = cipher.seal("api_key", apiKey, ctx);
    if (apiPassword) patch["api_password_enc"] = cipher.seal("api_password", apiPassword, ctx);
    patch["key_id"] = cipher.kid;
  }
  if (input.enabled !== undefined) patch["enabled"] = input.enabled;
  if (input.force) patch["force"] = true;

  const saved = unwrap(
    "platform_store_terminal_save",
    await paymentsRpc("platform_store_terminal_save", {
      _actor: actorId,
      _tenant: tenantId,
      _patch: patch,
      _app_environment: env,
    }),
  );
  tenantLog.info("store_terminal_saved", {
    fields: Object.keys(patch)
      .filter((k) => k !== "mode" && k !== "terminal_max_installments")
      .join(","),
  });
  return storeTerminalViewOf(saved);
}

/** SIGN only (₪1, a fresh reference, nothing charged), then the result is recorded for the account */
export async function testStoreTerminal(
  actorId: string,
  tenantId: string,
): Promise<{ ok: boolean; code: string | null }> {
  const env = readyEnv();
  const { creds } = await connectionCheckCredentials(env, actorId, tenantId);
  const order = randomBytes(16).toString("hex");
  const endpoint = hypEndpoint();
  let ok = false;
  let code: string | null = null;
  try {
    const pairs = buildSignParams(creds, { amountMinor: 100, order, moreData: true });
    const http = await hypRequest(endpoint, encodeParams(pairs), { method: "GET" });
    if (!http.ok) {
      code = http.error;
    } else {
      const sign = validateSignResponse(
        http.body,
        { masof: creds.masof, amountMinor: 100, order, moreData: true },
        endpoint,
      );
      ok = sign.ok;
      code = sign.ok ? "0" : (sign.ccode ?? sign.code);
    }
  } catch {
    code = "input";
  }
  unwrap(
    "platform_store_terminal_verified",
    await paymentsRpc("platform_store_terminal_verified", {
      _actor: actorId,
      _tenant: tenantId,
      _ok: ok,
      _code: code,
    }),
  );
  tenantLog.info("store_terminal_checked", { ok, code });
  if (code === "901" || code === "902") tenantLog.alert("terminal_credentials_refused", { code });
  return { ok, code };
}
