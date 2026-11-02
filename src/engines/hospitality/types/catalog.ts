// מתחמים ויחידות — מה ש-catalog_view() ופונקציות הקטלוג מחזירות (מיגרציה 10; פרטי
// היחידה והמתחם, מיטות ומתקנים — מיגרציה 11, שלב 2d)

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

/** סוגי המיטות (הבדיקה במסד: unit_beds.bed_type) */
export const BED_TYPES = [
  "double",
  "queen",
  "king",
  "single",
  "sofa_bed",
  "bunk",
  "crib",
  "mattress",
] as const;
export type BedType = (typeof BED_TYPES)[number];

/** שורת מיטות: סוג, כמה, ובאיזה חדר (לא חובה) */
export interface BedRow {
  bed_type: BedType;
  quantity: number;
  room_label: string | null;
}

/** מתקן שסומן ביחידה / במתחם (מהקטלוג של העסק), עם הערה קצרה */
export interface AmenityLink {
  amenity_id: string;
  note: string | null;
}

/** קבוצות המתקנים (הרשימה במסד: _amenity_categories) */
export const AMENITY_CATEGORIES = [
  "room",
  "kitchen",
  "outdoor",
  "pool_spa",
  "services",
  "accessibility",
  "other",
] as const;
export type AmenityCategory = (typeof AMENITY_CATEGORIES)[number];

/** מתקן בקטלוג של העסק — מהרשימה המוכנה (preset_code) או משלכם */
export interface Amenity {
  id: string;
  name: string;
  icon: string | null;
  /** קבוצה; מתקנים ישנים יכולים להחזיק טקסט חופשי — מוצגים ב"אחר" */
  category: string | null;
  preset_code: string | null;
}

/** פריט ברשימה המוכנה (amenity_presets()) */
export interface AmenityPreset {
  code: string;
  name: string;
  category: AmenityCategory;
  icon: string;
}

export type Parking = "none" | "free" | "paid";
export type ParkingType = "private" | "shared";
export type SmokingRule = "forbidden" | "outside" | "allowed";
export type AllowRule = "no" | "on_request" | "allowed";
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
  separate_toilets: number;
  /** null — רק המקסימום הכולל חל */
  max_adults: number | null;
  max_children: number | null;
  /** מיגרציה 41: גודל במ"ר; null — לא הוזן (חסר — מסד בלי 41) */
  size_sqm?: number | null;
  beds: BedRow[];
  amenities: AmenityLink[];
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
  latitude: number | null;
  longitude: number | null;
  parking: Parking | null;
  parking_type: ParkingType | null;
  parking_spaces: number | null;
  parking_fee_note: string | null;
  parking_instructions: string | null;
  guest_info: string | null;
  rules_smoking: SmokingRule | null;
  rules_pets: AllowRule | null;
  rules_pets_note: string | null;
  rules_events: AllowRule | null;
  /** "22:00" */
  quiet_from: string | null;
  quiet_to: string | null;
  rules_custom: string[];
  /** מתקנים משותפים במתחם */
  amenities: AmenityLink[];
  units: CatalogUnit[];
}

export interface CatalogView {
  limits: { max_units: number | null; units_used: number; active: boolean };
  /** פעולות של בעל העסק בלבד (ארכיון, מחיקה) — 2c.3 */
  can_owner: boolean;
  /** שעות הכניסה והיציאה של העסק ("15:00") — מוצגות בכללי המקום */
  check_in_time: string | null;
  check_out_time: string | null;
  /** קטלוג המתקנים של העסק */
  amenities: Amenity[];
  amenity_presets: AmenityPreset[];
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

/** פרטי המתחם (2d): מיקום, חניה, מידע לאורחים, כללי המקום ומתקנים משותפים */
export interface PropertyDetailFields {
  location: { lat: number; lng: number } | null;
  parking: Parking | null;
  parking_type: ParkingType | null;
  parking_spaces: number | null;
  parking_fee_note: string | null;
  parking_instructions: string | null;
  guest_info: string | null;
  rules_smoking: SmokingRule | null;
  rules_pets: AllowRule | null;
  rules_pets_note: string | null;
  rules_events: AllowRule | null;
  quiet_from: string | null;
  quiet_to: string | null;
  rules_custom: string[];
  amenities: AmenityLink[];
}
export type PropertyDetailKey = keyof PropertyDetailFields;
export const PROPERTY_DETAIL_KEYS: readonly PropertyDetailKey[] = [
  "location",
  "parking",
  "parking_type",
  "parking_spaces",
  "parking_fee_note",
  "parking_instructions",
  "guest_info",
  "rules_smoking",
  "rules_pets",
  "rules_pets_note",
  "rules_events",
  "quiet_from",
  "quiet_to",
  "rules_custom",
  "amenities",
];
/** מה נשלח בשמירת המתחם: הפרטים הבסיסיים ו / או פרטי 2d */
export type PropertyChanges = Partial<PropertyFields & PropertyDetailFields>;

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
  separate_toilets: number;
  max_adults: number | null;
  max_children: number | null;
  /** מיגרציה 41: גודל במ"ר (לא חובה) */
  size_sqm: number | null;
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
  "separate_toilets",
  "max_adults",
  "max_children",
  "size_sqm",
];
/** מה נשלח בשמירת היחידה: שדות, ו / או המיטות והמתקנים (כל הרשימה) */
export type UnitChanges = Partial<UnitFields> & { beds?: BedRow[]; amenities?: AmenityLink[] };

/** מידע פרטי להגעה (קודים, Wi-Fi) — לא חלק מ-catalog_view; נקרא ונשמר בנפרד */
export interface ArrivalValues {
  entry_code: string | null;
  gate_code: string | null;
  wifi_name: string | null;
  wifi_password: string | null;
  instructions: string | null;
}
export type ArrivalKey = keyof ArrivalValues;
export const ARRIVAL_KEYS: readonly ArrivalKey[] = [
  "entry_code",
  "gate_code",
  "wifi_name",
  "wifi_password",
  "instructions",
];
export interface ArrivalRecord extends ArrivalValues {
  revision: number;
}
export interface ArrivalInfoView {
  property_id: string;
  can_edit: boolean;
  property: ArrivalRecord | null;
  units: { unit_id: string; name: string; info: ArrivalRecord | null }[];
}
export interface ArrivalSaveInput {
  propertyId: string;
  unitId: string | null;
  values: Partial<ArrivalValues>;
  /** null — עוד לא נשמר מידע */
  revision: number | null;
}
export type ArrivalSaveResult =
  | { status: "saved"; revision: number | null }
  | { status: "conflict"; message: string; view: ArrivalInfoView };

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
