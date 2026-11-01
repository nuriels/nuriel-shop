// מחירים, כללים ומדיניות (Stage 2f): בדיקת הקלט — אותם כללים והודעות כמו פונקציות המסד
// (מיגרציה 13; הבדיקות הסופיות והגרסאות — במסד).
import type { FeeTier, PolicyRules, PriceMode, RuleKind } from "../types/pricing";
import { InputError, uuid } from "./input";

type Raw = Record<string, unknown> | null | undefined;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function moneyError(
  label: string,
  v: unknown,
  min = 0,
  max = 100000,
  nullable = false,
): string | null {
  if (v === null || v === undefined) return nullable ? null : `יש למלא את ${label}`;
  if (!isNum(v) || v < min || v > max || Math.round(v * 100) !== v * 100)
    return `${label} — סכום בין ${min} ל-${max} (עד שתי ספרות אחרי הנקודה)`;
  return null;
}

export const UNIT_PRICE_KEYS = [
  "base_price",
  "extra_adult_price",
  "extra_child_price",
  "min_nights",
  "price_floor",
  "price_ceiling",
  "policy_id",
] as const;
export type UnitPriceKey = (typeof UNIT_PRICE_KEYS)[number];
export const UNIT_PRICE_LABELS: Record<UnitPriceKey, string> = {
  base_price: "מחיר ללילה",
  extra_adult_price: "תוספת למבוגר",
  extra_child_price: "תוספת לילד",
  min_nights: "מינימום לילות",
  price_floor: "מחיר מינימלי",
  price_ceiling: "מחיר מקסימלי",
  policy_id: "מדיניות ביטול",
};

export function unitPriceError(key: UnitPriceKey, v: unknown): string | null {
  const label = UNIT_PRICE_LABELS[key];
  if (key === "min_nights")
    return isNum(v) && Number.isInteger(v) && v >= 1 && v <= 60
      ? null
      : `${label} חייב להיות מספר שלם בין 1 ל-60`;
  if (key === "policy_id")
    return v === null || (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v))
      ? null
      : `${label} — ערך לא תקין`;
  return moneyError(label, v, 0, 100000, key === "price_floor" || key === "price_ceiling");
}

export function parseUnitPrices(input: Raw): {
  id: string;
  changes: Record<string, unknown>;
  revision: number;
} {
  const i = input ?? {};
  const raw = i["changes"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length === 0)
    throw new InputError("אין שינויים לשמירה");
  const changes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(UNIT_PRICE_KEYS as readonly string[]).includes(k))
      throw new InputError(`שדה לא מוכר: ${k.slice(0, 40)}`);
    const e = unitPriceError(k as UnitPriceKey, v);
    if (e) throw new InputError(e);
    changes[k] = v;
  }
  const f = changes["price_floor"];
  const c = changes["price_ceiling"];
  if (isNum(f) && isNum(c) && f > c)
    throw new InputError("המחיר המינימלי לא יכול להיות גבוה מהמקסימלי");
  const rev = i["revision"];
  if (!isNum(rev) || !Number.isInteger(rev) || rev < 1) throw new InputError("הגרסה לא תקינה");
  return { id: uuid(i["id"], "היחידה"), changes, revision: rev };
}

const KINDS: readonly RuleKind[] = ["weekday", "weekend", "season", "holiday"];
const MODES: readonly PriceMode[] = ["fixed", "percent", "amount"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** כלל מחיר מהטופס — שגיאה אחת בעברית או null (כמו rate_rule_save) */
export function ruleError(r: Record<string, unknown>): string | null {
  const name = r["name"];
  if (typeof name !== "string" || name.trim() === "") return "יש למלא את שם הכלל";
  if (name.trim().length > 80) return "שם הכלל ארוך מדי (עד 80 תווים)";
  if (!KINDS.includes(r["kind"] as RuleKind)) return "סוג הכלל — יש לבחור מהרשימה";
  if (!MODES.includes(r["price_mode"] as PriceMode)) return "אופן המחיר — יש לבחור מהרשימה";
  const value = r["value"];
  if (!isNum(value)) return "יש למלא את המחיר";
  if (r["price_mode"] === "fixed" && (value < 0 || value > 100000))
    return "מחיר ללילה — בין 0 ל-100000";
  if (r["price_mode"] === "percent" && (value < -90 || value > 500))
    return "שינוי באחוזים — בין ‎-90% ל-500%";
  const from = r["date_from"];
  const to = r["date_to"];
  if ((r["kind"] === "season" || r["kind"] === "holiday") && (!from || !to))
    return "לעונה ולחג יש לבחור תאריכים";
  if (
    (from === null || from === undefined || from === "") !==
    (to === null || to === undefined || to === "")
  )
    return "יש לבחור גם מתאריך וגם עד תאריך";
  if (from && to) {
    if (typeof from !== "string" || typeof to !== "string" || !DATE.test(from) || !DATE.test(to))
      return "תאריך לא תקין";
    if (to <= from) return '"עד תאריך" חייב להיות אחרי "מתאריך"';
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 366) return "כלל אחד — עד שנה";
  }
  const min = r["min_nights"];
  if (
    min !== null &&
    min !== undefined &&
    (!isNum(min) || !Number.isInteger(min) || min < 1 || min > 60)
  )
    return "מינימום לילות חייב להיות מספר שלם בין 1 ל-60";
  const mask = r["days_mask"];
  if (mask !== undefined && (!isNum(mask) || !Number.isInteger(mask) || mask < 1 || mask > 127))
    return "יש לבחור לפחות יום אחד בשבוע";
  if (r["policy_id"] && r["kind"] !== "season" && r["kind"] !== "holiday")
    return "מדיניות ביטול מיוחדת — רק לעונה או לחג";
  return null;
}

export function parseRuleSave(input: Raw): { id: string | null; data: Record<string, unknown> } {
  const i = input ?? {};
  const d = i["data"];
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new InputError("חסרים פרטי הכלל");
  const data = d as Record<string, unknown>;
  const allowed = [
    "name",
    "kind",
    "scope",
    "date_from",
    "date_to",
    "days_mask",
    "price_mode",
    "value",
    "min_nights",
    "priority",
    "policy_id",
    "is_active",
  ];
  for (const k of Object.keys(data))
    if (!allowed.includes(k)) throw new InputError(`שדה לא מוכר: ${k.slice(0, 40)}`);
  const id = i["id"] === null || i["id"] === undefined ? null : uuid(i["id"], "הכלל");
  // יצירה — כל השדות; עדכון חלקי (למשל הפעלה / השבתה) — רק מה שנשלח, והמסד בודק את התוצאה
  if (id === null || "name" in data) {
    const e = ruleError({ price_mode: "fixed", ...data });
    if (e) throw new InputError(e);
  }
  return { id, data };
}

export const FEE_LABELS: Record<FeeTier["fee"], string> = {
  none: "ללא חיוב",
  percent_total: "אחוז מהסכום",
  percent_deposit: "אחוז מהמקדמה",
  fixed: "סכום קבוע",
  deposit: "המקדמה",
  full: "הסכום המלא",
};

/** שגיאה במדיניות (כמו policy_save + הבדיקות הקיימות במסד) */
export function policyError(name: string, r: PolicyRules): string | null {
  if (name.trim() === "") return "יש למלא את שם המדיניות";
  if (name.trim().length > 80) return "שם המדיניות ארוך מדי (עד 80 תווים)";
  if (
    r.free_cancel_days !== null &&
    (!Number.isInteger(r.free_cancel_days) || r.free_cancel_days < 0 || r.free_cancel_days > 365)
  )
    return "ביטול חינם עד (ימים) — מספר שלם בין 0 ל-365";
  if (r.deposit_kind !== "none" && !(r.deposit_value > 0)) return "גובה המקדמה חייב להיות גדול מ-0";
  if (r.deposit_kind === "percent" && r.deposit_value > 100) return "מקדמה באחוזים — עד 100%";
  if (r.fee_tiers.length > 10) return "מדרגות הביטול: עד 10 מדרגות";
  let prev: number | null = null;
  for (const t of r.fee_tiers) {
    if (!Number.isInteger(t.from_days) || t.from_days < 0 || t.from_days > 365)
      return "מדרגת ביטול: מספר ימים שלם בין 0 ל-365";
    if (prev !== null && t.from_days >= prev)
      return "מדרגות הביטול חייבות להיות מסודרות מהרחוקה לקרובה";
    if (r.free_cancel_days !== null && t.from_days > r.free_cancel_days)
      return "מדרגת ביטול לא יכולה להתחיל לפני סוף הביטול החינם";
    const v = t.value ?? 0;
    if ((t.fee === "percent_total" || t.fee === "percent_deposit") && (v < 0 || v > 100))
      return "דמי ביטול באחוזים — 0 עד 100";
    if ((t.fee === "deposit" || t.fee === "percent_deposit") && r.deposit_kind === "none")
      return "דמי ביטול לפי המקדמה דורשים מקדמה במדיניות";
    prev = t.from_days;
  }
  if (r.no_show_fee === "deposit" && r.deposit_kind === "none")
    return "דמי אי-הגעה לפי המקדמה דורשים מקדמה במדיניות";
  if (r.no_show_fee === "percent_total" && (r.no_show_value < 0 || r.no_show_value > 100))
    return "דמי אי-הגעה באחוזים — עד 100%";
  if (r.auto_cancel === "within_free_window" && r.free_cancel_days === null)
    return "ביטול אוטומטי בחלון החינם דורש חלון ביטול חינם";
  if ((r.guest_text ?? "").length > 2000) return "ההסבר לאורח ארוך מדי (עד 2000 תווים)";
  return null;
}

export function parsePolicySave(input: Raw): {
  id: string | null;
  data: Record<string, unknown>;
  version: number | null;
} {
  const i = input ?? {};
  const d = i["data"];
  if (!d || typeof d !== "object" || Array.isArray(d) || Object.keys(d).length === 0)
    throw new InputError("אין שינויים לשמירה");
  const allowed = [
    "name",
    "deposit_kind",
    "deposit_value",
    "deposit_due",
    "free_cancel_days",
    "free_cancel_time",
    "fee_tiers",
    "no_show_fee",
    "no_show_value",
    "auto_cancel",
    "guest_text",
  ];
  for (const k of Object.keys(d))
    if (!allowed.includes(k)) throw new InputError(`שדה לא מוכר: ${k.slice(0, 40)}`);
  const id = i["id"] === null || i["id"] === undefined ? null : uuid(i["id"], "המדיניות");
  const v = i["version"];
  const version =
    v === null || v === undefined ? null : isNum(v) && Number.isInteger(v) && v >= 1 ? v : null;
  if (id !== null && version === null) throw new InputError("הגרסה לא תקינה");
  return { id, data: d as Record<string, unknown>, version };
}

export function parsePreview(input: Raw): { rules: PolicyRules; total: number; checkIn: string } {
  const i = input ?? {};
  const total = i["total"];
  const checkIn = i["checkIn"];
  if (!isNum(total) || total < 0 || total > 1000000) throw new InputError("סכום הדוגמה לא תקין");
  if (typeof checkIn !== "string" || !DATE.test(checkIn))
    throw new InputError("תאריך הדוגמה לא תקין");
  const rules = i["rules"];
  if (!rules || typeof rules !== "object") throw new InputError("חסרים כללי המדיניות");
  return { rules: rules as PolicyRules, total, checkIn };
}

export function parseQuoteInput(input: Raw): {
  unitId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
} {
  const i = input ?? {};
  const ci = i["checkIn"];
  const co = i["checkOut"];
  if (typeof ci !== "string" || !DATE.test(ci) || typeof co !== "string" || !DATE.test(co))
    throw new InputError("יש לבחור תאריכים");
  if (co <= ci) throw new InputError("תאריך היציאה חייב להיות אחרי הכניסה");
  const a = i["adults"];
  const c = i["children"];
  if (!isNum(a) || !Number.isInteger(a) || a < 1 || a > 100)
    throw new InputError("מספר המבוגרים לא תקין");
  if (!isNum(c) || !Number.isInteger(c) || c < 0 || c > 100)
    throw new InputError("מספר הילדים לא תקין");
  return { unitId: uuid(i["unitId"], "היחידה"), checkIn: ci, checkOut: co, adults: a, children: c };
}

/** תבניות מוכנות למדיניות (נקודת התחלה — הבעלים יכולים לשנות כל ערך) */
export const POLICY_TEMPLATES: Record<
  "flexible" | "moderate" | "strict",
  { label: string; rules: Partial<PolicyRules> }
> = {
  flexible: {
    label: "גמיש",
    rules: {
      free_cancel_days: 3,
      fee_tiers: [{ from_days: 3, fee: "percent_total", value: 50 }],
      no_show_fee: "full",
    },
  },
  moderate: {
    label: "רגיל",
    rules: {
      free_cancel_days: 7,
      fee_tiers: [
        { from_days: 7, fee: "percent_total", value: 50 },
        { from_days: 2, fee: "full" },
      ],
      no_show_fee: "full",
    },
  },
  strict: {
    label: "קפדני",
    rules: {
      free_cancel_days: 14,
      fee_tiers: [
        { from_days: 14, fee: "percent_total", value: 50 },
        { from_days: 7, fee: "full" },
      ],
      no_show_fee: "full",
    },
  },
};
