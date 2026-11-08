/**
 * NURIEL AI ASSISTANT — לוגיקה טהורה (בלי שרת ובלי מסד): ניקוי קלט, סינון מידע רגיש, זיהוי בקשות אסורות,
 * ההחלטה מה מוצג, קודי הסירוב (חבילה שפגה / לא קיימת / הושבתה), מחירון הדגמים והערכת עלות.
 * משותף לשני המוצרים; קטלוגי המדריכים נפרדים (ראו guides/types.ts).
 *
 * עיקרון האבטחה (מהארכיטקטורה של קובי): הדגם לא כותב שום טקסט שמוצג למשתמש. הוא מחזיר רק סיווג (שאלה
 * על תפעול המערכת / לא) ומזהים מתוך רשימת מדריכים סגורה. כל מה שמוצג — המדריכים, וההודעות הקבועות
 * שבקובץ הזה — נכתב מראש בקוד. לכן גם דגם ש"שוכנע" לגמרי לא יכול להוציא דרכו מידע: אין לו ערוץ.
 *
 * תווים נסתרים: טווחי התווים (בקרה, כיווניות, ניקוד) נבנים כאן בזמן ריצה ממספרים — לא ככתב בקוד —
 * כי כלי עריכה עלולים להפוך רצף \u לתו בלתי נראה ולשבור את הדפוס. בדיקת יחידה סורקת את קבצי העוזר
 * ומוודאת שאין בהם אף תו נסתר או תו כיווניות.
 */

// ------------------------------------------------------------------ דגמים ומחירון

export const AI_MODELS = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5", hint: "זול ומהיר — מומלץ לעוזר הזה" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", hint: "מאוזן" },
  { id: "claude-opus-5-5", label: "Opus 5.5", hint: "החזק ביותר, ויקר יותר" },
] as const;

export type AiModelId = (typeof AI_MODELS)[number]["id"];

export const DEFAULT_AI_MODEL: AiModelId = "claude-haiku-5-5";

/** דגם לא מוכר (או ריק) חוזר לברירת המחדל — כך שערך ישן במסד לא שובר את העוזר */
export function normalizeModel(value: unknown): AiModelId {
  const found = AI_MODELS.find((model) => model.id === value);
  return found ? found.id : DEFAULT_AI_MODEL;
}

/**
 * המחירון — במקום אחד בלבד. דולר למיליון טוקנים, לפי המחירון הרשמי של Anthropic (נבדק 08.11.2026):
 * Haiku 5.5 — המחיר לבקשות עד 100 אלף טוקנים (הבקשות של העוזר קטנות בהרבה). כתיבה ל-cache (5 דקות) =
 * פי 1.25 מהקלט; קריאה מה-cache = עשירית מהקלט, וב-Opus 5.5 — חצי עשירית ($0.20). העלות כאן משוערת;
 * החיוב בפועל — בקונסולה של Anthropic.
 */
export const MODEL_PRICES: Record<
  AiModelId,
  { input: number; cacheWrite: number; cacheRead: number; output: number }
> = {
  "claude-haiku-5-5": { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
  "claude-opus-5-5": { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
};
export const MODEL_PRICES_CHECKED_ON = "2026-11-08";

/** טוקנים של קריאה (או סכום קריאות). inputTokens = כל הקלט, כולל כתיבה ל-cache וקריאה ממנו */
export type TokenUsage = {
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
};

export const NO_TOKENS: TokenUsage = {
  inputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
};

/** עלות משוערת בדולרים לפי ה-usage שהחזירה Anthropic והמחירון */
export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const price = MODEL_PRICES[normalizeModel(model)];
  const uncached = Math.max(0, usage.inputTokens - usage.cacheWriteTokens - usage.cacheReadTokens);
  return (
    (uncached * price.input +
      usage.cacheWriteTokens * price.cacheWrite +
      usage.cacheReadTokens * price.cacheRead +
      usage.outputTokens * price.output) /
    1_000_000
  );
}

// ------------------------------------------------------------------ מצבים והגדרות

/** off = אף אחד · test = רק מנהל העל (בדיקה, גם בעסק בלי חבילה) · on = כל עסק עם חבילה בתוקף */
export const AI_MODES = ["off", "test", "on"] as const;
export type AiMode = (typeof AI_MODES)[number];

export function isAiMode(value: unknown): value is AiMode {
  return typeof value === "string" && (AI_MODES as readonly string[]).includes(value);
}

export const LIMIT_BOUNDS = {
  maxQuestionChars: { min: 50, max: 1000 },
  // הרבה מתחת לתקרה של כל המערכת (1500 בשעה) — עסק אחד לא יכול לנצל אותה לבד
  tenantHourlyLimit: { min: 1, max: 300 },
  userMinuteLimit: { min: 1, max: 60 },
  monthlyBudgetUsd: { min: 0, max: 100000 },
} as const;

export type KeyCheck = { ok: true; key: string } | { ok: false; error: string };

/**
 * בדיקת צורת המפתח לפני השמירה — לא מוודאת שהוא פעיל (את זה בודקת "בדיקת חיבור"), רק תופסת טעויות
 * נפוצות בהדבקה: רווחים, מפתח Admin, טקסט אחר. ההודעות לא חוזרות על המפתח עצמו.
 */
export function checkApiKeyFormat(raw: unknown): KeyCheck {
  const key = String(raw ?? "").trim();
  if (key === "") return { ok: false, error: "נא להדביק מפתח" };
  if (/\s/.test(key)) {
    return { ok: false, error: "המפתח לא אמור להכיל רווחים או שורות — נא להדביק אותו שוב" };
  }
  if (key.startsWith("sk-ant-admin")) {
    return { ok: false, error: "זה מפתח Admin. צריך מפתח API רגיל (נוצר בעמוד API keys בקונסולה)" };
  }
  if (!/^sk-ant-[A-Za-z0-9_-]{20,400}$/.test(key)) {
    return { ok: false, error: "המפתח לא נראה תקין — הוא אמור להתחיל ב-sk-ant-" };
  }
  return { ok: true, key };
}

/** 4 התווים האחרונים של המפתח, להצגה למנהל העל בלבד */
export function keyLast4(key: string): string {
  return key.slice(-4);
}

// ------------------------------------------------------------------ הודעות קבועות

/** התשובה הקבועה לכל שאלה שאינה על תפעול המערכת */
export const OFF_TOPIC_MESSAGE =
  "אני העוזר של NURIEL AI, ואני יכול לסייע בשימוש במערכת הניהול ובאפשרויות שלה. בנושא הזה אין לי אפשרות לסייע.";

/** שאלה על המערכת שאין לה מדריך מאושר: לא מנחשים ולא ממציאים — מפנים לתמיכה אנושית */
export const UNKNOWN_MESSAGE =
  "אין לי מדריך מאושר לשאלה הזו, ולכן לא אנחש תשובה. אפשר לפנות לתמיכה של NURIEL — והשאלה נרשמה כדי שנוסיף עליה מדריך.";

export const LIMITED_MESSAGE =
  "נשאלו הרבה שאלות בזמן קצר. נסו שוב בעוד כמה דקות, ובינתיים אפשר לבחור מדריך מהרשימה.";

export const REPEATED_MESSAGE =
  "השאלה הזו כבר נשאלה כמה פעמים ברצף. התשובה מופיעה למעלה — ואפשר לנסח את השאלה אחרת.";

/** הקריאה לשירות ה-AI נכשלה (בלי ניסיון חוזר). פרטי השגיאה — רק למנהל העל, במסך הניהול */
export const AI_FAILED_MESSAGE = "לא הצלחתי לקבל תשובה מהעוזר כרגע. נסו שוב בעוד כמה דקות.";

/** כשהשרת לא ענה בכלל (מוצג בדפדפן) — בלי פרטי השגיאה */
export const CONNECTION_FAILED_MESSAGE = "לא הצלחתי לבדוק את העוזר כרגע. נסו שוב בעוד כמה דקות.";

/** תזכורת קבועה בחלון העוזר */
export const PRIVACY_HINT = "אין לכתוב כאן סיסמאות או פרטים אישיים של לקוחות.";

export const FORBIDDEN_MESSAGE = "אין הרשאה";

export const RENEWAL_CONTACT = "לחידוש פנו לצוות NURIEL COMPUTERS";

// ------------------------------------------------------------------ תאריכים ומחיר (תצוגה בלבד)

/** "2027-11-07" → "07.11.2027" (תאריך שחושב בשרת לפי שעון ישראל — כאן רק תצוגה) */
export function formatIsraeliDate(isoDate: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate ?? ""));
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "";
}

/**
 * תצוגה מקדימה בלבד (המסד הוא המקור): היום האחרון של תקופה שמתחילה ב-start — יום לפני אותו תאריך 12
 * חודשים קדימה; תאריך שלא קיים בחודש (29.02 / 31) נצמד לסוף החודש, כמו ב-Postgres.
 */
export function periodEndPreview(start: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  if (!match) return null;
  const year = Number(match[1]) + 1;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const lastOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const anniversary = new Date(Date.UTC(year, month - 1, Math.min(day, lastOfMonth)));
  anniversary.setUTCDate(anniversary.getUTCDate() - 1);
  return anniversary.toISOString().slice(0, 10);
}

/** היום בישראל (YYYY-MM-DD) — לברירת מחדל בטופס בלבד; השרת מחשב בעצמו */
export function israelTodayForDisplay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(now);
}

export const STATUS_LABELS: Record<SubscriptionStatusLabelKey, string> = {
  none: "ללא חבילה",
  scheduled: "טרם התחילה",
  active: "פעיל",
  ending_soon: "עומד להסתיים",
  expired: "פג תוקף",
  suspended: "מושהה",
  mismatch: "לא תואם לסוג העסק",
};
type SubscriptionStatusLabelKey =
  "none" | "scheduled" | "active" | "ending_soon" | "expired" | "suspended" | "mismatch";

/** 15000 אגורות → "150 ₪" */
export function formatShekels(agorot: number | null | undefined): string {
  const value = Number(agorot ?? 0) / 100;
  const text = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `${text} ₪`;
}

// ------------------------------------------------------------------ מצב החבילה (מהמסד) וסירובים

/** הסטטוס שהמסד מחשב (ai_state_on) — לפי היום בישראל */
export const SUBSCRIPTION_STATUSES = [
  "none",
  "scheduled",
  "active",
  "ending_soon",
  "expired",
  "suspended",
  "mismatch",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type SubscriptionState = {
  status: SubscriptionStatus;
  entitled: boolean;
  product: string | null;
  siteType: string | null;
  startsOn: string | null;
  endsOn: string | null;
  daysLeft: number | null;
  renewalStartsOn: string | null;
  priceAgorot: number | null;
  packageName: string | null;
  /** הקטלוג שהמסד משייך לחבילה (ai_packages.guide_catalog) — חייב להיות הקטלוג של פונקציית השרת */
  guideCatalog: string | null;
};

const asText = (value: unknown): string | null => (typeof value === "string" ? value : null);
const asInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;

/** הפלט של ai_entitlement / ai_state_on — כל ערך לא צפוי נהיה "אין חבילה" (נכשל לכיוון הבטוח) */
export function parseSubscriptionState(raw: unknown): SubscriptionState {
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const status = (SUBSCRIPTION_STATUSES as readonly string[]).includes(String(value["status"]))
    ? (value["status"] as SubscriptionStatus)
    : "none";
  return {
    status,
    // "זכאי" רק כשהמסד אמר במפורש וגם הסטטוס תואם — שתי הבדיקות יחד
    entitled: value["entitled"] === true && (status === "active" || status === "ending_soon"),
    product: asText(value["product"]),
    siteType: asText(value["site_type"]),
    startsOn: asText(value["starts_on"]),
    endsOn: asText(value["ends_on"]),
    daysLeft: asInt(value["days_left"]),
    renewalStartsOn: asText(value["renewal_starts_on"]),
    priceAgorot: asInt(value["price_agorot"]),
    packageName: asText(value["package_name"]),
    guideCatalog: asText(value["guide_catalog"]),
  };
}

/**
 * למה העוזר לא זמין לפונה הזה. הקודים חוזרים גם בקריאה ישירה ל-API (כך גם הדפדפן וגם מי שעוקף אותו
 * מקבלים בדיוק את אותו סירוב):
 *  assistant_off            השירות כבוי (או במצב בדיקה — למי שאינו מנהל העל), או בלי מפתח תקין
 *  no_subscription          לעסק אין חבילה
 *  subscription_not_started החבילה מתחילה בעתיד
 *  subscription_expired     החבילה הסתיימה
 *  subscription_suspended   מנהל העל השבית את החבילה
 *  product_mismatch         החבילה לא מסוג העסק (לא אמור לקרות — המסד מונע; נחסם בכל זאת)
 */
export type DenialCode =
  | "assistant_off"
  | "no_subscription"
  | "subscription_not_started"
  | "subscription_expired"
  | "subscription_suspended"
  | "product_mismatch";

export function denialFor(
  state: SubscriptionState,
  product: string,
  catalogId: string,
): DenialCode | null {
  if (state.siteType !== null && state.siteType !== product) return "product_mismatch";
  if (state.product !== null && state.product !== product) return "product_mismatch";
  if (state.guideCatalog !== null && state.guideCatalog !== catalogId) return "product_mismatch";
  switch (state.status) {
    case "active":
    case "ending_soon":
      return state.entitled ? null : "no_subscription";
    case "scheduled":
      return "subscription_not_started";
    case "expired":
      return "subscription_expired";
    case "suspended":
      return "subscription_suspended";
    case "mismatch":
      return "product_mismatch";
    case "none":
      return "no_subscription";
  }
}

/** ההודעה הקבועה לכל סירוב (התאריך והמחיר — מהמסד) */
export function denialMessage(code: DenialCode, state: SubscriptionState | null): string {
  const price = formatShekels(state?.priceAgorot ?? 15000);
  switch (code) {
    case "assistant_off":
      return "העוזר אינו פעיל כרגע.";
    case "no_subscription":
      return `NURIEL AI אינו פעיל בעסק הזה. החבילה עולה ${price} לשנה — להפעלה פנו לצוות NURIEL COMPUTERS.`;
    case "subscription_not_started":
      return `חבילת NURIEL AI תתחיל ב-${formatIsraeliDate(state?.startsOn)}.`;
    case "subscription_expired":
      return `חבילת NURIEL AI הסתיימה ב-${formatIsraeliDate(state?.endsOn)}. מחיר החידוש: ${price} לשנה — ${RENEWAL_CONTACT}.`;
    case "subscription_suspended":
      return `NURIEL AI הושבת בעסק הזה. לפרטים פנו לצוות NURIEL COMPUTERS.`;
    case "product_mismatch":
      return "העוזר אינו זמין בעסק הזה.";
  }
}

/** הודעה עדינה כשהחבילה מסתיימת בקרוב (30 יום ומטה) */
export function endingSoonMessage(state: SubscriptionState): string | null {
  if (state.status !== "ending_soon" || state.daysLeft === null) return null;
  const when =
    state.daysLeft <= 0
      ? "מסתיימת היום"
      : state.daysLeft === 1
        ? "מסתיימת מחר"
        : `מסתיימת בעוד ${state.daysLeft} ימים`;
  return `חבילת NURIEL AI ${when} (${formatIsraeliDate(state.endsOn)}). מחיר החידוש: ${formatShekels(state.priceAgorot)} לשנה — ${RENEWAL_CONTACT}.`;
}

// ------------------------------------------------------------------ ניקוי קלט

export const DEFAULT_MAX_QUESTION_LENGTH = 400;
export const MAX_PREVIOUS_QUESTIONS = 3;
const MAX_PREVIOUS_LENGTH = 200;

/**
 * תווים בלתי נראים — נמחקים, לא הופכים לרווח ("sys<רוחב אפס>tem" → "system", כדי שהבדיקה תתפוס את
 * המילה): תווי עיצוב (Cf — רוחב אפס, כיווניות, BOM, תווי Tag U+E0000–E007F), שימוש פרטי (Co), קודים
 * שלא הוקצו (Cn), חצאי זוג (Cs), וכל תו "שמתעלמים ממנו" לפי Unicode (Default_Ignorable — בוררי וריאציה,
 * מילויי האנגול שנראים כמו רווח ועוד). בקודים בלבד — אף תו נסתר לא מופיע בקוד עצמו.
 */
const INVISIBLE = /[\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Default_Ignorable_Code_Point}]/gu;
/** תווי בקרה (גם שורה חדשה), מפרידי שורה / פסקה, ו-< > — כדי שהטקסט לא "יסגור" את התגיות שבהן הוא נשלח לדגם */
const CONTROL_OR_MARKUP = /[\p{Cc}\u{2028}\u{2029}<>]/gu;
/** לבדיקה שסורקת את קבצי העוזר (בלי הדגל g): כל תו בלתי נראה, ותווי בקרה C1 */
export const HIDDEN_CHARACTER =
  /[\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Default_Ignorable_Code_Point}\u{7F}-\u{9F}\u{2028}\u{2029}]/u;
/** ניקוד וטעמים עבריים (U+0591–U+05C7) */
const HEBREW_MARKS = /[\u{0591}-\u{05C7}]/gu;

/**
 * הצורה האחידה של טקסט מהדפדפן: NFKC (רוחב מלא וצורות תאימות → הצורה הרגילה, כך ש-＜ הופך ל-<),
 * מחיקת התווים הבלתי נראים, בקרה ו-< > לרווח, ורווחים מכווצים.
 */
export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(CONTROL_OR_MARKUP, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** קיצור בלי לחתוך תו באמצע (זוג surrogates) */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

function cleanText(value: unknown, max: number): string {
  return clip(normalizeText(String(value ?? "")), max);
}

/** השאלה לאחר ניקוי: בלי תווים נסתרים, רווחים מכווצים, אורך מוגבל. null = ריקה / קצרה מדי */
export function sanitizeQuestion(
  value: unknown,
  max: number = DEFAULT_MAX_QUESTION_LENGTH,
): string | null {
  if (typeof value !== "string") return null;
  const text = cleanText(value, Math.max(1, Math.min(max, LIMIT_BOUNDS.maxQuestionChars.max)));
  return text.length >= 2 ? text : null;
}

/** האם השאלה המקורית (לפני ניקוי) ארוכה מהמותר — כדי להודיע במקום לקצץ בשקט */
export function questionTooLong(
  value: unknown,
  max: number = DEFAULT_MAX_QUESTION_LENGTH,
): boolean {
  return (
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim().length > max
  );
}

/**
 * השאלות הקודמות באותה שיחה (רק של המשתמש עצמו — לא "תשובות" שהדפדפן שולח, שאפשר לזייף), לשאלות
 * המשך כמו "ואיך מבטלים את זה?". עד 3 אחרונות, קצרות.
 */
export function sanitizePrevious(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-10)
    .filter((item): item is string => typeof item === "string")
    .map((item) => cleanText(item, MAX_PREVIOUS_LENGTH))
    .filter((item) => item.length >= 2)
    .slice(-MAX_PREVIOUS_QUESTIONS);
}

/** צורה קנונית של שאלה — לזיהוי שאלה זהה שחוזרת שוב ושוב */
export function questionFingerprint(question: string): string {
  return question
    .normalize("NFKC")
    .replace(HEBREW_MARKS, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// ------------------------------------------------------------------ סינון מידע רגיש

/** מילה שאחריה בא סוד: סיסמה / קוד כניסה / אימות / סודי / גישה / password / pin */
const SECRET_WORD = String.raw`(?:ה)?סיסמת\s+[א-ת]+|(?:ה)?סיסמ(?:ה|א)(?:\s+(?:שלו|שלה|שלי|שלנו|שלהם|החדשה|הזמנית|הישנה))?|\b(?:password|passcode|passwd|pwd|pin(?:\s+code)?)\b|(?:ה)?קוד\s+(?:ה)?(?:כניסה|אימות|סודי|גישה)`;
const SECRET_SAID = new RegExp(
  String.raw`(${SECRET_WORD})(\s*(?:[:=]|\bis\b|\bwas\b|היא|הוא|זה|זו)\s*)\S+`,
  "gi",
);
const SECRET_NEXT = new RegExp(
  // ספרות או סימנים של סיסמה (בלי ? ו-! — הם בדרך כלל סוף המשפט)
  String.raw`(${SECRET_WORD})(\s+)(?=\S*[\d@#$%^&*~+=_])\S+`,
  "gi",
);
const SECRET_LATIN_AFTER_HEBREW =
  /((?:ה)?סיסמת\s+[א-ת]+|(?:ה)?סיסמ(?:ה|א)(?:\s+(?:שלו|שלה|שלי|שלנו|שלהם|החדשה|הזמנית|הישנה))?)(\s+)[A-Za-z][\w.-]{3,}/g;

/**
 * מסיר מהטקסט מידע רגיש לפני שהוא נשלח לדגם ולפני שהוא נשמר ביומן: מפתחות וטוקנים, כתובות מייל,
 * קישורים, מספרים ארוכים (טלפון, ת.ז, ח.פ, כרטיס אשראי, חשבון בנק, מספר הזמנה), מחרוזות שנראות כמו
 * סיסמה, סיסמה / קוד שנכתבו במפורש ("סיסמה: ...", "my password is ...", "הסיסמה שלי 1234"), וכל
 * רצף של 4 ספרות ומעלה. שמות אנשים אי אפשר לזהות בוודאות — לכן גם התזכורת
 * בחלון.
 */
export function redactSensitive(text: string): string {
  return (
    text
      .replace(/sk-ant-[\w-]*/gi, "[מפתח]")
      .replace(/\bre_[A-Za-z0-9_]{8,}/g, "[מפתח]")
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[אימייל]")
      .replace(/(?:https?:\/\/|www\.)\S+/gi, "[קישור]")
      // "סיסמה: x", "password = x", "my password is x", "הסיסמה שלי היא x"
      .replace(SECRET_SAID, "$1$2[הוסתר]")
      // "הסיסמה שלי 1234", "pin 4821" — המילה שאחרי נראית כמו סוד (ספרות / סימנים)
      .replace(SECRET_NEXT, "$1$2[הוסתר]")
      // "הסיסמה שלי qwerty" — מילה באנגלית אחרי "סיסמה" בעברית
      .replace(SECRET_LATIN_AFTER_HEBREW, "$1$2[הוסתר]")
      .replace(/[\w-]{24,}/g, "[מחרוזת]")
      // אותיות וספרות יחד (סיסמה, קוד, מספר רישוי) — מחרוזת אנגלית קצרה בלי ספרות ("pdf") נשארת
      .replace(/[A-Za-z0-9!@#$%^&*._+=-]{6,}/g, (token) =>
        /[A-Za-z]/.test(token) && /\d/.test(token) ? "[מחרוזת]" : token,
      )
      // 4 ספרות ומעלה (קוד אימות, קוד כניסה, טלפון, ת.ז, כרטיס, חשבון, הזמנה) — לסיווג אין בהן צורך
      .replace(/\d(?:[\s.-]?\d){3,}/g, "[מספר]")
  );
}

// ------------------------------------------------------------------ בקשות אסורות

/**
 * בקשות שאין לעוזר תמיכה לטפל בהן בשום מקרה, מזוהות בקוד עוד לפני הדגם (והדגם לא רואה אותן בכלל):
 * ניסיונות לשנות את ההוראות או את התפקיד, בקשות לחשוף את ההגדרות הפנימיות, סיסמאות, מפתחות, קוד, שרתים,
 * מסד נתונים או טכנולוגיות, מידע של משתמשים / עסקים אחרים, והרצת פקודות. שכבת הגנה נוספת בלבד: גם
 * בלעדיה הדגם לא יכול להחזיר טקסט חופשי. הבדיקות מוודאות שאף מדריך ואף שאלה רגילה לא נחסמים בטעות.
 */
const BLOCKED_PATTERNS: readonly RegExp[] = [
  // שינוי הוראות / תפקיד / התחזות
  /system\s*prompt|prompt\s*injection|jailbreak|developer\s*mode|dan\s*mode|ignore\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous|prior|above|earlier)|disregard\s+(?:all|any|the|your|previous)|you\s+are\s+now|act\s+as|pretend\s+(?:to\s+be|you)|role\s*-?\s*play|no\s+(?:limits|restrictions|rules)|override\s+(?:your|the)\s+(?:rules|instructions)/i,
  /פרומפט|הנחיות\s+(?:ה)?מערכת|הוראות\s+(?:ה)?מערכת|ההוראות\s+שלך|ההנחיות\s+שלך|ההוראות\s+(?:ה)?פנימיות|ההנחיות\s+(?:ה)?פנימיות|ההגדרות\s+(?:ה)?פנימיות|ההגדרות\s+שלך|הכללים\s+שקיבלת|התעלם\s+מ|תתעלם\s+מ|להתעלם\s+מ|התעלמי\s+מ|שכח\s+את\s+(?:כל\s+)?ה(?:הוראות|הנחיות)|מצב\s+מפתח|מצב\s+פיתוח|בלי\s+הגבלות|ללא\s+הגבלות|בלי\s+מגבלות|ללא\s+מגבלות|אתה\s+עכשיו|מעכשיו\s+אתה|מהיום\s+תפקידך|תעמיד\s+פני|העמד\s+פני|משחק\s+תפקידים|תשחק\s+(?:את\s+)?(?:ה)?תפקיד/i,
  /(?:^|[^א-ת])אני\s+(?:ה)?(?:מפתח|מתכנת)(?:\s|$|[,.!?])|(?:i\s*am|i'm)\s+(?:the\s+|a\s+|an\s+)?(?:developer|admin|administrator|owner)|anthropic|openai|אנתרופיק|claude|קלוד|chatgpt|\bgpt|ג'יפיטי/i,
  // הוצאת ההוראות בעקיפין: תרגום, קידוד, חזרה על טקסט
  /base\s*64|rot\s*13|hexadecimal|\bhex\b|בקידוד|לקודד|תקודד|קדד\s+את|unicode\s+escape|(?:repeat|print|show|reveal|output)\s+(?:me\s+)?(?:your|the)\s+(?:instructions|rules|settings|config|configuration|prompt)|(?:text|words)\s+above|(?:מה\s+ש|את\s+מה\s+ש)כתוב\s+(?:למעלה|לפני)|תחזור\s+על\s+(?:ה)?(?:הוראות|הנחיות|טקסט)|סכם\s+(?:במילים\s+שלך\s+)?את\s+(?:כל\s+)?(?:ה)?(?:כללים|הוראות|הנחיות)/i,
  // מפתחות, סודות, קוד, תשתית וטכנולוגיה
  /api\s*[-_]?\s*key|apikey|\brm\s+-|\bls\s+-|\bcat\s+\/|\bcurl\s|\bwget\s|\bchmod\b|\bchown\b|\bpasswd\b|access\s*token|secret|credential|\benv\b|environment\s+variable|private\s+key|\bssh\b|\bsudo\b|\bshell\b|\bbash\b|terminal|powershell|command\s+line|docker|kubernetes|nginx|ip\s+address|database|\bsql\b|select\s+\S+\s+from|drop\s+table|insert\s+into|supabase|postgres|mysql|mongodb|redis|source\s+code|stack\s*trace|framework|\breact\b|typescript|javascript|node\.?js|tanstack|python|\bphp\b|tech\s*stack|which\s+(?:language|technology|technologies|framework)/i,
  /מפתח\s+(?:ה-?)?api|מפתחות\s+(?:ה)?(?:הצפנה|גישה|api)|מפתח\s+(?:ה)?(?:הצפנה|גישה)|טוקן|סודות\s+(?:ה)?מערכת|משתני\s+(?:ה)?סביבה|קוד\s+(?:ה)?מקור|הקוד\s+של\s+(?:ה)?(?:אתר|מערכת|עוזר|בוט)|מסד\s+(?:ה)?נתונים|בסיס\s+(?:ה)?נתונים|דאטה\s*בייס|שמות\s+(?:ה)?טבלאות|מבנה\s+(?:ה)?(?:טבלאות|מסד|נתונים)|שאילת(?:ה|ות)|טרמינל|שורת\s+(?:ה)?פקודה|(?:תריץ|הרץ|להריץ|תפעיל|הפעל|לבצע|תבצע)\s+(?:את\s+)?(?:ה)?(?:פקודה|פקודות|קוד|סקריפט)|פקודה\s+בשרת|סקריפט|גישה\s+לשרת|כתובת\s+(?:ה)?(?:שרת|ip)|על\s+איזה\s+שרת|איפה\s+(?:ה)?(?:אתר|מערכת)\s+(?:מאוחסנ|יושב|רץ)|אחסון\s+(?:ה)?(?:אתר|מערכת)|באיזו\s+שפ|באיזה\s+שפ|באיזו\s+טכנולוגי|באילו\s+טכנולוגי|איזה\s+טכנולוגי|אילו\s+טכנולוגי|טכנולוגיות|ארכיטקטור|תשתית\s+(?:ה)?(?:אתר|מערכת)|דוקר|הגדרות\s+(?:של\s+)?(?:ה)?עוזר|ההגדרות\s+של\s+העוזר|(?:המפתח|מפתח)\s+(?:שלו|של\s+העוזר)/i,
  // חשיפת סיסמאות (בתחילת מילה בלבד: "למה הסיסמה לא עובדת?" היא שאלה רגילה)
  /(?:^|[^א-ת])ו?מה\s+(?:ה)?סיסמ|(?:^|[^א-ת])ו?(?:תראה|הראה|הצג|תציג|תגלה|גלה|לחשוף|תחשוף|תשלח)\s+(?:לי\s+)?(?:את\s+)?(?:כל\s+)?(?:ה)?סיסמ|רשימת\s+(?:ה)?סיסמאות|כל\s+(?:ה)?סיסמאות|(?:show|reveal|tell|give)\s+(?:me\s+)?(?:the\s+|all\s+|your\s+)?passwords?|what\s+is\s+the\s+password/i,
  // משתמשים / מנהלים / עסקים אחרים
  /(?:שיחות|היסטורי[יה]ת?|שאלות|הודעות)\s+(?:ה?שיחה\s+)?(?:של\s+)?(?:ה)?(?:משתמש|מנהל|לקוח)(?:ים)?\s+(?:ה)?אחר|מה\s+(?:שאל|כתב)(?:ו)?\s+(?:ה)?(?:מנהל|משתמש)(?:ים)?\s+(?:ה)?אחר|other\s+(?:users|admins|stores|businesses|tenants)|another\s+(?:user|admin|store|tenant|business|zimmer|hotel)|(?:נתונים|מידע|פרטים|הזמנות|לקוחות|אורחים|מחירים|דוחות)\s+(?:של|מ)\s*(?:ה)?(?:חנות|אתר|עסק|צימר|מתחם|מלון)\s+(?:ה)?(?:אחר|שכ[נן]|מתחר)|(?:חנות|עסק|צימר|מתחם|מלון)\s+(?:ה)?(?:אחר|אחרת|מתחר)|(?:פרטי|הטלפון\s+של|המייל\s+של|האימייל\s+של|הכתובת\s+של)\s+(?:ה)?מנהל(?:ים)?\s+(?:ה)?(?:אחר|ראשי)|הטלפון\s+(?:ה)?פרטי/i,
];

/**
 * אותיות קיריליות / יווניות שנראות כמו לטיניות ("sуstem" עם у קירילית) → הלטינית, לבדיקה בלבד (הטקסט
 * עצמו לא משתנה). בקודים — שום אות כזו לא מופיעה בקוד עצמו.
 */
const LOOKALIKES = new Map<string, string>(
  (
    [
      [0x0430, "a"],
      [0x0432, "b"],
      [0x0435, "e"],
      [0x0451, "e"],
      [0x043a, "k"],
      [0x043c, "m"],
      [0x043d, "h"],
      [0x043e, "o"],
      [0x0440, "p"],
      [0x0441, "c"],
      [0x0442, "t"],
      [0x0443, "y"],
      [0x0445, "x"],
      [0x0456, "i"],
      [0x0457, "i"],
      [0x0458, "j"],
      [0x0455, "s"],
      [0x0501, "d"],
      [0x051b, "q"],
      [0x051d, "w"],
      [0x04bb, "h"],
      [0x04cf, "l"],
      [0x04af, "y"],
      [0x0261, "g"],
      [0x03b1, "a"],
      [0x03b2, "b"],
      [0x03b5, "e"],
      [0x03b9, "i"],
      [0x03ba, "k"],
      [0x03bd, "v"],
      [0x03bf, "o"],
      [0x03c1, "p"],
      [0x03c4, "t"],
      [0x03c5, "u"],
      [0x03c7, "x"],
      [0x03b3, "y"],
      [0x03c9, "w"],
    ] as const
  ).map(([code, latin]) => [String.fromCodePoint(code), latin]),
);

function latinSkeleton(text: string): string {
  let out = "";
  for (const ch of text) out += LOOKALIKES.get(ch) ?? ch;
  return out;
}

export function detectBlockedRequest(text: string): boolean {
  const normalized = normalizeText(text).replace(HEBREW_MARKS, "");
  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  const lower = normalized.toLowerCase();
  const skeleton = latinSkeleton(lower);
  return skeleton !== lower && BLOCKED_PATTERNS.some((pattern) => pattern.test(skeleton));
}

/**
 * בקשה אסורה בשאלה עצמה — או מפוצלת בין השאלות הקודמות (שלא נחסמו) לשאלה ("system" ואז "prompt").
 * שאלה קודמת שנחסמה לבדה לא נשלחת לדגם בכלל, ולא חוסמת את השאלות שאחריה.
 */
export function isBlockedConversation(question: string, previous: readonly string[]): boolean {
  if (detectBlockedRequest(question)) return true;
  const allowed = previous.filter((item) => !detectBlockedRequest(item));
  return allowed.length > 0 && detectBlockedRequest([...allowed, question].join(" "));
}

// ------------------------------------------------------------------ ההחלטה מה מוצג

export type RouterTopic = "site_help" | "off_topic";

/** מה שהדגם רשאי להחזיר — ותו לא: נושא, ועד 2 מזהי מדריכים מהרשימה הסגורה */
export type RouterResult = { topic: RouterTopic; guideIds: string[] };

/**
 * תשובת הדגם לאחר ניקוי: נושא לא מוכר → "לא על המערכת" (ברירת מחדל סגורה); רק מזהי מדריכים שקיימים
 * בקטלוג של המוצר, עד 2, בלי כפילויות. כל שדה אחר שהדגם החזיר — נזרק.
 */
export function sanitizeRouterOutput(raw: unknown, knownIds: ReadonlySet<string>): RouterResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { topic: "off_topic", guideIds: [] };
  }
  const value = raw as { topic?: unknown; guides?: unknown };
  if (value.topic !== "site_help") return { topic: "off_topic", guideIds: [] };
  const ids: string[] = [];
  if (Array.isArray(value.guides)) {
    for (const candidate of value.guides) {
      if (typeof candidate === "string" && knownIds.has(candidate) && !ids.includes(candidate)) {
        ids.push(candidate);
      }
      if (ids.length === 2) break;
    }
  }
  return { topic: "site_help", guideIds: ids };
}

/**
 * guides / off_topic / unknown: תשובה רגילה · limited: הגבלת קצב · unavailable: העוזר לא זמין לפונה
 * (code אומר למה) · failed: הקריאה לשירות ה-AI נכשלה
 */
export type AskKind = "guides" | "off_topic" | "unknown" | "limited" | "unavailable" | "failed";

/**
 * התשובה שחוזרת לדפדפן. מכילה רק מזהי מדריכים, קוד, והודעה קבועה מהקובץ הזה — אף פעם לא טקסט שהדגם
 * כתב, לא פרטי שגיאה, לא טוקנים ולא עלויות.
 */
export type AskResult = {
  kind: AskKind;
  guideIds: string[];
  /** "אולי התכוונתם": מדריכים קרובים בחיפוש מילות מפתח */
  suggestions: string[];
  message: string | null;
  /** כשהעוזר לא זמין: הסיבה (subscription_expired וכו') */
  code: DenialCode | null;
};

export function limitedResult(message: string = LIMITED_MESSAGE): AskResult {
  return { kind: "limited", guideIds: [], suggestions: [], message, code: null };
}

export function unavailableResult(code: DenialCode, state: SubscriptionState | null): AskResult {
  return {
    kind: "unavailable",
    guideIds: [],
    suggestions: [],
    message: denialMessage(code, state),
    code,
  };
}

/** הקריאה לשירות נכשלה: הודעה כללית, ומדריכים קרובים מהחיפוש */
export function failedAnswer(keywordIds: string[]): AskResult {
  return {
    kind: "failed",
    guideIds: [],
    suggestions: keywordIds.slice(0, 3),
    message: AI_FAILED_MESSAGE,
    code: null,
  };
}

const OFF_TOPIC_RESULT: AskResult = {
  kind: "off_topic",
  guideIds: [],
  suggestions: [],
  message: OFF_TOPIC_MESSAGE,
  code: null,
};

/**
 * טבלת ההחלטה:
 *  - בקשה אסורה → ההודעה הקבועה של "לא על המערכת".
 *  - יש תשובה מהדגם: "לא על המערכת" → ההודעה הקבועה; מדריכים → המדריכים; על המערכת בלי מדריך →
 *    "אין מדריך מאושר" (+ מדריכים קרובים מהחיפוש, אם יש).
 *  - אין דגם (נכשל / חיפוש בלבד): תוצאות חיפוש; בלי תוצאות — אם אין בשאלה מילה מעולם המערכת →
 *    "לא על המערכת", אחרת → "אין מדריך מאושר".
 */
export function composeAnswer(input: {
  blocked: boolean;
  routed: RouterResult | null;
  keywordIds: string[];
  siteVocabulary: boolean;
}): AskResult {
  if (input.blocked) return OFF_TOPIC_RESULT;
  if (input.routed) {
    if (input.routed.topic === "off_topic") return OFF_TOPIC_RESULT;
    if (input.routed.guideIds.length > 0) {
      return {
        kind: "guides",
        guideIds: input.routed.guideIds,
        suggestions: [],
        message: null,
        code: null,
      };
    }
    return {
      kind: "unknown",
      guideIds: [],
      suggestions: input.keywordIds.slice(0, 3),
      message: UNKNOWN_MESSAGE,
      code: null,
    };
  }
  if (input.keywordIds.length > 0) {
    return {
      kind: "guides",
      guideIds: input.keywordIds.slice(0, 3),
      suggestions: [],
      message: null,
      code: null,
    };
  }
  if (!input.siteVocabulary) return OFF_TOPIC_RESULT;
  return { kind: "unknown", guideIds: [], suggestions: [], message: UNKNOWN_MESSAGE, code: null };
}

// ------------------------------------------------------------------ שגיאות (למנהל העל בלבד)

/** גם אם הודעת שגיאה כלשהי תכלול מפתח — הוא לא יוצא החוצה (ליומן, למסך, ללוגים) */
export function scrubKeys(text: string): string {
  return text.replace(/sk-ant-[A-Za-z0-9_-]*/g, "sk-ant-…");
}

/**
 * הודעה בעברית על שגיאה מ-Anthropic — מה קרה ומה עושים. מוצגת רק למנהל העל במסך הניהול. לפי קוד
 * הסטטוס והטקסט של השגיאה, כך שאפשר לבדוק אותה גם בלי הספרייה.
 */
export function describeAiError(error: unknown): string {
  return scrubKeys(describeError(error)).slice(0, 300);
}

function describeError(error: unknown): string {
  const status =
    typeof error === "object" &&
    error !== null &&
    typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : null;
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/credit balance/i.test(message)) return "אין יתרת קרדיט בחשבון Anthropic — יש לטעון קרדיט";
  if (/usage limits|spend limit|enforced_spend_limit_reached/i.test(message)) {
    return "הגעתם לתקרת ההוצאה ב-Anthropic — היא מתאפסת בתחילת החודש, או שאפשר להעלות אותה בקונסולה";
  }
  if (status === 401) return "המפתח שגוי או בוטל";
  if (status === 403) return "למפתח אין הרשאה — בדקו את ה-Workspace שלו בקונסולה";
  if (status === 404) return "הדגם שנבחר לא זמין בחשבון — נסו דגם אחר";
  if (status === 429) return "יותר מדי בקשות כרגע — נסו שוב בעוד דקה";
  if (status !== null && status >= 500) {
    return "השירות של Anthropic עמוס או לא זמין כרגע — נסו שוב מאוחר יותר";
  }
  if (status === 400) return `הבקשה נדחתה: ${message.slice(0, 140)}`;
  if (/timed? ?out/i.test(message)) return "הבקשה ל-Anthropic נמשכה יותר מדי";
  if (/connection|fetch failed|ENOTFOUND|ECONN|network/i.test(message)) {
    return "השרת לא מצליח להגיע ל-Anthropic (בדקו חיבור אינטרנט או חסימת רשת)";
  }
  if (/max_tokens|format/i.test(message)) return "תשובת ה-AI לא הגיעה בפורמט הצפוי";
  return "שגיאה לא צפויה בעוזר ה-AI";
}

// ------------------------------------------------------------------ מה שהדפדפן של מנהל העסק מקבל

/**
 * מצב העוזר למנהל עסק: האם להציג אותו בכלל, האם הוא זמין, ולמה לא. בלי מפתח, בלי דגם, בלי צריכה ובלי
 * עלויות. הכול מחושב בשרת בכל קריאה — ההסתרה בדפדפן היא נוחות בלבד.
 */
export type AssistantStatusView =
  | { visible: false }
  | {
      visible: true;
      product: string;
      assistantName: string;
      available: boolean;
      code: DenialCode | null;
      /** ההודעה לתצוגה כשהעוזר לא זמין */
      message: string | null;
      /** הודעה עדינה כשהחבילה מסתיימת בקרוב */
      notice: string | null;
      status: SubscriptionStatus;
      startsOn: string | null;
      endsOn: string | null;
      daysLeft: number | null;
      renewalPriceAgorot: number | null;
      /** מנהל העל במצב בדיקה (הגישה שלו לא תלויה בחבילה) */
      testMode: boolean;
      maxQuestionChars: number;
    };
