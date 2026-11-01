// מחירים ומדיניות (Stage 2f) — טקסטים בעברית פשוטה וחישוב הדוגמה "אם אורח מבטל N ימים לפני"
// מתוך לוח הזמנים שהשרת החזיר (policy_preview = אותו חישוב כמו בהזמנה).
import type {
  FeeTier,
  PolicyPreview,
  PolicyRules,
  PricedUnit,
  RateRule,
} from "../../types/pricing";
import { FEE_LABELS } from "../../validation/pricing";
import { manageKeys } from "../lib/query-keys";

export const pricingKey = [...manageKeys.all, "pricing"] as const;

export const money = (n: number, currency = "ILS") =>
  new Intl.NumberFormat("he-IL", { style: "currency", currency, maximumFractionDigits: 2 }).format(
    n,
  );

export const RULE_KIND_LABELS: Record<RateRule["kind"], string> = {
  weekday: "ימי חול",
  weekend: "סוף שבוע",
  season: "עונה",
  holiday: "חג",
};
const DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
export const DAY_LABELS = DAYS;

export const daysText = (mask: number) =>
  mask === 127 ? "כל הימים" : DAYS.filter((_, i) => (mask & (1 << i)) !== 0).join(", ");

export function priceText(r: Pick<RateRule, "price_mode" | "value">, currency = "ILS"): string {
  if (r.price_mode === "fixed") return `${money(r.value, currency)} ללילה`;
  if (r.price_mode === "percent") return `${r.value > 0 ? "+" : ""}${r.value}% ממחיר הבסיס`;
  return `${r.value > 0 ? "+" : ""}${money(r.value, currency)} למחיר הבסיס`;
}

export function scopeText(
  r: Pick<RateRule, "unit_id" | "property_id">,
  units: PricedUnit[],
  props: { id: string; name: string }[],
) {
  if (r.unit_id) return units.find((u) => u.id === r.unit_id)?.name ?? "יחידה";
  if (r.property_id) return `כל ${props.find((p) => p.id === r.property_id)?.name ?? "המתחם"}`;
  return "כל היחידות";
}

const shortDate = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${Number(day)}.${Number(m)}.${y}`;
};
/** [from, to) → "1.7.2027 – 31.8.2027" (הלילה האחרון הוא יום לפני to) */
export function datesText(r: Pick<RateRule, "date_from" | "date_to">): string | null {
  if (!r.date_from || !r.date_to) return null;
  const last = new Date(`${r.date_to}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() - 1);
  return `${shortDate(r.date_from)} – ${shortDate(last.toISOString().slice(0, 10))} (לילות)`;
}

/** "ביטול חינם עד 7 ימים לפני ההגעה; אחר כך 50% מהסכום; מ-2 ימים לפני — הסכום המלא" */
export function policySummary(r: PolicyRules): string {
  const parts: string[] = [];
  parts.push(
    r.free_cancel_days === null
      ? "אין ביטול חינם"
      : `ביטול חינם עד ${r.free_cancel_days} ימים לפני ההגעה`,
  );
  if (r.fee_tiers.length === 0) parts.push("אחר כך — הסכום המלא");
  r.fee_tiers.forEach((t, i) =>
    parts.push(`${i === 0 ? "אחר כך" : `מ-${t.from_days} ימים לפני`} — ${tierText(t)}`),
  );
  parts.push(
    `אי-הגעה — ${r.no_show_fee === "percent_total" ? `${r.no_show_value}% מהסכום` : r.no_show_fee === "fixed" ? money(r.no_show_value) : r.no_show_fee === "deposit" ? "המקדמה" : "הסכום המלא"}`,
  );
  return parts.join("; ");
}
export const tierText = (t: FeeTier) =>
  t.fee === "percent_total"
    ? `${t.value ?? 0}% מהסכום`
    : t.fee === "percent_deposit"
      ? `${t.value ?? 0}% מהמקדמה`
      : t.fee === "fixed"
        ? money(t.value ?? 0)
        : FEE_LABELS[t.fee];

/**
 * מה האורח מקבל בחזרה אם הוא מבטל N ימים לפני ההגעה (באותה שעה של הכניסה): התקופה בלוח
 * הזמנים של השרת שהמועד נופל בה, ודמי הביטול שלה. מחזיר null כשהמועד אחרי ההגעה.
 */
export function refundAt(
  preview: PolicyPreview,
  daysBefore: number,
): { fee: number; refund: number } | null {
  if (daysBefore < 0) return null;
  const arrival = Date.parse(preview.schedule.arrival);
  const at = arrival - daysBefore * 86400000;
  const p = preview.schedule.periods.find(
    (x) =>
      (x.from === null || Date.parse(x.from) <= at) &&
      (x.until === null || at < Date.parse(x.until)),
  );
  if (!p) return null;
  return { fee: p.fee, refund: Math.max(0, preview.total - p.fee) };
}

export const DEFAULT_POLICY_RULES: PolicyRules = {
  deposit_kind: "none",
  deposit_value: 0,
  deposit_due: "approval",
  free_cancel_days: 7,
  free_cancel_time: null,
  fee_tiers: [{ from_days: 7, fee: "percent_total", value: 50 }],
  no_show_fee: "full",
  no_show_value: 0,
  auto_cancel: "never",
  guest_text: null,
};
