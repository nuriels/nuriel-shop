/**
 * NURIEL AI – Hospitality: הצעות SEO (ניהול וקידום SEO של האתר). צד שרת בלבד.
 *
 * אותו צינור כמו העוזר ו"מוצרים כפולים" (src/platform/ai/assistant.server.ts,
 * src/lib/ai/product-duplicates-ai.server.ts), באותו סדר ובכל קריאה מחדש — בלי שום מנגנון AI נוסף:
 *  1. מי הפונה — מהטוקן; העסק — לפי הכתובת; העסק חייב להיות אתר אירוח (resolveCaller).
 *  2. הגבלת קצב למשתמש — לפני שאילתות המסד.
 *  3. בעלים / מנהל, ועם הרשאת settings (seo_proposals() במסד נקרא בשם המשתמש — אחרת נדחה).
 *  4. תבניות (בלי AI) — לכל עסק, בחינם, בלי מכסה ובלי חיוב.
 *  5. AI — רק לעסק זכאי (evaluateAccess: חבילת NURIEL AI – Hospitality בתוקף, מצב העוזר, מפתח שמור). עסק
 *     בלי חבילה: אין קריאה לדגם, אין מכסה, אין חיוב — רק הודעה.
 *  6. לכל קריאה לדגם — המכסות במסד (ai_quota_take: משתמש, עסק, "אותה בקשה", כלל המערכת, תקרת התקציב
 *     החודשית). בלי בדיקת מכסה — בלי קריאה. אותו מפתח, אותו דגם (ai_settings), אותו לקוח
 *     (createAnthropicRouterClient), ואותו יומן (ai_usage_log, סימון "seo-writer").
 *  7. התשובה נבדקת (seo-writer.ts) ונכנסת כהצעה ממתינה בלבד (seo_proposals_add). שום דבר לא נשמר באתר.
 * הפקה ראשונית — פעם אחת לעסק לכל סוג (seo_run_start במסד, גם בקריאות מקבילות).
 */
import { HOSPITALITY_GUIDE_CATALOG } from "./guides";
import {
  ALT_BATCH,
  ALT_MAX_PER_RUN,
  SEO_USAGE_MARK,
  altCandidates,
  altOutputSchema,
  buildAltPrompt,
  buildContextMessage,
  buildRewordMessage,
  buildRewordPrompt,
  buildSeoContext,
  buildTextPrompt,
  parseAltOutput,
  parseRewordOutput,
  parseTextOutput,
  rewordOutputSchema,
  textOutputSchema,
  type AltImage,
  type SeoContext,
} from "./seo-writer";
import type { PublicPackage } from "../types/packages";
import type { PublicRoomType, PublicSite, RawPublicSite } from "../types/website";
import type {
  SeoGenerateResult,
  SeoProposal,
  SeoProposalItem,
  SeoProposalsView,
} from "../types/seo";
import { normalizeDesign, type SiteDesign } from "../website/design/schema";
import { toPublicSite } from "../website/lib/site-map";
import { templateProposals } from "../website/seo-templates";
import {
  BUDGET_REACHED,
  evaluateAccess,
  resolveCaller,
  type AiCaller,
  type Evaluation,
} from "@/platform/ai/assistant.server";
import {
  denialMessage,
  describeAiError,
  estimateCostUsd,
  FORBIDDEN_MESSAGE,
  LIMITED_MESSAGE,
  NO_TOKENS,
  type AiModelId,
  type TokenUsage,
} from "@/platform/ai/logic";
import {
  createAnthropicRouterClient,
  thinkingFor,
  type RouterClient,
  type RouterParams,
} from "@/platform/ai/router.server";
import { SafeError } from "@/platform/ai/safe-error";
import * as store from "@/platform/ai/store.server";

/** כל בקשה (גם של מי שאינו מנהל) — למשתמש בדקה, לפני השאילתות במסד */
export const SEO_GATE_PER_MINUTE = 10;

export const SEO_UNAVAILABLE_MESSAGE =
  "שיפור הניסוח ותיאורי התמונות עם AI זמינים בשירות NURIEL AI. ההצעות הבסיסיות זמינות לכם בחינם.";
export const SEO_BUDGET_MESSAGE = "הצעות ה-AI לא זמינות כרגע. נסו שוב מאוחר יותר.";
export const SEO_FAILED_MESSAGE = "לא הצלחתי להכין הצעות עם AI כרגע. נסו שוב בעוד כמה דקות.";
export const SEO_REPEATED_MESSAGE =
  "כבר ביקשתם את זה כמה פעמים בדקות האחרונות. נסו שוב בעוד כמה דקות.";

// ------------------------------------------------------------------ הבקשות לדגם (במקום אחד — הבדיקות מוודאות מה יוצא)

const maxTokens = (model: AiModelId, big: boolean) =>
  model === "claude-opus-5-5" ? (big ? 12000 : 6000) : big ? 6000 : 2048;

function params(
  model: AiModelId,
  system: string,
  content: RouterParams["messages"][number]["content"],
  schema: Record<string, unknown>,
  big: boolean,
): RouterParams {
  const thinking = thinkingFor(model);
  return {
    model,
    max_tokens: maxTokens(model, big),
    ...(thinking ? { thinking } : {}),
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { effort: "low", format: { type: "json_schema", schema } },
  };
}

export function buildTextParams(model: AiModelId, ctx: SeoContext): RouterParams {
  return params(
    model,
    buildTextPrompt(),
    buildContextMessage(ctx),
    textOutputSchema([...ctx.unitRefs.keys()]),
    true,
  );
}

export function buildAltParams(model: AiModelId, images: readonly AltImage[]): RouterParams {
  return params(
    model,
    buildAltPrompt(),
    images.flatMap((img) => [
      { type: "text" as const, text: `Photo ${img.ref}:` },
      { type: "image" as const, source: { type: "url" as const, url: img.url } },
    ]),
    altOutputSchema(images.map((i) => i.ref)),
    false,
  );
}

export function buildRewordParams(
  model: AiModelId,
  ctx: SeoContext,
  target: Parameters<typeof buildRewordMessage>[1],
): RouterParams {
  return params(
    model,
    buildRewordPrompt(),
    buildRewordMessage(ctx, target),
    rewordOutputSchema(),
    false,
  );
}

// ------------------------------------------------------------------ קריאה אחת לדגם

type Called = { ok: boolean; parsed: unknown; usage: TokenUsage; error: string | null };

async function send(client: RouterClient, p: RouterParams): Promise<Called> {
  try {
    const call = await client.send(p);
    const usage: TokenUsage = {
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      cacheWriteTokens: call.cacheWriteTokens ?? 0,
      cacheReadTokens: call.cacheReadTokens ?? 0,
    };
    // הדגם סירב — אין הצעות; לא תקלה
    if (call.stopReason === "refusal") return { ok: true, parsed: null, usage, error: null };
    if (call.stopReason !== "end_turn" || call.text === null)
      return {
        ok: false,
        parsed: null,
        usage,
        error: describeAiError(
          new Error(`unexpected format (stop_reason ${String(call.stopReason)})`),
        ),
      };
    try {
      return { ok: true, parsed: JSON.parse(call.text), usage, error: null };
    } catch {
      return {
        ok: false,
        parsed: null,
        usage,
        error: describeAiError(new Error("unexpected format (invalid JSON)")),
      };
    }
  } catch (error) {
    const usage = (error as { usage?: TokenUsage } | null)?.usage;
    return {
      ok: false,
      parsed: null,
      usage: usage && typeof usage.inputTokens === "number" ? usage : NO_TOKENS,
      error: describeAiError(error),
    };
  }
}

// ------------------------------------------------------------------ המסד

async function serverRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { callServerRpc } = await import("../server/rpc.server");
  return callServerRpc<T>(fn, args, { ip: "unknown", userAgent: "hospitality-seo" });
}

export interface SeoDeps {
  createClient?: (apiKey: string) => Promise<RouterClient>;
  /** בבדיקות: נתוני האתר והרשימה בלי מסד */
  load?: (caller: AiCaller) => Promise<Loaded>;
  rpc?: <T>(fn: string, args: Record<string, unknown>) => Promise<T>;
}

export interface Loaded {
  site: PublicSite;
  design: SiteDesign;
  view: { proposals: SeoProposal[]; runs: SeoProposalsView["runs"] };
}

/** בשם המשתמש: הרשימה (בודקת הרשאת settings במסד) והאתר עם הטיוטה */
async function loadForCaller(): Promise<Loaded> {
  const [{ manageRpc }, { publicUrl }] = await Promise.all([
    import("../server/manage.server"),
    import("../server/media.server"),
  ]);
  const view = await manageRpc<Loaded["view"]>("seo_proposals", {});
  const [raw, types, packages] = await Promise.all([
    manageRpc<RawPublicSite>("site_preview", {}),
    manageRpc<PublicRoomType[]>("room_types_view", {}).catch(() => [] as PublicRoomType[]),
    Promise.resolve([] as PublicPackage[]),
  ]);
  // הביטויים של העסק נקראים מהמסמך לפני toPublicSite (שמסיר אותם מכל מה שנשלח לדפדפן)
  const design = normalizeDesign(raw.design?.document ?? null, raw.design?.theme);
  return { site: toPublicSite(raw, publicUrl, types, packages), design, view };
}

// ------------------------------------------------------------------ הפונה

type Ready =
  { ok: true; caller: AiCaller; loaded: Loaded } | { ok: false; result: SeoGenerateResult };

async function ready(deps: SeoDeps): Promise<Ready> {
  const caller = await resolveCaller("hospitality", {
    bucket: "ai:seo-gate",
    perMinute: SEO_GATE_PER_MINUTE,
  });
  if (caller === "limited")
    return { ok: false, result: { status: "limited", message: LIMITED_MESSAGE } };
  if (!caller) throw new SafeError(FORBIDDEN_MESSAGE);
  // בשם המשתמש — מי שאין לו הרשאת settings נדחה כאן, לפני כל הפקה
  const loaded = await (deps.load ?? loadForCaller)(caller);
  return { ok: true, caller, loaded };
}

/** מצב NURIEL AI לעסק — בלי לצרוך מכסה */
export async function aiAvailability(
  caller: AiCaller,
): Promise<{ ev: Evaluation; available: boolean; message: string | null }> {
  const ev = await evaluateAccess(caller, HOSPITALITY_GUIDE_CATALOG);
  const available = ev.denial === null && !!ev.key;
  return {
    ev,
    available,
    message: available
      ? null
      : ev.state.status === "none"
        ? SEO_UNAVAILABLE_MESSAGE
        : denialMessage(ev.denial ?? "assistant_off", ev.state),
  };
}

// ------------------------------------------------------------------ הפקה

type RunKind = "template" | "ai";
type RunScope = "initial" | "request";

async function startRun(
  rpc: NonNullable<SeoDeps["rpc"]>,
  caller: AiCaller,
  kind: RunKind,
  scope: RunScope,
): Promise<string | null> {
  return rpc<string | null>("seo_run_start", {
    _tenant: caller.tenantId,
    _actor: caller.userId,
    _kind: kind,
    _scope: scope,
  });
}

async function addItems(
  rpc: NonNullable<SeoDeps["rpc"]>,
  caller: AiCaller,
  run: string,
  items: SeoProposalItem[],
  onlyEmpty: boolean,
): Promise<{ added: number; skipped: number }> {
  if (!items.length) return { added: 0, skipped: 0 };
  return rpc("seo_proposals_add", {
    _tenant: caller.tenantId,
    _run: run,
    _items: items,
    _only_empty: onlyEmpty,
  });
}

async function finishRun(
  rpc: NonNullable<SeoDeps["rpc"]>,
  caller: AiCaller,
  run: string,
  ok: boolean,
) {
  await rpc("seo_run_finish", { _tenant: caller.tenantId, _run: run, _ok: ok });
}

/** הצעות בסיסיות (בלי AI) — לכל עסק */
async function runTemplates(
  rpc: NonNullable<SeoDeps["rpc"]>,
  caller: AiCaller,
  loaded: Loaded,
  scope: RunScope,
): Promise<SeoGenerateResult> {
  const run = await startRun(rpc, caller, "template", scope);
  if (!run) return { status: "already" };
  try {
    const r = await addItems(rpc, caller, run, templateProposals(loaded), true);
    await finishRun(rpc, caller, run, true);
    return { status: "ok", ...r, calls: 0 };
  } catch (error) {
    await finishRun(rpc, caller, run, false).catch(() => undefined);
    throw error;
  }
}

type AiJob =
  | { what: "text" }
  | { what: "alt"; onlyEmpty: boolean }
  | { what: "reword"; proposal: SeoProposal };

/**
 * הפקת AI. עסק בלי NURIEL AI פעיל — "unavailable" בלי קריאה, בלי מכסה ובלי חיוב. כל קריאה לדגם עוברת
 * במכסות ובתקציב הקיימים; קריאה שנחסמה — עוצרים (מה שכבר הוכן נשמר כהצעות).
 */
async function runAi(
  rpc: NonNullable<SeoDeps["rpc"]>,
  caller: AiCaller,
  loaded: Loaded,
  scope: RunScope,
  jobs: AiJob[],
  deps: SeoDeps,
): Promise<SeoGenerateResult> {
  const { ev, available } = await aiAvailability(caller);
  if (!available || !ev.key) return { status: "unavailable", message: denialFor(ev) };
  const run = await startRun(rpc, caller, "ai", scope);
  if (!run) return { status: "already" };

  const ctx = buildSeoContext(loaded.site, loaded.design);
  const createClient = deps.createClient ?? createAnthropicRouterClient;
  let client: RouterClient | null = null;
  let added = 0;
  let skipped = 0;
  let calls = 0;
  let succeeded = 0;
  let stop: SeoGenerateResult | null = null;
  const onlyEmpty = scope === "initial";

  // כל קריאה: מכסה → דגם → בדיקה → הצעות → יומן
  const call = async (
    fingerprint: string,
    build: () => RouterParams,
    parse: (parsed: unknown) => SeoProposalItem[],
    itemsOnlyEmpty: boolean,
  ): Promise<boolean> => {
    let quota: store.QuotaResult | "unchecked";
    try {
      quota = await store.takeQuota({
        tenantId: caller.tenantId,
        userId: caller.userId,
        fingerprint,
        modelCall: true,
      });
    } catch {
      quota = "unchecked";
    }
    if (quota !== "ok") {
      if (quota === "budget" && ev.settings?.last_error !== BUDGET_REACHED)
        await store.recordLastError(BUDGET_REACHED);
      stop =
        quota === "repeated"
          ? { status: "limited", message: SEO_REPEATED_MESSAGE }
          : quota === "user" || quota === "tenant" || quota === "global"
            ? { status: "limited", message: LIMITED_MESSAGE }
            : { status: "unavailable", message: SEO_BUDGET_MESSAGE };
      return false;
    }
    client ??= await createClient(ev.key!);
    calls++;
    const called = await send(client, build());
    let items: SeoProposalItem[] = [];
    if (called.ok) {
      succeeded++;
      items = parse(called.parsed);
      const r = await addItems(rpc, caller, run, items, itemsOnlyEmpty);
      added += r.added;
      skipped += r.skipped;
    }
    if (called.ok && ev.settings?.last_error) await store.recordLastError(null);
    if (!called.ok) await store.recordLastError(called.error);
    await store.logUsage({
      tenantId: caller.tenantId,
      product: "hospitality",
      mode: ev.testMode ? "test" : called.ok ? "ai" : "ai_error",
      outcome: called.ok ? "guides" : "failed",
      guides: [SEO_USAGE_MARK],
      question: null,
      model: ev.model,
      inputTokens: called.usage.inputTokens,
      outputTokens: called.usage.outputTokens,
      cacheWriteTokens: called.usage.cacheWriteTokens,
      cacheReadTokens: called.usage.cacheReadTokens,
      costUsd: estimateCostUsd(ev.model, called.usage),
      error: called.error,
    });
    return called.ok;
  };

  try {
    for (const job of jobs) {
      if (stop) break;
      if (job.what === "text") {
        await call(
          `seo:text:${scope}`,
          () => buildTextParams(ev.model, ctx),
          (parsed) => parseTextOutput(parsed, ctx),
          onlyEmpty,
        );
      } else if (job.what === "alt") {
        // תמונות שכבר יש להן הצעה ממתינה — דילוג (כך כל בקשה מתקדמת בגלריה)
        const pending = new Set(
          loaded.view.proposals
            .filter((p) => p.status === "pending" && p.target_kind === "media" && p.target_id)
            .map((p) => p.target_id!),
        );
        const images = altCandidates(loaded.site, {
          onlyEmpty: job.onlyEmpty,
          limit: ALT_MAX_PER_RUN,
          skip: pending,
        });
        for (let i = 0; i < images.length && !stop; i += ALT_BATCH) {
          const batch = images.slice(i, i + ALT_BATCH).map((img, k) => ({ ...img, ref: k + 1 }));
          await call(
            `seo:alt:${batch[0]!.mediaId}`,
            () => buildAltParams(ev.model, batch),
            (parsed) => parseAltOutput(parsed, batch, ctx.phone),
            job.onlyEmpty,
          );
        }
      } else {
        const p = job.proposal;
        if (p.target_kind === "media") {
          const img = altCandidates(loaded.site, { onlyEmpty: false, limit: 10000 }).find(
            (x) => x.mediaId === p.target_id,
          );
          if (!img) continue;
          const one = [{ ...img, ref: 1 }];
          await call(
            `seo:reword:${p.id}`,
            () => buildAltParams(ev.model, one),
            (parsed) => parseAltOutput(parsed, one, ctx.phone).filter((x) => x.text !== p.proposed),
            false,
          );
        } else {
          const unitRef =
            p.target_kind === "unit"
              ? ([...ctx.unitRefs.entries()].find(([, id]) => id === p.target_id)?.[0] ?? null)
              : null;
          if (p.target_kind === "unit" && !unitRef) continue;
          const target = { kind: p.target_kind, field: p.field, unitRef, previous: p.proposed };
          await call(
            `seo:reword:${p.id}`,
            () => buildRewordParams(ev.model, ctx, target),
            (parsed) => {
              const text = parseRewordOutput(parsed, target, ctx.phone);
              return text && text !== p.proposed
                ? [{ target_kind: p.target_kind, target_id: p.target_id, field: p.field, text }]
                : [];
            },
            false,
          );
        }
      }
    }
  } finally {
    // ריצה בלי אף קריאה מוצלחת — "נכשלה", כך שהפקה ראשונית תנסה שוב בפעם הבאה
    await finishRun(rpc, caller, run, succeeded > 0).catch(() => undefined);
  }
  if (stop && added === 0) return stop;
  if (calls > 0 && succeeded === 0) return { status: "failed", message: SEO_FAILED_MESSAGE };
  return { status: "ok", added, skipped, calls };
}

function denialFor(ev: Evaluation): string {
  return ev.state.status === "none"
    ? SEO_UNAVAILABLE_MESSAGE
    : denialMessage(ev.denial ?? "assistant_off", ev.state);
}

// ------------------------------------------------------------------ מה פונקציות השרת קוראות

/** הרשימה + האם NURIEL AI זמין לעסק (בלי מכסה ובלי קריאה לדגם) */
export async function handleSeoView(deps: SeoDeps = {}): Promise<SeoProposalsView> {
  const r = await ready(deps);
  if (!r.ok) throw new SafeError(LIMITED_MESSAGE);
  const { available, message } = await aiAvailability(r.caller);
  return { ...r.loaded.view, ai: { available, message } };
}

/**
 * הפעם הראשונה שהעסק פותח את "גוגל ושיתוף": הצעות בסיסיות (פעם אחת, לכל עסק), ולעסק עם NURIEL AI פעיל —
 * הפקת AI ראשונית אחת (טקסטים + עד 24 תיאורי תמונות), בתוך המכסות והתקציב. רק לשדות ריקים.
 */
export async function handleSeoAutoStart(deps: SeoDeps = {}): Promise<{
  template: SeoGenerateResult;
  ai: SeoGenerateResult;
}> {
  const r = await ready(deps);
  if (!r.ok) return { template: r.result, ai: r.result };
  const rpc = deps.rpc ?? serverRpc;
  const { caller, loaded } = r;
  const template = loaded.view.runs.template_initial
    ? ({ status: "already" } as const)
    : await runTemplates(rpc, caller, loaded, "initial");
  const ai = loaded.view.runs.ai_initial
    ? ({ status: "already" } as const)
    : await runAi(
        rpc,
        caller,
        loaded,
        "initial",
        [{ what: "text" }, { what: "alt", onlyEmpty: true }],
        deps,
      );
  return { template, ai };
}

export type SeoGenerateInput =
  | { kind: "template" }
  | { kind: "ai"; what: "text" | "alt" }
  | { kind: "reword"; proposalId: string };

/** לפי בקשה: הצעות בסיסיות, טקסטים / תיאורי תמונות עם AI, או ניסוח אחר להצעה אחת */
export async function handleSeoGenerate(
  input: unknown,
  deps: SeoDeps = {},
): Promise<SeoGenerateResult> {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const r = await ready(deps);
  if (!r.ok) return r.result;
  const rpc = deps.rpc ?? serverRpc;
  const { caller, loaded } = r;
  if (raw["kind"] === "template") return runTemplates(rpc, caller, loaded, "request");
  if (raw["kind"] === "ai" && (raw["what"] === "text" || raw["what"] === "alt"))
    return runAi(
      rpc,
      caller,
      loaded,
      "request",
      [raw["what"] === "text" ? { what: "text" } : { what: "alt", onlyEmpty: true }],
      deps,
    );
  if (raw["kind"] === "reword" && typeof raw["proposalId"] === "string") {
    const p = loaded.view.proposals.find(
      (x) => x.id === raw["proposalId"] && x.status === "pending",
    );
    if (!p) return { status: "failed", message: "ההצעה לא נמצאה או שכבר טופלה" };
    return runAi(rpc, caller, loaded, "request", [{ what: "reword", proposal: p }], deps);
  }
  throw new SafeError("בקשה לא תקינה");
}
