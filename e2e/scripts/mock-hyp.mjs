// ============================================================
// Mock Hyp Pay — local / CI only (MAX/Hyp DEMO, evidence 05 §1). mock-services.mjs dispatches every
// /hyp/… and /__hyp/… request here, before its 503 fallback (Grow keeps the 503). The app reaches it
// only through MAX_PAY_TEST_URL=http://127.0.0.1:4010/hyp/p/ (app-up.sh). Nothing here talks to Hyp.
//
// Documented behaviour (as quoted in docs/payment-gateways/evidence/demo/01-hyp-protocol.md §1):
//   • action=APISign&What=SIGN (GET or POST): "a URL-encoded string containing all parameters and a
//     signature"; action "changes to pay"; other parameters "returned as-is". 902 = wrong PassP,
//     904 = missing What.
//   • Payment page = <base>?<SIGN response>. A paid page redirects the browser to the terminal's
//     success URL with Id, CCode, Amount, ACode, Order, Fild1, Fild2, Fild3, Sign (+ MoreData fields).
//   • No error URL (Hyp's recommendation): a decline stays on Hyp's page. 600/700/800 without an error
//     URL go to the success URL.
//   • action=APISign&What=VERIFY + Masof, KEY, PassP + "all parameters from the redirect URL, in their
//     original order": CCode=0 = valid; 200 = missing parameters; 902; 904.
// MOCK ASSUMPTIONS (undocumented; app code must not depend on them):
//   MA-1  SIGN echo: raw parameter segments in ASCII key order (What included), KEY/PassP removed,
//         `signature` (64 hex) last.
//   MA-2  Wrong KEY or unknown Masof → 902, like a wrong PassP.
//   MA-3  SIGN with a parameter DEMO never sends (invoice, installments, J5/postpone, HK, UserId,
//         sendemail, tOwner) → mock-only CCode 9902. Real Hyp would accept it.
//   MA-4  Any other action / What (refunds, cancel, tokens, links) → mock-only CCode 9903.
//   MA-5  Return order: the documented base set, then MoreData in the documented table order, then
//         extras (HeshASM, HKId, MULTI, Info), `Sign` last. Fild1 = client name, Fild2 = email,
//         Fild3 empty; non-ASCII as UTF-8 unless the win1255 switch is set. Amount/Order echoed raw.
//   MA-6  Formats: signature/Sign = 64 hex; Id = 12 digits derived from (terminal, Order, n);
//         sentinel values from e2e/fixtures/hyp-fake.mjs.
//   MA-7  "Each payment session can only be used once": approve uses the page up; decline and cancel
//         do not. Cancel never redirects (the shopper just leaves).
//   MA-8  VERIFY = 0 only when the return is byte-for-byte the one the mock issued (order, empty
//         values, percent-encoding) and Masof/KEY/PassP are those of the issuing terminal; otherwise
//         mock-only 9901 (Hyp's tamper code is undocumented); a missing base parameter → 200.
//   MA-9  An authentic decline or hold return verifies with 0: VERIFY proves authenticity, not approval.
//   MA-10 POST bodies are read as application/x-www-form-urlencoded (Hyp does not document the type).
//   MA-11 API answers are text/plain; system errors are HTML.
// Deterministic: no randomness. signature, Sign and Id are HMACs of a fixed seed the app never sees;
// the only per-run values are the canary KEY/PassP, built from the run id app-up.sh passes in.
// Control (tests only): POST /__hyp/reset · POST /__hyp/scenario · GET /__hyp/calls ·
// GET /__hyp/scenarios · GET /__hyp/terminals (the run's fake credentials, for the specs).
// ============================================================
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import {
  HYP_FAKE_NOTICE,
  HYP_FAKE_TERMINALS,
  HYP_HEBREW_TEXT,
  HYP_MOCK_CODES,
  HYP_PAGE_TESTIDS,
  HYP_SENTINELS,
  hypFakeCredentials,
} from "../fixtures/hyp-fake.mjs";

/** Fixed seed: signatures, Sign values and transaction Ids are deterministic; the app never knows it */
const SEED = "nuriel-e2e-mock-hyp-seed-v1";
const ENDPOINT_PATHS = new Set(["/hyp/p/", "/hyp/p"]);
/** The documented base set of a payment completion redirect (creating-a-payment-page example) */
const BASE_RETURN_KEYS = [
  "Id",
  "CCode",
  "Amount",
  "ACode",
  "Order",
  "Fild1",
  "Fild2",
  "Fild3",
  "Sign",
];
/** The five fixed VERIFY parameters (pay/reference/actions#validate-a-transaction) */
const VERIFY_FIXED = new Set(["action", "What", "Masof", "KEY", "PassP"]);
/** Never echoed (unless the echo_secret switch asks), and never recorded with a value */
const SECRET_NAMES = new Set(["key", "passp", "zpass"]);
/** Evidence 01 §1.2 "Not sent in DEMO" (MA-3) */
const FORBIDDEN_SIGN = new Set(
  [
    "SendHesh",
    "sendHeshSMS",
    "Pritim",
    "heshDesc",
    "sendemail",
    "Tash",
    "FixTash",
    "tashType",
    "ShowEngTashText",
    "J5",
    "Postpone",
    "HK",
    "freq",
    "TashFirstPayment",
    "FirstPaymentTash",
    "OnlyOnApprove",
    "UserId",
    "tOwner",
  ].map((n) => n.toLowerCase()),
);
const isForbiddenSign = (key) => FORBIDDEN_SIGN.has(key.toLowerCase()) || /^ez\./i.test(key);
/** A documented decline code ("Transaction not approved") for the decline_redirect switch */
const DEFAULT_DECLINE_CCODE = "4";
const OVERSIZE_PAD = 70_000;
const REDIRECT_ELSEWHERE = "http://hyp-redirect.invalid/p/";

// ---- scenario switches (evidence 05 §1.3) ----
const TRANSPORT = [
  "html_200",
  "html_with_ccode0",
  "garbage_200",
  "json_200",
  "http_500",
  "http_503",
  "timeout",
  "reset",
  "oversize",
  "redirect_3xx",
];
const SWITCHES = {
  sign: new Set([
    "ok",
    "creds",
    "no_what",
    "echo_secret",
    "no_signature",
    "no_action_pay",
    ...TRANSPORT,
  ]),
  verify: new Set([
    "ok",
    "fail_code",
    "fail_200",
    "creds",
    "no_what",
    "trailing_crlf",
    "ccode_00",
    "ccode_space",
    "ccode_dup",
    "lenient",
    ...TRANSPORT,
  ]),
  page: new Set([
    "approve",
    "decline",
    "cancel",
    "moredata_off",
    "win1255",
    "utf8",
    "dup_param",
    "extra_secret_param",
    "hold_600",
    "hold_700",
    "hold_800",
    "hesh",
    "hesh_empty",
    "hesh_zero",
    "heshasm",
    "hkid",
    "multi",
    "repeatable",
  ]),
};
const SLOW = /^slow:(\d{1,5})$/;
const FLAKY = /^flaky:(\d{1,3})$/;
const DECLINE_REDIRECT = /^decline_redirect(?::(\d{1,3}))?$/;
const PAGE_OUTCOMES = new Set(["approve", "decline", "cancel"]);

const HTML = "text/html; charset=utf-8";
const TEXT = "text/plain; charset=utf-8";
const GARBAGE = Buffer.from([
  0x00, 0xff, 0xfe, 0x3d, 0x26, 0x26, 0x3d, 0x25, 0x00, 0x7f, 0x80, 0x0a,
]);

const hmacHex = (key, data) => createHmac("sha256", key).update(data).digest("hex");
const terminalSecret = (masof) => createHmac("sha256", SEED).update(`terminal|${masof}`).digest();
/** Transaction Id: 12 digits, derived from (terminal, Order, n) — never repeats across runs, no randomness */
const txnId = (masof, order, n) => {
  const h = hmacHex(SEED, `id|${masof}|${order}|${n}`);
  return `7${(BigInt(`0x${h.slice(0, 16)}`) % 10n ** 11n).toString().padStart(11, "0")}`;
};

const decode = (s) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return null;
  }
};
/** "a=1&b=2" → segments; every segment is kept (empty ones too), so raw strings can be rebuilt exactly */
const segmentsOf = (s) =>
  s
    ? s.split("&").map((raw) => {
        const eq = raw.indexOf("=");
        const rawKey = eq < 0 ? raw : raw.slice(0, eq);
        const rawValue = eq < 0 ? "" : raw.slice(eq + 1);
        return { raw, rawKey, rawValue, key: decode(rawKey) ?? rawKey, value: decode(rawValue) };
      })
    : [];
const nonEmpty = (segs) => segs.filter((s) => s.raw !== "");
const valueOf = (segs, key) => {
  const seg = segs.find((s) => s.key === key);
  return seg ? (seg.value ?? seg.rawValue) : null;
};
const comparable = (s) => [s.key, s.value ?? s.rawValue];

/** Percent-encodes `text` as Windows-1255 bytes (Hebrew letters → 0xE0–0xFA; others → "?") */
function win1255(text) {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0x3f;
    if (/[A-Za-z0-9\-_.~]/.test(ch)) out += ch;
    else if (code < 0x80) out += `%${code.toString(16).toUpperCase().padStart(2, "0")}`;
    else if (code >= 0x5d0 && code <= 0x5ea)
      out += `%${(0xe0 + code - 0x5d0).toString(16).toUpperCase()}`;
    else out += "%3F";
  }
  return out;
}

/** Masks KEY / PassP / zPass values in a parameter string (for the shared /__calls list) */
function redactParams(s) {
  return s
    .split("&")
    .map((seg) => {
      const eq = seg.indexOf("=");
      if (eq < 0) return seg;
      const key = decode(seg.slice(0, eq)) ?? "";
      return SECRET_NAMES.has(key.toLowerCase()) ? `${seg.slice(0, eq)}=[redacted]` : seg;
    })
    .join("&");
}
const redactUrl = (url) => {
  const q = url.indexOf("?");
  return q < 0 ? url : `${url.slice(0, q + 1)}${redactParams(url.slice(q + 1))}`;
};

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function pageHtml({ amount, hint, actionUrl, status, error, buttons }) {
  const T = HYP_PAGE_TESTIDS;
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>דף תשלום מדומה — בדיקות בלבד</title>
</head>
<body data-testid="${T.page}" style="font-family: sans-serif; max-width: 32rem; margin: 2rem auto; padding: 0 1rem">
<h1>דף תשלום מדומה</h1>
<p>${esc(HYP_FAKE_NOTICE)}. אין בדף הזה שדות כרטיס.</p>
${error ? `<p role="alert" data-testid="${T.error}">${esc(error)}</p>` : ""}
${amount !== null ? `<p>סכום: <span dir="ltr" data-testid="${T.amount}">${esc(amount)}</span></p>` : ""}
${hint ? `<p>מסוף: <span dir="ltr">…${esc(hint)}</span></p>` : ""}
${
  buttons
    ? `<form method="post" action="${esc(actionUrl)}">
<button type="submit" name="__choice" value="approve" data-testid="${T.approve}">אישור התשלום</button>
<button type="submit" name="__choice" value="decline" data-testid="${T.decline}">דחיית התשלום</button>
<button type="submit" name="__choice" value="cancel" data-testid="${T.cancel}">ביטול</button>
</form>`
    : ""
}
${status ? `<p role="status" data-testid="${T.status}">${esc(status)}</p>` : ""}
</body>
</html>
`;
}

/**
 * One entry of the Hyp call log (GET /__hyp/calls): parameter NAMES only, never values of KEY/PassP.
 * @typedef {{ seq: number, method: string | undefined, path: string,
 *   action: "SIGN" | "VERIFY" | "PAGE" | "OTHER", what: string | null, query_keys: string[],
 *   body_keys: string[], content_type: string | null, masof: string | null, order: string | null,
 *   choice: string | null, result: string | null }} HypCall
 */

/**
 * The mock. `runId` (from app-up.sh, HYP_MOCK_RUN_ID) makes the canary credentials unique per run.
 * `externalCalls` = mock-services' shared /__calls list (gets a copy without KEY/PassP values).
 * `hangMs` = how long the `timeout` switch holds a request before dropping it.
 * @param {{ runId: string, externalCalls?: Array<Record<string, unknown>> | null, hangMs?: number }} options
 */
export function createHypMock({ runId, externalCalls = null, hangMs = 60_000 }) {
  const creds = hypFakeCredentials(runId);
  const T = HYP_FAKE_TERMINALS;
  const named = Object.freeze({
    platform: Object.freeze({ ...T.platform, ...creds.platform }),
    storeA: Object.freeze({ ...T.storeA, ...creds.storeA }),
    storeB: Object.freeze({ ...T.storeB, ...creds.storeB }),
    liveShaped: Object.freeze({ ...T.liveShaped, ...creds.liveShaped }),
  });
  const terminals = Object.values(named);
  const byMasof = new Map(terminals.map((t) => [t.masof, t]));
  const byLabel = new Map(terminals.map((t) => [t.label, t]));

  /** Reset by /__hyp/reset */
  let scenarios = [];
  let pages = new Map(); // signature → issued payment page
  let returns = new Map(); // Sign → the genuine return the mock issued
  let approvals = new Map(); // "<masof>|<order>" → returns issued so far
  /** @type {HypCall[]} */
  let log = [];
  /** Never reset: call numbers and signatures never repeat within the process */
  let callSeq = 0;
  let signSeq = 0;
  let scenarioSeq = 0;

  const send = (res, status, type, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...headers });
    res.end(body);
  };
  const json = (res, status, value) => send(res, status, "application/json", JSON.stringify(value));

  function reset() {
    scenarios = [];
    pages = new Map();
    returns = new Map();
    approvals = new Map();
    log = [];
  }

  // ---- scenarios ----
  function resolveTarget(target) {
    const t = String(target ?? "global");
    if (t === "global") return { target: "global", targetValue: null };
    const term = /^terminal:(.+)$/.exec(t);
    if (term) {
      const found = byMasof.get(term[1]) ?? byLabel.get(term[1]);
      if (!found) throw new Error("unknown terminal (use a fake Masof or a label)");
      return { target: "terminal", targetValue: found.masof };
    }
    const order = /^order:([\x21-\x7e]{1,128})$/.exec(t);
    if (order) return { target: "order", targetValue: order[1] };
    throw new Error('target must be "global", "terminal:<masof|label>" or "order:<ref>"');
  }
  function parseSwitch(kind, raw) {
    if (kind === "page") {
      const list = (Array.isArray(raw) ? raw : String(raw).split(","))
        .map((s) => String(s).trim())
        .filter(Boolean);
      if (list.length === 0) throw new Error("page: empty switch");
      for (const v of list)
        if (!SWITCHES.page.has(v) && !DECLINE_REDIRECT.test(v))
          throw new Error(`page: unknown switch ${v}`);
      return list;
    }
    const v = String(raw).trim();
    if (SWITCHES[kind].has(v) || SLOW.test(v) || (kind === "verify" && FLAKY.test(v))) return v;
    throw new Error(`${kind}: unknown switch ${v}`);
  }
  function addScenario(spec) {
    if (!spec || typeof spec !== "object") throw new Error("body must be a JSON object");
    const target = resolveTarget(spec.target);
    let times = null;
    if (spec.times !== undefined && spec.times !== null) {
      if (!Number.isInteger(spec.times) || spec.times < 1 || spec.times > 1000)
        throw new Error("times must be an integer 1-1000");
      times = spec.times;
    }
    const parsed = [];
    for (const kind of ["sign", "verify", "page"]) {
      if (spec[kind] === undefined) continue;
      let value = parseSwitch(kind, spec[kind]);
      let remaining = times;
      const flaky = typeof value === "string" ? FLAKY.exec(value) : null;
      // flaky:<n> = the first n VERIFY calls get an HTML system error, then normal answers
      if (flaky) {
        value = "html_200";
        remaining = Math.max(1, Number(flaky[1]));
      }
      parsed.push({ kind, value, label: spec[kind], ...target, remaining });
    }
    if (parsed.length === 0) throw new Error("set at least one of sign, verify, page");
    // all or nothing: nothing is added when one switch is invalid
    const added = parsed.map((entry) => {
      scenarioSeq += 1;
      return { id: scenarioSeq, ...entry };
    });
    scenarios.push(...added);
    return added;
  }
  /** Most specific first: order, then terminal, then global; within a level the latest wins */
  function findScenario(kind, { order, masof }) {
    for (const [type, value] of [
      ["order", order],
      ["terminal", masof],
      ["global", null],
    ]) {
      if (type !== "global" && !value) continue;
      for (let i = scenarios.length - 1; i >= 0; i -= 1) {
        const s = scenarios[i];
        if (s.kind === kind && s.target === type && (type === "global" || s.targetValue === value))
          return s;
      }
    }
    return null;
  }
  function takeScenario(kind, where) {
    const s = findScenario(kind, where);
    if (!s) return null;
    if (s.remaining !== null) {
      s.remaining -= 1;
      if (s.remaining <= 0) scenarios = scenarios.filter((x) => x !== s);
    }
    return s.value;
  }

  // ---- requests ----
  function readRequest(req, body) {
    const url = req.url ?? "/";
    const q = url.indexOf("?");
    const path = q < 0 ? url : url.slice(0, q);
    const query = q < 0 ? "" : url.slice(q + 1);
    const contentType = req.headers["content-type"] ? String(req.headers["content-type"]) : null;
    const form =
      req.method === "POST" &&
      body &&
      (!contentType || /^application\/x-www-form-urlencoded\b/i.test(contentType))
        ? body
        : "";
    const paramString = [query, form].filter(Boolean).join("&");
    return {
      path,
      contentType,
      querySegs: segmentsOf(query),
      bodySegs: segmentsOf(form),
      segs: segmentsOf(paramString),
    };
  }
  /**
   * @param {HypCall["action"]} action
   * @param {{ masof?: string | null, order?: string | null, choice?: string | null }} [where]
   * @returns {HypCall}
   */
  function logCall(req, r, action, { masof = null, order = null, choice = null } = {}) {
    callSeq += 1;
    /** @type {HypCall} */
    const entry = {
      seq: callSeq,
      method: req.method,
      path: r.path,
      action,
      what: valueOf(r.segs, "What"),
      query_keys: nonEmpty(r.querySegs).map((s) => s.key),
      body_keys: nonEmpty(r.bodySegs).map((s) => s.key),
      content_type: req.method === "POST" ? r.contentType : null,
      masof,
      order,
      choice,
      result: null,
    };
    log.push(entry);
    return entry;
  }
  const authenticate = (get) => {
    const t = byMasof.get(get("Masof") ?? "");
    return t && get("KEY") === t.key && get("PassP") === t.passp ? t : null;
  };
  /** A URL-encoded API answer (MA-11); `sw === "oversize"` pads it past 64 KB */
  const answer = (res, entry, body, result, sw = null) => {
    entry.result = result;
    send(res, 200, TEXT, sw === "oversize" ? `${body}&Pad=${"x".repeat(OVERSIZE_PAD)}` : body);
  };
  /** Transport-level switches shared by SIGN and VERIFY; true = the response is handled */
  function transport(req, res, sw, entry, respond) {
    if (!sw) return false;
    const slow = SLOW.exec(sw);
    if (slow) {
      entry.result = sw;
      const timer = setTimeout(respond, Math.min(Number(slow[1]), 60_000));
      res.on("close", () => clearTimeout(timer));
      return true;
    }
    const raw = (status, type, body) => {
      entry.result = sw;
      send(res, status, type, body);
      return true;
    };
    switch (sw) {
      case "timeout": {
        entry.result = "timeout";
        const timer = setTimeout(() => req.socket.destroy(), hangMs);
        res.on("close", () => clearTimeout(timer));
        return true;
      }
      case "reset":
        entry.result = "reset";
        req.socket.destroy();
        return true;
      case "http_500":
        return raw(
          500,
          HTML,
          "<!DOCTYPE html><html><body><h1>500 Internal Server Error</h1></body></html>",
        );
      case "http_503":
        return raw(
          503,
          HTML,
          "<!DOCTYPE html><html><body><h1>503 Service Unavailable</h1></body></html>",
        );
      case "html_200":
        return raw(
          200,
          HTML,
          "<!DOCTYPE html><html><body><h1>System error (mock)</h1></body></html>",
        );
      case "html_with_ccode0":
        return raw(
          200,
          HTML,
          `<!DOCTYPE html><html><body><p>CCode=0</p><p>action=pay&amp;signature=${"0".repeat(64)}</p></body></html>`,
        );
      case "garbage_200":
        return raw(200, TEXT, GARBAGE);
      case "json_200":
        return raw(
          200,
          "application/json",
          JSON.stringify({ CCode: "0", action: "pay", signature: "0".repeat(64) }),
        );
      case "redirect_3xx":
        entry.result = sw;
        res.writeHead(302, { Location: REDIRECT_ELSEWHERE, "Cache-Control": "no-store" });
        res.end();
        return true;
      default:
        return false;
    }
  }

  function sign(req, res, r) {
    const masof = valueOf(r.segs, "Masof");
    const order = valueOf(r.segs, "Order");
    const entry = logCall(req, r, "SIGN", { masof, order });
    const sw = takeScenario("sign", { order, masof });
    const respond = () => {
      const t = authenticate((k) => valueOf(r.segs, k));
      if (sw === "creds" || !t) return answer(res, entry, "CCode=902", "902", sw);
      if (sw === "no_what") return answer(res, entry, "CCode=904", "904", sw);
      const forbidden = nonEmpty(r.segs).find((s) => isForbiddenSign(s.key));
      if (forbidden) {
        const code = HYP_MOCK_CODES.forbiddenParam;
        const body = `CCode=${code}&mockError=forbidden_param&mockParam=${encodeURIComponent(forbidden.key)}`;
        return answer(res, entry, body, code, sw);
      }
      const kept = [];
      for (const s of nonEmpty(r.segs)) {
        if (SECRET_NAMES.has(s.key.toLowerCase())) {
          if (sw === "echo_secret") kept.push(s);
        } else if (s.key === "action" && sw !== "no_action_pay") {
          kept.push({ ...s, raw: "action=pay", rawKey: "action", rawValue: "pay", value: "pay" });
        } else kept.push(s);
      }
      kept.sort((a, b) => (a.rawKey < b.rawKey ? -1 : a.rawKey > b.rawKey ? 1 : 0));
      const unsigned = kept.map((s) => s.raw).join("&");
      signSeq += 1;
      const signature = hmacHex(terminalSecret(t.masof), `SIGN|${signSeq}|${unsigned}`);
      if (sw === "no_signature") return answer(res, entry, unsigned, "ok", sw);
      const client = [valueOf(r.segs, "ClientName"), valueOf(r.segs, "ClientLName")].filter(
        Boolean,
      );
      pages.set(signature, {
        masof: t.masof,
        successUrl: t.successUrl,
        pairs: [...kept.map(comparable), ["signature", signature]],
        order: order ?? "",
        orderRaw: r.segs.find((s) => s.key === "Order")?.rawValue ?? "",
        amountRaw: r.segs.find((s) => s.key === "Amount")?.rawValue ?? "",
        amount: valueOf(r.segs, "Amount"),
        coinRaw: r.segs.find((s) => s.key === "Coin")?.rawValue ?? "",
        moreData: valueOf(r.segs, "MoreData") === "True",
        signFlag: valueOf(r.segs, "Sign") === "True",
        fild1: client.join(" "),
        fild2: valueOf(r.segs, "email") ?? "",
        cell: valueOf(r.segs, "cell"),
        used: false,
      });
      return answer(res, entry, `${unsigned}&signature=${signature}`, "ok", sw);
    };
    if (!transport(req, res, sw, entry, respond)) respond();
  }

  function verify(req, res, r) {
    // The five fixed parameters (first occurrence of each) vs. the rest = the return, byte for byte
    const fixed = new Map();
    const rest = [];
    for (const s of r.segs) {
      if (VERIFY_FIXED.has(s.key) && !fixed.has(s.key)) fixed.set(s.key, s);
      else rest.push(s);
    }
    const rawReturn = rest.map((s) => s.raw).join("&");
    const ret = nonEmpty(rest);
    const masof = fixed.get("Masof")?.value ?? null;
    const order = valueOf(ret, "Order");
    const entry = logCall(req, r, "VERIFY", { masof, order });
    const sw = takeScenario("verify", { order, masof });
    const respond = () => {
      const t = authenticate((k) => fixed.get(k)?.value ?? null);
      const code = (c) => (sw === "trailing_crlf" ? `CCode=${c}\r\n` : `CCode=${c}`);
      if (sw === "creds" || !t) return answer(res, entry, "CCode=902", "902", sw);
      if (sw === "no_what") return answer(res, entry, "CCode=904", "904", sw);
      if (sw === "ccode_00") return answer(res, entry, "CCode=00", "00", sw);
      if (sw === "ccode_space") return answer(res, entry, " CCode=0", "space", sw);
      if (sw === "ccode_dup") return answer(res, entry, "CCode=0&CCode=1", "dup", sw);
      const mismatch = HYP_MOCK_CODES.verifyMismatch;
      if (sw === "fail_code") return answer(res, entry, code(mismatch), mismatch, sw);
      if (sw === "fail_200") return answer(res, entry, code("200"), "200", sw);
      // lenient: 0 for any return, even a changed Amount/Order/Coin (our own binding must refuse it)
      if (sw === "lenient") return answer(res, entry, code("0"), "0", sw);
      const keys = new Set(ret.map((s) => s.key));
      const sign = valueOf(ret, "Sign");
      const issued = sign ? returns.get(sign) : undefined;
      const missing =
        BASE_RETURN_KEYS.some((k) => !keys.has(k)) ||
        (issued?.keys.some((k) => !keys.has(k)) ?? false);
      if (missing) return answer(res, entry, code("200"), "200", sw);
      const ok = !!issued && issued.masof === t.masof && issued.raw === rawReturn;
      return answer(res, entry, code(ok ? "0" : mismatch), ok ? "0" : mismatch, sw);
    };
    if (!transport(req, res, sw, entry, respond)) respond();
  }

  /** The return a paid (or redirected) page sends to the browser; registers the genuine one */
  function buildReturn(p, ccode, mods, approved) {
    const S = HYP_SENTINELS;
    const k = `${p.masof}|${p.order}`;
    const n = approvals.get(k) ?? 0;
    approvals.set(k, n + 1);
    const has = (m) => mods.includes(m);
    let fild1 = encodeURIComponent(p.fild1);
    let info = null;
    if (has("win1255")) fild1 = info = win1255(HYP_HEBREW_TEXT);
    else if (has("utf8")) fild1 = info = encodeURIComponent(HYP_HEBREW_TEXT);
    const hesh = has("hesh") ? S.Hesh : has("hesh_zero") ? "0" : has("hesh_empty") ? "" : null;
    const pairs = [
      ["Id", txnId(p.masof, p.order, n)],
      ["CCode", ccode],
      ["Amount", p.amountRaw],
      ["ACode", approved ? S.ACode : ""],
      ["Order", p.orderRaw],
      ["Fild1", fild1],
      ["Fild2", encodeURIComponent(p.fild2)],
      ["Fild3", ""],
    ];
    if (p.moreData && !has("moredata_off")) {
      pairs.push(
        ["Bank", S.Bank],
        ["TransType", encodeURIComponent(S.TransType)],
        ["Payments", S.Payments],
        ["UserId", S.UserId],
        ["Brand", S.Brand],
        ["Issuer", S.Issuer],
        ["L4digit", S.L4digit],
      );
      if (p.cell) pairs.push(["cell", encodeURIComponent(p.cell)]);
      pairs.push(["Coin", p.coinRaw || "1"], ["Tmonth", S.Tmonth], ["Tyear", S.Tyear]);
      if (hesh !== null) pairs.push(["Hesh", hesh]);
      pairs.push(["UID", S.UID], ["bincard", S.bincard]);
    } else if (hesh !== null) pairs.push(["Hesh", hesh]);
    if (has("heshasm")) pairs.push(["HeshASM", S.HeshASM]);
    if (has("hkid")) pairs.push(["HKId", S.HKId]);
    if (has("multi")) pairs.push(["MULTI", S.MULTI]);
    if (info !== null) pairs.push(["Info", info]);
    const unsigned = pairs.map(([key, value]) => `${key}=${value}`).join("&");
    const sign = p.signFlag ? hmacHex(terminalSecret(p.masof), `RETURN|${unsigned}`) : null;
    if (sign) {
      const raw = `${unsigned}&Sign=${sign}`;
      returns.set(sign, {
        masof: p.masof,
        order: p.order,
        raw,
        keys: [...pairs.map(([key]) => key), "Sign"],
      });
    }
    // Attacks on the genuine return: the registered one stays genuine, so VERIFY of this one fails
    const inject = [];
    if (has("dup_param")) inject.push(`Amount=${p.amountRaw === "1" ? "2" : "1"}`);
    if (has("extra_secret_param")) inject.push(`PassP=${S.injectedPassP}`);
    const delivered = [unsigned, ...inject, ...(sign ? [`Sign=${sign}`] : [])].join("&");
    return `${p.successUrl}?${delivered}`;
  }

  function page(req, res, r) {
    const choices = r.segs.filter((s) => s.key === "__choice");
    const explicit = choices.length > 0 ? (choices[choices.length - 1]?.value ?? null) : null;
    const params = nonEmpty(r.segs).filter((s) => s.key !== "__choice");
    const signature = valueOf(params, "signature");
    const p = signature ? pages.get(signature) : undefined;
    const entry = logCall(req, r, "PAGE", {
      masof: p?.masof ?? valueOf(params, "Masof"),
      order: p?.order ?? valueOf(params, "Order"),
      choice: explicit,
    });
    const html = (status, opts) => send(res, status, HTML, pageHtml(opts));
    const fail = (reason, message) => {
      entry.result = `error:${reason}`;
      html(200, {
        amount: null,
        hint: null,
        actionUrl: "",
        status: null,
        error: message,
        buttons: false,
      });
    };
    if (!p) return fail("unknown_signature", "שגיאה: חתימה לא מוכרת (הדף לא נוצר בשרת המדומה)");
    const same =
      params.length === p.pairs.length &&
      params.every((s, i) => {
        const [key, value] = comparable(s);
        return key === p.pairs[i]?.[0] && value === p.pairs[i]?.[1];
      });
    if (!same) return fail("changed", "שגיאה: פרטי הדף שונו אחרי החתימה");
    const where = { order: p.order, masof: p.masof };
    const auto = findScenario("page", where)?.value.find((m) => PAGE_OUTCOMES.has(m)) ?? null;
    const choice = explicit ?? auto;
    const actionUrl = `${r.path}?${params.map((s) => s.raw).join("&")}`;
    const render = (state, status) => {
      entry.result = state;
      html(200, {
        amount: p.amount,
        hint: p.masof.slice(-2),
        actionUrl,
        status,
        error: null,
        buttons: state !== "cancelled",
      });
    };
    if (!choice) return render("page", null);
    if (!PAGE_OUTCOMES.has(choice)) return fail("bad_choice", "שגיאה: בחירה לא מוכרת");
    const mods = takeScenario("page", where) ?? [];
    const redirect = (location, code) => {
      entry.result = `redirect:${code}`;
      res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
      res.end();
    };
    if (choice === "approve") {
      const repeatable = mods.includes("repeatable");
      if (p.used && !repeatable)
        return fail("used", "שגיאה: הדף הזה כבר שולם (כל דף תשלום משמש פעם אחת)");
      const hold = mods.find((m) => /^hold_\d+$/.test(m));
      const ccode = hold ? hold.slice("hold_".length) : "0";
      const location = buildReturn(p, ccode, mods, true);
      if (!repeatable) p.used = true;
      return redirect(location, ccode);
    }
    if (choice === "decline") {
      const dr = mods.map((m) => DECLINE_REDIRECT.exec(m)).find(Boolean);
      if (dr) {
        const ccode = dr[1] ?? DEFAULT_DECLINE_CCODE;
        return redirect(buildReturn(p, ccode, mods, false), ccode);
      }
      return render("declined", "העסקה נדחתה (בדיקה). אפשר לנסות שוב או לבטל.");
    }
    return render("cancelled", "התשלום בוטל (בדיקה). אין חזרה לאתר.");
  }

  function unsupported(req, res, r, action) {
    const entry = logCall(req, r, "OTHER", {
      masof: valueOf(r.segs, "Masof"),
      order: valueOf(r.segs, "Order"),
    });
    const code = HYP_MOCK_CODES.unsupported;
    const what = action === null ? "" : `&mockAction=${encodeURIComponent(action)}`;
    answer(res, entry, `CCode=${code}&mockError=unsupported${what}`, code);
  }

  // ---- control endpoints (tests only) ----
  function control(req, res, body) {
    const u = new URL(req.url ?? "/", "http://mock.invalid");
    const route = `${req.method} ${u.pathname}`;
    if (route === "POST /__hyp/reset") {
      reset();
      return json(res, 200, { ok: true });
    }
    if (route === "POST /__hyp/scenario") {
      try {
        const added = addScenario(JSON.parse(body || "null"));
        return json(res, 200, { ok: true, ids: added.map((s) => s.id) });
      } catch (error) {
        return json(res, 400, { error: error instanceof Error ? error.message : "bad scenario" });
      }
    }
    if (route === "GET /__hyp/scenarios") return json(res, 200, scenarios);
    if (route === "GET /__hyp/calls") {
      const order = u.searchParams.get("order");
      const action = u.searchParams.get("action")?.toUpperCase() ?? null;
      const m = u.searchParams.get("masof");
      const masof = m ? (byLabel.get(m)?.masof ?? m) : null;
      return json(
        res,
        200,
        log.filter(
          (e) =>
            (!order || e.order === order) &&
            (!action || e.action === action) &&
            (!masof || e.masof === masof),
        ),
      );
    }
    if (route === "GET /__hyp/terminals")
      return json(res, 200, {
        notice: HYP_FAKE_NOTICE,
        terminals: terminals.map(({ label, scope, tenantSlug, masof, key, passp, successUrl }) => ({
          label,
          scope,
          tenantSlug,
          masof,
          key,
          passp,
          successUrl,
        })),
      });
    return json(res, 404, { error: "unknown mock Hyp control endpoint" });
  }

  /** Handles /hyp/… and /__hyp/…; false = not a Hyp request (the caller goes on) */
  function handle(req, res, body = "") {
    const url = req.url ?? "/";
    const path = url.split("?")[0] ?? "";
    if (path.startsWith("/__hyp/")) {
      control(req, res, body);
      return true;
    }
    if (path !== "/hyp" && !path.startsWith("/hyp/")) return false;
    externalCalls?.push({
      method: req.method,
      url: redactUrl(url),
      body: redactParams(body).slice(0, 100_000),
      at: Date.now(),
    });
    const r = readRequest(req, body);
    if (!ENDPOINT_PATHS.has(r.path)) {
      logCall(req, r, "OTHER").result = "404";
      send(res, 404, TEXT, "mock Hyp: unknown path");
      return true;
    }
    const action = valueOf(r.segs, "action");
    if (action === "pay") page(req, res, r);
    else if (action !== "APISign") unsupported(req, res, r, action);
    else {
      const what = valueOf(r.segs, "What");
      if (what === "SIGN") sign(req, res, r);
      else if (what === "VERIFY") verify(req, res, r);
      else if (what === null) {
        const entry = logCall(req, r, "OTHER", { masof: valueOf(r.segs, "Masof") });
        answer(res, entry, "CCode=904", "904");
      } else unsupported(req, res, r, `APISign/${what}`);
    }
    return true;
  }

  return {
    handle,
    reset,
    /** The run's fake terminals with their canary credentials */
    terminals: named,
    /** The Hyp call log (names only — never KEY/PassP values) */
    calls: () => log.slice(),
  };
}

/**
 * A server that serves only the Hyp mock (unit tests). mock-services.mjs embeds `handle` instead.
 * @param {{ runId: string, externalCalls?: Array<Record<string, unknown>> | null, hangMs?: number }} options
 */
export function createHypMockServer(options) {
  const mock = createHypMock(options);
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (!mock.handle(req, res, body)) {
        res.writeHead(404, { "Content-Type": TEXT });
        res.end("not a mock Hyp path");
      }
    });
  });
  return { server, mock };
}
