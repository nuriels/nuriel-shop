// U17 — the MAX/Hyp DEMO boundaries (DM-SEP-3) and the two negative capabilities (DM-NEG-1, DM-NEG-2).
//
// Rules U17-B1…B10 of docs/payment-gateways/evidence/demo/03-architecture.md §1.5, adapted to the file layout of
// docs/payment-gateways/DEMO-IMPLEMENTATION-CONTRACT.md §3: secret-touching code lives under
// src/platform/payments/server/ (Vite import protection covers only **/server/**), one folder per scope
// (server/tenant/, server/platform/), one root-secret reader per scope (server/tenant-keys.ts,
// server/platform-keys.ts; server/env.ts reads both only for the start-up sanity check).
//
// Same scanner as boundaries.test.ts (comments stripped; static, type, re-export, dynamic and relative imports).
// Every rule is a pure function over a {path → source} tree. Each one runs on the real tree (it must find nothing)
// and on a small synthetic tree (it must bite). So a rule about files that do not exist yet passes today and fails
// the moment such a file breaks it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SUSPENDED_ALLOWED_PATHS } from "@/lib/blocked-pages";

const ROOT = process.cwd();
const toRel = (abs: string) => relative(ROOT, abs).split("\\").join("/");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    return statSync(abs).isDirectory() ? walk(abs) : [toRel(abs)];
  });
}

/** repo-relative path (with /) → source */
type Tree = ReadonlyMap<string, string>;
const tree = (files: Record<string, string>): Tree => new Map(Object.entries(files));

/** every file under src/ (the "nowhere in src/" scans); CODE = its .ts/.tsx part (the import rules) */
const ALL: Tree = new Map(
  walk(join(ROOT, "src")).map((f) => [f, readFileSync(join(ROOT, f), "utf8")] as const),
);
const CODE: Tree = new Map([...ALL].filter(([f]) => /\.tsx?$/.test(f)));

// ------------------------------------------------------------------ scanner (as in boundaries.test.ts)

const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

interface Import {
  spec: string;
  /** repo-relative path without extension; null = a package */
  target: string | null;
  dynamic: boolean;
}

function importsOf(rel: string, code: string): Import[] {
  return [...stripComments(code).matchAll(IMPORT_RE)].map((m) => {
    const spec = (m[1] ?? m[2] ?? m[3])!;
    const path = spec.startsWith("@/")
      ? `src/${spec.slice(2)}`
      : spec.startsWith(".")
        ? normalize(join(dirname(rel), spec))
            .split("\\")
            .join("/")
        : null;
    return {
      spec,
      target: path === null ? null : path.replace(/\.(tsx?|m?js)$/, ""),
      dynamic: m[2] !== undefined,
    };
  });
}

/** a path, with or without its extension, matches one of the patterns */
const matchesAny = (patterns: readonly RegExp[], path: string) =>
  patterns.some((p) => p.test(path) || p.test(`${path}.ts`) || p.test(`${path}.tsx`));

// ------------------------------------------------------------------ the layout (contract §3)

const PAY = "src/platform/payments/";
const PAY_SERVER = `${PAY}server/`;
const SERVER_DB = `${PAY_SERVER}db.ts`;

/** shared and pure (provider.ts, registry.ts, max/protocol.ts, max/messages.ts, redact.ts, …): no I/O, no secrets */
const isPure = (f: string) => f.startsWith(PAY) && !f.startsWith(PAY_SERVER);

/** TENANT scope: a store's own terminal (PAYMENTS_SECRETS_KEY), store hosts, max_* functions */
const TENANT_SIDE: readonly RegExp[] = [
  /^src\/platform\/payments\/server\/tenant\//,
  /^src\/platform\/payments\/server\/tenant-keys\.ts$/,
  /^src\/lib\/online-payments[\w.-]*\.tsx?$/,
  /^src\/routes\/payments\.return\.\$provider\.ts$/,
  /^src\/routes\/checkout_\.pay\.\$orderId\.tsx$/,
  /^src\/components\/(checkout|orders|payments)\/OnlinePayment[\w-]*\.tsx$/,
  /^src\/components\/platform\/MaxPayments[\w-]*\.tsx$/,
];
/** PLATFORM scope: NURIEL's terminal (PLATFORM_TERMINAL_SECRETS_KEY), the platform host, platform_* functions */
const PLATFORM_SIDE: readonly RegExp[] = [
  /^src\/platform\/payments\/server\/platform\//,
  /^src\/platform\/payments\/server\/platform-keys\.ts$/,
  /^src\/platform\/payments\/server\/stepup\.ts$/,
  /^src\/platform\/billing\/pay[\w.-]*\.tsx?$/,
  /^src\/platform\/billing\/ui\/(Pay|PlatformTerminal)[\w-]*\.tsx$/,
  /^src\/components\/platform\/PlatformTerminal[\w-]*\.tsx$/,
  /^src\/routes\/platform_\.payments[\w.$-]*\.tsx?$/,
];
const isTenantSide = (f: string) => matchesAny(TENANT_SIDE, f);
const isPlatformSide = (f: string) => matchesAny(PLATFORM_SIDE, f);
const isPaymentsFile = (f: string) => f.startsWith(PAY) || isTenantSide(f) || isPlatformSide(f);
/** shared server modules, scope-neutral (env.ts, http.ts, crypto.ts, the service-role adapter db.ts) */
const isSharedServer = (f: string) =>
  /^src\/platform\/payments\/server\/[\w.-]+\.ts$/.test(f) &&
  !isTenantSide(f) &&
  !isPlatformSide(f);

/** the orchestration code of both scopes (wave 2): server functions, orchestrators, jobs, return routes */
const SCOPE_CODE: readonly RegExp[] = [
  /^src\/platform\/payments\/server\/(tenant|platform)\/[\w.-]+\.ts$/,
  /^src\/lib\/online-payments[\w.-]*\.ts$/,
  /^src\/platform\/billing\/pay[\w.-]*\.ts$/,
  /^src\/routes\/(payments\.return|platform_\.payments_\.return)\.\$provider\.ts$/,
];
const isScopeCode = (f: string) => matchesAny(SCOPE_CODE, f);

/** server-only by name or folder: never reachable from the browser bundle */
const isServerOnly = (path: string) =>
  /(^|\/)server(\/|$)/.test(path) || /\.server(\.tsx?)?$/.test(path);

const TENANT_RETURN_ROUTE = "src/routes/payments.return.$provider.ts";
const PLATFORM_RETURN_ROUTE = "src/routes/platform_.payments_.return.$provider.ts";
const TENANT_RETURN = `${PAY_SERVER}tenant/return.ts`;
const PLATFORM_RETURN = `${PAY_SERVER}platform/return.ts`;
const PLATFORM_START = `${PAY_SERVER}platform/pay.ts`;
const PLATFORM_TERMINAL = `${PAY_SERVER}platform/terminal.ts`;
/** the typed DB API declares every function name; it calls nothing */
const DECLARES_DB_API = "src/integrations/supabase/types.ts";

const code = (t: Tree, f: string) => stripComments(t.get(f) ?? "");
const each = (t: Tree, keep: (f: string) => boolean) => [...t].filter(([f]) => keep(f));

// ------------------------------------------------------------------ the rules

/** U17-B1: shared payment code is pure — it imports only its own set, no package, no I/O, no secret */
const IMPURE =
  /process\.env|import\.meta\.env|\bfetch\s*\(|supabase|XMLHttpRequest|\bWebSocket\b|\blocalStorage\b|\bsessionStorage\b|\bdocument\.|\bwindow\.|\bglobalThis\b|\bset(?:Interval|Timeout)\s*\(/;
function ruleB1(t: Tree): string[] {
  const bad: string[] = [];
  for (const [f, src] of each(t, (f) => isPure(f) && /\.tsx?$/.test(f))) {
    for (const imp of importsOf(f, src)) {
      if (imp.target === null) bad.push(`${f}: imports the package "${imp.spec}"`);
      else if (!isPure(imp.target)) bad.push(`${f} → ${imp.target}`);
    }
    const hit = stripComments(src).match(IMPURE);
    if (hit) bad.push(`${f}: uses ${hit[0]}`);
  }
  return bad;
}

/** names that belong to the other scope (DB functions, root secrets, key helpers, the platform step-up) */
const PLATFORM_NAMES: readonly RegExp[] = [
  /\bplatform_attempts?_/,
  /\bplatform_terminal_/,
  /\bplatform_card_/,
  /\bplatform_return_/,
  /\bplatform_stepup_/,
  /\bplatform_unreturned_attempts\b/,
  /\bPLATFORM_TERMINAL_SECRETS_KEY\b/,
  /\bplatformSecretCipher\b/,
  /\bstepupKey\b/,
  /\bcreateStepupService\b/,
];
const TENANT_NAMES: readonly RegExp[] = [
  /\bmax_attempts?_/,
  /\bmax_order_/,
  /\bmax_account_/,
  /\bmax_store_settings_/,
  /\bmax_review_/,
  /\bmax_unreturned_attempts\b/,
  /\bmax_return_/,
  /\bmax_payments/,
  /\bplatform_store_terminal_/,
  /\bPAYMENTS_SECRETS_KEY\b/,
  /\btenantSecretCipher\b/,
];

function crossScope(
  t: Tree,
  from: (f: string) => boolean,
  forbiddenTarget: (target: string) => boolean,
  names: readonly RegExp[],
): string[] {
  const bad: string[] = [];
  for (const [f, src] of each(t, from)) {
    for (const imp of importsOf(f, src))
      if (imp.target !== null && forbiddenTarget(imp.target)) bad.push(`${f} → ${imp.target}`);
    const stripped = stripComments(src);
    for (const name of names) if (name.test(stripped)) bad.push(`${f}: names ${name.source}`);
  }
  return bad;
}

/** U17-B2: the tenant side never reaches the platform side (code, platform billing, names, the platform key) */
const ruleB2 = (t: Tree) =>
  crossScope(
    t,
    isTenantSide,
    (target) => isPlatformSide(target) || target.startsWith("src/platform/billing/"),
    PLATFORM_NAMES,
  );

/** U17-B3: the platform side (and the whole platform billing domain) never reaches the tenant side */
const ruleB3 = (t: Tree) =>
  crossScope(
    t,
    (f) => isPlatformSide(f) || f.startsWith("src/platform/billing/"),
    isTenantSide,
    TENANT_NAMES,
  );

/** U17-B4: one caller per settle / secret / raw-return / terminal-save / step-up function */
const SOLE_CALLER: readonly (readonly [fn: string, file: string])[] = [
  ["max_attempt_mark_paid", TENANT_RETURN],
  ["platform_attempt_mark_paid", PLATFORM_RETURN],
  ["max_attempt_secrets", `${PAY_SERVER}tenant/credentials.ts`],
  ["platform_store_terminal_check_secrets", `${PAY_SERVER}tenant/credentials.ts`],
  ["platform_attempt_secrets", `${PAY_SERVER}platform/credentials.ts`],
  ["platform_terminal_check_secrets", `${PAY_SERVER}platform/credentials.ts`],
  ["max_return_keep", TENANT_RETURN],
  ["max_return_get", TENANT_RETURN],
  ["platform_return_keep", PLATFORM_RETURN],
  ["platform_return_get", PLATFORM_RETURN],
  ["platform_store_terminal_save", `${PAY_SERVER}tenant/admin.ts`],
  ["platform_terminal_save", PLATFORM_TERMINAL],
  ["platform_stepup_issue", `${PAY_SERVER}stepup.ts`],
  ["platform_stepup_consume", `${PAY_SERVER}stepup.ts`],
];
function ruleB4(t: Tree): string[] {
  const bad: string[] = [];
  for (const [fn, owner] of SOLE_CALLER) {
    const re = new RegExp(`\\b${fn}\\b`);
    for (const [f, src] of each(t, (f) => f !== owner && f !== DECLARES_DB_API))
      if (re.test(stripComments(src))) bad.push(`${f}: names ${fn} (only ${owner} may)`);
  }
  // DM-SEP-6 (app side): the one file that saves NURIEL's terminal consumes a step-up challenge first
  const saver = code(t, PLATFORM_TERMINAL);
  if (/\bplatform_terminal_save\b/.test(saver) && !/\.consume\s*\(/.test(saver))
    bad.push(
      `${PLATFORM_TERMINAL}: saves the platform terminal without consuming a step-up challenge`,
    );
  return bad;
}

/** U17-B5: no tenant context in the platform scope or in the shared server modules */
const TENANT_CONTEXT: readonly RegExp[] = [
  /\bcurrentTenantId\s*\(/,
  /\bmaybeCurrentTenant\s*\(/,
  /\bsupabaseAdmin\b/,
  /\brequireSupabaseAuth\b/,
  /x-tenant-id/i,
  /__requestTenantId/,
  /\btenantSiteOrigin\s*\(/,
];
const TENANT_CONTEXT_MODULES: readonly string[] = [
  "src/integrations/supabase/client.server",
  "src/integrations/supabase/tenant.server",
  "src/integrations/supabase/auth-middleware",
  "src/integrations/supabase/client",
];
function ruleB5(t: Tree): string[] {
  const bad: string[] = [];
  for (const [f, src] of each(t, (f) => isPlatformSide(f) || isSharedServer(f))) {
    for (const imp of importsOf(f, src)) {
      if (imp.target === null || !TENANT_CONTEXT_MODULES.includes(imp.target)) continue;
      // the one service-role adapter (contract: "wired to supabaseAdminUnscoped.rpc") — never the scoped client
      if (f === SERVER_DB && imp.target === "src/integrations/supabase/client.server") continue;
      bad.push(`${f} → ${imp.target}`);
    }
    const stripped = stripComments(src);
    for (const re of TENANT_CONTEXT) if (re.test(stripped)) bad.push(`${f}: uses ${re.source}`);
    // the payer is the store whose admin panel started the payment: only the start may read the host's store
    // (currentSite() is null on the platform host); every later step uses the payer stored on the attempt
    if (f !== PLATFORM_START && isPlatformSide(f) && /\bcurrentSite\s*\(/.test(stripped))
      bad.push(`${f}: reads the host's store (only ${PLATFORM_START} may)`);
  }
  return bad;
}

/** U17-B6: one reader per root secret and per payments switch; no VITE_* payment variable */
const ENV_READERS: readonly (readonly [name: string, files: readonly string[]])[] = [
  ["PAYMENTS_SECRETS_KEY", [`${PAY_SERVER}tenant-keys.ts`, `${PAY_SERVER}env.ts`]],
  ["PLATFORM_TERMINAL_SECRETS_KEY", [`${PAY_SERVER}platform-keys.ts`, `${PAY_SERVER}env.ts`]],
  ["PAYMENTS_ENV", [`${PAY_SERVER}env.ts`]],
  ["MAX_PAY_TEST_URL", [`${PAY_SERVER}env.ts`]],
  [
    "PAYMENTS_JOBS",
    [`${PAY_SERVER}env.ts`, `${PAY_SERVER}tenant/jobs.ts`, `${PAY_SERVER}platform/jobs.ts`],
  ],
];
const VITE_PAYMENT = /\bVITE_[A-Z0-9_]*(PAY|MAX|HYP|MASOF|TERMINAL|SECRET)/;
function ruleB6(t: Tree): string[] {
  const bad: string[] = [];
  for (const [f, src] of t) {
    const stripped = stripComments(src);
    for (const [name, readers] of ENV_READERS)
      if (!readers.includes(f) && new RegExp(`\\b${name}\\b`).test(stripped))
        bad.push(`${f}: reads ${name} (only ${readers.join(", ")})`);
    const vite = stripped.match(VITE_PAYMENT);
    if (vite) bad.push(`${f}: ${vite[0]} would reach the browser bundle`);
    if (isPaymentsFile(f) && /import\.meta\.env/.test(stripped))
      bad.push(`${f}: payment code reads import.meta.env`);
  }
  return bad;
}

/** U17-B7: MAX and Grow never meet — no import in either direction, no Grow name in payment code */
const GROW_FILE: readonly RegExp[] = [
  /^src\/lib\/(platform-)?grow[\w.-]*\.ts$/,
  /^src\/routes\/(api\.webhooks\.grow|checkout_\.grow\.\$orderId)\.tsx?$/,
  /^src\/components\/[\w/-]*Grow[\w-]*\.tsx$/,
];
const isGrowFile = (f: string) => matchesAny(GROW_FILE, f);
function ruleB7(t: Tree): string[] {
  const bad: string[] = [];
  for (const [f, src] of t) {
    if (isPaymentsFile(f)) {
      for (const imp of importsOf(f, src))
        if (imp.target !== null && isGrowFile(imp.target)) bad.push(`${f} → ${imp.target}`);
      // .ts: any Grow identifier; .tsx: Grow identifiers only (Tailwind has a "grow" class)
      const grow = f.endsWith(".tsx")
        ? /GROW_|grow_|Grow[A-Z]|grow[.-](server|payments|webhook|crypto)/
        : /\bgrow|Grow|GROW/;
      const hit = stripComments(src).match(grow);
      if (hit) bad.push(`${f}: names Grow (${hit[0]})`);
    }
    if (isGrowFile(f))
      for (const imp of importsOf(f, src))
        if (imp.target !== null && isPaymentsFile(imp.target)) bad.push(`${f} → ${imp.target}`);
  }
  return bad;
}

/** U17-B8: no module-level state holding credentials, keys, clients or caches (adapters are built per call) */
const TOP_LET = /^(?:export\s+)?(?:let|var)\s+([A-Za-z_$][\w$]*)/gm;
const TOP_COLLECTION =
  /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)[^=\n]*=\s*new\s+(?:Map|WeakMap|Set|WeakSet)\b/gm;
/** a job's timer handle / re-entrancy guard is the only mutable module state the scope code may keep */
const TIMER_NAME = /timer|running|started|interval/i;
const SECRETISH_NAME = /cred|secret|key|passp|masof|cipher|adapter|client|cache|token/i;
function ruleB8(t: Tree): string[] {
  const bad: string[] = [];
  // all payment server modules: no collection at module level, no mutable secret-ish name;
  // the scope code (orchestrators, server functions, jobs, return routes): no mutable module state but a timer
  for (const [f, src] of each(
    t,
    (f) => f.endsWith(".ts") && (f.startsWith(PAY_SERVER) || isScopeCode(f)),
  )) {
    const stripped = stripComments(src);
    for (const m of stripped.matchAll(TOP_COLLECTION))
      bad.push(`${f}: module-level collection "${m[1]}"`);
    for (const m of stripped.matchAll(TOP_LET)) {
      const name = m[1]!;
      if (isScopeCode(f) ? !TIMER_NAME.test(name) : SECRETISH_NAME.test(name))
        bad.push(`${f}: module-level mutable "${name}"`);
    }
  }
  return bad;
}

/** U17-B9: each return route is bound to its host type; no third return path */
const RETURN_PATH = /createFileRoute\(\s*["']([^"']*payments_?\/return[^"']*)["']/;
function ruleB9(t: Tree): string[] {
  const bad: string[] = [];
  const tenantRoute = t.get(TENANT_RETURN_ROUTE);
  if (tenantRoute !== undefined) {
    if (!/createFileRoute\(\s*["']\/payments\/return\/\$provider["']\s*\)/.test(tenantRoute))
      bad.push(`${TENANT_RETURN_ROUTE}: the path must be /payments/return/$provider`);
    // a store's return is refused on the platform host — before any DB write or VERIFY
    if (
      !/\bisPlatform(?:Host|Request)\s*\(/.test(stripComments(tenantRoute) + code(t, TENANT_RETURN))
    )
      bad.push(`${TENANT_RETURN_ROUTE}: no platform-host refusal`);
  }
  const platformRoute = t.get(PLATFORM_RETURN_ROUTE);
  if (platformRoute !== undefined) {
    if (
      !/createFileRoute\(\s*["']\/platform_?\/payments_?\/return\/\$provider["']\s*\)/.test(
        platformRoute,
      )
    )
      bad.push(
        `${PLATFORM_RETURN_ROUTE}: the path must start with /platform/ (403 on every store host)`,
      );
    if (!/\bisPlatformHost\s*\(/.test(stripComments(platformRoute) + code(t, PLATFORM_RETURN)))
      bad.push(`${PLATFORM_RETURN_ROUTE}: does not assert the platform host`);
  }
  for (const [f, src] of each(t, (f) => f.startsWith("src/routes/"))) {
    if (f === TENANT_RETURN_ROUTE || f === PLATFORM_RETURN_ROUTE) continue;
    const path = stripComments(src).match(RETURN_PATH);
    if (path) bad.push(`${f}: a third return path (${path[1]})`);
  }
  return bad;
}

/**
 * U17-B10: GET-only return routes that answer 303 + no-store + no-referrer; TLS checks on; no === between a
 * signature / HMAC / credential and another value (presence checks against undefined / null / a literal are fine)
 */
const SECRETISH = "(?:signature|hmac|passp|apikey|api_key)";
const OTHER_VALUE = "(?!(?:undefined|null|true|false)\\b)[A-Za-z_$][\\w$]*(?:\\.[\\w$]+)*";
const SECRET_COMPARE = new RegExp(
  `\\b[\\w$.]*${SECRETISH}[\\w$.]*\\s*[!=]==\\s*${OTHER_VALUE}|${OTHER_VALUE}\\s*[!=]==\\s*[\\w$.]*${SECRETISH}`,
  "i",
);
function ruleB10(t: Tree): string[] {
  const bad: string[] = [];
  for (const [route, orchestrator] of [
    [TENANT_RETURN_ROUTE, TENANT_RETURN],
    [PLATFORM_RETURN_ROUTE, PLATFORM_RETURN],
  ] as const) {
    const src = t.get(route);
    if (src === undefined) continue;
    const stripped = stripComments(src);
    if (
      !/handlers\s*:\s*\{\s*GET\s*:/.test(stripped) ||
      /\b(POST|PUT|PATCH|DELETE|OPTIONS)\s*:/.test(stripped)
    )
      bad.push(`${route}: the handlers must be GET only`);
    const both = stripped + code(t, orchestrator);
    for (const must of ["303", "no-store", "no-referrer"])
      if (!both.includes(must)) bad.push(`${route}: the response lacks ${must}`);
  }
  for (const [f, src] of t) {
    const stripped = stripComments(src);
    if (/rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED/.test(stripped))
      bad.push(`${f}: turns off TLS certificate checks`);
    if (isPaymentsFile(f)) {
      const hit = stripped.match(SECRET_COMPARE);
      if (hit)
        bad.push(`${f}: compares a secret with ${hit[0].trim()} (use a constant-time compare)`);
    }
  }
  return bad;
}

/** U17-B11: browser-reachable payment files reach server code only by a dynamic import inside a handler */
function ruleB11(t: Tree): string[] {
  const bad: string[] = [];
  for (const [f, src] of each(t, (f) => isPaymentsFile(f) && !isServerOnly(f)))
    for (const imp of importsOf(f, src))
      if (!imp.dynamic && imp.target !== null && isServerOnly(imp.target))
        bad.push(`${f}: static import of server code ${imp.target}`);
  return bad;
}

/** DM-SEC-7 (app side): the scope code logs only through its scope logger, and that logger redacts */
const SCOPE_LOGGERS: readonly string[] = [
  `${PAY_SERVER}tenant/log.ts`,
  `${PAY_SERVER}platform/log.ts`,
];
function ruleSec7(t: Tree): string[] {
  const bad: string[] = [];
  for (const [f, src] of each(t, isScopeCode)) {
    const stripped = stripComments(src);
    if (SCOPE_LOGGERS.includes(f)) {
      if (!/\bredactPaymentText\s*\(/.test(stripped))
        bad.push(`${f}: logs without redactPaymentText`);
    } else if (/\bconsole\s*\./.test(stripped)) {
      bad.push(`${f}: logs directly (use the scope logger)`);
    }
  }
  return bad;
}

/** DM-NEG-1: no refund, cancel, payout, token or payment-link code anywhere in src/ (redact.ts may mask zPass) */
const NEG1: readonly (readonly [re: RegExp, what: string])[] = [
  [/\bzikoyAPI\b/i, "refund (zikoyAPI)"],
  [/\bCancelTrans\b/i, "cancellation (CancelTrans)"],
  [/\bzPass\b/i, "refund / payout password (zPass)"],
  [/\bgetToken\b/i, "card token (getToken)"],
  [/\bpayRequest\b/i, "payment link (payRequest)"],
  [/\bcommitTrans\b/i, "J5 commit (commitTrans)"],
  [/action\s*=\s*soft\b/i, "token charge / payout (action=soft)"],
];
const REDACTOR = `${PAY}redact.ts`;
function ruleNeg1(t: Tree): string[] {
  const bad: string[] = [];
  for (const [f, src] of t) {
    for (const [re, what] of NEG1) {
      if (f === REDACTOR && re.source.includes("zPass")) continue;
      if (re.test(src)) bad.push(`${f}: ${what}`);
    }
    if (isPaymentsFile(f)) {
      const stripped = stripComments(src);
      if (/["'`]soft["'`]/.test(stripped)) bad.push(`${f}: the "soft" action`);
      if (/\b(refund|cancel|tokens?|payouts?)\s*:\s*true\b/.test(stripped))
        bad.push(`${f}: a refund / cancel / token / payout capability turned on`);
    }
  }
  return bad;
}

/** DM-NEG-2: no SmartBee — no module, package, env name, table or text anywhere in src/ */
const SMARTBEE = /smart[\s_-]*bee/i;
const ruleNeg2 = (t: Tree) =>
  [...t].filter(([, src]) => SMARTBEE.test(src)).map(([f]) => `${f}: SmartBee`);

// ------------------------------------------------------------------ tests

describe("U17 scanner and layout", () => {
  it("scans the whole source tree", () => {
    expect(CODE.size).toBeGreaterThan(200);
    expect(ALL.size).toBeGreaterThanOrEqual(CODE.size);
  });

  it("classifies the contract layout (§3) into shared, tenant and platform", () => {
    for (const f of [
      "src/platform/payments/provider.ts",
      "src/platform/payments/registry.ts",
      "src/platform/payments/max/protocol.ts",
      "src/platform/payments/max/messages.ts",
      "src/platform/payments/redact.ts",
    ])
      expect(isPure(f), f).toBe(true);
    for (const f of [
      "src/platform/payments/server/env.ts",
      "src/platform/payments/server/http.ts",
      "src/platform/payments/server/crypto.ts",
      SERVER_DB,
    ])
      expect(isSharedServer(f), f).toBe(true);
    for (const f of [
      "src/platform/payments/server/tenant-keys.ts",
      "src/platform/payments/server/tenant/return.ts",
      "src/lib/online-payments.functions.ts",
      TENANT_RETURN_ROUTE,
      "src/routes/checkout_.pay.$orderId.tsx",
      "src/components/checkout/OnlinePaymentPage.tsx",
      "src/components/orders/OnlinePaymentInfo.tsx",
      "src/components/payments/OnlinePaymentSettingsCard.tsx",
      "src/components/platform/MaxPaymentsTab.tsx",
    ]) {
      expect(isTenantSide(f), f).toBe(true);
      expect(isPlatformSide(f), f).toBe(false);
    }
    for (const f of [
      "src/platform/payments/server/platform-keys.ts",
      "src/platform/payments/server/stepup.ts",
      "src/platform/payments/server/platform/return.ts",
      "src/platform/billing/pay.functions.ts",
      "src/platform/billing/ui/PayOnlineButton.tsx",
      "src/platform/billing/ui/PlatformTerminalCard.tsx",
      "src/routes/platform_.payments.tsx",
      PLATFORM_RETURN_ROUTE,
    ]) {
      expect(isPlatformSide(f), f).toBe(true);
      expect(isTenantSide(f), f).toBe(false);
    }
    // existing billing and Grow code is neither scope
    for (const f of ["src/platform/billing/ui/MyBillingCard.tsx", "src/lib/grow.server.ts"])
      expect(isTenantSide(f) || isPlatformSide(f), f).toBe(false);
  });

  it("the import scanner tells static from dynamic imports and resolves aliases and relative paths", () => {
    const imports = importsOf(
      "src/lib/online-payments.functions.ts",
      [
        'import type { X } from "@/platform/payments/provider";',
        'export { y } from "./online-payments";',
        'const m = await import("@/platform/payments/server/tenant/checkout");',
        'import { z } from "zod";',
      ].join("\n"),
    );
    expect(imports).toEqual([
      {
        spec: "@/platform/payments/provider",
        target: "src/platform/payments/provider",
        dynamic: false,
      },
      { spec: "./online-payments", target: "src/lib/online-payments", dynamic: false },
      {
        spec: "@/platform/payments/server/tenant/checkout",
        target: "src/platform/payments/server/tenant/checkout",
        dynamic: true,
      },
      { spec: "zod", target: null, dynamic: false },
    ]);
  });

  it("Vite import protection still keeps every **/server/** file out of the browser bundle", () => {
    const vite = readFileSync(join(ROOT, "vite.config.ts"), "utf8");
    expect(vite).toMatch(/importProtection:\s*\{\s*behavior:\s*"error"/);
    expect(vite).toContain('files: ["**/server/**"]');
  });
});

describe("U17 / DM-SEP-3: platform ⟷ tenant separation (real tree)", () => {
  it("DM-SEP-3 / U17-B1: shared payment code is pure (no I/O, no package, no secret)", () => {
    expect(ruleB1(CODE)).toEqual([]);
  });

  it("DM-SEP-3 / U17-B2: the tenant side never reaches the platform side", () => {
    expect(ruleB2(CODE)).toEqual([]);
  });

  it("DM-SEP-3 / U17-B3: the platform side never reaches the tenant side", () => {
    expect(ruleB3(CODE)).toEqual([]);
  });

  it("DM-SEP-3 / U17-B4 (+ DM-SEP-6): one caller per settle / secret / raw-return / terminal / step-up function", () => {
    expect(ruleB4(CODE)).toEqual([]);
  });

  it("DM-SEP-3 / U17-B5: no tenant context in the platform scope or the shared server modules", () => {
    expect(ruleB5(CODE)).toEqual([]);
  });

  it("DM-SEP-3 / U17-B6: one reader per root secret and payments switch; no VITE_* payment variable", () => {
    expect(ruleB6(CODE)).toEqual([]);
  });

  it("DM-SEP-3 / U17-B7: MAX never imports Grow and Grow never imports MAX", () => {
    expect(ruleB7(CODE)).toEqual([]);
  });

  it("DM-SEP-3 / U17-B8: no module-level state holding credentials, clients or caches", () => {
    expect(ruleB8(CODE)).toEqual([]);
  });

  it("DM-SEP-3 / U17-B9: each return route is bound to its host type; no third return path", () => {
    expect(ruleB9(CODE)).toEqual([]);
  });

  it("DM-SEP-3 / U17-B9: a locked store still receives returns but never opens a new payment page", () => {
    // the payment may already have been taken; a new attempt is refused (max_payments_active needs an active store)
    expect(SUSPENDED_ALLOWED_PATHS.test("/checkout/pay/00000000-0000-0000-0000-000000000000")).toBe(
      false,
    );
    if (CODE.has(TENANT_RETURN_ROUTE)) {
      expect(SUSPENDED_ALLOWED_PATHS.test("/payments/return/max")).toBe(true);
    }
    // the platform return relies on storeGate: /platform/* answers 403 on every store host
    expect(code(CODE, "src/server.ts")).toContain("/^\\/platform(\\/|$)/.test(pathname)");
  });

  it("DM-SEP-3 / U17-B10: GET-only 303 returns, TLS checks never off, no === on secrets", () => {
    expect(ruleB10(CODE)).toEqual([]);
  });

  it("DM-SEP-3 / U17-B11: browser-reachable payment files never statically import server code", () => {
    expect(ruleB11(CODE)).toEqual([]);
  });

  it("DM-SEC-7 (app side): scope code logs only through its redacting scope logger", () => {
    expect(ruleSec7(CODE)).toEqual([]);
  });
});

describe("U17: negative capabilities (real tree)", () => {
  it("DM-NEG-1: no refund, cancel, payout, token or payment-link code anywhere in src/", () => {
    expect(ruleNeg1(ALL)).toEqual([]);
  });

  it("DM-NEG-2: no SmartBee dependency (src/ and package.json)", () => {
    expect(ruleNeg2(ALL)).toEqual([]);
    expect(readFileSync(join(ROOT, "package.json"), "utf8")).not.toMatch(SMARTBEE);
  });
});

describe("U17: every rule bites (synthetic trees)", () => {
  it("U17-B1 bites: a pure module that imports server code, a package or the environment", () => {
    const bad = ruleB1(
      tree({
        "src/platform/payments/max/protocol.ts":
          'import { hypEndpoint } from "../server/env";\nimport { z } from "zod";\nexport const k = process.env["X"];',
        "src/platform/payments/provider.ts": "export type ScopeName = 1;",
      }),
    );
    expect(bad).toEqual([
      "src/platform/payments/max/protocol.ts → src/platform/payments/server/env",
      'src/platform/payments/max/protocol.ts: imports the package "zod"',
      "src/platform/payments/max/protocol.ts: uses process.env",
    ]);
    expect(
      ruleB1(
        tree({
          "src/platform/payments/registry.ts":
            'import type { ProviderId } from "./provider";\nimport { buildSignParams } from "./max/protocol";\nexport const PROVIDERS = { max: buildSignParams } as Record<ProviderId, unknown>;',
        }),
      ),
    ).toEqual([]);
  });

  it("U17-B2 bites: the tenant side imports the platform side or names a platform function", () => {
    const bad = ruleB2(
      tree({
        "src/lib/online-payments.functions.ts":
          'const m = await import("@/platform/payments/server/platform/pay");\nconst b = await import("@/platform/billing/billing.server");',
        "src/platform/payments/server/tenant/checkout.ts":
          'await rpc("platform_attempt_open", {});\nconst k = process.env["PLATFORM_TERMINAL_SECRETS_KEY"];',
        "src/components/platform/MaxPaymentsTab.tsx":
          'import { PlatformTerminalCard } from "@/platform/billing/ui/PlatformTerminalCard";',
      }),
    );
    expect(bad).toEqual([
      "src/lib/online-payments.functions.ts → src/platform/payments/server/platform/pay",
      "src/lib/online-payments.functions.ts → src/platform/billing/billing.server",
      "src/platform/payments/server/tenant/checkout.ts: names \\bplatform_attempts?_",
      "src/platform/payments/server/tenant/checkout.ts: names \\bPLATFORM_TERMINAL_SECRETS_KEY\\b",
      "src/components/platform/MaxPaymentsTab.tsx → src/platform/billing/ui/PlatformTerminalCard",
    ]);
    // the store-terminal admin functions of the platform admin are tenant scope: allowed
    expect(
      ruleB2(
        tree({
          "src/platform/payments/server/tenant/admin.ts":
            'await rpc("platform_store_terminal_save", {}); await rpc("platform_payment_unknown_return", {});',
        }),
      ),
    ).toEqual([]);
  });

  it("U17-B3 bites: the platform side (or platform billing) imports the tenant side or names a max_* function", () => {
    const bad = ruleB3(
      tree({
        "src/platform/billing/pay.functions.ts": 'import { x } from "@/lib/online-payments";',
        "src/platform/billing/ui/MyBillingCard.tsx":
          'import { OnlinePaymentInfo } from "@/components/orders/OnlinePaymentInfo";',
        "src/platform/payments/server/platform/return.ts":
          'const k = process.env["PAYMENTS_SECRETS_KEY"];\nawait rpc("max_attempt_mark_paid", {});\nconst c = tenantSecretCipher(env, mode);',
      }),
    );
    expect(bad).toHaveLength(5);
    expect(
      ruleB3(
        tree({
          "src/platform/billing/ui/PayOnlineButton.tsx":
            'import { myBillingPayStart } from "../pay.functions";\nconst o = { max_installments: 1 };',
        }),
      ),
    ).toEqual([]);
  });

  it("U17-B4 bites: a second caller of a settle function, a terminal save without step-up", () => {
    const bad = ruleB4(
      tree({
        "src/platform/payments/server/tenant/jobs.ts": 'await rpc("max_attempt_mark_paid", {});',
        "src/platform/payments/server/tenant/return.ts": 'await rpc("max_attempt_mark_paid", {});',
        [PLATFORM_TERMINAL]: 'await rpc("platform_terminal_save", { _actor: a });',
        [DECLARES_DB_API]: "max_attempt_mark_paid: { Args: {}; Returns: Json };",
      }),
    );
    expect(bad).toEqual([
      "src/platform/payments/server/tenant/jobs.ts: names max_attempt_mark_paid (only src/platform/payments/server/tenant/return.ts may)",
      `${PLATFORM_TERMINAL}: saves the platform terminal without consuming a step-up challenge`,
    ]);
    expect(
      ruleB4(
        tree({
          [PLATFORM_TERMINAL]:
            'const ok = await stepup.consume(actor, challenge, purpose, code);\nawait rpc("platform_terminal_save", {});',
        }),
      ),
    ).toEqual([]);
  });

  it("U17-B5 bites: tenant context in the platform scope; the scoped client in the shared adapter", () => {
    const bad = ruleB5(
      tree({
        "src/platform/payments/server/platform/return.ts":
          'import { supabaseAdmin } from "@/integrations/supabase/client.server";\nconst t = currentTenantId();',
        "src/platform/billing/pay.functions.ts": "const site = await currentSite();",
        [SERVER_DB]:
          'import { supabaseAdmin } from "@/integrations/supabase/client.server";\nconst h = { "x-tenant-id": t };',
      }),
    );
    expect(bad).toEqual([
      "src/platform/payments/server/platform/return.ts → src/integrations/supabase/client.server",
      "src/platform/payments/server/platform/return.ts: uses \\bcurrentTenantId\\s*\\(",
      "src/platform/payments/server/platform/return.ts: uses \\bsupabaseAdmin\\b",
      `src/platform/billing/pay.functions.ts: reads the host's store (only ${PLATFORM_START} may)`,
      `${SERVER_DB}: uses \\bsupabaseAdmin\\b`,
      `${SERVER_DB}: uses x-tenant-id`,
    ]);
    expect(
      ruleB5(
        tree({
          [SERVER_DB]:
            'import { supabaseAdminUnscoped } from "@/integrations/supabase/client.server";',
          [PLATFORM_START]: "const site = await currentSite();",
        }),
      ),
    ).toEqual([]);
  });

  it("U17-B6 bites: a second root-secret reader, a VITE_* payment variable, import.meta.env", () => {
    const bad = ruleB6(
      tree({
        "src/lib/online-payments.functions.ts": 'const k = process.env["PAYMENTS_SECRETS_KEY"];',
        "src/platform/payments/server/platform/jobs.ts":
          'const k = process.env.PLATFORM_TERMINAL_SECRETS_KEY;\nconst u = process.env["MAX_PAY_TEST_URL"];',
        "src/routes/checkout.tsx": "const t = import.meta.env.VITE_MAX_TERMINAL;",
        "src/platform/payments/max/messages.ts": "const e = import.meta.env.MODE;",
      }),
    );
    expect(bad).toHaveLength(5);
    expect(
      ruleB6(
        tree({
          [`${PAY_SERVER}tenant-keys.ts`]: 'const root = process.env["PAYMENTS_SECRETS_KEY"];',
          [`${PAY_SERVER}env.ts`]:
            'process.env["PAYMENTS_SECRETS_KEY"]; process.env["PLATFORM_TERMINAL_SECRETS_KEY"]; process.env["PAYMENTS_ENV"];',
          [`${PAY_SERVER}tenant/jobs.ts`]: 'if (process.env["PAYMENTS_JOBS"] === "off") return;',
        }),
      ),
    ).toEqual([]);
  });

  it("U17-B7 bites: payments importing or naming Grow, Grow importing payments", () => {
    const bad = ruleB7(
      tree({
        "src/platform/payments/server/tenant/checkout.ts":
          'import { loadGrowCredentials } from "@/lib/grow.server";',
        "src/components/orders/OnlinePaymentInfo.tsx":
          'import { GrowPaymentInfo } from "@/components/orders/GrowPaymentInfo";',
        "src/lib/grow-webhook.server.ts":
          'import { hypEndpoint } from "@/platform/payments/server/env";',
      }),
    );
    expect(bad).toEqual([
      "src/platform/payments/server/tenant/checkout.ts → src/lib/grow.server",
      "src/platform/payments/server/tenant/checkout.ts: names Grow (Grow)",
      "src/components/orders/OnlinePaymentInfo.tsx → src/components/orders/GrowPaymentInfo",
      "src/components/orders/OnlinePaymentInfo.tsx: names Grow (GrowP)",
      "src/lib/grow-webhook.server.ts → src/platform/payments/server/env",
    ]);
    // a Tailwind "grow" class or a "SettingRow" is not Grow
    expect(
      ruleB7(
        tree({
          "src/components/checkout/OnlinePaymentPage.tsx":
            '<div className="grow" /> <SettingRow /> <Box flexGrow={1} />',
        }),
      ),
    ).toEqual([]);
  });

  it("U17-B8 bites: a module-level credential cache or key map", () => {
    const bad = ruleB8(
      tree({
        "src/platform/payments/server/tenant/credentials.ts":
          "let cached: string | null = null;\nconst cache = new Map<string, string>();\nlet timer: number | null = null;",
        [`${PAY_SERVER}crypto.ts`]:
          "let derivedKey: Buffer | null = null;\nlet warnedOnce = false;",
        "src/lib/online-payments.ts": "const LABELS = new Map([['a', 'b']]);",
      }),
    );
    expect(bad).toEqual([
      'src/platform/payments/server/tenant/credentials.ts: module-level collection "cache"',
      'src/platform/payments/server/tenant/credentials.ts: module-level mutable "cached"',
      `${PAY_SERVER}crypto.ts: module-level mutable "derivedKey"`,
      'src/lib/online-payments.ts: module-level collection "LABELS"',
    ]);
    expect(
      ruleB8(
        tree({
          "src/platform/payments/server/platform/jobs.ts":
            "let timer: ReturnType<typeof setInterval> | null = null;\nlet running = false;\nexport function f() {\n  let x = 1;\n  return x;\n}",
        }),
      ),
    ).toEqual([]);
  });

  it("U17-B9 bites: a return route without its host check, on the wrong path, or a third return path", () => {
    const bad = ruleB9(
      tree({
        [TENANT_RETURN_ROUTE]:
          'export const Route = createFileRoute("/payments/return/$provider")({ server: { handlers: { GET: h } } });',
        [PLATFORM_RETURN_ROUTE]:
          'export const Route = createFileRoute("/payments_/platform-return/$provider")({});',
        "src/routes/payments.return.$provider.platform.ts":
          'export const Route = createFileRoute("/payments/return/$provider/platform")({});',
      }),
    );
    expect(bad).toEqual([
      `${TENANT_RETURN_ROUTE}: no platform-host refusal`,
      `${PLATFORM_RETURN_ROUTE}: the path must start with /platform/ (403 on every store host)`,
      `${PLATFORM_RETURN_ROUTE}: does not assert the platform host`,
      "src/routes/payments.return.$provider.platform.ts: a third return path (/payments/return/$provider/platform)",
    ]);
    expect(
      ruleB9(
        tree({
          [TENANT_RETURN_ROUTE]: 'createFileRoute("/payments/return/$provider")({});',
          [TENANT_RETURN]: "if (await isPlatformHost()) return notFound();",
          [PLATFORM_RETURN_ROUTE]:
            'createFileRoute("/platform_/payments_/return/$provider")({}); if (!(await isPlatformHost())) return x;',
        }),
      ),
    ).toEqual([]);
  });

  it("U17-B10 bites: a POST return, a page instead of a 303, TLS off, === on a signature", () => {
    const bad = ruleB10(
      tree({
        [PLATFORM_RETURN_ROUTE]:
          "createFileRoute(p)({ server: { handlers: { GET: g, POST: p } } });",
        [`${PAY_SERVER}http.ts`]: "new Agent({ connect: { rejectUnauthorized: false } });",
        [PLATFORM_RETURN]: "if (parsed.signature === expected) settle();",
      }),
    );
    expect(bad).toEqual([
      `${PLATFORM_RETURN_ROUTE}: the handlers must be GET only`,
      `${PLATFORM_RETURN_ROUTE}: the response lacks 303`,
      `${PLATFORM_RETURN_ROUTE}: the response lacks no-store`,
      `${PLATFORM_RETURN_ROUTE}: the response lacks no-referrer`,
      `${PAY_SERVER}http.ts: turns off TLS certificate checks`,
      `${PLATFORM_RETURN}: compares a secret with parsed.signature === expected (use a constant-time compare)`,
    ]);
    expect(ruleB10(tree({ [PLATFORM_RETURN]: "if (sent === echo.codeHmac) ok();" }))).toHaveLength(
      1,
    );
    expect(
      ruleB10(
        tree({
          [TENANT_RETURN_ROUTE]:
            "createFileRoute(p)({ server: { handlers: { GET: async () => r } } });",
          [TENANT_RETURN]:
            'new Response(null, { status: 303, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });\nif (typeof signature === "string" && echo.signature !== undefined && sent.masof === echo.masof) {}',
          // the start-up sanity check compares two configured roots: not a secret comparison of request input
          [`${PAY_SERVER}env.ts`]: "if (tenantSecret === platformSecret) return null;",
        }),
      ),
    ).toEqual([]);
  });

  it("U17-B11 bites: a page or a server-function file that statically imports server code", () => {
    expect(
      ruleB11(
        tree({
          "src/components/checkout/OnlinePaymentPage.tsx":
            'import { startTenantPayment } from "@/platform/payments/server/tenant/checkout";',
          "src/platform/billing/pay.functions.ts": 'import { ownerRpc } from "./billing.server";',
          "src/lib/online-payments.functions.ts":
            'const m = await import("@/platform/payments/server/tenant/checkout");',
          "src/platform/payments/server/tenant/checkout.ts": 'import { open } from "../crypto";',
        }),
      ),
    ).toEqual([
      "src/components/checkout/OnlinePaymentPage.tsx: static import of server code src/platform/payments/server/tenant/checkout",
      "src/platform/billing/pay.functions.ts: static import of server code src/platform/billing/billing.server",
    ]);
  });

  it("DM-SEC-7 bites: a direct console line in scope code, a scope logger that does not redact", () => {
    expect(
      ruleSec7(
        tree({
          [TENANT_RETURN]: "console.error('VERIFY failed', url);",
          [`${PAY_SERVER}platform/log.ts`]: "export const log = (s: string) => console.log(s);",
          [`${PAY_SERVER}tenant/log.ts`]:
            'import { redactPaymentText } from "@/platform/payments/redact";\nexport const log = (s: string) => console.log(redactPaymentText(s));',
        }),
      ),
    ).toEqual([
      `${TENANT_RETURN}: logs directly (use the scope logger)`,
      `${PAY_SERVER}platform/log.ts: logs without redactPaymentText`,
    ]);
  });

  it("DM-NEG-1 bites on every banned capability, and only on them", () => {
    const bad = ruleNeg1(
      tree({
        "src/lib/x.ts":
          'const a = "zikoyAPI"; const b = "CancelTrans"; const c = "zPass"; const d = "getToken"; const e = "payRequest"; const f = "commitTrans"; const g = "action=soft";',
        "src/platform/payments/registry.ts":
          'export const CAPS = { refund: true }; const p = [["action", "soft"]];',
      }),
    );
    expect(bad).toHaveLength(9);
    expect(
      ruleNeg1(
        tree({
          // existing stock transfers, and the redactor that masks zPass in log lines
          "src/lib/locations.ts": "export async function cancelTransfer(id: string) {}",
          [REDACTOR]: "const MASKED = /(KEY|PassP|zPass)=[^&]*/g;",
          "src/platform/payments/provider.ts":
            "export const CAPS = { refund: false, cancel: false };",
        }),
      ),
    ).toEqual([]);
  });

  it("DM-NEG-2 bites on SmartBee in any spelling", () => {
    expect(
      ruleNeg2(
        tree({
          "src/lib/a.ts": 'import { client } from "smartbee";',
          "src/lib/b.ts": "const SMART_BEE_KEY = 1;",
          "src/lib/c.md": "Smart Bee invoices",
          "src/lib/d.ts": "const smartphone = 1; const bee = 2;",
        }),
      ),
    ).toEqual(["src/lib/a.ts: SmartBee", "src/lib/b.ts: SmartBee", "src/lib/c.md: SmartBee"]);
  });
});
