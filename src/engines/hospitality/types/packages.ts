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
  /**
   * מיגרציה 202: חדרים נוספים שאפשר להוסיף לחבילה (באתר — רק יחידות פעילות). null — בלי חדרים נוספים.
   * (חסר לגמרי — מסד בלי מיגרציה 202.)
   */
  addons?: PackageAddons | null;
}

/** מיגרציה 202: חדרים נוספים לחבילה — אילו יחידות, מחיר קבוע ללילה לחדר, וכמה לכל היותר */
export interface PackageAddons {
  unit_ids: string[];
  nightly_price: number;
  max: number;
}

export interface StaffPackage extends PublicPackage {
  is_active: boolean;
  policy_id: string | null;
  revision: number;
  unit_name: string | null;
  /** הזמנות של החבילה עצמה (בלי החדרים הנוספים) */
  bookings_count: number;
  /** מיגרציה 202: הזמנות של חדרים נוספים לחבילה */
  addon_bookings_count?: number;
  updated_at: string;
}

export interface PackageUnitOption {
  id: string;
  name: string;
  property_id: string;
  property_name: string;
  capacity: number;
  is_active: boolean;
  /** מיגרציה 202: "whole_property" ("כל המתחם") — לא מוצע כחדר נוסף */
  kind?: string;
  /** מיגרציה 202: חדר מלון לפי סוג — לא מוצע כחדר נוסף */
  typed?: boolean;
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
  /** מיגרציה 202: "addon" — ההזמנה היא חדר נוסף לחבילה (המחיר — לחדר, לא של החבילה) */
  role?: "addon";
  addon_nightly_price?: number;
}

/** הצעת המחיר לחבילה: כמו הצעה ליחידה, במחיר החבילה ובלי פירוט לילות מהתעריפים */
export interface PackageQuote extends Omit<Quote, "nights" | "promotion_id" | "min_nights"> {
  package: PackageSnapshot;
  policy: PolicySnapshot;
}

/** מיגרציה 202: חדר נוסף פנוי לחבילה בתאריך שנבחר (רק הפנויים) */
export interface PackageAddonUnit {
  unit_id: string;
  unit_name: string;
  capacity: number;
  max_adults: number | null;
  max_children: number | null;
  nightly_price: number;
  /** מחיר ללילה × לילות החבילה */
  total: number;
}

export interface PackageAddonsQuote {
  package_id: string;
  check_in: string;
  check_out: string;
  nights: number;
  currency: string;
  nightly_price: number | null;
  /** כמה חדרים אפשר להוסיף (לא יותר מהפנויים) */
  max: number;
  units: PackageAddonUnit[];
}

/** חדר נוסף בהצעה המשותפת — המחיר והמדיניות מחושבים במסד */
export interface PackageRoomQuote {
  unit_id: string;
  unit_name: string;
  adults: number;
  children: number;
  nights_count: number;
  nightly_price: number;
  total: number;
  deposit_amount: number;
  available: boolean;
  policy: PolicySnapshot;
}

/** הצעה אחת לחבילה + חדרים: מחיר החבילה (total) + החדרים (rooms_total) = grand_total; hash אחד לכל התנאים */
export interface PackageRoomsQuote extends PackageQuote {
  package_available: boolean;
  rooms: PackageRoomQuote[];
  rooms_total: number;
  grand_total: number;
}

/** חדר נוסף שהאורח בחר (לבקשה) */
export interface PackageRoomChoice {
  unitId: string;
  adults: number;
  children: number;
}

export interface PackageAddonsInput {
  unitIds: string[];
  nightlyPrice: number | null;
  max: number;
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
  /** מיגרציה 202: null — בלי שינוי בחדרים הנוספים; unitIds ריק — מבטל אותם */
  addons: PackageAddonsInput | null;
}
