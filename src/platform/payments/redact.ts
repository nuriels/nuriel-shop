/**
 * Online payments — the single redactor for every payment log line (DM-SEC-7). Server-side use only.
 *
 * Masks values, matching names case-insensitively, in:
 * - query strings, plain (`?name=value&…`) or %-encoded once (`name%3Dvalue%26…`);
 * - JSON-like text: `"name":"value"`, `'name': 'value'`, `name: value` (also numbers and \"escaped\" strings).
 * Rules:
 * - fully masked ("***"): KEY, PassP, zPass, Sign, signature, UserId, bincard/BinCard, Tmonth, Tyear, L4digit,
 *   cell, email, ClientName, ClientLName — plus the other customer fields Hyp sends back on a return
 *   (Fild1–Fild3, street, city, zip, UID), since Hyp asks to mask "any customer-related parameters";
 * - Masof (and the terminal_number / terminalNumber column names): only the last 2 characters stay ("…12");
 * - any Luhn-valid run of 13–19 digits, contiguous or grouped by single spaces/dashes → "[card]".
 * Never throws; applying it twice gives the same text.
 */

const FULL_MASK_NAMES = [
  "KEY",
  "PassP",
  "zPass",
  "Sign",
  "signature",
  "UserId",
  "bincard",
  "Tmonth",
  "Tyear",
  "L4digit",
  "cell",
  "email",
  "ClientName",
  "ClientLName",
  "Fild1",
  "Fild2",
  "Fild3",
  "street",
  "city",
  "zip",
  "UID",
];
const TERMINAL_NAMES = ["Masof", "terminal_number", "terminalNumber"];

const MASK = "***";
const CARD_MASK = "[card]";

/** Longest first, so `signature` is tried before `Sign`. */
const alternation = (names: string[]) => [...names].sort((a, b) => b.length - a.length).join("|");

/** Not preceded by a name character: `api_key=` or `monkey=` are other names. */
const NAME_START = String.raw`(?<![A-Za-z0-9_.\-])`;
/** A %-encoded name starts after `%26` (&) or `%3F` (?), or like a plain one. */
const ENCODED_NAME_START = String.raw`(?:(?<=%26)|(?<=%3F)|${NAME_START})`;
/** A plain query value: up to `&`, whitespace or a quote; a backslash escapes the next character. */
const PLAIN_VALUE = String.raw`(?<value>(?:\\.|[^&\s"'\\])*)`;
/** A %-encoded query value: as plain, and also up to the next `%26`. */
const ENCODED_VALUE = String.raw`(?<value>(?:(?!%26)(?:\\.|[^&\s"'\\]))*)`;
/**
 * JSON-like value: "…" / '…' with escapes, \"…\" (escaped JSON inside a string, up to 7 backslashes), or a bare
 * token. Quoted forms are bounded (VALUE_MAX characters) so that many unterminated values cannot make the scan
 * quadratic; a longer quoted value falls back to the bare token. Secrets and customer fields are far shorter.
 */
const VALUE_MAX = 1024;
const JSON_VALUE = String.raw`(?<value>"(?:\\.|[^"\\\n]){0,${VALUE_MAX}}"|'(?:\\.|[^'\\\n]){0,${VALUE_MAX}}'|(?<eq>\\{1,7}["'])(?:(?!\k<eq>)[^\n]){0,${VALUE_MAX}}\k<eq>|[^\s,}\]]+)`;
/** The quote around a JSON-like name: none, ' or ", or an escaped one (\" up to 7 backslashes). */
const NAME_QUOTE = String.raw`(?<q>\\{1,7}["']|["']?)`;

interface Patterns {
  json: RegExp;
  plain: RegExp;
  encoded: RegExp;
}

function patterns(names: string[]): Patterns {
  const alt = alternation(names);
  return {
    json: new RegExp(
      String.raw`${NAME_START}${NAME_QUOTE}(?<name>${alt})\k<q>(?<sep>\s*:\s*)${JSON_VALUE}`,
      "gi",
    ),
    plain: new RegExp(String.raw`${NAME_START}(?<name>${alt})(?<sep>=)${PLAIN_VALUE}`, "gi"),
    encoded: new RegExp(
      String.raw`${ENCODED_NAME_START}(?<name>${alt})(?<sep>%3D)${ENCODED_VALUE}`,
      "gi",
    ),
  };
}

const FULL = patterns(FULL_MASK_NAMES);
const TERMINAL = patterns(TERMINAL_NAMES);

type Groups = Record<string, string | undefined>;
/** The named groups of a String.prototype.replace callback (always its last argument). */
const groupsOf = (args: unknown[]): Groups => args[args.length - 1] as Groups;

const fullMask = (value: string) => (value === "" ? "" : MASK);

/** Last 2 characters only; values already masked stay as they are. */
function terminalMask(value: string): string {
  if (value === "" || value === MASK || value.startsWith("…")) return value;
  return value.length > 2 ? `…${value.slice(-2)}` : MASK;
}

/** Masks the inside of a JSON-like value and keeps its own quotes. */
function maskJsonValue(value: string, mask: (inner: string) => string): string {
  const quote = /^\\{0,7}["']/.exec(value)?.[0];
  if (quote && value.length >= quote.length * 2 && value.endsWith(quote))
    return `${quote}${mask(value.slice(quote.length, value.length - quote.length))}${quote}`;
  return mask(value);
}

function applyPatterns(text: string, p: Patterns, mask: (value: string) => string): string {
  return text
    .replace(p.json, (...args: unknown[]) => {
      const g = groupsOf(args);
      const q = g["q"] ?? "";
      return `${q}${g["name"] ?? ""}${q}${g["sep"] ?? ""}${maskJsonValue(g["value"] ?? "", mask)}`;
    })
    .replace(p.plain, (...args: unknown[]) => {
      const g = groupsOf(args);
      return `${g["name"] ?? ""}${g["sep"] ?? ""}${mask(g["value"] ?? "")}`;
    })
    .replace(p.encoded, (...args: unknown[]) => {
      const g = groupsOf(args);
      return `${g["name"] ?? ""}${g["sep"] ?? ""}${mask(g["value"] ?? "")}`;
    });
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Maximal runs of digit groups joined by single spaces or dashes. */
const DIGIT_GROUPS_RE = /(?<![0-9])[0-9]+(?:[ -][0-9]+)*(?![0-9])/g;
const MIN_PAN = 13;
const MAX_PAN = 19;

/** Masks every window of consecutive groups that holds 13–19 digits and passes Luhn. */
function maskCardNumbers(text: string): string {
  return text.replace(DIGIT_GROUPS_RE, (run) => {
    const groups: { start: number; end: number; digits: string }[] = [];
    for (const m of run.matchAll(/[0-9]+/g))
      groups.push({ start: m.index, end: m.index + m[0].length, digits: m[0] });
    const masked: boolean[] = groups.map(() => false);
    for (let i = 0; i < groups.length; i += 1) {
      let digits = "";
      for (let j = i; j < groups.length; j += 1) {
        digits += groups[j]?.digits ?? "";
        if (digits.length > MAX_PAN) break;
        if (digits.length >= MIN_PAN && luhnValid(digits)) masked.fill(true, i, j + 1);
      }
    }
    if (!masked.includes(true)) return run;
    let out = "";
    let cursor = 0;
    for (let i = 0; i < groups.length; i += 1) {
      if (!masked[i]) continue;
      let j = i;
      while (j + 1 < groups.length && masked[j + 1]) j += 1;
      out += run.slice(cursor, groups[i]?.start ?? cursor) + CARD_MASK;
      cursor = groups[j]?.end ?? cursor;
      i = j;
    }
    return out + run.slice(cursor);
  });
}

/** Redacts one payment log line (or any text about to be logged). */
export function redactPaymentText(s: string): string {
  let text: string;
  try {
    text = typeof s === "string" ? s : String(s);
  } catch {
    return MASK;
  }
  text = applyPatterns(text, FULL, fullMask);
  text = applyPatterns(text, TERMINAL, terminalMask);
  return maskCardNumbers(text);
}
