/**
 * NURIEL AI ASSISTANT — הצינור של מנהל העסק (מצב העוזר ושאלה). משותף לשני המוצרים; כל פונקציית שרת של
 * מוצר מעבירה את הקטלוג שלה בלבד (Ecommerce: src/lib/ai-assistant.functions.ts, Hospitality:
 * src/engines/hospitality/api/assistant.functions.ts).
 *
 * בכל קריאה, בסדר הזה, ובשרת בלבד:
 *  1. מי הפונה — מהטוקן שאומת (לא ממה שהדפדפן שולח), ובאיזה עסק — לפי הכתובת (Host), לא לפי tenant_id
 *     מהדפדפן. סוג העסק במסד חייב להיות המוצר של הקטלוג.
 *  2. ההרשאה: מנהל העסק (owner / manager לפי המנגנון הקיים) — אחרת "אין הרשאה".
 *  3. הגבלות קצב (משתמש / עסק / כלל המערכת).
 *  4. הזכאות במסד, לפי היום בישראל: חבילה פעילה, תאריך ההתחלה הגיע, תאריך הסיום לא עבר, לא הושבתה,
 *     סוג החבילה וקטלוג המדריכים תואמים. אין "בדיקה בטעינה" — כל שאלה נבדקת מחדש.
 *  5. השאלה: ניקוי, חסימת בקשות אסורות לפני הדגם, סינון מידע רגיש, סיווג בלבד, יומן.
 */
import { sessionFromRequest } from "../auth/session.server";
import { allowAction } from "../security/rate-limit.server";
import { currentSite } from "../tenancy/current-site.server";
import type { GuideCatalog } from "./guides/types";
import { searchGuides, siteVocabularyMatch } from "./guides/search";
import {
  composeAnswer,
  denialFor,
  denialMessage,
  describeAiError,
  detectBlockedRequest,
  endingSoonMessage,
  estimateCostUsd,
  failedAnswer,
  FORBIDDEN_MESSAGE,
  limitedResult,
  NO_TOKENS,
  parseSubscriptionState,
  questionFingerprint,
  questionTooLong,
  redactSensitive,
  REPEATED_MESSAGE,
  sanitizePrevious,
  sanitizeQuestion,
  unavailableResult,
  DEFAULT_MAX_QUESTION_LENGTH,
  type AiModelId,
  type AskResult,
  type AssistantStatusView,
  type DenialCode,
  type SubscriptionState,
  type TokenUsage,
} from "./logic";
import { createAnthropicRouterClient, routeQuestion, type RouterClient } from "./router.server";
import { SafeError } from "./safe-error";
import * as store from "./store.server";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
/** תקרה לכל המערכת (כל העסקים יחד) — נגד לולאה / הצפה, לא תקציב */
export const GLOBAL_HOURLY_LIMIT = 1500;
/** אותה שאלה בדיוק, באותו עסק — עד 3 פעמים ב-10 דקות */
export const SAME_QUESTION_LIMIT = { count: 3, windowMs: 10 * MINUTE } as const;

// ------------------------------------------------------------------ מי הפונה

export type AiCaller = {
  userId: string;
  tenantId: string;
  role: "owner" | "manager";
  platformAdmin: boolean;
};

/**
 * הפונה, רק אם הוא מנהל של העסק שבכתובת, והעסק מהמוצר של הקטלוג. אחרת null — בלי לגלות למה.
 * (מנהל הפלטפורמה הוא owner בכל עסק, כמו בכל המערכת.)
 */
export async function resolveCaller(product: GuideCatalog["product"]): Promise<AiCaller | null> {
  let session: { userId: string } | null = null;
  try {
    session = await sessionFromRequest();
  } catch {
    session = null;
  }
  if (!session) return null;
  const site = await currentSite();
  if (!site || site.siteType !== product) return null;
  const [role, platformAdmin] = await Promise.all([
    store.callerRole(session.userId, site.id),
    store.isPlatformAdmin(session.userId),
  ]);
  if (role !== "owner" && role !== "manager") return null;
  return { userId: session.userId, tenantId: site.id, role, platformAdmin };
}

// ------------------------------------------------------------------ זמינות לפונה

export type Evaluation = {
  settings: store.SettingsRow | null;
  state: SubscriptionState;
  denial: DenialCode | null;
  /** מנהל העל במצב בדיקה: הגישה שלו לא תלויה בחבילה */
  testMode: boolean;
  key: string | null;
  model: AiModelId;
};

export async function evaluateAccess(caller: AiCaller, catalog: GuideCatalog): Promise<Evaluation> {
  const settings = await store.loadSettings();
  let rawState: unknown = null;
  try {
    rawState = await store.entitlement(caller.tenantId);
  } catch {
    rawState = null; // תקלה במסד → "אין חבילה" (נכשל לכיוון הבטוח)
  }
  const state = parseSubscriptionState(rawState);
  const mode = settings?.mode ?? "off";
  let denial: DenialCode | null = null;
  let testMode = false;
  if (mode === "off") {
    denial = "assistant_off";
  } else if (mode === "test") {
    if (caller.platformAdmin) testMode = true;
    else denial = "assistant_off";
  } else {
    denial = denialFor(state, catalog.product, catalog.catalogId);
  }
  // גם במצב בדיקה: העסק חייב להיות מהמוצר של הקטלוג
  if (denial === null && state.siteType !== null && state.siteType !== catalog.product) {
    denial = "product_mismatch";
  }
  const { key, readable } = store.readApiKey(settings);
  if (denial === null && (!key || !readable)) denial = "assistant_off";
  return {
    settings,
    state,
    denial,
    testMode,
    key: denial === null ? key : null,
    model: store.modelOf(settings),
  };
}

/**
 * מצב העוזר למנהל עסק. מי שאינו מנהל העסק (או עסק מסוג אחר) — לא מקבל כלום. עסק שאין לו ולא הייתה לו
 * חבילה לא רואה את העוזר (חוץ ממנהל העל במצב בדיקה). בלי מפתח, דגם, צריכה או עלויות.
 */
export async function handleStatus(catalog: GuideCatalog): Promise<AssistantStatusView> {
  const caller = await resolveCaller(catalog.product);
  if (!caller) return { visible: false };
  const ev = await evaluateAccess(caller, catalog);
  if (ev.state.status === "none" && !ev.testMode) return { visible: false };
  return {
    visible: true,
    product: catalog.product,
    assistantName: catalog.assistantName,
    available: ev.denial === null,
    code: ev.denial,
    message: ev.denial ? denialMessage(ev.denial, ev.state) : null,
    notice: ev.denial === null ? endingSoonMessage(ev.state) : null,
    status: ev.state.status,
    startsOn: ev.state.startsOn,
    endsOn: ev.state.endsOn,
    daysLeft: ev.state.daysLeft,
    renewalPriceAgorot: ev.state.priceAgorot,
    testMode: ev.testMode,
    maxQuestionChars: ev.settings?.max_question_chars ?? DEFAULT_MAX_QUESTION_LENGTH,
  };
}

// ------------------------------------------------------------------ הצינור: שאלה → תשובה

export type AiAccess = { client: RouterClient; model: AiModelId };

/** טוקנים שנצרכו גם כשהקריאה "נכשלה" אחרי תשובה (פורמט לא צפוי / נקטעה) — מוצמדים לשגיאה בנתב */
function usageFromError(error: unknown): TokenUsage | null {
  const usage = (error as { usage?: TokenUsage } | null)?.usage;
  return usage && typeof usage.inputTokens === "number" ? usage : null;
}

export type Answered = {
  answer: AskResult;
  mode: store.UsageMode;
  model: AiModelId | null;
  calledAi: boolean;
  usage: TokenUsage;
  costUsd: number;
  /** תיאור השגיאה — למנהל העל בלבד */
  error: string | null;
};

/**
 * הצינור (אחרי ההרשאה והזכאות):
 *  1. בקשה אסורה (חשיפת הוראות / סיסמאות / מפתחות / קוד / שרת / עסקים אחרים...) → נעצרת כאן, והדגם
 *     לא רואה אותה בכלל.
 *  2. אחרת הדגם מקבל את השאלה אחרי סינון מידע רגיש, ומחזיר רק סיווג ומזהי מדריכים מהקטלוג של המוצר.
 *  3. הקריאה נכשלה (בלי ניסיון חוזר) → הודעה כללית + מדריכים קרובים מהחיפוש; הפרטים למנהל העל.
 * מה שחוזר נבנה תמיד מהודעות קבועות ומזהי מדריכים מהרשימה הסגורה. getAi שמחזיר null = חיפוש בלבד.
 */
export async function answerQuestion(
  catalog: GuideCatalog,
  question: string,
  previousQuestions: readonly string[],
  getAi: () => Promise<AiAccess | null>,
): Promise<Answered> {
  const keywordIds = searchGuides(question, catalog.guides).map((hit) => hit.guide.id);
  const base = { model: null, calledAi: false, usage: NO_TOKENS, costUsd: 0, error: null };
  if (detectBlockedRequest(question)) {
    return {
      ...base,
      answer: composeAnswer({ blocked: true, routed: null, keywordIds, siteVocabulary: false }),
      mode: "blocked",
    };
  }

  let ai: AiAccess | null = null;
  try {
    ai = await getAi();
  } catch (error) {
    return {
      ...base,
      answer: failedAnswer(keywordIds),
      mode: "ai_error",
      error: describeAiError(error),
    };
  }
  if (!ai) {
    return {
      ...base,
      answer: composeAnswer({
        blocked: false,
        routed: null,
        keywordIds,
        siteVocabulary: siteVocabularyMatch(question, catalog.guides),
      }),
      mode: "search",
    };
  }

  // לדגם נשלח רק טקסט מסונן; שאלה קודמת שהייתה בקשה אסורה לא נשלחת כלל
  const previous = previousQuestions
    .filter((item) => !detectBlockedRequest(item))
    .map(redactSensitive);
  try {
    const routed = await routeQuestion(ai.client, {
      catalog,
      model: ai.model,
      question: redactSensitive(question),
      previous,
    });
    const usage: TokenUsage = {
      inputTokens: routed.inputTokens,
      cacheWriteTokens: routed.cacheWriteTokens,
      cacheReadTokens: routed.cacheReadTokens,
      outputTokens: routed.outputTokens,
    };
    return {
      answer: composeAnswer({
        blocked: false,
        routed: routed.result,
        keywordIds,
        siteVocabulary: true,
      }),
      mode: "ai",
      model: ai.model,
      calledAi: true,
      usage,
      costUsd: estimateCostUsd(ai.model, usage),
      error: null,
    };
  } catch (error) {
    const usage = usageFromError(error) ?? NO_TOKENS;
    return {
      ...base,
      answer: failedAnswer(keywordIds),
      mode: "ai_error",
      model: ai.model,
      calledAi: true,
      usage,
      costUsd: estimateCostUsd(ai.model, usage),
      error: describeAiError(error),
    };
  }
}

export function outcomeOf(answer: AskResult): store.UsageOutcome {
  return answer.kind === "guides" || answer.kind === "off_topic" || answer.kind === "failed"
    ? answer.kind
    : "unknown";
}

/** שדות הטוקנים והעלות ליומן — רק כשהייתה קריאה לדגם */
export function usageColumns(answered: Pick<Answered, "calledAi" | "usage" | "costUsd">) {
  if (!answered.calledAi) return {};
  return {
    inputTokens: answered.usage.inputTokens,
    outputTokens: answered.usage.outputTokens,
    cacheWriteTokens: answered.usage.cacheWriteTokens,
    cacheReadTokens: answered.usage.cacheReadTokens,
    costUsd: answered.costUsd,
  };
}

function withinLimits(caller: AiCaller, settings: store.SettingsRow | null): boolean {
  const perMinute = settings?.user_minute_limit ?? 6;
  const perHour = settings?.tenant_hourly_limit ?? 60;
  return (
    allowAction(`ai:user-minute:${caller.userId}`, perMinute, MINUTE) &&
    allowAction(`ai:tenant-hour:${caller.tenantId}`, perHour, HOUR) &&
    allowAction("ai:all-hour", GLOBAL_HOURLY_LIMIT, HOUR)
  );
}

/**
 * שאלה בחלון העוזר — מנהלי העסק בלבד, וכל התנאים נבדקים מחדש בכל שאלה. עוזר לא זמין → רק ההודעה והקוד
 * (subscription_expired וכו'), בלי חיפוש, בלי דגם ובלי יומן. כך גם קריאה ישירה ל-API לא עוקפת דבר.
 */
export async function handleAsk(
  catalog: GuideCatalog,
  input: unknown,
  deps: { createClient?: (apiKey: string) => Promise<RouterClient> } = {},
): Promise<AskResult> {
  const caller = await resolveCaller(catalog.product);
  if (!caller) throw new SafeError(FORBIDDEN_MESSAGE);

  const ev = await evaluateAccess(caller, catalog);
  if (!withinLimits(caller, ev.settings)) return limitedResult();
  if (ev.denial !== null || !ev.key)
    return unavailableResult(ev.denial ?? "assistant_off", ev.state);

  const raw = (typeof input === "object" && input !== null ? input : {}) as {
    question?: unknown;
    previous?: unknown;
  };
  const max = ev.settings?.max_question_chars ?? DEFAULT_MAX_QUESTION_LENGTH;
  if (questionTooLong(raw.question, max)) throw new SafeError(`השאלה ארוכה מדי — עד ${max} תווים`);
  const question = sanitizeQuestion(raw.question, max);
  if (!question) throw new SafeError("נא לכתוב שאלה");

  // אותה שאלה שוב ושוב (סקריפט / לחיצות חוזרות) — לא נשלחת שוב לדגם
  const fingerprint = questionFingerprint(question).slice(0, 200);
  if (
    !allowAction(
      `ai:same:${caller.tenantId}:${fingerprint}`,
      SAME_QUESTION_LIMIT.count,
      SAME_QUESTION_LIMIT.windowMs,
    )
  ) {
    return limitedResult(REPEATED_MESSAGE);
  }

  const key = ev.key;
  const createClient = deps.createClient ?? createAnthropicRouterClient;
  const answered = await answerQuestion(
    catalog,
    question,
    sanitizePrevious(raw.previous),
    async () => ({
      client: await createClient(key),
      model: ev.model,
    }),
  );

  if (answered.mode === "ai" && ev.settings?.last_error) await store.recordLastError(null);
  if (answered.mode === "ai_error") await store.recordLastError(answered.error);
  const outcome = outcomeOf(answered.answer);
  await store.logUsage({
    tenantId: caller.tenantId,
    product: catalog.product,
    mode: ev.testMode ? "test" : answered.mode,
    outcome,
    guides: answered.answer.guideIds,
    // טקסט השאלה (מסונן) נשמר רק כשאין מדריך או כשנחסמה — לשיפור המדריכים ולזיהוי ניסיונות עקיפה
    question:
      outcome === "unknown" || answered.mode === "blocked" ? redactSensitive(question) : null,
    model: answered.model,
    ...usageColumns(answered),
    error: answered.error,
  });
  return answered.answer;
}
