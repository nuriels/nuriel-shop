// מתחמים ויחידות — מה ש-catalog_view() ופונקציות הקטלוג מחזירות (מיגרציה 10)

/** סוג המקום (תווית בלבד — שום כלל לא תלוי בה) */
export const PROPERTY_TYPES = [
  "zimmer",
  "zimmer_complex",
  "vacation_apartments",
  "villa",
  "boutique_hotel",
  "guest_house",
  "other",
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/** סוג היחידה (תווית בלבד) */
export const UNIT_TYPES = [
  "zimmer",
  "suite",
  "room",
  "apartment",
  "villa",
  "cabin",
  "studio",
  "other",
] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export type PropertyStatus = "draft" | "active" | "archived";
export type UnitKind = "unit" | "room" | "whole_property";

export interface CatalogUnit {
  id: string;
  property_id: string;
  kind: UnitKind;
  unit_type: UnitType;
  name: string;
  description: string | null;
  capacity: number;
  base_occupancy: number;
  child_age_limit: number;
  bedrooms: number;
  bathrooms: number;
  is_active: boolean;
  sort_order: number;
  revision: number;
  has_price: boolean;
  has_photo: boolean;
  has_history: boolean;
  /** "כל המתחם" — היחידות שבו; אחרת null */
  member_ids: string[] | null;
}

export interface CatalogProperty {
  id: string;
  name: string;
  property_type: PropertyType;
  description: string | null;
  address: string | null;
  status: PropertyStatus;
  sort_order: number;
  revision: number;
  units: CatalogUnit[];
}

export interface CatalogView {
  limits: { max_units: number | null; units_used: number; active: boolean };
  /** פעולות של בעל העסק בלבד (ארכיון, מחיקה) — 2c.3 */
  can_owner: boolean;
  properties: CatalogProperty[];
}

/** שדות המתחם שאפשר לקבוע (יצירה / עריכה) */
export interface PropertyFields {
  name: string;
  property_type: PropertyType;
  description: string | null;
  address: string | null;
  status: "draft" | "active";
}
export type PropertyKey = keyof PropertyFields;
export const PROPERTY_KEYS: readonly PropertyKey[] = [
  "name",
  "property_type",
  "description",
  "address",
  "status",
];

/** שדות היחידה שאפשר לקבוע (המחיר — בשלב 2f) */
export interface UnitFields {
  name: string;
  unit_type: UnitType;
  description: string | null;
  capacity: number;
  base_occupancy: number;
  child_age_limit: number;
  bedrooms: number;
  bathrooms: number;
}
export type UnitKey = keyof UnitFields;
export const UNIT_KEYS: readonly UnitKey[] = [
  "name",
  "unit_type",
  "description",
  "capacity",
  "base_occupancy",
  "child_age_limit",
  "bedrooms",
  "bathrooms",
];

/** שמירה: נשמר, או "עודכן בינתיים" עם הנתונים העדכניים (לא שגיאה) */
export type CatalogSaveResult =
  | { status: "saved"; id: string; revision: number }
  | { status: "conflict"; message: string; view: CatalogView };

/**
 * פעולה (הפעלה / השבתה, ארכיון, מחיקה, "השכרת המתחם כולו", סדר) — Stage 2c.3.
 * done: בוצעה (revision — הגרסה החדשה של מה שהשתנה, אם יש); conflict: מישהו אחר שינה
 * בינתיים — לא בוצע דבר, ומוחזרים הנתונים העדכניים.
 */
export type CatalogActionResult =
  | { status: "done"; revision: number | null }
  | { status: "conflict"; message: string; view: CatalogView };

/** "השכרת המתחם כולו": מצב, היחידות, והגרסה של "כל המתחם" כפי שנטענה (null — עוד לא קיים) */
export interface WholePropertyInput {
  propertyId: string;
  enabled: boolean;
  memberIds: string[];
  revision: number | null;
}

/** סדר היחידות הפעילות של מתחם: הסדר שנטען (expected) והסדר החדש (ids) */
export interface ReorderInput {
  propertyId: string;
  expected: string[];
  ids: string[];
}

/** ההקמה הראשונה: מקום האירוח והיחידות הראשונות שלו */
export interface SetupUnit {
  name: string;
  capacity: number;
  bedrooms: number;
}
export interface SetupInput {
  propertyType: PropertyType;
  name: string;
  units: SetupUnit[];
}
export interface SetupResult {
  propertyId: string;
  created: number;
  requested: number;
  /** כשלא כל היחידות נוצרו (למשל מגבלת החבילה) — ההסבר מהמסד */
  message: string | null;
}
