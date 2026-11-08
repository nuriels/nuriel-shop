// מילוי התבנית של מסמך: המשתנים ({{business_name}}) מפרטי העסק, והפרטים שרק בעל העסק יודע
// ([[להשלמה: …]]) נשארים מסומנים עד שהוא כותב אותם. מה שחסר — לא מתפרסם (גם המסד בודק).
// הטקסט: שורה שמתחילה ב-"## " — כותרת; "- " — פריט ברשימה; שורה רגילה — פסקה.
import type { DocumentsView } from "../types/documents";
import { siteCopy } from "../website/copy";
import { policyLines } from "../website/lib/format";
import { ACCESSIBILITY_ITEMS, type AccessibilityItem } from "./kinds";

export const VAR_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/g;
export const PLACEHOLDER_RE = /\[\[([^\]]*)\]\]/g;

/** המשתנים שאפשר לשים בתבנית — שם בעברית ומאיפה הערך */
export const VARIABLES: { key: string; label: string; where: string; optional?: boolean }[] = [
  { key: "business_name", label: "שם העסק", where: "הגדרות העסק" },
  { key: "contact_line", label: "פרטי הקשר (טלפון, אימייל, כתובת)", where: "הגדרות העסק" },
  { key: "business_phone", label: "טלפון העסק", where: "הגדרות העסק" },
  { key: "business_email", label: "אימייל העסק", where: "הגדרות העסק" },
  { key: "business_address", label: "כתובת העסק", where: "הגדרות העסק" },
  { key: "site_url", label: "כתובת האתר", where: "האתר" },
  { key: "legal_name", label: "שם העוסק / החברה", where: "פרטי העסק למסמכים" },
  { key: "registration_id", label: "מספר עוסק / ח.פ", where: "פרטי העסק למסמכים" },
  { key: "check_in_time", label: "שעת כניסה", where: "הגדרות העסק" },
  { key: "check_out_time", label: "שעת יציאה", where: "הגדרות העסק" },
  { key: "cancellation_policy", label: "מדיניות הביטול (ברירת המחדל)", where: "תמחור ומדיניות" },
  { key: "payment_methods", label: "אמצעי התשלום", where: "תשלומים" },
  { key: "house_rules", label: "כללי המקום מהמתחמים", where: "פרטי המתחם" },
  { key: "a11y_contact", label: "פניות בנושא נגישות", where: "פרטי העסק למסמכים" },
  {
    key: "a11y_coordinator",
    label: "רכז הנגישות (רק כשחובה)",
    where: "פרטי העסק למסמכים",
    optional: true,
  },
  { key: "physical_accessibility", label: "הסדרי הנגישות במתחם", where: "פרטי המתחם" },
  { key: "today", label: "תאריך העדכון (יום הפרסום)", where: "אוטומטי" },
];

const LABEL: Record<string, string> = Object.fromEntries(VARIABLES.map((v) => [v.key, v.label]));
const OPTIONAL = new Set(VARIABLES.filter((v) => v.optional).map((v) => v.key));

export const ITEM_LABELS: Record<AccessibilityItem, string> = {
  parking: "חניית נכים מסומנת",
  entrance: "כניסה נגישה למתחם (בלי מדרגות, או עם רמפה)",
  step_free: "דרך בלי מדרגות (או עם רמפה / מעלון) מהחניה עד היחידה הנגישה",
  unit: "יחידת אירוח נגישה",
  restroom: "שירותים ומקלחת נגישים",
  grab_bars: "מאחזי יד בשירותים ובמקלחת",
  passages: "מעברים ופתחים ברוחב שמתאים לכיסא גלגלים",
};
export const ANSWER_LABELS = { yes: "יש", partial: "חלקית", no: "אין" } as const;

const clean = (s: string | null | undefined) => (s ?? "").trim();
const join = (parts: (string | null | undefined)[], sep = " · ") =>
  parts.map(clean).filter(Boolean).join(sep);

function rulesText(view: DocumentsView): string {
  const lines: string[] = [];
  for (const p of view.properties) {
    const r = p.rules;
    const own: string[] = [];
    if (r.smoking === "forbidden") own.push("- העישון אסור במתחם");
    else if (r.smoking === "outside") own.push("- עישון רק בשטחים הפתוחים");
    if (r.pets === "no") own.push("- בלי בעלי חיים");
    else if (r.pets === "allowed" || r.pets === "on_request")
      own.push(
        `- בעלי חיים — ${r.pets === "allowed" ? "מותר" : "בתיאום מראש"}${r.pets_note ? ` (${clean(r.pets_note)})` : ""}`,
      );
    if (r.events === "no") own.push("- בלי אירועים ומסיבות");
    else if (r.events === "on_request") own.push("- אירועים — רק בתיאום מראש");
    if (r.quiet_from && r.quiet_to) own.push(`- שעות שקט: ${r.quiet_from}–${r.quiet_to}`);
    for (const l of Array.isArray(r.custom) ? r.custom : [])
      if (clean(l)) own.push(`- ${clean(l)}`);
    if (own.length === 0) continue;
    if (view.properties.length > 1) lines.push(`## ${p.name}`);
    lines.push(...own);
  }
  return lines.join("\n");
}

function physicalText(view: DocumentsView, contact: string): string {
  const out: string[] = [];
  const confirmed = view.properties.filter((p) => p.accessibility);
  for (const p of confirmed) {
    const a = p.accessibility!;
    const items = ACCESSIBILITY_ITEMS.flatMap((k) => {
      const it = a.items[k];
      return it
        ? [
            `- ${ITEM_LABELS[k]}: ${ANSWER_LABELS[it.answer]}${it.details ? ` — ${clean(it.details)}` : ""}`,
          ]
        : [];
    });
    if (clean(a.additional)) items.push(`- התאמות נוספות: ${clean(a.additional)}`);
    const who = join([a.contact_name, a.contact_phone, a.contact_email]);
    if (who) items.push(`- למידע נוסף על הנגישות במתחם: ${who}`);
    if (items.length === 0) continue;
    out.push(`## ${p.name}`, ...items);
  }
  if (out.length > 0) return out.join("\n");
  // בלי מידע שבעל המתחם מסר ואישר — לא כותבים שהמתחם נגיש (וגם לא שאינו נגיש)
  return `המידע על הסדרי הנגישות במתחם טרם נמסר. לפרטים לפני ההגעה — פנו אלינו: ${contact}.`;
}

/** הערכים של המשתנים, מפרטי העסק כפי שהם עכשיו. ריק — חסר. */
export function buildVars(
  view: DocumentsView,
  ctx: { siteUrl: string; today: string },
): Record<string, string> {
  const b = view.business;
  const p = view.profile;
  const t = siteCopy("he");
  const contactLine = join([
    b?.phone && `טלפון ${b.phone}`,
    b?.email && `אימייל ${b.email}`,
    b?.address && `כתובת: ${b.address}`,
  ]);
  const a11yContact =
    join([p?.a11y_contact_name, p?.a11y_contact_phone, p?.a11y_contact_email]) || contactLine;
  const pay = view.payments;
  const methods = [
    pay?.bank && "העברה בנקאית",
    pay?.bit && "ביט",
    pay?.phone && "תשלום בטלפון (כרטיס אשראי)",
  ].filter(Boolean) as string[];
  const policy = policyLines(view.policy, t, b?.currency ?? "ILS");
  return {
    business_name: clean(b?.name),
    contact_line: contactLine,
    business_phone: clean(b?.phone),
    business_email: clean(b?.email),
    business_address: clean(b?.address),
    site_url: ctx.siteUrl,
    legal_name: clean(p?.legal_name) || clean(b?.name),
    registration_id: clean(p?.registration_id),
    check_in_time: clean(b?.check_in_time),
    check_out_time: clean(b?.check_out_time),
    cancellation_policy: [
      ...(view.policy?.guest_text ? [clean(view.policy.guest_text)] : []),
      ...policy.map((l) => `- ${l}`),
    ].join("\n"),
    payment_methods: methods.join(", "),
    house_rules: rulesText(view),
    a11y_contact: a11yContact,
    a11y_coordinator: p?.coordinator_required
      ? join([p.coordinator_name, p.coordinator_phone, p.coordinator_email])
        ? `רכז/ת הנגישות: ${join([p.coordinator_name, p.coordinator_phone, p.coordinator_email])}`
        : ""
      : "",
    physical_accessibility: physicalText(view, a11yContact || "דרך פרטי הקשר באתר"),
    today: ctx.today,
  };
}

export interface Rendered {
  text: string;
  /** משתנים בלי ערך (חוסם פרסום) — בעברית */
  missing: string[];
  /** פרטים שבעל העסק צריך לכתוב בעצמו ([[…]]) */
  placeholders: string[];
}

/** ממלא את המשתנים. משתנה בלי ערך נשאר {{…}} בטקסט (ומסומן בתצוגה); רכז נגישות כשאין חובה — נמחק. */
export function renderDocument(
  body: string,
  vars: Record<string, string>,
  coordinatorRequired = false,
): Rendered {
  const missing = new Set<string>();
  let text = body.replace(VAR_RE, (whole, key: string) => {
    const v = vars[key];
    if (v === undefined) {
      missing.add(`משתנה לא מוכר: ${key}`);
      return whole;
    }
    if (v === "") {
      if (OPTIONAL.has(key) && !(key === "a11y_coordinator" && coordinatorRequired)) return "";
      missing.add(LABEL[key] ?? key);
      return whole;
    }
    return v;
  });
  // שורות שנשארו ריקות אחרי משתנה אופציונלי
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  const placeholders = [...text.matchAll(PLACEHOLDER_RE)].map((m) => clean(m[1]));
  return { text, missing: [...missing], placeholders };
}

export type Block =
  { kind: "h"; text: string } | { kind: "p"; text: string } | { kind: "ul"; items: string[] };

/** הטקסט → כותרות, פסקאות ורשימות (בלי HTML — מוצג כטקסט בלבד) */
export function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("## ")) blocks.push({ kind: "h", text: line.slice(3).trim() });
    else if (line.startsWith("- ")) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "ul") last.items.push(line.slice(2).trim());
      else blocks.push({ kind: "ul", items: [line.slice(2).trim()] });
    } else blocks.push({ kind: "p", text: line });
  }
  return blocks;
}
