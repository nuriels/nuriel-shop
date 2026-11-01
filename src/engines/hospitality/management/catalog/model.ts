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
import { BUSINESS_TYPES, setupUnitType as setupUnitTypeFor } from "./labels";

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

// ---------- Stage 2c.3: עמודי יחידה ומתחם, סדר, הפעלה, ארכיון ומחיקה ----------

/** היחידות הפיזיות הפעילות של מתחם — בסדר שנקבע (רק אותן מסדרים) */
export function activeUnits(p: CatalogProperty): CatalogUnit[] {
  return physicalUnits(p).filter((u) => u.is_active);
}

/** היחידות הפיזיות שלא פעילות (מוצגות בנפרד) */
export function inactiveUnits(p: CatalogProperty): CatalogUnit[] {
  return physicalUnits(p).filter((u) => !u.is_active);
}

export function propertyOf(view: CatalogView, unit: CatalogUnit): CatalogProperty | null {
  return findProperty(view, unit.property_id);
}

/** הזזה ברשימה (גרירה או חץ) — רשימה חדשה; מחוץ לטווח — בלי שינוי */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from === to || from < 0 || to < 0 || from >= out.length || to >= out.length) return out;
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item as T);
  return out;
}

export const sameOrder = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** אחרי סדר חדש: היחידות הפעילות בסדר החדש, אחריהן הלא פעילות, ו"כל המתחם" בסוף (כמו המסד) */
export function withUnitOrder(
  view: CatalogView,
  propertyId: string,
  ids: readonly string[],
): CatalogView {
  return {
    ...view,
    properties: view.properties.map((p) => {
      if (p.id !== propertyId) return p;
      const byId = new Map(p.units.map((u) => [u.id, u]));
      const ordered = ids.map((id) => byId.get(id)).filter((u): u is CatalogUnit => Boolean(u));
      const rest = physicalUnits(p).filter((u) => !ids.includes(u.id));
      const whole = wholeUnit(p);
      const units = [...ordered, ...rest].map((u, i) => ({ ...u, sort_order: i }));
      return { ...p, units: whole ? [...units, whole] : units };
    }),
  };
}

// ---------- מה מונע פעולה (ההסבר מוצג מראש; המסד בודק שוב) ----------

/** היחידה בתוך "כל המתחם" פעיל? */
export function inActiveWhole(p: CatalogProperty, unitId: string): boolean {
  const w = wholeUnit(p);
  return Boolean(w?.is_active && w.member_ids?.includes(unitId));
}

export function inAnyWhole(p: CatalogProperty, unitId: string): boolean {
  return Boolean(wholeUnit(p)?.member_ids?.includes(unitId));
}

export const DEACTIVATE_IN_WHOLE =
  'היחידה כלולה ב"כל המתחם" הפעיל — יש להשבית את "כל המתחם" או להסיר ממנו את היחידה קודם';
export const DELETE_WITH_HISTORY = "ליחידה יש הזמנות או חסימות — אפשר להשבית אותה במקום למחוק";
export const DELETE_IN_WHOLE = 'היחידה כלולה ב"כל המתחם" — יש להסיר אותה משם קודם';
export const PROPERTY_DELETE_WITH_HISTORY =
  "במתחם יש יחידות עם הזמנות או חסימות — אפשר להעביר אותו לארכיון במקום למחוק";
export const ARCHIVED_FOR_MANAGER = "המתחם בארכיון — רק בעל העסק יכול לשנות אותו או להחזיר אותו.";

/** למה אי אפשר להשבית את היחידה עכשיו (או null) */
export function deactivateBlock(p: CatalogProperty, unit: CatalogUnit): string | null {
  return unit.kind !== "whole_property" && inActiveWhole(p, unit.id) ? DEACTIVATE_IN_WHOLE : null;
}

/** למה אי אפשר להפעיל את היחידה עכשיו (או null) */
export function activateBlock(view: CatalogView, p: CatalogProperty): string | null {
  if (p.status === "archived") return "המתחם בארכיון — יש להחזיר אותו מהארכיון קודם";
  return unitsLimit(view.limits).canAdd ? null : unitsLimit(view.limits).reason;
}

/** למה אי אפשר למחוק את היחידה (או null) — מחיקה לבעלים בלבד */
export function unitDeleteBlock(p: CatalogProperty, unit: CatalogUnit): string | null {
  if (unit.has_history) return DELETE_WITH_HISTORY;
  if (inAnyWhole(p, unit.id)) return DELETE_IN_WHOLE;
  return null;
}

/** למה אי אפשר למחוק את המתחם (או null) */
export function propertyDeleteBlock(p: CatalogProperty): string | null {
  return p.units.some((u) => u.has_history) ? PROPERTY_DELETE_WITH_HISTORY : null;
}

// ---------- "השכרת המתחם כולו" ----------

export interface MemberChoice {
  unit: CatalogUnit;
  /** אפשר לבחור (יחידה פעילה); אחרת — למה לא */
  disabledReason: string | null;
}

/** היחידות שאפשר לכלול ב"כל המתחם": הפיזיות של המתחם; לא פעילה — מוצגת ולא ניתנת לבחירה */
export function memberChoices(p: CatalogProperty): MemberChoice[] {
  return physicalUnits(p).map((unit) => ({
    unit,
    disabledReason: unit.is_active ? null : "לא פעילה — יש להפעיל אותה קודם",
  }));
}

/**
 * מצב ההתחלה של הבחירה: היחידות הנוכחיות (הפעילות שבהן), או — אם עוד אין לפחות שתיים —
 * כל היחידות הפעילות
 */
export function initialMembers(p: CatalogProperty): string[] {
  const active = activeUnits(p).map((u) => u.id);
  const current = (wholeUnit(p)?.member_ids ?? []).filter((id) => active.includes(id));
  return current.length >= 2 ? current : active;
}

export const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/** ברירות המחדל ליחידה חדשה במתחם: הסוג לפי סוג המקום ושם פנוי ("צימר 3") */
export function newUnitDefaults(p: CatalogProperty | undefined): Partial<UnitForm> {
  if (!p) return {};
  return {
    unit_type: setupUnitTypeFor(p.property_type),
    name: nextUnitName(
      BUSINESS_TYPES[p.property_type].unitWord,
      p.units.map((u) => u.name),
    ),
  };
}

/** "השכרת המתחם כולו" אפשרית רק כשיש במתחם לפחות שתי יחידות */
export const canRentWhole = (p: CatalogProperty) => physicalUnits(p).length >= 2;

// ---------- "עודכן בינתיים" בפעולות (נבדק בשרת לפני הפעולה) ----------

export const STALE_UNIT = "היחידה עודכנה בינתיים על ידי משתמש אחר — הפרטים רועננו. בדקו ונסו שוב.";
export const GONE_UNIT = "היחידה נמחקה בינתיים.";
export const STALE_PROPERTY =
  "המתחם עודכן בינתיים על ידי משתמש אחר — הפרטים רועננו. בדקו ונסו שוב.";
export const GONE_PROPERTY = "המתחם נמחק בינתיים.";
export const STALE_WHOLE =
  '"השכרת המתחם כולו" עודכנה בינתיים על ידי משתמש אחר — הבחירה רועננה. בדקו ונסו שוב.';
export const STALE_ORDER = "סדר היחידות שונה בינתיים על ידי משתמש אחר — הרשימה רועננה. נסו שוב.";

export function staleUnit(view: CatalogView, id: string, revision: number): string | null {
  const u = findUnit(view, id);
  if (!u) return GONE_UNIT;
  return u.revision === revision ? null : STALE_UNIT;
}

export function staleProperty(view: CatalogView, id: string, revision: number): string | null {
  const p = findProperty(view, id);
  if (!p) return GONE_PROPERTY;
  return p.revision === revision ? null : STALE_PROPERTY;
}

/** הגרסה של "כל המתחם" כפי שנטענה — null אם עוד לא נוצר */
export function wholeRevision(p: CatalogProperty): number | null {
  return wholeUnit(p)?.revision ?? null;
}

export function staleWhole(
  view: CatalogView,
  propertyId: string,
  revision: number | null,
): string | null {
  const p = findProperty(view, propertyId);
  if (!p) return GONE_PROPERTY;
  return wholeRevision(p) === revision ? null : STALE_WHOLE;
}

export function staleOrder(
  view: CatalogView,
  propertyId: string,
  expected: readonly string[],
): string | null {
  const p = findProperty(view, propertyId);
  if (!p) return GONE_PROPERTY;
  return sameOrder(
    activeUnits(p).map((u) => u.id),
    expected,
  )
    ? null
    : STALE_ORDER;
}
