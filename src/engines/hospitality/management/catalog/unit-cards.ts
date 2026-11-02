// כרטיסי היחידות במסך "יחידות ומתחמים" — חישובים טהורים (נבדקים ביחידה), בלי שדות חדשים במסד:
// המחיר ללילה ובסוף השבוע (מכללי המחיר), המיטות, המתקנים, ומצב הפרסום באתר.
import type { Amenity, BedRow, CatalogProperty, CatalogUnit } from "../../types/catalog";
import type { RateRule } from "../../types/pricing";
import { BED_TYPE_LABELS } from "../details/labels";
import { missingForBooking } from "./model";

/**
 * המחיר בלילות סוף השבוע: כלל "סוף שבוע" פעיל בלי טווח תאריכים — הספציפי ביותר (היחידה, ואז המתחם,
 * ואז כל העסק), ובאותה רמה — העדיפות הגבוהה. null — אין כלל כזה (אותו מחיר כל השבוע).
 */
export function weekendPrice(
  unit: Pick<CatalogUnit, "id" | "property_id">,
  base: number,
  rules: readonly RateRule[],
): number | null {
  const level = (r: RateRule) =>
    r.unit_id === unit.id
      ? 3
      : r.unit_id === null && r.property_id === unit.property_id
        ? 2
        : r.unit_id === null && r.property_id === null
          ? 1
          : 0;
  const rule = rules
    .filter(
      (r) => r.kind === "weekend" && r.is_active && !r.date_from && !r.date_to && level(r) > 0,
    )
    .sort((a, b) => level(b) - level(a) || b.priority - a.priority)[0];
  if (!rule) return null;
  const v =
    rule.price_mode === "fixed"
      ? rule.value
      : rule.price_mode === "percent"
        ? base * (1 + rule.value / 100)
        : base + rule.value;
  return Math.max(0, Math.round(v));
}

/** "מיטה זוגית · 2 מיטות יחיד" */
export function bedsText(beds: readonly Pick<BedRow, "bed_type" | "quantity">[]): string {
  const sum = new Map<string, number>();
  for (const b of beds) sum.set(b.bed_type, (sum.get(b.bed_type) ?? 0) + Number(b.quantity || 0));
  return [...sum.entries()]
    .filter(([, n]) => n > 0)
    .map(([t, n]) => {
      const label = BED_TYPE_LABELS[t as keyof typeof BED_TYPE_LABELS] ?? t;
      return n === 1 ? label : `${n} × ${label}`;
    })
    .join(" · ");
}

/** המתקנים הראשונים (לפי הסדר בקטלוג) ועוד כמה */
export function amenityPreview(
  unit: Pick<CatalogUnit, "amenities">,
  catalog: readonly Pick<Amenity, "id" | "name">[],
  max = 3,
): { shown: string[]; more: number } {
  const names = new Map(catalog.map((a) => [a.id, a.name]));
  const all = unit.amenities.map((a) => names.get(a.amenity_id)).filter((n): n is string => !!n);
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) };
}

export type PublishState = "live" | "inactive" | "missing" | "draft" | "closed";

/** האם היחידה מוצגת לאורחים באתר — ואם לא, למה */
export function publishState(
  unit: CatalogUnit,
  property: Pick<CatalogProperty, "status">,
  siteOpen: boolean,
): { state: PublishState; label: string } {
  if (!unit.is_active) return { state: "inactive", label: "לא פעילה" };
  if (property.status === "draft") return { state: "draft", label: "המתחם בטיוטה" };
  const missing = missingForBooking(unit);
  if (missing.length) return { state: "missing", label: `חסר: ${missing.join(" ו")}` };
  if (!siteOpen) return { state: "closed", label: "מוכנה — האתר עוד סגור" };
  return { state: "live", label: "מוצגת באתר" };
}
