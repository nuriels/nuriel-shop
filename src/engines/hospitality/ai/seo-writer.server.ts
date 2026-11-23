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
  SeoField,
  SeoGenerateResult,
  SeoProposal,
  SeoProposalItem,
  SeoProposalsView,
} from "../types/seo";
import { normalizeDesign, type SiteDesign } from "../website/design/schema";
import { toPublicSite } from "../website/lib/site-map";
import { templateProposals } from "../website/seo-templates";
import {
  SEO_FIX_FIELD,
  parseSeoFix,
  sameTarget,
  seoFixTargets,
  type SeoFixResult,
  type SeoFixTarget,
} from "../website/seo-fix";
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

/**
 * מנוע ה-SEO (הפקה ברקע): "משתמש" קבוע רק לדלי המכסה למשתמש בדקה (ai_quota_take) — המכסה של העסק, "אותה
 * בקשה", כלל המערכת ותקרת התקציב חלים כרגיל. לא נרשם כפעולה של אדם (seo_run_start מקבל NULL).
 */
export const SEO_SYSTEM_USER = "00000000-0000-4000-8000-00000000a1e0";

/** בקשת הפקה (הצעות בסיסיות / AI / ניסוח אחר) — למשתמש בדקה, לפני השאילתות במסד */
export const SEO_GATE_PER_MINUTE = 10;
/**
 * פתיחת הלשונית והרשימה (קריאה בלבד + ההפקה הראשונית, שקורית פעם אחת לעסק) — למשתמש בדקה, כמו מצב העוזר.
 * נפרד מהפקה: כל אישור מרענן את הרשימה ואת העורך, ובמכסה של 10 בדקה הרשימה הייתה נעלמת אחרי כמה אישורים.
 */
export const SEO_VIEW_PER_MINUTE = 60;

const GENERATE_GATE = { bucket: "ai:seo-gate", perMinute: SEO_GATE_PER_MINUTE } as const;
const VIEW_GATE = { bucket: "ai:seo-view", perMinute: SEO_VIEW_PER_MINUTE } as const;

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

/**
 * בשם המשתמש: הרשימה (בודקת הרשאת settings במסד) והאתר עם הטיוטה. החבילות — הרשימה הציבורית של העסק
 * (public_packages, כמו מנוע ה-SEO ברקע), כך שגם "הצעות בסיסיות" ו"תקנו לי" מהמסך מכסים את החבילות.
 */
async function loadForCaller(caller: AiCaller): Promise<Loaded> {
  const [{ manageRpc }, { publicUrl }, { rpc: publicRpc }] = await Promise.all([
    import("../server/manage.server"),
    import("../server/media.server"),
    import("../website/seo.server"),
  ]);
  const view = await manageRpc<Loaded["view"]>("seo_proposals", {});
  const [raw, types, packages] = await Promise.all([
    manageRpc<RawPublicSite>("site_preview", {}),
    manageRpc<PublicRoomType[]>("room_types_view", {}).catch(() => [] as PublicRoomType[]),
    publicRpc<PublicPackage[]>(caller.tenantId, "public_packages").catch(
      () => [] as PublicPackage[],
    ),
  ]);
  // הביטויים של העסק נקראים מהמסמך לפני toPublicSite (שמסיר אותם מכל מה שנשלח לדפדפן)
  const design = normalizeDesign(raw.design?.document ?? null, raw.design?.theme);
  return { site: toPublicSite(raw, publicUrl, types, packages), design, view };
}

// ------------------------------------------------------------------ הפונה

type Ready =
  { ok: true; caller: AiCaller; loaded: Loaded } | { ok: false; result: SeoGenerateResult };

async function ready(
  deps: SeoDeps,
  gate: typeof GENERATE_GATE | typeof VIEW_GATE = GENERATE_GATE,
): Promise<Ready> {
  const caller = await resolveCaller("hospitality", gate);
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
/** auto — a background run of the SEO engine (new units / packages / images): empty fields only, like initial */
type RunScope = "initial" | "request" | "auto";

async function startRun(
  rpc: NonNullable<SeoDeps["rpc"]>,
  caller: AiCaller,
  kind: RunKind,
  scope: RunScope,
): Promise<string | null> {
  return rpc<string | null>("seo_run_start", {
    _tenant: caller.tenantId,
    // a background run has no person behind it — not recorded as anyone's action
    _actor: caller.userId === SEO_SYSTEM_USER ? null : caller.userId,
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
  | { what: "reword"; proposal: SeoProposal }
  /** "תקנו לי": ניסוח חדש לשדה אחד של עמוד אחד, במקום הטקסט שיש עכשיו (חבילות — בלי AI: לא בהקשר) */
  | { what: "fix"; target: SeoFixTarget; field: SeoField; previous: string };

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
  const onlyEmpty = scope !== "request";

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
            .filter(
              (p) =>
                (p.status === "pending" || p.status === "later") &&
                p.target_kind === "media" &&
                p.target_id,
            )
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
      } else if (job.what === "fix") {
        const { target, field } = job;
        if (target.target_kind === "package") continue;
        const unitRef =
          target.target_kind === "unit"
            ? ([...ctx.unitRefs.entries()].find(([, id]) => id === target.target_id)?.[0] ?? null)
            : null;
        if (target.target_kind === "unit" && !unitRef) continue;
        const ask = { kind: target.target_kind, field, unitRef, previous: job.previous };
        await call(
          `seo:fix:${target.target_kind}:${target.target_id ?? "home"}:${field}`,
          () => buildRewordParams(ev.model, ctx, ask),
          (parsed) => {
            const text = parseRewordOutput(parsed, ask, ctx.phone);
            return text && text !== job.previous
              ? [{ target_kind: target.target_kind, target_id: target.target_id, field, text }]
              : [];
          },
          false,
        );
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
  const r = await ready(deps, VIEW_GATE);
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
  // חלק מפתיחת הלשונית: אחרי הפעם הראשונה רק "already" (בלי הפקה); קריאות לדגם — במכסות הקיימות
  const r = await ready(deps, VIEW_GATE);
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

export const SEO_FIX_GONE =
  'לא מצאנו את העמוד הזה באתר — ייתכן שהוא השתנה מאז הבדיקה. לחצו "לבדוק עכשיו" ונסו שוב.';
export const SEO_FIX_BUSY = "הכנת הצעות אחרת רצה ממש עכשיו — נסו שוב בעוד רגע.";
export const SEO_FIX_NOTHING =
  "אין לנו הצעה טובה יותר ממה שכתוב עכשיו. אפשר לערוך את הטקסט בעצמכם בעמוד עצמו.";

/** הטקסט שיש עכשיו בשדה (או מה שגוגל רואה במקומו) — הבסיס לניסוח החדש */
function currentText(loaded: Loaded, t: SeoFixTarget, field: SeoField): string {
  if (t.target_kind === "site")
    return (
      (field === "seo_title" ? loaded.design.seo?.title : loaded.design.seo?.description) ?? ""
    );
  if (t.target_kind === "unit") {
    const u = loaded.site.units.find((x) => x.id === t.target_id);
    if (!u) return "";
    return field === "seo_title"
      ? (u.seo_title ?? u.name)
      : (u.seo_description ?? (u.description ?? "").slice(0, 300));
  }
  return "";
}

/**
 * "תקנו לי" ליד ממצא בבדיקה הטכנית (כותרת / תיאור לגוגל): הצעה ממתינה לכל עמוד שבממצא — קודם התבנית
 * (בחינם, מהנתונים של העסק), ולעמוד שהתבנית לא מציעה לו משהו חדש — NURIEL AI (רק לעסק זכאי, במכסות). עמוד
 * שכבר מחכה לו הצעה לאותו שדה — לא מפיקים שוב, רק מצביעים עליה. שום דבר לא משתנה באתר עד שבעל העסק מאשר.
 */
export async function handleSeoFix(input: unknown, deps: SeoDeps = {}): Promise<SeoFixResult> {
  const request = parseSeoFix(input);
  if (!request) throw new SafeError("לממצא הזה אין תיקון אוטומטי");
  const field = SEO_FIX_FIELD[request.code]!;
  const r = await ready(deps);
  if (!r.ok)
    return {
      status: r.result.status === "limited" ? "limited" : "failed",
      message: "message" in r.result ? r.result.message : null,
      field,
      targets: [],
      added: 0,
    };
  const rpc = deps.rpc ?? serverRpc;
  const { caller } = r;
  let loaded = r.loaded;
  const reload = async () => {
    loaded = await (deps.load ?? loadForCaller)(caller);
  };
  const targets = seoFixTargets(loaded.site, request);
  if (!targets.length)
    return { status: "none", message: SEO_FIX_GONE, field, targets: [], added: 0 };
  const waiting = () =>
    targets.filter((t) =>
      loaded.view.proposals.some(
        (p) =>
          (p.status === "pending" || p.status === "later") && p.field === field && sameTarget(p, t),
      ),
    );

  let added = 0;
  const need = targets.filter((t) => !waiting().some((w) => sameTarget(w, t)));
  const items = templateProposals(loaded).filter(
    (i) => i.field === field && need.some((t) => sameTarget(t, i)),
  );
  if (items.length) {
    const run = await startRun(rpc, caller, "template", "request");
    if (!run) return { status: "busy", message: SEO_FIX_BUSY, field, targets: waiting(), added: 0 };
    try {
      added += (await addItems(rpc, caller, run, items, false)).added;
      await finishRun(rpc, caller, run, true);
    } catch (error) {
      await finishRun(rpc, caller, run, false).catch(() => undefined);
      throw error;
    }
    if (added > 0) await reload();
  }

  // התבנית לא הציעה משהו חדש (הטקסט שלה כבר באתר) — ניסוח חדש עם NURIEL AI, מהטקסט שיש עכשיו
  let note: string | null = null;
  const missing = targets.filter(
    (t) => t.target_kind !== "package" && !waiting().some((w) => sameTarget(w, t)),
  );
  if (missing.length) {
    const jobs: AiJob[] = missing.slice(0, 5).map((t) => ({
      what: "fix",
      target: t,
      field,
      previous: currentText(loaded, t, field),
    }));
    const ai = await runAi(rpc, caller, loaded, "request", jobs, deps);
    if (ai.status === "ok" && ai.added > 0) {
      added += ai.added;
      await reload();
    } else if (ai.status === "unavailable" || ai.status === "limited" || ai.status === "failed") {
      note = ai.message;
    }
  }
  const found = waiting();
  if (!found.length)
    return { status: "none", message: note ?? SEO_FIX_NOTHING, field, targets: [], added };
  return { status: "ok", message: null, field, targets: found, added };
}

// ------------------------------------------------------------------ מנוע ה-SEO: הפקה ברקע (בלי דפדפן)

/**
 * הפקת AI ברקע — מהעובד של מנוע ה-SEO (src/platform/seo/worker.server.ts), רק כש-SEO_BACKGROUND_AI=on ורק
 * לעסק עם חבילת NURIEL AI – Hospitality בתוקף (evaluateAccess, בדיוק כמו בבקשה מהמסך). אותו צינור, אותו
 * מפתח, אותו דגם, אותן מכסות ואותו יומן. רק לשדות ריקים, ורק כהצעות ממתינות.
 */
export async function runBackgroundAi(
  tenantId: string,
  data: { site: PublicSite; design: SiteDesign },
  opts: {
    scope: "initial" | "entity";
    entityType: string | null;
    rpc: <T>(fn: string, args: Record<string, unknown>) => Promise<T>;
  },
  deps: SeoDeps = {},
): Promise<SeoGenerateResult> {
  const caller: AiCaller = {
    userId: SEO_SYSTEM_USER,
    tenantId,
    role: "owner",
    platformAdmin: false,
  };
  const open = await opts.rpc<{
    open: {
      target_kind: SeoProposal["target_kind"];
      target_id: string | null;
      field: SeoProposal["field"];
      status: SeoProposal["status"];
    }[];
    runs: SeoProposalsView["runs"];
  }>("seo_open_targets", { _tenant: tenantId });
  const loaded: Loaded = {
    site: data.site,
    design: data.design,
    view: {
      proposals: open.open.map((o, i) => ({
        id: `open-${i}`,
        target_kind: o.target_kind,
        target_id: o.target_id,
        field: o.field,
        proposed: "",
        base: null,
        source: "template" as const,
        status: o.status,
        applied: null,
        created_at: "",
        decided_at: null,
        target_label: null,
        current: null,
      })),
      runs: open.runs,
    },
  };
  if (opts.scope === "initial" && loaded.view.runs.ai_initial) return { status: "already" };
  const jobs: AiJob[] =
    opts.scope === "initial"
      ? [{ what: "text" }, { what: "alt", onlyEmpty: true }]
      : opts.entityType === "media"
        ? [{ what: "alt", onlyEmpty: true }]
        : [{ what: "text" }];
  return runAi(opts.rpc, caller, loaded, opts.scope === "initial" ? "initial" : "auto", jobs, deps);
}
