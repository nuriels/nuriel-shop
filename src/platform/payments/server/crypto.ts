/**
 * MAX/Hyp payments — encryption primitives (server only; plan §6.1 ENV-4, evidence 02 K1 / G-4).
 *
 * • hkdfKey: HKDF-SHA256, salt "nuriel-payments", 32 bytes. The root secret and the label are passed in by
 *   tenant-keys.ts / platform-keys.ts; nothing in this file reads the environment.
 * • seal / open: AES-256-GCM, a random 12-byte IV and a 16-byte tag. Token
 *   "v1:<kid>:<iv>:<tag>:<ciphertext>" (base64url, no padding). The header "v1:<kid>" is authenticated together
 *   with the caller's AAD, so a token whose kid was edited fails exactly like any other tampering.
 * • open never says why: every failure (format, kid, key, tag, AAD) throws the same fixed Error, with no cause.
 * • Nothing here logs. No error message carries a key, a plaintext, an AAD or a token.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const FORMAT = "v1";
const SALT = "nuriel-payments";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** terminal credentials and raw returns are small; this only bounds misuse */
const MAX_PLAINTEXT_BYTES = 64 * 1024;
const MAX_TOKEN_CHARS = 90_000;
const KID_FORMAT = /^[A-Za-z0-9_-]{1,32}$/;
const B64URL_FORMAT = /^[A-Za-z0-9_-]+$/;
/** one AAD part: no separator, no whitespace (UUIDs, env, scope, mode, field names, kid) */
const AAD_PART = /^[A-Za-z0-9._-]{1,128}$/;

const DECRYPT_FAILED = "payments: decrypt failed";
const ENCRYPT_FAILED = "payments: encrypt failed";
const DERIVE_FAILED = "payments: key derivation failed";

/** a root secret shorter than this is never used (plan ENV-9) */
export const MIN_ROOT_CHARS = 32;

function fail(message: string): never {
  throw new Error(message);
}

const isKey = (key: unknown): key is Buffer => Buffer.isBuffer(key) && key.length === KEY_BYTES;

/** the header is part of the authenticated data: editing the kid in a token breaks the tag */
const boundAad = (kid: string, aad: string) => Buffer.from(`${FORMAT}:${kid}:${aad}`, "utf8");

/** strict base64url: only the URL alphabet, no padding, canonical (re-encodes to the same text) */
function fromB64url(text: string): Buffer | null {
  if (!B64URL_FORMAT.test(text)) return null;
  const bytes = Buffer.from(text, "base64url");
  return bytes.toString("base64url") === text ? bytes : null;
}

/** HKDF-SHA256 (salt "nuriel-payments") → a 32-byte key for one label */
export function hkdfKey(root: string, info: string): Buffer {
  if (typeof root !== "string" || root.length === 0) fail(DERIVE_FAILED);
  if (typeof info !== "string" || info.length === 0) fail(DERIVE_FAILED);
  try {
    return Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(root, "utf8"),
        Buffer.from(SALT, "utf8"),
        Buffer.from(info, "utf8"),
        KEY_BYTES,
      ),
    );
  } catch {
    return fail(DERIVE_FAILED);
  }
}

/** AES-256-GCM → "v1:<kid>:<b64url iv>:<b64url tag>:<b64url ct>" */
export function seal(key: Buffer, plaintext: string, aad: string, kid: string): string {
  if (!isKey(key) || typeof aad !== "string") fail(ENCRYPT_FAILED);
  if (typeof kid !== "string" || !KID_FORMAT.test(kid)) fail(ENCRYPT_FAILED);
  if (typeof plaintext !== "string" || plaintext.length === 0) fail(ENCRYPT_FAILED);
  const body = Buffer.from(plaintext, "utf8");
  if (body.length > MAX_PLAINTEXT_BYTES) fail(ENCRYPT_FAILED);
  try {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(boundAad(kid, aad));
    const sealed = Buffer.concat([cipher.update(body), cipher.final()]);
    return [
      FORMAT,
      kid,
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      sealed.toString("base64url"),
    ].join(":");
  } catch {
    return fail(ENCRYPT_FAILED);
  }
}

/** the inverse of seal; any failure → Error("payments: decrypt failed"), always the same, no cause */
export function open(key: Buffer, token: string, aad: string): string {
  try {
    if (!isKey(key) || typeof aad !== "string") fail(DECRYPT_FAILED);
    if (typeof token !== "string" || token.length > MAX_TOKEN_CHARS) fail(DECRYPT_FAILED);
    const parts = token.split(":");
    if (parts.length !== 5) fail(DECRYPT_FAILED);
    const [format, kid, ivText, tagText, bodyText] = parts as [
      string,
      string,
      string,
      string,
      string,
    ];
    if (format !== FORMAT || !KID_FORMAT.test(kid)) fail(DECRYPT_FAILED);
    const iv = fromB64url(ivText);
    const tag = fromB64url(tagText);
    const body = fromB64url(bodyText);
    if (!iv || iv.length !== IV_BYTES || !tag || tag.length !== TAG_BYTES || !body) {
      fail(DECRYPT_FAILED);
    }
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(boundAad(kid, aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    // a fresh error: neither the cause nor the reason leaves this function
    throw new Error(DECRYPT_FAILED);
  }
}

/** a short, deterministic id of a root secret (it identifies the key, it reveals nothing about it) */
export function keyIdOf(root: string): string {
  if (typeof root !== "string" || root.length === 0) fail(DERIVE_FAILED);
  return createHmac("sha256", root).update("kid", "utf8").digest("hex").slice(0, 8);
}

/** AAD from parts joined with "|"; a part that could shift the boundaries ("|", spaces, empty) is refused */
export function joinAad(parts: readonly string[]): string {
  for (const part of parts) {
    if (typeof part !== "string" || !AAD_PART.test(part)) fail(ENCRYPT_FAILED);
  }
  return parts.join("|");
}

/** constant-time equality of two strings (both are hashed first, so neither length nor prefix leaks) */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(String(a), "utf8").digest();
  const right = createHash("sha256").update(String(b), "utf8").digest();
  return timingSafeEqual(left, right);
}
