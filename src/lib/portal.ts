/**
 * שער הפלטפורמה (חלק 12) — עזרים טהורים, משותפים לדפדפן ולשרת.
 *
 * באתר של החנות nuriel-app2 לא מוצג קטלוג: מוצג דף נחיתה של הפלטפורמה,
 * ובו כניסה בקוד למייל ← החנויות שלכם / פתיחת חנות חדשה ← ישר לניהול.
 */

/** החנות שהאתר שלה הוא שער הפלטפורמה (דף נחיתה במקום קטלוג) */
export const PORTAL_STORE_SLUG = "nuriel-app2";

/** שם החנות בטופס "צור את החנות שלך" */
export const STORE_NAME_MIN = 2;
export const STORE_NAME_MAX = 60;

/** אותו פורמט כמו במסד (tenant_slug_problem) */
export const PORTAL_SLUG_FORMAT = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
/** כתובת מוצעת — קצרה מספיק לשורת כתובת נוחה */
const SUGGESTED_SLUG_MAX = 30;

// ------------------------------------------------------------
// כתובת באנגלית משם החנות (תעתיק עברית → לטינית)
// ------------------------------------------------------------

const HEBREW_LETTERS: Record<string, string> = {
  א: "a",
  ב: "b",
  ג: "g",
  ד: "d",
  ה: "h",
  ו: "v",
  ז: "z",
  ח: "ch",
  ט: "t",
  י: "y",
  כ: "k",
  ך: "ch",
  ל: "l",
  מ: "m",
  ם: "m",
  נ: "n",
  ן: "n",
  ס: "s",
  ע: "a",
  פ: "p",
  ף: "f",
  צ: "tz",
  ץ: "tz",
  ק: "k",
  ר: "r",
  ש: "sh",
  ת: "t",
};

/** ג׳ / ז׳ / צ׳ (עם גרש) */
const GERESH_LETTERS: Record<string, string> = { ג: "j", ז: "zh", צ: "ch", ץ: "ch" };
const GERESH = /['׳`]/;

const isHebrewLetter = (char: string | undefined) =>
  char !== undefined && HEBREW_LETTERS[char] !== undefined;

/** מילה עברית אחת → אותיות לטיניות (תעתיק פשוט, בלי ניקוד) */
function transliterateHebrewWord(word: string): string {
  const letters = [...word].filter((char) => isHebrewLetter(char) || GERESH.test(char));
  let out = "";
  for (let index = 0; index < letters.length; index += 1) {
    const char = letters[index] ?? "";
    if (GERESH.test(char)) continue;
    const next = letters[index + 1];
    const prev = index > 0 ? letters[index - 1] : undefined;
    const isFirst = out === "";
    const isLast = index === letters.length - 1 || (next !== undefined && GERESH.test(next));

    if (next !== undefined && GERESH.test(next) && GERESH_LETTERS[char]) {
      out += GERESH_LETTERS[char];
      continue;
    }
    switch (char) {
      case "ו":
        // וו = v; בתחילת מילה = v; באמצע / בסוף = o ("שלום" → shalom ≈ shlom)
        if (next === "ו") {
          out += "v";
          index += 1;
        } else out += isFirst ? "v" : "o";
        break;
      case "י":
        // יי = y; בתחילת מילה = y; באמצע / בסוף = i ("יוסי" → yosi)
        if (next === "י") {
          out += "y";
          index += 1;
        } else out += isFirst ? "y" : "i";
        break;
      case "ה":
        // ה' הידיעה בתחילת מילה ארוכה = ha; בסוף מילה = a ("דנה" → dana ≈ dna)
        if (isFirst && letters.length >= 4) out += "ha";
        else out += isLast && !isFirst ? "a" : "h";
        break;
      case "פ":
        out += isFirst ? "p" : "f";
        break;
      case "א":
      case "ע":
        // אות שקטה אחרי תנועה לא מכפילה אותה
        if (!(prev === "ו" || prev === "י") || isFirst) out += "a";
        break;
      default:
        out += HEBREW_LETTERS[char] ?? "";
    }
  }
  return out;
}

/** "החנות של דנה" → "hachnot-shl-dna" · "Cohen Electric" → "cohen-electric" */
export function suggestSlug(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[֑-ׇ]/g, "") // ניקוד וטעמים
    .replace(/[̀-ͯ]/g, "") // סימנים מעל אותיות לטיניות (é → e)
    .toLowerCase()
    .split(/[^a-z0-9א-ת'׳`]+/)
    .filter(Boolean);

  const parts = words
    .map((word) =>
      [...word].some(isHebrewLetter)
        ? // מילה מעורבת (למשל "ב-2") — כל חלק בנפרד
          word
            .split(/([a-z0-9]+)/)
            .map((part) => (/^[a-z0-9]+$/.test(part) ? part : transliterateHebrewWord(part)))
            .join("")
        : word.replace(/[^a-z0-9]/g, ""),
    )
    .filter(Boolean);

  let slug = "";
  for (const part of parts) {
    const next = slug ? `${slug}-${part}` : part;
    if (next.length > SUGGESTED_SLUG_MAX) {
      if (!slug) slug = part.slice(0, SUGGESTED_SLUG_MAX);
      break;
    }
    slug = next;
  }
  slug = slug.replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (slug === "") return "my-shop";
  if (slug.length < 3) return `${slug}-shop`;
  return slug;
}

/** ניקוי הקלדה בשדה הכתובת: אותיות קטנות, רווח → מקף, בלי תווים אחרים */
export function cleanSlugInput(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s_.]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 63);
}

/** בעיה בפורמט (לפני שאלה לשרת), או null */
export function slugFormatProblem(slug: string): string | null {
  if (slug === "") return "יש להזין כתובת באנגלית";
  if (!PORTAL_SLUG_FORMAT.test(slug)) {
    return "3-63 תווים: אותיות אנגליות קטנות, ספרות ומקפים (לא בהתחלה או בסוף)";
  }
  return null;
}

/** בעיה בשם החנות, או null */
export function storeNameProblem(name: string): string | null {
  const clean = name.trim().replace(/\s+/g, " ");
  if (clean.length < STORE_NAME_MIN) return `שם החנות — לפחות ${STORE_NAME_MIN} תווים`;
  if (clean.length > STORE_NAME_MAX) return `שם החנות — עד ${STORE_NAME_MAX} תווים`;
  return null;
}

// ------------------------------------------------------------
// פרטי העסק בהקמה (שלב E1) — אותם כללים כמו portal_create_store_business במסד.
// נשמרים בהגדרות החנות, ומשם התקנון, מדיניות הפרטיות, המסמכים והמיילים מתמלאים.
// ------------------------------------------------------------

/** חברה = עוסק מורשה לעניין מע"מ; עוסק פטור → בלי מע"מ */
export type PortalBusinessType = "authorized" | "exempt" | "company";

export const PORTAL_BUSINESS_TYPES: {
  value: PortalBusinessType;
  label: string;
  /** התווית של שדה המספר */
  idLabel: string;
  hint: string;
}[] = [
  { value: "authorized", label: "עוסק מורשה", idLabel: "מספר עוסק מורשה", hint: "גובים מע״מ" },
  { value: "exempt", label: "עוסק פטור", idLabel: "מספר עוסק פטור", hint: "בלי מע״מ" },
  { value: "company", label: "חברה בע״מ", idLabel: "מספר חברה (ח.פ)", hint: "גובים מע״מ" },
];

export type PortalBusinessDetails = {
  legal_name: string;
  business_type: PortalBusinessType | "";
  tax_id: string;
  /** בעוסק פטור לא רלוונטי (תמיד בלי מע"מ) */
  prices_include_vat: boolean;
  /** טלפון לשירות לקוחות */
  phone: string;
  /** לא חובה */
  address: string;
};

export type PortalBusinessField = "legal_name" | "business_type" | "tax_id" | "phone" | "address";

export const BUSINESS_NAME_MAX = 120;
export const BUSINESS_ADDRESS_MAX = 200;

const oneLine = (value: unknown) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");

/** ספרות בלבד (רווחים ומקפים יורדים) — כמו במסד */
export const cleanTaxId = (value: unknown) => String(value ?? "").replace(/[\s-]/g, "");
/** ספרות ו-+ בלבד — כמו במסד */
export const cleanBusinessPhone = (value: unknown) =>
  String(value ?? "")
    .trim()
    .replace(/[^0-9+]/g, "");

export function cleanBusinessDetails(input: unknown): PortalBusinessDetails {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const type = String(raw["business_type"] ?? "");
  return {
    legal_name: oneLine(raw["legal_name"]),
    business_type: PORTAL_BUSINESS_TYPES.some((t) => t.value === type)
      ? (type as PortalBusinessType)
      : "",
    tax_id: cleanTaxId(raw["tax_id"]),
    prices_include_vat: raw["prices_include_vat"] !== false,
    phone: cleanBusinessPhone(raw["phone"]),
    address: oneLine(raw["address"]),
  };
}

/** הבעיות לפי שדה (אובייקט ריק = הכול תקין) */
export function businessDetailsProblems(
  details: PortalBusinessDetails,
): Partial<Record<PortalBusinessField, string>> {
  const problems: Partial<Record<PortalBusinessField, string>> = {};
  if (details.legal_name.length < 2 || details.legal_name.length > BUSINESS_NAME_MAX) {
    problems.legal_name = `שם העסק — 2 עד ${BUSINESS_NAME_MAX} תווים`;
  }
  if (details.business_type === "") problems.business_type = "בחרו את סוג העסק";
  if (!/^[0-9]{5,12}$/.test(details.tax_id)) {
    problems.tax_id = "המספר — 5 עד 12 ספרות (בלי אותיות)";
  }
  if (!/^\+?[0-9]{9,15}$/.test(details.phone)) {
    problems.phone = "טלפון — 9 עד 15 ספרות, למשל 050-1234567";
  }
  if (details.address.length > BUSINESS_ADDRESS_MAX) {
    problems.address = `כתובת — עד ${BUSINESS_ADDRESS_MAX} תווים`;
  }
  return problems;
}

/** הלוגו בהקמה (לא חובה): PNG / JPEG / WebP, עד 2MB אחרי הדחיסה בדפדפן */
export const PORTAL_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const PORTAL_LOGO_MAX_BYTES = 2 * 1024 * 1024;

// ------------------------------------------------------------
// אתר לצימר מהשער (שלב E2): החבילות המפורסמות + בקשה (ההקמה בתשלום — מנהל הפלטפורמה מקים).
// אותם כללים כמו hospitality.site_request_submit במסד.
// ------------------------------------------------------------

export type PortalZimmerPlan = {
  code: string;
  name: string;
  tagline: string;
  price_monthly: number | null;
  setup_fee: number | null;
  max_units: number | null;
  highlights: string[];
};

export type ZimmerRequest = {
  business_name: string;
  phone: string;
  /** כמה יחידות (חדרים / בקתות) — לא חובה */
  units: number | null;
  /** החבילה המבוקשת; ריק = "עוד לא יודע" */
  plan_code: string;
  area: string;
  message: string;
};

export type ZimmerRequestField = "business_name" | "phone" | "units" | "area" | "message";

export const ZIMMER_AREA_MAX = 80;
export const ZIMMER_MESSAGE_MAX = 1000;

export function cleanZimmerRequest(input: unknown): ZimmerRequest {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const unitsText = String(raw["units"] ?? "").trim();
  return {
    business_name: oneLine(raw["business_name"]),
    phone: cleanBusinessPhone(raw["phone"]),
    // ריק = לא צוין; טקסט שאינו מספר → NaN, והבדיקה מסמנת אותו
    units: unitsText === "" ? null : Number(unitsText),
    plan_code: String(raw["plan_code"] ?? "").trim(),
    area: oneLine(raw["area"]),
    message: String(raw["message"] ?? "").trim(),
  };
}

export function zimmerRequestProblems(
  request: ZimmerRequest,
): Partial<Record<ZimmerRequestField, string>> {
  const problems: Partial<Record<ZimmerRequestField, string>> = {};
  if (request.business_name.length < 2 || request.business_name.length > BUSINESS_NAME_MAX) {
    problems.business_name = `שם העסק — 2 עד ${BUSINESS_NAME_MAX} תווים`;
  }
  if (!/^\+?[0-9]{9,15}$/.test(request.phone)) {
    problems.phone = "טלפון — 9 עד 15 ספרות, למשל 050-1234567";
  }
  if (
    request.units !== null &&
    (!Number.isInteger(request.units) || request.units < 1 || request.units > 500)
  ) {
    problems.units = "מספר היחידות — 1 עד 500";
  }
  if (request.area.length > ZIMMER_AREA_MAX) problems.area = `אזור — עד ${ZIMMER_AREA_MAX} תווים`;
  if (request.message.length > ZIMMER_MESSAGE_MAX) {
    problems.message = `הערה — עד ${ZIMMER_MESSAGE_MAX.toLocaleString("he-IL")} תווים`;
  }
  return problems;
}

/**
 * מיגרציה 40: כתובת מוצעת לעסק אירוח — כמו לחנות (suggestSlug), בלי "shop": שם בלי אותיות →
 * ריק (בעל העסק בוחר), ושם קצר מקבל "-stay" במקום "-shop".
 */
export function suggestZimmerSlug(name: string): string {
  const slug = suggestSlug(name);
  if (slug === "my-shop") return "";
  return /^[a-z0-9]{1,2}-shop$/.test(slug) ? slug.replace(/-shop$/, "-stay") : slug;
}

/** מה שהשער מקבל אחרי פתיחת עסק אירוח (portal_open_site) */
export type PortalZimmerOpened = {
  /** העסק — כמו חנות ברשימה (כניסה דרך אותו קוד כניסה, /admin-handoff → /manage) */
  store: PortalStore;
  /** סוף תקופת הניסיון (ISO) */
  trialEndsAt: string | null;
};

/** "200 ₪" — בלי אגורות כשאין */
export const shekels = (value: number | null | undefined): string | null =>
  value === null || value === undefined ? null : `${Number(value).toLocaleString("he-IL")} ₪`;

// ------------------------------------------------------------
// החשבון והחנויות (מהמסד: portal_account / portal_store_state)
// ------------------------------------------------------------

export type PortalStore = {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended";
  isBlocked: boolean;
  /** הכתובת של החנות (https://<slug>.nuri1.fit או דומיין מותאם) */
  url: string;
  createdAt: string;
};

export type PortalAccount = {
  /** יש כבר חשבון התחברות למייל הזה */
  hasAccount: boolean;
  stores: PortalStore[];
  /**
   * אפשר לפתוח חנות חדשה. חלק 18ב: גם מי שכבר מנהל חנויות (חשבון אחד — כמה
   * חנויות), כל עוד המייל לא רשום כלקוח בחנות אחרת ולא הגיע למספר המרבי.
   */
  canCreate: boolean;
  /** כמה חנויות אפשר לפתוח לחשבון אחד (null = לא ידוע) */
  maxStores: number | null;
  /** למה אי אפשר לפתוח חנות (כשאין חנויות להציג) */
  blockedReason: string | null;
};

const ROLE_LABELS: Record<string, string> = {
  customer: "לקוח",
  agent: "סוכן",
  warehouse: "איש מחסן",
  admin: "מנהל",
};

/** הסבר כשהמייל רשום כלקוח בחנות אחרת (חשבון לקוח — חנות אחת) */
export function otherMembershipReason(role: string, storeName: string): string {
  const label = ROLE_LABELS[role] ?? "משתמש";
  const store = storeName.trim() ? `"${storeName.trim()}"` : "אחרת";
  return `כתובת המייל הזו רשומה כ${label} בחנות ${store} במערכת. חשבון של לקוח משויך לחנות אחת — כדי לפתוח חנות משלכם, התחברו עם כתובת מייל אחרת.`;
}

// ------------------------------------------------------------
// האם אפשר כבר להיכנס לחנות חדשה (תעודת SSL לכתובת)
// ------------------------------------------------------------

/** סקריפט התעודות בשרת מדווח כל דקה; אחרי 5 דקות בלי דיווח — הוא לא רץ */
export const SSL_AGENT_STALE_MS = 5 * 60 * 1000;

export type StoreReadiness =
  /** אפשר להיכנס */
  | "ready"
  /** התעודה בהנפקה (בדרך כלל עד דקה-שתיים) */
  | "waiting"
  /** ההנפקה נכשלה / הכתובת חסומה — אפשר לנסות בכל זאת */
  | "error";

export function storeReadiness(
  state: {
    sslStatus: string | null;
    agentSeenAt: string | null;
    hasOwnDomain: boolean;
  },
  now: number = Date.now(),
): StoreReadiness {
  // דומיין מלא / מותאם פעיל — התעודה שלו לא תלויה בהקמה
  if (state.hasOwnDomain) return "ready";
  if (state.sslStatus === "active" || state.sslStatus === "external") return "ready";
  if (state.sslStatus === "error" || state.sslStatus === "blocked") return "error";
  const seen = state.agentSeenAt ? Date.parse(state.agentSeenAt) : NaN;
  // אין סקריפט תעודות פעיל בשרת (או שלא דיווח מזמן) — אין למה לחכות
  if (!Number.isFinite(seen) || now - seen > SSL_AGENT_STALE_MS) return "ready";
  return "waiting";
}

// ------------------------------------------------------------
// דף הנחיתה → חלון הכניסה
// ------------------------------------------------------------

/**
 * המסלול שנבחר בדף הנחיתה לפני הכניסה: חנות (14 ימי ניסיון), צימר (30 ימי ניסיון), הרשמה כללית
 * ("הרשמה קלה — תוך 2 דקות" — בוחרים אחרי הקוד), כניסה לניהול (גם מהקישור במייל, `/#login`)
 */
export type PortalIntent = "store" | "zimmer" | "signup" | "login" | null;

/**
 * השלב אחרי האימות: יש חנויות (או אי אפשר לפתוח) → החנויות; אחרת — המסלול שנבחר בדף הנחיתה
 * (חנות → "צור את החנות שלך", צימר → אתר לצימר, אם יש חבילות מפורסמות), ובלי בחירה — "מה מקימים?"
 */
export function stepAfterLogin(
  account: Pick<PortalAccount, "stores" | "canCreate">,
  intent: PortalIntent,
  zimmerPlanCount: number,
): "stores" | "product" | "create" | "zimmer" {
  if (account.stores.length > 0 || !account.canCreate) return "stores";
  if (intent === "store") return "create";
  if (intent === "zimmer" && zimmerPlanCount > 0) return "zimmer";
  return "product";
}
