// ============================================================
// Leak scanners for the MAX/Hyp DEMO (plan §6.2, DM-SEC-1…6; evidence 02-security §6.2).
// Shared engine of scan-secrets.mjs and scan-db.mjs: canaries, pattern rules, Luhn, archives.
//
// • Node built-ins only (no npm package).
// • A hit is reported as WHERE + RULE (+ line number or count) — NEVER the matched value: the scan output is
//   itself a CI log.
// • Files the owner keeps private are never opened, in any mode: .env* files, deploy/setup-selfhost.sh,
//   docs/seo-engine/ISTORES-COMPARISON.md and the Yaad Sarig plugin sources.
// ============================================================
import { createHash } from "node:crypto";
import { brotliDecompressSync, deflateRawSync, gunzipSync, inflateRawSync } from "node:zlib";

export const EXIT_CLEAN = 0;
export const EXIT_HITS = 1;
export const EXIT_ERROR = 2;

/** a problem with the scan itself (arguments, unreadable input): exit 2, never "clean" */
export class ScanError extends Error {}

// ---------- files that are never read ----------

const NEVER_READ_PATHS = ["deploy/setup-selfhost.sh", "docs/seo-engine/ISTORES-COMPARISON.md"];

/** true for a path (relative or absolute, any separator) that must never be opened */
export function neverRead(path) {
  const p = String(path).split("\\").join("/");
  const base = p.slice(p.lastIndexOf("/") + 1);
  if (base.startsWith(".env")) return true;
  if (/yaad|sarig/i.test(p)) return true;
  return NEVER_READ_PATHS.some((x) => p === x || p.endsWith(`/${x}`));
}

// ---------- canaries ----------

export const MIN_CANARY_CHARS = 8;

/** one canary per line; empty lines and "#" lines are ignored; a too-short canary is a config error */
export function parseCanaries(text) {
  const canaries = [];
  String(text)
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const value = raw.trim();
      if (!value || value.startsWith("#")) return;
      if (value.length < MIN_CANARY_CHARS) {
        throw new ScanError(
          `canaries line ${i + 1}: shorter than ${MIN_CANARY_CHARS} characters (would match by chance)`,
        );
      }
      canaries.push({ id: `canary#${i + 1}`, value });
    });
  return canaries;
}

/** the base64 text that encodes `bytes` wherever they sit in a larger blob (3 alignments) */
function base64Variants(bytes) {
  const out = [];
  for (let k = 0; k < 3; k++) {
    const encoded = Buffer.concat([Buffer.alloc(k), bytes]).toString("base64");
    const start = Math.ceil((k * 4) / 3);
    const end = Math.floor(((k + bytes.length) * 8) / 6);
    const core = encoded.slice(start, end);
    if (core.length >= 12) out.push(core, core.replace(/\+/g, "-").replace(/\//g, "_"));
  }
  return out;
}

/**
 * Matchers for every canary: as is, URL-encoded, form-encoded and JSON-escaped (case-insensitive), and its
 * base64 / base64url encodings (case-sensitive, canaries of 12+ bytes).
 */
export function canaryMatchers(canaries) {
  return canaries.map(({ id, value }) => {
    const plain = new Set(
      [
        value,
        encodeURIComponent(value),
        encodeURIComponent(value).replace(/%20/g, "+"),
        JSON.stringify(value).slice(1, -1),
      ].map((v) => v.toLowerCase()),
    );
    const bytes = Buffer.from(value, "utf8");
    const encoded = bytes.length >= 12 ? base64Variants(bytes) : [];
    return {
      id,
      test: (line, lower) =>
        [...plain].some((v) => lower.includes(v)) || encoded.some((v) => line.includes(v)),
    };
  });
}

/** positive control: every canary must be found in a planted line, plainly and base64-encoded */
export function assertCanariesDetectable(matchers, canaries) {
  canaries.forEach((canary, i) => {
    const lines = [
      `planted ${canary.value} here`,
      `blob ${Buffer.from(`xx${canary.value}yy`, "utf8").toString("base64")} end`,
    ];
    for (const line of lines.slice(0, Buffer.byteLength(canary.value) >= 12 ? 2 : 1)) {
      if (!matchers[i].test(line, line.toLowerCase())) {
        throw new ScanError(`positive control failed for ${canary.id}`);
      }
    }
  });
}

// ---------- Luhn ----------

export function luhnValid(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return digits.length > 0 && sum % 10 === 0;
}

/** completes a digit string with its Luhn check digit (tests and self-tests build card-like values at run time) */
export function withLuhnDigit(body) {
  for (let d = 0; d <= 9; d++) if (luhnValid(`${body}${d}`)) return `${body}${d}`;
  throw new Error("unreachable");
}

// Card-like runs: 13–19 digits whose first digit is a payment-card industry (2–6), alone in their token (not part
// of a hex hash, a base64 blob or an identifier). Epoch timestamps (ms/µs/ns start with 1) and dates / migration
// versions (YYYYMMDD…, "20…") are not card-like.
// Also not card-like: the parts of a decimal number ("12.3456789012345") and valid GTIN-13/14 barcodes (product
// catalogues: EAN-13 is the 13-digit run met most often in real data).
const LUHN_RUN = /(?<![0-9A-Za-z.])[2-6][0-9]{12,18}(?![0-9A-Za-z]|\.[0-9])/g;
const LUHN_GROUPED =
  /(?<![0-9A-Za-z.])([2-6][0-9]{3})([ -])([0-9]{4})\2([0-9]{4})\2([0-9]{4})(?![0-9A-Za-z]|\.[0-9])/g;

/** GS1 check digit (EAN-13, GTIN-14): weights 3,1,3,… from the right, excluding the check digit */
function gtinValid(digits) {
  let sum = 0;
  for (let i = digits.length - 2, w = 3; i >= 0; i--, w = 4 - w)
    sum += (digits.charCodeAt(i) - 48) * w;
  return (10 - (sum % 10)) % 10 === digits.charCodeAt(digits.length - 1) - 48;
}

/** 2-series cards are Mastercard 2221–2720 only: "20…" / "21…" runs are dates and migration versions */
const cardLike = (digits) => {
  if ((digits.length === 13 || digits.length === 14) && gtinValid(digits)) return false;
  if (digits[0] !== "2") return true;
  const bin = Number(digits.slice(0, 4));
  return bin >= 2221 && bin <= 2720;
};

export function cardNumbersIn(line) {
  const found = [];
  for (const m of line.matchAll(LUHN_RUN)) {
    if (cardLike(m[0]) && luhnValid(m[0])) found.push(m[0]);
  }
  for (const m of line.matchAll(LUHN_GROUPED)) {
    const digits = `${m[1]}${m[3]}${m[4]}${m[5]}`;
    if (cardLike(digits) && luhnValid(digits)) found.push(digits);
  }
  return found;
}

// ---------- values: empty, masked, placeholder ----------

const VALUE_END = /^(?:$|[&\s"'<>,;)}\]\\])/;
const MASK_WORDS = "redacted|masked|hidden|removed|filtered";
const MASK = new RegExp(
  String.raw`^(?:\*{2,}|(?:%2A){2,}|•{2,}|x{3,}|X{3,}|#{2,}|…|\.{3}|\[(?:${MASK_WORDS})\]|<(?:${MASK_WORDS})>|\((?:${MASK_WORDS})\)|\{(?:${MASK_WORDS})\}|(?:${MASK_WORDS}))(?=$|[&\s"'<>,;)}\]\\])`,
  "i",
);

/** the value right after "NAME=" is empty or a redaction mask (the whole value, nothing after it) */
export function emptyOrMasked(rest, extraMasks = []) {
  if (VALUE_END.test(rest) || MASK.test(rest)) return true;
  return extraMasks.some((m) => rest.startsWith(m) && VALUE_END.test(rest.slice(m.length)));
}

// in tracked files: code, templates and documentation placeholders are not credentials
const NON_LITERAL = /^[^A-Za-z0-9]/;
const PLACEHOLDER =
  /^(?:(?:fake|canary|example|placeholder|dummy|sample|redacted|masked|changeme|your|xxx|test-only)|(?:value|val|key|secret|password|pass|token|string|text)(?![A-Za-z0-9]))/i;

// ---------- rules ----------

const B = "(?<![A-Za-z0-9_])"; // not glued to an identifier (SUPABASE_SERVICE_ROLE_KEY= is not KEY=)
const CREDENTIAL_PARAM = new RegExp(`${B}(?:KEY|[Pp][Aa][Ss][Ss][Pp]|[Zz][Pp][Aa][Ss][Ss])=`, "g");
const CREDENTIAL_JSON = /\\?"(?:KEY|PassP|zPass)\\?"\s*:\s*\\?"/g;
const SIGNATURE_PARAM = new RegExp(`${B}(?:Sign|signature)=[A-Za-z0-9+/=_%-]{20,}`);
const SIGNATURE_JSON = /\\?"(?:Sign|signature)\\?"\s*:\s*\\?"[A-Za-z0-9+/=_-]{20,}/;
const HYP_URL_QUERY = /pay\.hyp\.co\.il\/p\/?\?/i;
const RAW_CCODE = new RegExp(`${B}CCode=`);
const RAW_ORDER = new RegExp(`${B}Order=`);
const CARD_PARAM = new RegExp(`${B}(?:L4digit|Tmonth|Tyear|bincard|cell)=`, "g");
const USER_ID_PARAM = new RegExp(`${B}UserId=[0-9]`);
const CARD_JSON_KEY = /\\?"(?:Tmonth|Tyear|bincard|UserId|L4digit|cell)\\?"\s*:\s*/g;
const TERMINAL_NUMBER = /(?<![0-9])00100[0-9]{5}(?![0-9])/g;

function anyUnmasked(line, re, extraMasks) {
  for (const m of line.matchAll(re)) {
    if (!emptyOrMasked(line.slice(m.index + m[0].length), extraMasks)) return true;
  }
  return false;
}

function anyJsonValue(line, re, extraMasks) {
  for (const m of line.matchAll(re)) {
    let rest = line.slice(m.index + m[0].length);
    if (/^null\b/.test(rest)) continue;
    rest = rest.replace(/^\\?"/, "");
    if (/^\\?"/.test(rest) || emptyOrMasked(rest, extraMasks)) continue;
    return true;
  }
  return false;
}

/** the literals that must never reach the client bundle (X1 extended) */
export const BUNDLE_LITERALS = [
  "PassP",
  "zPass",
  "APISign",
  "What=VERIFY",
  "What=SIGN",
  "zikoyAPI",
  "CancelTrans",
  "PAYMENTS_SECRETS_KEY",
  "PLATFORM_TERMINAL_SECRETS_KEY",
  "PAYMENTS_ENV",
  "MAX_PAY_TEST_URL",
  // tables / columns (evidence 02 names and migration 208 names)
  "payment_provider_accounts",
  "platform_payment_accounts",
  "payment_terminal_registry",
  "terminal_registry",
  "tenant_accounts",
  "platform_accounts",
  "tenant_attempts",
  "platform_attempts",
  "api_key_enc",
  "api_password_enc",
  "return_enc",
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function bundleRules() {
  const literals = BUNDLE_LITERALS.map((word) => {
    const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRe(word)}(?![A-Za-z0-9_])`);
    return { id: `literal:${word}`, test: (line) => re.test(line) };
  });
  const assignment = new RegExp(`${B}(?:KEY|PassP)=[^&"'\\s]`);
  return [...literals, { id: "credential-param", test: (line) => assignment.test(line) }];
}

/** server logs, CI artifacts, browser dumps and DB values */
function runtimeRules(extraMasks) {
  return [
    { id: "credential-param", test: (l) => anyUnmasked(l, CREDENTIAL_PARAM, extraMasks) },
    { id: "credential-json", test: (l) => anyJsonValue(l, CREDENTIAL_JSON, extraMasks) },
    { id: "signature-value", test: (l) => SIGNATURE_PARAM.test(l) || SIGNATURE_JSON.test(l) },
    { id: "hyp-url-with-query", test: (l) => HYP_URL_QUERY.test(l) },
    { id: "raw-return", test: (l) => RAW_CCODE.test(l) && RAW_ORDER.test(l) },
    {
      id: "card-field",
      test: (l) => USER_ID_PARAM.test(l) || anyUnmasked(l, CARD_PARAM, extraMasks),
    },
    { id: "card-json-key", test: (l) => anyJsonValue(l, CARD_JSON_KEY, extraMasks) },
    { id: "card-number", test: (l) => cardNumbersIn(l).length > 0 },
  ];
}

/** tracked files (U18/X10 extended) */
function repoRules(allow) {
  return [
    {
      id: "terminal-number",
      test: (l) => [...l.matchAll(TERMINAL_NUMBER)].some((m) => !allow.terminals.has(m[0])),
    },
    {
      id: "credential-assignment",
      test: (l) => {
        for (const m of l.matchAll(CREDENTIAL_PARAM)) {
          const rest = l.slice(m.index + m[0].length);
          if (emptyOrMasked(rest) || NON_LITERAL.test(rest) || PLACEHOLDER.test(rest)) continue;
          return true;
        }
        return false;
      },
    },
    {
      id: "card-number",
      test: (l, ctx) => !ctx.luhnFixture && cardNumbersIn(l).some((n) => !allow.luhnValues.has(n)),
    },
  ];
}

export function rulesFor(mode, { extraMasks = [], allow = emptyAllow() } = {}) {
  if (mode === "bundle") return bundleRules();
  if (mode === "logs" || mode === "artifacts" || mode === "db") return runtimeRules(extraMasks);
  if (mode === "repo") return repoRules(allow);
  throw new ScanError(`unknown mode: ${mode}`);
}

export function emptyAllow() {
  return { terminals: new Set(), luhnValues: new Set(), luhnPaths: [] };
}

/**
 * scripts/security/declared-fakes.json: the fake values tracked files may contain on purpose. Each list holds
 * strings or { "value" | "path": …, "why": … } objects.
 */
export function parseAllow(json) {
  const data = JSON.parse(json);
  const item = (x) => (x && typeof x === "object" ? String(x.value ?? x.path ?? "") : String(x));
  const list = (key) => (Array.isArray(data[key]) ? data[key].map(item).filter(Boolean) : []);
  return {
    terminals: new Set(list("terminals")),
    luhnValues: new Set(list("luhnValues")),
    luhnPaths: list("luhnPaths"),
  };
}

// ---------- content ----------

const isBinary = (buf) => buf.subarray(0, 8000).includes(0);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const EMPTY_ZIP = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
const MAX_INFLATED_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_DEPTH = 4;
const DATA_URI = /data:[a-z0-9.+/-]*(?:;[a-z0-9=.+/-]+)*;base64,([A-Za-z0-9+/]{16,}={0,2})/gi;

/** a minimal ZIP reader (central directory; stored and deflate entries; no zip64, no encryption) */
export function readZip(buf) {
  const EOCD = 0x06054b50;
  const CEN = 0x02014b50;
  const LOC = 0x04034b50;
  if (buf.length < 22) throw new Error("zip: too small");
  let eocd = -1;
  for (let i = buf.length - 22, stop = Math.max(0, buf.length - 22 - 0xffff); i >= stop; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip: no end record");
  const total = buf.readUInt16LE(eocd + 10);
  const cenSize = buf.readUInt32LE(eocd + 12);
  const cenOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cenSize === 0xffffffff || cenOffset === 0xffffffff)
    throw new Error("zip64");
  if (cenOffset + cenSize > buf.length) throw new Error("zip: bad central directory");
  const entries = [];
  let p = cenOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN) throw new Error("zip: bad entry");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLength = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLength);
    p += 46 + nameLength + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (name.endsWith("/")) continue;
    if (size === 0xffffffff || local === 0xffffffff) throw new Error("zip64");
    if (flags & 1) throw new Error("zip: encrypted entry");
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== LOC)
      throw new Error("zip: bad entry");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + size > buf.length) throw new Error("zip: truncated");
    const data = buf.subarray(start, start + size);
    if (method === 0) entries.push({ name, data });
    else if (method === 8) {
      entries.push({ name, data: inflateRawSync(data, { maxOutputLength: MAX_INFLATED_BYTES }) });
    } else throw new Error(`zip: method ${method}`);
  }
  return entries;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** a minimal ZIP writer (deflate), for the self-tests and the unit tests */
export function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const raw = Buffer.from(data);
    const body = deflateRawSync(raw);
    const fileName = Buffer.from(name, "utf8");
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc32(raw), 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(fileName.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(crc32(raw), 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(fileName.length, 28);
    cen.writeUInt32LE(offset, 42);
    locals.push(head, fileName, body);
    centrals.push(cen, fileName);
    offset += head.length + fileName.length + body.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

/**
 * Scans one buffer (a file, an archive entry, a decoded data URI) with the given rules and canary matchers.
 * Calls onHit({ where, line, rule }) — never with the value. Archives (zip; gzip / brotli by name) are opened in
 * every mode; in "artifacts" mode an archive that cannot be opened is itself a hit (it cannot be proven clean).
 */
export function scanBuffer(buf, where, opts, onHit, stats, depth = 0) {
  const { rules, matchers, mode } = opts;
  const unscannable = () => {
    if (mode === "artifacts") onHit({ where, line: 0, rule: "unscannable-archive" });
    else stats.skipped.push(`${where} (archive not readable)`);
  };
  if (depth > MAX_ARCHIVE_DEPTH) return unscannable();
  try {
    if (buf.subarray(0, 4).equals(ZIP_MAGIC) || buf.subarray(0, 4).equals(EMPTY_ZIP)) {
      for (const entry of readZip(buf)) {
        scanBuffer(entry.data, `${where}!${entry.name}`, opts, onHit, stats, depth + 1);
      }
      return;
    }
    if (buf.subarray(0, 2).equals(GZIP_MAGIC)) {
      const inner = gunzipSync(buf, { maxOutputLength: MAX_INFLATED_BYTES });
      return scanBuffer(inner, `${where}!gunzip`, opts, onHit, stats, depth + 1);
    }
    if (/\.br$/i.test(where)) {
      const inner = brotliDecompressSync(buf, { maxOutputLength: MAX_INFLATED_BYTES });
      return scanBuffer(inner, `${where}!brotli`, opts, onHit, stats, depth + 1);
    }
  } catch {
    return unscannable();
  }
  if (isBinary(buf)) {
    stats.binary += 1;
    return;
  }
  stats.scanned += 1;
  const text = buf.toString("utf8");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].endsWith("\r") ? lines[i].slice(0, -1) : lines[i];
    if (opts.skipLine?.(line)) continue;
    const lower = line.toLowerCase();
    for (const m of matchers) if (m.test(line, lower)) onHit({ where, line: i + 1, rule: m.id });
    for (const r of rules)
      if (r.test(line, opts.ctx ?? {})) onHit({ where, line: i + 1, rule: r.id });
    if (mode === "artifacts" && line.length > 40) {
      let k = 0;
      for (const m of line.matchAll(DATA_URI)) {
        k += 1;
        let decoded;
        try {
          decoded = Buffer.from(m[1], "base64");
        } catch {
          continue;
        }
        scanBuffer(decoded, `${where}:${i + 1}!data-uri#${k}`, opts, onHit, stats, depth + 1);
      }
    }
  }
}

/** a short stable digest (to name a fixture without printing it) */
export const digestOf = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 12);

/** "a b 'c d' \"e\"" → ["a", "b", "c d", "e"] (no shell is involved) */
export function splitCommand(text) {
  const out = [];
  let cur = "";
  let quote = null;
  let any = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < text.length) cur += text[++i];
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      any = true;
    } else if (/\s/.test(ch)) {
      if (cur || any) out.push(cur);
      cur = "";
      any = false;
    } else if (ch === "\\" && i + 1 < text.length) {
      cur += text[++i];
    } else cur += ch;
  }
  if (quote) throw new ScanError("unbalanced quote in the command");
  if (cur || any) out.push(cur);
  return out;
}
