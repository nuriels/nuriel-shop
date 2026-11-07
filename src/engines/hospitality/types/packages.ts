// שלב א' 7 (מיגרציה 59): חבילות אירוח וחבילות מיוחדות — מה שהמסד מחזיר לאתר ולצוות.
// חבילה = יחידה אחת, מספר לילות קבוע, מחיר קבוע לחבילה; ההזמנה עצמה על היחידה (בלי הזמנה כפולה).
import type { PolicySnapshot, Quote } from "./domain";
import type { PublicPolicy } from "./website";

/** package = חבילת אירוח; special = חבילה מיוחדת (חבילת כלה, יום הולדת…) */
export type PackageKind = "package" | "special";

export interface PublicPackage {
  id: string;
  slug: string;
  kind: PackageKind;
  name: string;
  description: string | null;
  /** תנאי החבילה (מה כלול / לא כלול) — האורח מאשר אותם בהזמנה */
  terms: string | null;
  nights: number;
  /** המחיר של כל החבילה (לא ללילה) */
  price: number;
  max_guests: number;
  /** אפשר להזמין לשהייה בתוך התקופה (הגעה מ- / עזיבה עד); null — בלי הגבלה */
  stay_from: string | null;
  stay_to: string | null;
  unit_id: string;
  /** תמונות מהגלריות של האתר (יחידה / מתחם / אתר) — לפי הסדר שנבחר */
  media_ids: string[];
  sort_order: number;
  /** מדיניות ביטול משלה (אחרת — כמו ביחידה) */
  policy: PublicPolicy | null;
}

export interface StaffPackage extends PublicPackage {
  is_active: boolean;
  policy_id: string | null;
  revision: number;
  unit_name: string | null;
  bookings_count: number;
  updated_at: string;
}

export interface PackageUnitOption {
  id: string;
  name: string;
  property_id: string;
  property_name: string;
  capacity: number;
  is_active: boolean;
}

export interface PackagesView {
  packages: StaffPackage[];
  units: PackageUnitOption[];
  policies: { id: string; name: string; is_default: boolean }[];
}

/** פרטי החבילה כפי שהאורח ראה ואישר (בהצעת המחיר, ובהזמנה — package_snapshot) */
export interface PackageSnapshot {
  id: string;
  slug?: string;
  kind: PackageKind;
  name: string;
  nights: number;
  price: number;
  max_guests: number;
  terms: string | null;
}

/** הצעת המחיר לחבילה: כמו הצעה ליחידה, במחיר החבילה ובלי פירוט לילות מהתעריפים */
export interface PackageQuote extends Omit<Quote, "nights" | "promotion_id" | "min_nights"> {
  package: PackageSnapshot;
  policy: PolicySnapshot;
}

export interface PackageInput {
  id: string | null;
  unitId: string;
  kind: PackageKind;
  name: string;
  nights: number;
  price: number;
  maxGuests: number;
  description: string | null;
  terms: string | null;
  stayFrom: string | null;
  stayTo: string | null;
  policyId: string | null;
  mediaIds: string[];
  expectedRevision: number | null;
}
