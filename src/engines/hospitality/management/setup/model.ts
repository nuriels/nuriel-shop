// מדריך ההקמה — הצעדים, הקבוצות, לאן כל צעד מוביל, ההמשך מאותה נקודה, ההתקדמות והטקסטים.
// טהור (נבדק ביחידה). הסטטוס עצמו מחושב במסד (setup_guide) — כאן רק מה מציגים.
import type { SetupGuideView, SetupMilestones, SetupStepKey } from "../../types/setup";
import { SETUP_STEPS } from "../../types/setup";
import { manageKeys } from "../lib/query-keys";

export const setupKey = [...manageKeys.all, "setup"] as const;

export type SetupGroupKey = "business" | "units" | "bookings" | "site";

export const SETUP_GROUPS: readonly { key: SetupGroupKey; title: string; description: string }[] = [
  { key: "business", title: "העסק", description: "איך קוראים לכם ואיך יוצרים קשר" },
  { key: "units", title: "יחידות, תמונות ומחירים", description: "מה האורחים מזמינים ובכמה" },
  { key: "bookings", title: "הזמנות ותשלום", description: "שעות, אישור בקשות, ביטול ומקדמה" },
  { key: "site", title: "האתר", description: "עיצוב, תוכן, גוגל ופרסום" },
];

export type SetupPath =
  | "/manage/settings"
  | "/manage/units"
  | "/manage/photos"
  | "/manage/pricing"
  | "/manage/policies"
  | "/manage/website";

export interface SetupStepDef {
  key: SetupStepKey;
  group: SetupGroupKey;
  title: string;
  /** מה עושים בצעד — שורה אחת */
  hint: string;
  to: SetupPath;
  /** פרמטרים / עוגן במסך היעד */
  search?: { tab?: string };
  hash?: string;
  /** ההרשאה של מסך היעד (כמו בניווט) */
  permission: string;
  /** חובה / "בדקתי, מתאים לי" / רשות (אפשר לדלג) */
  kind: "required" | "review" | "optional";
  /** הטקסט של הכפתור למסך */
  cta: string;
}

export const SETUP_STEP_DEFS: readonly SetupStepDef[] = [
  {
    key: "details",
    group: "business",
    title: "פרטי העסק",
    hint: "שם העסק כפי שיופיע לאורחים, וכתובת (מופיעה במקטע המיקום באתר)",
    to: "/manage/settings",
    hash: "business",
    permission: "settings",
    kind: "required",
    cta: "לפרטי העסק",
  },
  {
    key: "contact",
    group: "business",
    title: "יצירת קשר",
    hint: "טלפון או אימייל לאורחים — ואם תרצו, גם וואטסאפ",
    to: "/manage/settings",
    hash: "business",
    permission: "settings",
    kind: "required",
    cta: "לפרטי הקשר",
  },
  {
    key: "units",
    group: "units",
    title: "יחידות אירוח",
    hint: "צימר, סוויטה, חדר או דירה — עם מספר האורחים",
    to: "/manage/units",
    permission: "catalog",
    kind: "required",
    cta: "ליחידות",
  },
  {
    key: "photos",
    group: "units",
    title: "תמונות",
    hint: "תמונות אמיתיות של המקום — לכל יחידה ולגלריה של האתר",
    to: "/manage/photos",
    permission: "media",
    kind: "required",
    cta: "לתמונות",
  },
  {
    key: "prices",
    group: "units",
    title: "מחירים",
    hint: "מחיר ללילה לכל יחידה; סופי שבוע, עונות וחגים — בכללי המחיר",
    to: "/manage/pricing",
    permission: "pricing",
    kind: "required",
    cta: "למחירים",
  },
  {
    key: "booking",
    group: "bookings",
    title: "הגדרות הזמנה",
    hint: "שעות הגעה ועזיבה, וכמה זמן יש לכם לאשר בקשה",
    to: "/manage/settings",
    hash: "times",
    permission: "settings",
    kind: "review",
    cta: "להגדרות ההזמנה",
  },
  {
    key: "policy",
    group: "bookings",
    title: "מדיניות ביטול",
    hint: "עד מתי מבטלים בלי חיוב, ומה קורה אחר כך",
    to: "/manage/policies",
    permission: "policies",
    kind: "review",
    cta: "למדיניות הביטול",
  },
  {
    key: "payments",
    group: "bookings",
    title: "תשלום ומקדמה",
    hint: "איך האורחים משלמים לכם (העברה בנקאית, Bit, טלפון) — והמקדמה במדיניות הביטול",
    to: "/manage/settings",
    hash: "payments",
    permission: "settings",
    kind: "review",
    cta: "להוראות התשלום",
  },
  {
    key: "template",
    group: "site",
    title: "תבנית עיצוב",
    hint: "אחת מארבע התבניות — אפשר להחליף בכל רגע",
    to: "/manage/website",
    search: { tab: "design" },
    permission: "settings",
    kind: "required",
    cta: "לבחירת תבנית",
  },
  {
    key: "logo",
    group: "site",
    title: "לוגו",
    hint: "הלוגו של העסק בראש האתר",
    to: "/manage/website",
    search: { tab: "design" },
    permission: "settings",
    kind: "optional",
    cta: "להוספת לוגו",
  },
  {
    key: "site",
    group: "site",
    title: "תוכן האתר",
    hint: 'כותרת, טקסט "עלינו", מה מוצג ובאיזה סדר',
    to: "/manage/website",
    search: { tab: "sections" },
    permission: "settings",
    kind: "required",
    cta: "לעורך האתר",
  },
  {
    key: "seo",
    group: "site",
    title: "גוגל ושיתוף",
    hint: "כותרת ותיאור לגוגל ולשיתוף בוואטסאפ ובפייסבוק — לא חובה",
    to: "/manage/website",
    search: { tab: "seo" },
    permission: "settings",
    kind: "optional",
    cta: "לגוגל ושיתוף",
  },
  {
    key: "publish",
    group: "site",
    title: "פרסום האתר",
    hint: "מה שבעורך הוא טיוטה עד שמפרסמים",
    to: "/manage/website",
    search: { tab: "publish" },
    permission: "settings",
    kind: "required",
    cta: "לפרסום",
  },
];

export const stepDef = (key: SetupStepKey): SetupStepDef =>
  SETUP_STEP_DEFS.find((s) => s.key === key) ?? SETUP_STEP_DEFS[0]!;

export const isDone = (view: SetupGuideView, key: SetupStepKey) => view.steps[key].done === true;

/**
 * להמשך מאותה נקודה: הצעד השמור אם עוד לא הושלם; אחרת הצעד הבא שלא הושלם אחריו;
 * אחרת הראשון שלא הושלם; הכול הושלם — null.
 */
export function resumeStep(view: SetupGuideView): SetupStepKey | null {
  const saved = view.state.current_step;
  const order = SETUP_STEPS;
  if (saved && order.includes(saved)) {
    if (!isDone(view, saved)) return saved;
    const after = order.slice(order.indexOf(saved) + 1).find((k) => !isDone(view, k));
    if (after) return after;
  }
  return order.find((k) => !isDone(view, k)) ?? null;
}

export function setupProgress(view: SetupGuideView): {
  done: number;
  total: number;
  percent: number;
} {
  const total = SETUP_STEPS.length;
  const done = SETUP_STEPS.filter((k) => isDone(view, k)).length;
  return { done, total, percent: Math.round((done / total) * 100) };
}

/** חמש אבני הדרך (גם ברשימה של לוח הבקרה) */
export const MILESTONES: readonly { key: keyof SetupMilestones; label: string }[] = [
  { key: "business", label: "פרטי העסק הושלמו" },
  { key: "units", label: "נוספה יחידה" },
  { key: "photos", label: "הועלו תמונות" },
  { key: "prices", label: "נקבעו מחירים" },
  { key: "site", label: "האתר מוכן לפרסום" },
];

export type StepState = "done" | "confirmed" | "skipped" | "todo";

export function stepState(view: SetupGuideView, key: SetupStepKey): StepState {
  const s = view.steps[key] as { done: boolean; confirmed?: boolean; skipped?: boolean };
  if (s.skipped) return "skipped";
  if (!s.done) return "todo";
  return s.confirmed ? "confirmed" : "done";
}

export const STATE_LABEL: Record<StepState, string> = {
  done: "הושלם",
  confirmed: "נבדק ואושר",
  skipped: "דילגתם",
  todo: "עוד לא הושלם",
};

const THEME_NAMES: Record<string, string> = {
  luxury: "יוקרה",
  nature: "טבע",
  modern: "מודרני",
  romantic: "רומנטי",
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/** פרט קצר על המצב של כל צעד (בלי פרטים אישיים) */
export function stepFact(view: SetupGuideView, key: SetupStepKey): string {
  const s = view.steps;
  switch (key) {
    case "details":
      return !s.details.name
        ? "חסר שם לעסק"
        : s.details.address
          ? "שם וכתובת"
          : "יש שם · כתובת — מומלץ";
    case "contact": {
      const ways = [
        s.contact.phone && "טלפון",
        s.contact.email && "אימייל",
        s.contact.whatsapp && "וואטסאפ",
      ].filter(Boolean);
      return ways.length ? ways.join(" · ") : "אין עדיין דרך ליצור קשר";
    }
    case "units":
      return s.units.active
        ? `${plural(s.units.active, "יחידה פעילה אחת", "יחידות פעילות")}`
        : s.units.total
          ? "יש יחידות, אבל אף אחת לא פעילה"
          : "עוד אין יחידות";
    case "photos":
      if (!s.photos.count) return "עוד אין תמונות (תמונות הדגמה לא נספרות)";
      return s.photos.units_without
        ? `${plural(s.photos.count, "תמונה אחת", "תמונות")} · ${plural(s.photos.units_without, "יחידה אחת", "יחידות")} בלי תמונה משלה`
        : plural(s.photos.count, "תמונה אחת", "תמונות");
    case "prices":
      return s.prices.active
        ? `מחיר ל-${s.prices.priced} מתוך ${s.prices.active} היחידות הפעילות`
        : "קודם מוסיפים יחידה";
    case "booking":
      return `הגעה ${s.booking.check_in} · עזיבה ${s.booking.check_out} · ${
        s.booking.mode === "instant"
          ? "הזמנה מיידית"
          : `אישור בקשה תוך ${s.booking.approval_hours} שעות`
      }`;
    case "policy":
      return s.policy.name
        ? `${s.policy.name}${
            s.policy.free_cancel_days !== null
              ? ` · ביטול חינם עד ${s.policy.free_cancel_days} ימים לפני ההגעה`
              : " · בלי ביטול חינם"
          }`
        : "אין מדיניות ברירת מחדל";
    case "payments": {
      const names: Record<string, string> = {
        bank: "העברה בנקאית",
        bit: "Bit",
        phone: "תשלום בטלפון",
        note: "הוראות משלכם",
      };
      const methods = s.payments.methods?.length
        ? s.payments.methods.map((m) => names[m] ?? m).join(" · ")
        : "תשלום בטלפון";
      const deposit =
        s.payments.deposit_kind === "none"
          ? "בלי מקדמה"
          : `מקדמה ${
              s.payments.deposit_kind === "percent"
                ? `${Number(s.payments.deposit_value)}%`
                : `₪${Number(s.payments.deposit_value)}`
            } ${s.payments.deposit_due === "booking" ? "בהזמנה" : "באישור ההזמנה"}`;
      return `${methods} · ${deposit}`;
    }
    case "template":
      return s.template.theme
        ? `תבנית "${THEME_NAMES[s.template.theme] ?? s.template.theme}"`
        : "עוד לא נבחרה תבנית";
    case "logo":
      return s.logo.has ? "יש לוגו" : s.logo.skipped ? "בלי לוגו — מוצג שם העסק" : "אין לוגו";
    case "site":
      return s.site.edited ? "האתר נערך" : "עוד לא נערך — מוצג תוכן ברירת מחדל מפרטי העסק";
    case "seo":
      return s.seo.has
        ? "יש כותרת / תיאור לגוגל"
        : s.seo.skipped
          ? "בלי — גוגל מקבל את שם העסק והתיאור הכללי"
          : "אין כותרת ותיאור לגוגל";
    case "publish":
      return publishText(view).headline;
  }
}

/** מצב הפרסום — טיוטה אף פעם לא מוצגת כמפורסמת */
export function publishText(
  view: SetupGuideView,
  formatDate: (iso: string) => string = (iso) => iso.slice(0, 10),
): { headline: string; detail: string; open: string; tone: "success" | "warning" | "neutral" } {
  const p = view.steps.publish;
  const open = p.site_open
    ? p.booking_open
      ? "האתר פתוח לגולשים, וקבלת הזמנות מהאתר פעילה."
      : "האתר פתוח לגולשים. קבלת הזמנות מהאתר עוד לא פעילה."
    : p.opens_on_publish
      ? "האתר ייפתח לגולשים ולהזמנות ברגע שתפרסמו אותו."
      : "האתר עוד סגור לגולשים — צוות נוריאל פותח אותו אחרי בדיקה אחרונה.";
  if (!p.published)
    return {
      headline: "עוד לא פורסם — מה שבעורך הוא טיוטה",
      detail: p.ready
        ? "הכול מוכן לפרסום הראשון."
        : "אפשר לפרסם כשיש לפחות יחידה אחת פעילה עם מחיר ותמונה משלה.",
      open,
      tone: "neutral",
    };
  const when = p.published_at ? ` ב-${formatDate(p.published_at)}` : "";
  if (p.unpublished)
    return {
      headline: `גרסה ${p.version} פורסמה${when} · יש שינויים שעוד לא פורסמו`,
      detail: "האורחים רואים את הגרסה שפורסמה, לא את הטיוטה.",
      open,
      tone: "warning",
    };
  return { headline: `גרסה ${p.version} פורסמה${when}`, detail: "", open, tone: "success" };
}

/** חיפוש המסך (?tab=) — רק ערכים מוכרים */
export const SETUP_EDITOR_TABS = ["sections", "design", "seo", "publish"] as const;
export function editorTab(raw: unknown): (typeof SETUP_EDITOR_TABS)[number] | null {
  return typeof raw === "string" && (SETUP_EDITOR_TABS as readonly string[]).includes(raw)
    ? (raw as (typeof SETUP_EDITOR_TABS)[number])
    : null;
}
