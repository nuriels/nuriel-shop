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
  /** אפשר לפתוח חנות חדשה (אין למייל שום שיוך לחנות) */
  canCreate: boolean;
  /** למה אי אפשר לפתוח חנות (כשאין חנויות להציג) */
  blockedReason: string | null;
};

const ROLE_LABELS: Record<string, string> = {
  customer: "לקוח",
  agent: "סוכן",
  warehouse: "איש מחסן",
  admin: "מנהל",
};

/** הסבר כשהמייל רשום בחנות אחרת בתפקיד שאינו ניהול */
export function otherMembershipReason(role: string, storeName: string): string {
  const label = ROLE_LABELS[role] ?? "משתמש";
  const store = storeName.trim() ? `"${storeName.trim()}"` : "אחרת";
  return `כתובת המייל הזו רשומה כ${label} בחנות ${store} במערכת. כל כתובת מייל משויכת לחנות אחת — כדי לפתוח חנות משלכם, התחברו עם כתובת מייל אחרת.`;
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
