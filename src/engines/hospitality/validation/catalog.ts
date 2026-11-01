// בדיקת שדות המתחמים והיחידות — אותם כללים והודעות כמו פונקציות הקטלוג במסד
// (מיגרציה 10; המסד נשאר הסמכות הסופית, כולל ההרשאה). משמש את הטפסים (הודעה ליד
// השדה) ואת פונקציות השרת.
import {
  PROPERTY_DETAIL_KEYS,
  PROPERTY_TYPES,
  UNIT_TYPES,
  type PropertyChanges,
  type PropertyDetailKey,
  type PropertyFields,
  type PropertyKey,
  type ReorderInput,
  type SetupInput,
  type UnitChanges,
  type UnitFields,
  type UnitKey,
  type WholePropertyInput,
} from "../types/catalog";
import { cleanAmenities, cleanBeds, cleanPropertyDetail } from "./details";
import { InputError, uuid } from "./input";

export const PROPERTY_LABELS: Record<PropertyKey, string> = {
  name: "שם המתחם",
  property_type: "סוג המקום",
  description: "תיאור המתחם",
  address: "כתובת",
  status: "מצב המתחם",
};

export const UNIT_LABELS: Record<UnitKey, string> = {
  name: "שם היחידה",
  unit_type: "סוג היחידה",
  description: "תיאור היחידה",
  capacity: "מספר האורחים המרבי",
  base_occupancy: "מספר האורחים הכלולים במחיר",
  child_age_limit: "גיל ילד עד",
  bedrooms: "חדרי שינה",
  bathrooms: "חדרי רחצה",
  separate_toilets: "שירותים נפרדים",
  max_adults: "מקסימום מבוגרים",
  max_children: "מקסימום ילדים",
};

const TEXT_MAX: Partial<Record<PropertyKey | UnitKey, number>> = {
  name: 120,
  description: 5000,
  address: 300,
};
const INT_RANGES: Partial<Record<UnitKey, [number, number]>> = {
  capacity: [1, 100],
  base_occupancy: [1, 100],
  child_age_limit: [0, 17],
  bedrooms: [0, 50],
  bathrooms: [0, 50],
  separate_toilets: [0, 50],
  max_adults: [1, 100],
  max_children: [0, 100],
};
/** null = רק המקסימום הכולל חל */
const NULLABLE_INTS: readonly UnitKey[] = ["max_adults", "max_children"];
export const MAX_SETUP_UNITS = 30;

function textError(label: string, value: unknown, max: number, required: boolean): string | null {
  if (value !== null && value !== undefined && typeof value !== "string")
    return `${label} — ערך לא תקין`;
  const s = typeof value === "string" ? value.trim() : "";
  if (s === "") return required ? `יש למלא את ${label}` : null;
  return s.length > max ? `${label} ארוך מדי (עד ${max} תווים)` : null;
}

function intError(label: string, value: unknown, [min, max]: [number, number]): string | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? null
    : `${label} חייב להיות מספר שלם בין ${min} ל-${max}`;
}

/** הודעת שגיאה לשדה של מתחם, או null אם תקין */
export function propertyFieldError(key: PropertyKey, value: unknown): string | null {
  const label = PROPERTY_LABELS[key];
  switch (key) {
    case "name":
      return textError(label, value, TEXT_MAX.name!, true);
    case "description":
    case "address":
      return textError(label, value, TEXT_MAX[key]!, false);
    case "property_type":
      return (PROPERTY_TYPES as readonly unknown[]).includes(value)
        ? null
        : `${label} — יש לבחור מהרשימה`;
    case "status":
      return value === "draft" || value === "active" ? null : `${label} — יש לבחור מהרשימה`;
  }
}

/** הודעת שגיאה לשדה של יחידה, או null אם תקין (בלי הקשר לשדות אחרים) */
export function unitFieldError(key: UnitKey, value: unknown): string | null {
  const label = UNIT_LABELS[key];
  if (key === "name") return textError(label, value, TEXT_MAX.name!, true);
  if (key === "description") return textError(label, value, TEXT_MAX.description!, false);
  if (key === "unit_type")
    return (UNIT_TYPES as readonly unknown[]).includes(value)
      ? null
      : `${label} — יש לבחור מהרשימה`;
  if (value === null && NULLABLE_INTS.includes(key)) return null;
  return intError(label, value, INT_RANGES[key]!);
}

export const MAX_ADULTS_ERROR = "מקסימום המבוגרים לא יכול להיות גדול ממספר האורחים המרבי";
export const MAX_CHILDREN_ERROR = "מקסימום הילדים לא יכול להיות גדול ממספר האורחים המרבי";

export const OCCUPANCY_ERROR = "מספר האורחים הכלולים במחיר לא יכול להיות גדול ממספר האורחים המרבי";

/** כל שדות היחידה, כולל הכלל שבין שני שדות (כלולים ≤ מרבי) */
export function unitErrors(fields: UnitFields): Partial<Record<UnitKey, string>> {
  const errors: Partial<Record<UnitKey, string>> = {};
  for (const key of Object.keys(UNIT_LABELS) as UnitKey[]) {
    const e = unitFieldError(key, fields[key]);
    if (e) errors[key] = e;
  }
  if (!errors.capacity && !errors.base_occupancy && fields.base_occupancy > fields.capacity)
    errors.base_occupancy = OCCUPANCY_ERROR;
  if (
    !errors.capacity &&
    !errors.max_adults &&
    fields.max_adults !== null &&
    fields.max_adults > fields.capacity
  )
    errors.max_adults = MAX_ADULTS_ERROR;
  if (
    !errors.capacity &&
    !errors.max_children &&
    fields.max_children !== null &&
    fields.max_children > fields.capacity
  )
    errors.max_children = MAX_CHILDREN_ERROR;
  return errors;
}

export function propertyErrors(fields: PropertyFields): Partial<Record<PropertyKey, string>> {
  const errors: Partial<Record<PropertyKey, string>> = {};
  for (const key of Object.keys(PROPERTY_LABELS) as PropertyKey[]) {
    const e = propertyFieldError(key, fields[key]);
    if (e) errors[key] = e;
  }
  return errors;
}

type Raw = Record<string, unknown> | null | undefined;
const obj = (v: unknown, what: string): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new InputError(`חסרים ${what}`);
  return v as Record<string, unknown>;
};
const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : v);
const textOrNull = (v: unknown) => {
  const t = trimmed(v);
  return t === "" || t === undefined ? null : t;
};

function cleanProperty(input: Record<string, unknown>, partial: boolean): PropertyChanges {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(input)) {
    if ((PROPERTY_DETAIL_KEYS as readonly string[]).includes(key)) {
      out[key] = cleanPropertyDetail(key as PropertyDetailKey, raw);
      continue;
    }
    if (!(key in PROPERTY_LABELS)) throw new InputError(`שדה לא מוכר: ${key.slice(0, 40)}`);
    const k = key as PropertyKey;
    const value = k === "description" || k === "address" ? textOrNull(raw) : trimmed(raw);
    const e = propertyFieldError(k, value);
    if (e) throw new InputError(e);
    out[k] = value;
  }
  if (!partial) {
    for (const k of ["name", "property_type"] as const)
      if (!(k in out)) throw new InputError(propertyFieldError(k, undefined)!);
  }
  return out as PropertyChanges;
}

function cleanUnit(input: Record<string, unknown>, partial: boolean): UnitChanges {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (key === "beds") {
      out[key] = cleanBeds(raw);
      continue;
    }
    if (key === "amenities") {
      out[key] = cleanAmenities(raw);
      continue;
    }
    if (!(key in UNIT_LABELS)) throw new InputError(`שדה לא מוכר: ${key.slice(0, 40)}`);
    const k = key as UnitKey;
    const value = k === "description" ? textOrNull(raw) : trimmed(raw);
    const e = unitFieldError(k, value);
    if (e) throw new InputError(e);
    out[k] = value;
  }
  if (!partial) {
    for (const k of ["name", "unit_type"] as const)
      if (!(k in out)) throw new InputError(unitFieldError(k, undefined)!);
  }
  const cap = out["capacity"];
  const inc = out["base_occupancy"];
  if (typeof cap === "number" && typeof inc === "number" && inc > cap)
    throw new InputError(OCCUPANCY_ERROR);
  const adults = out["max_adults"];
  const kids = out["max_children"];
  if (typeof cap === "number" && typeof adults === "number" && adults > cap)
    throw new InputError(MAX_ADULTS_ERROR);
  if (typeof cap === "number" && typeof kids === "number" && kids > cap)
    throw new InputError(MAX_CHILDREN_ERROR);
  return out as UnitChanges;
}

const revisionOf = (v: unknown) => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1)
    throw new InputError("הגרסה לא תקינה");
  return v;
};
const changesOf = (v: unknown) => {
  const changes = obj(v, "שינויים לשמירה");
  if (Object.keys(changes).length === 0) throw new InputError("אין שינויים לשמירה");
  return changes;
};

export function parseCreateProperty(input: Raw): { data: PropertyChanges } {
  return { data: cleanProperty(obj((input ?? {})["data"], "פרטי המתחם"), false) };
}

export function parseUpdateProperty(input: Raw): {
  id: string;
  changes: PropertyChanges;
  revision: number;
} {
  const i = input ?? {};
  return {
    id: uuid(i["id"], "המתחם"),
    changes: cleanProperty(changesOf(i["changes"]), true),
    revision: revisionOf(i["revision"]),
  };
}

export function parseCreateUnit(input: Raw): { propertyId: string; data: UnitChanges } {
  const i = input ?? {};
  return {
    propertyId: uuid(i["propertyId"], "המתחם"),
    data: cleanUnit(obj(i["data"], "פרטי היחידה"), false),
  };
}

export function parseUpdateUnit(input: Raw): {
  id: string;
  changes: UnitChanges;
  revision: number;
} {
  const i = input ?? {};
  return {
    id: uuid(i["id"], "היחידה"),
    changes: cleanUnit(changesOf(i["changes"]), true),
    revision: revisionOf(i["revision"]),
  };
}

// ---------- פעולות (Stage 2c.3) ----------

/** יחידה / מתחם + הגרסה שנטענה (ארכיון, מחיקה) */
export function parseTarget(
  input: Raw,
  what: "היחידה" | "המתחם",
): { id: string; revision: number } {
  const i = input ?? {};
  return { id: uuid(i["id"], what), revision: revisionOf(i["revision"]) };
}

/** הפעלה / השבתה של יחידה */
export function parseSetActive(input: Raw): { id: string; active: boolean; revision: number } {
  const i = input ?? {};
  if (typeof i["active"] !== "boolean") throw new InputError("חסר מצב היחידה");
  return { ...parseTarget(i, "היחידה"), active: i["active"] };
}

const MAX_LIST = 500;
const uuidList = (v: unknown, what: string): string[] => {
  if (!Array.isArray(v) || v.length > MAX_LIST) throw new InputError(`${what} — רשימה לא תקינה`);
  const ids = v.map((x) => uuid(x, what));
  if (new Set(ids).size !== ids.length) throw new InputError(`${what} — יחידה מופיעה פעמיים`);
  return ids;
};

export const WHOLE_MIN_MEMBERS = 2;
export const WHOLE_MEMBERS_ERROR = "יש לבחור לפחות שתי יחידות פעילות מהמתחם";

/** "השכרת המתחם כולו": כיבוי — בלי יחידות; הפעלה — לפחות שתיים */
export function parseWholeProperty(input: Raw): WholePropertyInput {
  const i = input ?? {};
  if (typeof i["enabled"] !== "boolean") throw new InputError('חסר מצב "השכרת המתחם כולו"');
  const rev = i["revision"];
  const revision = rev === null || rev === undefined ? null : revisionOf(rev);
  const memberIds = i["enabled"] ? uuidList(i["memberIds"], "היחידות") : [];
  if (i["enabled"] && memberIds.length < WHOLE_MIN_MEMBERS)
    throw new InputError(WHOLE_MEMBERS_ERROR);
  return { propertyId: uuid(i["propertyId"], "המתחם"), enabled: i["enabled"], memberIds, revision };
}

/** סדר: אותן יחידות בדיוק (לפחות שתיים), בסדר חדש */
export function parseReorder(input: Raw): ReorderInput {
  const i = input ?? {};
  const expected = uuidList(i["expected"], "הסדר הקודם");
  const ids = uuidList(i["ids"], "הסדר החדש");
  const same = new Set(expected);
  if (ids.length < 2 || ids.length !== expected.length || ids.some((x) => !same.has(x)))
    throw new InputError("רשימת הסדר לא תקינה");
  return { propertyId: uuid(i["propertyId"], "המתחם"), expected, ids };
}

/** ההקמה הראשונה: סוג המקום, השם, ולפחות יחידה אחת (עד MAX_SETUP_UNITS) */
export function parseSetup(input: Raw): SetupInput {
  const i = input ?? {};
  const propertyType = i["propertyType"];
  const typeError = propertyFieldError("property_type", propertyType);
  if (typeError) throw new InputError(typeError);
  const name = trimmed(i["name"]);
  const nameError = propertyFieldError("name", name);
  if (nameError) throw new InputError(nameError);
  const units = i["units"];
  if (!Array.isArray(units) || units.length === 0)
    throw new InputError("יש להוסיף לפחות יחידה אחת");
  if (units.length > MAX_SETUP_UNITS)
    throw new InputError(`אפשר להוסיף עד ${MAX_SETUP_UNITS} יחידות בהקמה — את השאר אחר כך`);
  return {
    propertyType: propertyType as SetupInput["propertyType"],
    name: name as string,
    units: units.map((u: unknown, n) => {
      const row = obj(u, `פרטי יחידה ${n + 1}`);
      const unitName = trimmed(row["name"]);
      for (const [k, v] of [
        ["name", unitName],
        ["capacity", row["capacity"]],
        ["bedrooms", row["bedrooms"]],
      ] as const) {
        const e = unitFieldError(k, v);
        if (e) throw new InputError(units.length > 1 ? `יחידה ${n + 1}: ${e}` : e);
      }
      return {
        name: unitName as string,
        capacity: row["capacity"] as number,
        bedrooms: row["bedrooms"] as number,
      };
    }),
  };
}
