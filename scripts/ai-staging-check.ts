/**
 * NURIEL AI — בדיקת Staging מבוקרת מול Anthropic האמיתי. לא רצה ב-CI ולא בשרת הייצור.
 *
 *   bun scripts/ai-staging-check.ts
 *     בדיקות בלי שום עלות:
 *       • בלי מפתח — נעצר לפני הרשת: אף בקשה לא יוצאת;
 *       • מפתח שגוי מול ה-API האמיתי — 401, בקשה אחת בדיוק, רק לכתובת הרשמית (גם כשבסביבה מוגדר
 *         ANTHROPIC_BASE_URL), השגיאה בלי המפתח;
 *       • Timeout אמיתי מול ה-API — בקשה אחת, בלי ניסיון חוזר;
 *       • מול שירות מקומי: 529 / 500 (שגיאת API), תשובה שאינה לפי הסכמה, מזהי מדריכים זרים, ספירת
 *         טוקנים ועלות לפי המחירון — ובכל אחד בדיוק בקשה אחת (maxRetries = 0).
 *
 *   ANTHROPIC_STAGING_KEY=<מפתח של סביבת בדיקה> bun scripts/ai-staging-check.ts --paid
 *     + קריאה אמיתית אחת בדיוק (Haiku 5.5 — בערך חצי סנט), עם אותה בקשה שהאפליקציה שולחת.
 *     --models=haiku,sonnet,opus — קריאה אחת לכל דגם שנבחר (עד 3 קריאות; כמה סנטים).
 *     המפתח נקרא רק מהמשתנה הזה — לא מהמסד ולא מ-ANTHROPIC_API_KEY — ולא מודפס (רק 4 התווים האחרונים).
 *     בלי --paid אין שום קריאה בתשלום.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { ECOMMERCE_GUIDE_CATALOG } from "../src/lib/ai/ecommerce-guides";
import {
  describeAiError,
  estimateCostUsd,
  keyLast4,
  MODEL_PRICES,
  NO_API_KEY_ERROR,
  type AiModelId,
} from "../src/platform/ai/logic";
import {
  ANTHROPIC_API_URL,
  createAnthropicRouterClient,
  routeQuestion,
} from "../src/platform/ai/router.server";

const args = process.argv.slice(2);
const PAID = args.includes("--paid");
const MODELS: Record<string, AiModelId> = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
};
const chosen = (args.find((a) => a.startsWith("--models="))?.slice(9) ?? "haiku")
  .split(",")
  .map((m) => m.trim())
  .filter((m) => m in MODELS)
  .slice(0, 3);

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

// כל בקשת רשת של הספרייה נספרת (ה-SDK לוקח את fetch בזמן יצירת הלקוח)
const realFetch = globalThis.fetch;
let requests: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  requests.push(input instanceof Request ? input.url : String(input));
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

const catalog = ECOMMERCE_GUIDE_CATALOG;
const known = new Set(catalog.guides.map((g) => g.id));
const question = "איך מוסיפים מוצר חדש לחנות?";
const ask = (client: Awaited<ReturnType<typeof createAnthropicRouterClient>>, model: AiModelId) =>
  routeQuestion(client, { catalog, model, question, previous: [] });
const errorOf = async (fn: () => Promise<unknown>): Promise<unknown> => {
  try {
    await fn();
    return null;
  } catch (error) {
    return error;
  }
};
const statusOf = (error: unknown) =>
  typeof (error as { status?: unknown })?.status === "number"
    ? (error as { status: number }).status
    : null;

const FAKE_KEY = `sk-ant-api03-${"StagingCheckInvalid".repeat(3)}Zq9_`;

console.log("1. no API key");
requests = [];
{
  for (const empty of ["", "   "]) {
    const error = await errorOf(async () =>
      ask(await createAnthropicRouterClient(empty), "claude-haiku-5-5"),
    );
    check(
      `refused before the network — ${JSON.stringify(empty)}`,
      error instanceof Error && error.message === NO_API_KEY_ERROR,
    );
    check("shown as 'לא הוגדר מפתח API'", describeAiError(error).startsWith("לא הוגדר מפתח API"));
  }
  check("no request at all", requests.length === 0, `${requests.length} requests`);
}

console.log("2. an invalid key against the real API (free — answered 401)");
requests = [];
{
  const error = await errorOf(async () =>
    ask(await createAnthropicRouterClient(FAKE_KEY), "claude-haiku-5-5"),
  );
  check("401 from Anthropic", statusOf(error) === 401, `status ${statusOf(error)}`);
  check(
    "exactly one request (maxRetries = 0)",
    requests.length === 1,
    `${requests.length} requests`,
  );
  check(
    `only the official address (${ANTHROPIC_API_URL}) — even with ANTHROPIC_BASE_URL in the environment`,
    requests.length > 0 && requests.every((u) => u.startsWith(`${ANTHROPIC_API_URL}/`)),
    requests.join(", "),
  );
  const text = `${describeAiError(error)} ${error instanceof Error ? error.message : ""}`;
  check("the error text never contains the key", !text.includes(FAKE_KEY));
  check(
    "shown to the platform admin as 'המפתח שגוי או בוטל'",
    describeAiError(error) === "המפתח שגוי או בוטל",
  );
}

console.log("3. a real timeout against the API (1 ms)");
requests = [];
{
  const error = await errorOf(async () =>
    ask(await createAnthropicRouterClient(FAKE_KEY, { timeoutMs: 1 }), "claude-haiku-5-5"),
  );
  check(
    "abandoned with a timeout error",
    error instanceof Error && /timed? ?out/i.test(error.message),
    error instanceof Error ? error.message : String(error),
  );
  check(
    "exactly one attempt — no retry after a timeout",
    requests.length === 1,
    `${requests.length} requests`,
  );
  check(
    "shown as 'הבקשה ל-Anthropic נמשכה יותר מדי'",
    describeAiError(error) === "הבקשה ל-Anthropic נמשכה יותר מדי",
  );
}

// ---------------------------------------------------------------- שירות מקומי (אותו קוד, כתובת אחרת)
type StubMode = "overloaded" | "server" | "not-json" | "foreign-ids" | "ok";
let mode: StubMode = "ok";
const USAGE = {
  input_tokens: 1200,
  cache_creation_input_tokens: 3000,
  cache_read_input_tokens: 0,
  output_tokens: 18,
};
const message = (text: string) => ({
  id: "msg_staging_check",
  type: "message",
  role: "assistant",
  model: "claude-haiku-5-5",
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: USAGE,
});
const stub = createServer((req: IncomingMessage, res: ServerResponse) => {
  req.resume();
  req.on("end", () => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (mode === "overloaded")
      return send(529, {
        type: "error",
        error: { type: "overloaded_error", message: "Overloaded" },
      });
    if (mode === "server")
      return send(500, { type: "error", error: { type: "api_error", message: "Internal" } });
    if (mode === "not-json")
      return send(200, message("Sure! To add a product, open the admin panel and…"));
    if (mode === "foreign-ids")
      return send(
        200,
        message(
          JSON.stringify({
            topic: "site_help",
            guides: ["hosp-block-dates", "made-up-id", "add-product"],
          }),
        ),
      );
    return send(200, message(JSON.stringify({ topic: "site_help", guides: ["add-product"] })));
  });
});
await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
const port = (stub.address() as AddressInfo).port;
const savedEnv = {
  host: process.env["PLATFORM_ADMIN_HOST"],
  url: process.env["AI_ASSISTANT_TEST_API_URL"],
};
// הכתובת המקומית נלקחת בחשבון רק כשגם פאנל הפלטפורמה על דומיין מקומי (כמו ב-E2E)
process.env["PLATFORM_ADMIN_HOST"] = "platform.staging-check.localhost";
process.env["AI_ASSISTANT_TEST_API_URL"] = `http://127.0.0.1:${port}`;
const local = () => createAnthropicRouterClient("sk-ant-api03-local-stub-only-0000");

console.log("4. API errors (local service): 529 overloaded / 500");
for (const [m, status] of [
  ["overloaded", 529],
  ["server", 500],
] as const) {
  mode = m;
  requests = [];
  const error = await errorOf(async () => ask(await local(), "claude-haiku-5-5"));
  check(
    `${status}: an error, exactly one request (no retry)`,
    statusOf(error) === status && requests.length === 1,
    `status ${statusOf(error)}, ${requests.length} requests`,
  );
  check(
    `${status}: shown as 'השירות של Anthropic עמוס או לא זמין כרגע'`,
    describeAiError(error).startsWith("השירות של Anthropic עמוס"),
  );
}

console.log("5. an answer that is not by the schema (local service)");
mode = "not-json";
requests = [];
{
  const error = await errorOf(async () => ask(await local(), "claude-haiku-5-5"));
  check(
    "free text instead of JSON → refused (nothing of it shown)",
    error instanceof Error && /unexpected format/.test(error.message),
  );
  const usage = (error as { usage?: { inputTokens: number; outputTokens: number } })?.usage;
  check(
    "the tokens of the unusable answer are still counted (cost recorded)",
    usage?.inputTokens === 4200 && usage?.outputTokens === 18,
  );
  check(
    "shown as 'תשובת ה-AI לא הגיעה בפורמט הצפוי'",
    describeAiError(error) === "תשובת ה-AI לא הגיעה בפורמט הצפוי",
  );
}
mode = "foreign-ids";
{
  const routed = await ask(await local(), "claude-haiku-5-5");
  check(
    "ids of the other product / made up are dropped — only this catalog's guides",
    JSON.stringify(routed.result.guideIds) === JSON.stringify(["add-product"]),
    JSON.stringify(routed.result.guideIds),
  );
}

console.log("6. tokens and cost by the price list (local service)");
mode = "ok";
requests = [];
{
  const routed = await ask(await local(), "claude-haiku-5-5");
  const usage = {
    inputTokens: routed.inputTokens,
    outputTokens: routed.outputTokens,
    cacheWriteTokens: routed.cacheWriteTokens,
    cacheReadTokens: routed.cacheReadTokens,
  };
  check(
    "input = plain + cache write + cache read (4200), output 18",
    usage.inputTokens === 4200 && usage.outputTokens === 18 && usage.cacheWriteTokens === 3000,
  );
  const p = MODEL_PRICES["claude-haiku-5-5"];
  const expected =
    (1200 * p.input + 3000 * p.cacheWrite + 0 * p.cacheRead + 18 * p.output) / 1_000_000;
  const cost = estimateCostUsd("claude-haiku-5-5", usage);
  check(
    `the cost by the price list — $${cost.toFixed(6)}`,
    Math.abs(cost - expected) < 1e-12,
    `expected $${expected.toFixed(6)}`,
  );
  check("one request", requests.length === 1);
}
stub.close();
if (savedEnv.host === undefined) delete process.env["PLATFORM_ADMIN_HOST"];
else process.env["PLATFORM_ADMIN_HOST"] = savedEnv.host;
if (savedEnv.url === undefined) delete process.env["AI_ASSISTANT_TEST_API_URL"];
else process.env["AI_ASSISTANT_TEST_API_URL"] = savedEnv.url;

// ---------------------------------------------------------------- קריאה אמיתית אחת (רק עם --paid)
const stagingKey = process.env["ANTHROPIC_STAGING_KEY"]?.trim() ?? "";
if (!PAID) {
  console.log("7. one real paid call — skipped (run with ANTHROPIC_STAGING_KEY=… and --paid)");
} else if (!stagingKey) {
  console.log("7. one real paid call — skipped: ANTHROPIC_STAGING_KEY is not set");
  failed += 1;
} else {
  console.log(
    `7. one real call per chosen model (key …${keyLast4(stagingKey)}): ${chosen.join(", ")}`,
  );
  for (const name of chosen) {
    const model = MODELS[name]!;
    requests = [];
    const started = Date.now();
    const error = await errorOf(async () => {
      const routed = await ask(await createAnthropicRouterClient(stagingKey), model);
      const usage = {
        inputTokens: routed.inputTokens,
        outputTokens: routed.outputTokens,
        cacheWriteTokens: routed.cacheWriteTokens,
        cacheReadTokens: routed.cacheReadTokens,
      };
      const cost = estimateCostUsd(model, usage);
      check(
        `${model}: classified as help with this catalog's guides`,
        routed.result.topic === "site_help" &&
          routed.result.guideIds.length > 0 &&
          routed.result.guideIds.every((id) => known.has(id)),
        JSON.stringify(routed.result),
      );
      check(
        `${model}: tokens counted`,
        usage.inputTokens > 0 && usage.outputTokens > 0,
        JSON.stringify(usage),
      );
      check(`${model}: cost $${cost.toFixed(6)} (under 5 cents)`, cost > 0 && cost < 0.05);
      check(`${model}: exactly one request, ${Date.now() - started} ms`, requests.length === 1);
    });
    if (error) check(`${model}: the request was accepted`, false, describeAiError(error));
  }
}

globalThis.fetch = realFetch;
console.log(
  `\nAI staging check: ${passed} passed, ${failed} failed${PAID ? "" : " (no paid call made)"}`,
);
process.exit(failed === 0 ? 0 : 1);
