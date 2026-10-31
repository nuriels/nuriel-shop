// מודל המסך "יחידות ומתחמים": קיבוץ לפי מתחם, המגבלה בחבילה, טקסטים, טפסים (ערכי
// טקסט בזמן ההקלדה → שדות לשמירה), מה השתנה, ומיזוג אחרי "עודכן בינתיים".
import type {
  CatalogProperty,
  CatalogUnit,
  CatalogView,
  PropertyFields,
  PropertyKey,
  PropertyType,
  UnitFields,
  UnitKey,
  UnitType,
} from "../../types/catalog";
import { PROPERTY_KEYS, UNIT_KEYS } from "../../types/catalog";
import { propertyErrors, unitErrors } from "../../validation/catalog";
import { BUSINESS_TYPES } from "./labels";

// ---------- הרשימה ----------

/** המתחמים שמוצגים ברשימה (בלי ארכיון), בסדר שנקבע */
export function visibleProperties(view: CatalogView): CatalogProperty[] {
  return view.properties.filter((p) => p.status !== "archived");
}

export function archivedCount(view: CatalogView): number {
  return view.properties.filter((p) => p.status === "archived").length;
}

/** היחידות הפיזיות של מתחם (בלי "כל המתחם"), בסדר שנקבע */
export function physicalUnits(p: CatalogProperty): CatalogUnit[] {
  return p.units.filter((u) => u.kind !== "whole_property");
}

export function wholeUnit(p: CatalogProperty): CatalogUnit | null {
  return p.units.find((u) => u.kind === "whole_property") ?? null;
}

/** "3 מתוך 20 יחידות פעילות בחבילה" — ואם אפשר להוסיף עוד */
export function unitsLimit(limits: CatalogView["limits"]): {
  text: string;
  canAdd: boolean;
  reason: string | null;
  remaining: number | null;
} {
  const { max_units: max, units_used: used, active } = limits;
  const text =
    max === null
      ? `${used} יחידות פעילות (ללא הגבלה בחבילה)`
      : `${used} מתוך ${max} יחידות פעילות בחבילה`;
  if (!active)
    return {
      text,
      canAdd: false,
      reason: "המנוי של העסק אינו פעיל — אי אפשר להוסיף יחידות.",
      remaining: 0,
    };
  if (max !== null && used >= max)
    return {
      text,
      canAdd: false,
      reason: "הגעתם למגבלת היחידות בחבילה. אפשר להשבית יחידה, או לבקש מנוריאל חבילה גדולה יותר.",
      remaining: 0,
    };
  return { text, canAdd: true, reason: null, remaining: max === null ? null : max - used };
}

const plural = (n: number, one: string, many: (n: number) => string) => (n === 1 ? one : many(n));

/** "עד 4 אורחים · 2 חדרי שינה · חדר רחצה אחד" */
export function unitSummary(u: Pick<CatalogUnit, "capacity" | "bedrooms" | "bathrooms">): string {
  const parts = [plural(u.capacity, "אורח אחד", (n) => `עד ${n} אורחים`)];
  if (u.bedrooms > 0) parts.push(plural(u.bedrooms, "חדר שינה אחד", (n) => `${n} חדרי שינה`));
  if (u.bathrooms > 0) parts.push(plural(u.bathrooms, "חדר רחצה אחד", (n) => `${n} חדרי רחצה`));
  return parts.join(" · ");
}

/** מה חסר כדי שאורחים יוכלו להזמין (מסכים בשלבים הבאים) — ליחידה פעילה בלבד */
export function missingForBooking(u: CatalogUnit): string[] {
  if (!u.is_active) return [];
  const missing: string[] = [];
  if (!u.has_price) missing.push("מחיר");
  if (!u.has_photo) missing.push("תמונות");
  return missing;
}

/** שם פנוי ליחידה חדשה: "צימר 3" (המספר הבא שלא תפוס) */
export function nextUnitName(word: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.trim()));
  for (let i = existing.length + 1; ; i++) {
    const name = `${word} ${i}`;
    if (!taken.has(name)) return name;
  }
}

// ---------- ההקמה הראשונה ----------

export interface SetupRow {
  name: string;
  capacity: string;
}

export function setupRows(type: PropertyType): SetupRow[] {
  const info = BUSINESS_TYPES[type];
  return Array.from({ length: info.startUnits }, (_, i) => ({
    name: `${info.unitWord} ${i + 1}`,
    capacity: "2",
  }));
}

// ---------- טפסים ----------

const toInt = (s: string): number => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : Number.NaN);

export type PropertyForm = {
  name: string;
  property_type: PropertyType;
  description: string;
  address: string;
  status: "draft" | "active";
};

export function propertyFormFrom(p: CatalogProperty | null, type?: PropertyType): PropertyForm {
  return {
    name: p?.name ?? "",
    property_type: p?.property_type ?? type ?? "zimmer_complex",
    description: p?.description ?? "",
    address: p?.address ?? "",
    status: p && p.status === "draft" ? "draft" : "active",
  };
}

export function propertyFields(f: PropertyForm): PropertyFields {
  const text = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    name: f.name.trim(),
    property_type: f.property_type,
    description: text(f.description),
    address: text(f.address),
    status: f.status,
  };
}

export type UnitForm = {
  name: string;
  unit_type: UnitType;
  description: string;
  capacity: string;
  base_occupancy: string;
  child_age_limit: string;
  bedrooms: string;
  bathrooms: string;
};

export function unitFormFrom(u: CatalogUnit | null, defaults?: Partial<UnitForm>): UnitForm {
  return {
    name: u?.name ?? defaults?.name ?? "",
    unit_type: u?.unit_type ?? defaults?.unit_type ?? "zimmer",
    description: u?.description ?? "",
    capacity: String(u?.capacity ?? defaults?.capacity ?? "2"),
    base_occupancy: String(u?.base_occupancy ?? defaults?.base_occupancy ?? "2"),
    child_age_limit: String(u?.child_age_limit ?? "12"),
    bedrooms: String(u?.bedrooms ?? defaults?.bedrooms ?? "1"),
    bathrooms: String(u?.bathrooms ?? defaults?.bathrooms ?? "1"),
  };
}

export function unitFields(f: UnitForm): UnitFields {
  return {
    name: f.name.trim(),
    unit_type: f.unit_type,
    description: f.description.trim() === "" ? null : f.description.trim(),
    capacity: toInt(f.capacity),
    base_occupancy: toInt(f.base_occupancy),
    child_age_limit: toInt(f.child_age_limit),
    bedrooms: toInt(f.bedrooms),
    bathrooms: toInt(f.bathrooms),
  };
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b) || (Number.isNaN(a) && Number.isNaN(b));

export function changedKeys<K extends string>(
  keys: readonly K[],
  a: Record<K, unknown>,
  b: Record<K, unknown>,
): K[] {
  return keys.filter((k) => !same(a[k], b[k]));
}

export function propertyChanges(base: PropertyForm, form: PropertyForm): Partial<PropertyFields> {
  const a = propertyFields(base);
  const b = propertyFields(form);
  const out: Partial<Record<PropertyKey, unknown>> = {};
  for (const k of changedKeys(PROPERTY_KEYS, a, b)) out[k] = b[k];
  return out as Partial<PropertyFields>;
}

export function unitChanges(base: UnitForm, form: UnitForm): Partial<UnitFields> {
  const a = unitFields(base);
  const b = unitFields(form);
  const out: Partial<Record<UnitKey, unknown>> = {};
  for (const k of changedKeys(UNIT_KEYS, a, b)) out[k] = b[k];
  return out as Partial<UnitFields>;
}

export const propertyFormErrors = (f: PropertyForm) => propertyErrors(propertyFields(f));
export const unitFormErrors = (f: UnitForm) => unitErrors(unitFields(f));

/**
 * מישהו אחר שמר בינתיים: הטופס החדש = הערכים העדכניים, ועליהם השינויים שלי בשדות
 * שהאחר לא שינה. שדה ששנינו שינינו — הערך שלו נשאר (השינוי שלי בוטל ומדווח).
 */
export function mergeAfterConflict<F extends Record<string, unknown>>(
  keys: readonly (keyof F & string)[],
  base: F,
  form: F,
  latest: F,
): { form: F; remoteChanged: (keyof F & string)[]; dropped: (keyof F & string)[] } {
  const remoteChanged = keys.filter((k) => !same(base[k], latest[k]));
  const mine = keys.filter((k) => !same(base[k], form[k]));
  const dropped = mine.filter((k) => remoteChanged.includes(k));
  const merged = { ...latest };
  for (const k of mine) if (!remoteChanged.includes(k)) merged[k] = form[k];
  return { form: merged, remoteChanged, dropped };
}

export const PROPERTY_FORM_KEYS = PROPERTY_KEYS as readonly (keyof PropertyForm & string)[];
export const UNIT_FORM_KEYS = UNIT_KEYS as readonly (keyof UnitForm & string)[];

export function findProperty(view: CatalogView, id: string): CatalogProperty | null {
  return view.properties.find((p) => p.id === id) ?? null;
}

export function findUnit(view: CatalogView, id: string): CatalogUnit | null {
  for (const p of view.properties) {
    const u = p.units.find((x) => x.id === id);
    if (u) return u;
  }
  return null;
}
