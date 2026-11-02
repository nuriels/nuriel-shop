// האתר הציבורי של העסק (Stage 4) — מה שהאתר מקבל מהשרת (public_site, מיגרציה 19).
// רק מידע ציבורי: בלי פרטי אורחים, קודי כניסה, הערות פנימיות או כללי מחיר.
import type { ArrivalValues } from "./catalog";
import type { GuestBookingView } from "./domain";
import type { GuestPaymentInfo } from "./payment-instructions";
export interface PublicMedia {
  id: string;
  kind: "image" | "video" | "embed";
  alt: string | null;
  width: number | null;
  height: number | null;
  is_cover: boolean;
  /** תמונת הדגמה (מסומנת "להמחשה" באתר) */
  is_demo: boolean;
  embed_provider: "youtube" | "vimeo" | null;
  embed_id: string | null;
  /** הקובץ עצמו (WebP 1600 / סרטון); null בהטמעה */
  url: string | null;
  /** 480w / 960w / 1600w */
  srcset: string | null;
  /** תמונה קטנה (רשימות, תצוגה מקדימה) */
  thumb_url: string | null;
}

export interface PublicAmenity {
  name: string;
  icon: string | null;
  category: string | null;
  note: string | null;
}

export interface PublicBed {
  bed_type: string;
  quantity: number;
  room_label: string | null;
}

export interface PublicRules {
  smoking: string | null;
  pets: string | null;
  pets_note: string | null;
  events: string | null;
  quiet_from: string | null;
  quiet_to: string | null;
  custom: string[] | null;
}

export interface PublicProperty {
  id: string;
  slug: string;
  name: string;
  property_type: string | null;
  description: string | null;
  address: string | null;
  location: { lat: number; lng: number } | null;
  parking: string | null;
  parking_type: string | null;
  parking_spaces: number | null;
  parking_fee_note: string | null;
  parking_instructions: string | null;
  guest_info: string | null;
  rules: PublicRules;
  amenities: PublicAmenity[];
  media: PublicMedia[];
}

export interface PublicUnit {
  id: string;
  slug: string;
  name: string;
  property_id: string;
  /** unit = יחידה אחת; whole_property = כל המתחם (מורכב מיחידות) */
  kind: "unit" | "whole_property";
  unit_type: string | null;
  description: string | null;
  capacity: number;
  base_occupancy: number;
  max_adults: number | null;
  max_children: number | null;
  child_age_limit: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  separate_toilets: number | null;
  /** מיגרציה 41: גודל במ"ר; null / חסר — לא מוצג */
  size_sqm?: number | null;
  /** מחיר בסיס ללילה ("החל מ-"); המחיר הסופי — רק מהצעת המחיר בשרת */
  base_price: number;
  min_nights: number;
  /** מדיניות ביטול משלה (אחרת — של העסק) */
  policy: PublicPolicy | null;
  member_ids: string[] | null;
  seo_title: string | null;
  seo_description: string | null;
  beds: PublicBed[];
  amenities: PublicAmenity[];
  media: PublicMedia[];
}

export interface PublicFeeTier {
  from_days: number;
  fee: "none" | "nights" | "percent_total" | "fixed" | "full";
  value?: number;
}

export interface PublicPolicy {
  name: string;
  free_cancel_days: number | null;
  fee_tiers: PublicFeeTier[] | null;
  no_show_fee: string | null;
  no_show_value: number | null;
  deposit_kind: string | null;
  deposit_value: number | null;
  guest_text: string | null;
}

export interface PublicBusiness {
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  currency: string;
  timezone: string;
  booking_mode: "request" | "instant" | string;
  approval_hours: number;
}

export interface PublicSite {
  business: PublicBusiness;
  /** היום באזור הזמן של העסק (YYYY-MM-DD) */
  today: string;
  /** אפשר לשלוח בקשת הזמנה מהאתר (דגל ההזמנות + מנוי פעיל) */
  booking_open: boolean;
  gallery: PublicMedia[];
  /** הלוגואים של העסק (מיגרציה 42) — לא בגלריה ולא כתמונת הפתיח; נמצאים לפי המזהה שבמסמך העיצוב */
  brand?: PublicMedia[];
  policy: PublicPolicy | null;
  properties: PublicProperty[];
  units: PublicUnit[];
  /** מסמך העיצוב: באתר — הגרסה המפורסמת האחרונה; בתצוגה המקדימה — הטיוטה (null — עוד לא עוצב) */
  design: SiteDesignRecord | null;
  /** סוגי חדרים (מלונות): הסוג נמכר במקום כל חדר; ההזמנה — לחדר פנוי מהסוג */
  room_types: PublicRoomType[];
  /** E5: הכתובת הקנונית של האתר (https://…, בלי / בסוף) — לכתובות הקנוניות ולשיתוף; null — לא ידוע */
  origin?: string | null;
}

export interface PublicRoomType {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  property_id: string;
  sort_order: number;
  revision: number;
  /** החדרים הפעילים של הסוג (באתר); לצוות — כל החדרים */
  room_ids: string[];
}

export interface PublicTypeAvailability {
  category_id: string;
  from: string;
  to: string;
  rooms: number;
  /** לילות שבהם אף חדר מהסוג לא פנוי */
  busy: string[];
}

export interface SiteDesignRecord {
  kind: "draft" | "published";
  version: number;
  revision: number;
  theme: string;
  /** JSON כמחרוזת (נבדק ומתוקן ב-normalizeDesign לפני ההצגה) */
  document: string;
  updated_at: string;
}

export interface PublicAvailability {
  unit_id: string;
  from: string;
  to: string;
  /** לילות תפוסים (YYYY-MM-DD) — בלי מי / למה */
  busy: string[];
}

/** הצורה הגולמית מהמסד (נתיבי אחסון במקום כתובות) */
export type RawPublicMedia = Omit<PublicMedia, "url" | "srcset" | "thumb_url"> & {
  path: string | null;
  variants: Record<string, string> | null;
};

export type RawPublicSite = Omit<
  PublicSite,
  "gallery" | "brand" | "properties" | "units" | "design" | "room_types"
> & {
  design: (Omit<SiteDesignRecord, "document"> & { document: unknown }) | null;
  gallery: RawPublicMedia[];
  brand?: RawPublicMedia[];
  properties: (Omit<PublicProperty, "media"> & { media: RawPublicMedia[] })[];
  units: (Omit<PublicUnit, "media"> & { media: RawPublicMedia[] })[];
};

/** מידע ההגעה לאורח מורשה (guest_arrival_info): רק בהזמנה מאושרת, מ-48 שעות לפני ההגעה ועד היציאה */
export interface GuestArrival {
  available: boolean;
  reason?: "not_confirmed" | "too_early" | "ended";
  available_from?: string;
  available_until?: string;
  property?: ArrivalValues | null;
  units?: { name: string; info: ArrivalValues | null }[];
}

/** עמוד "ההזמנה שלי" (קישור מאובטח) */
export interface SiteGuestBooking {
  booking: GuestBookingView;
  arrival: GuestArrival | null;
  /** מיגרציה 37: הוראות התשלום (לפני המיגרציה / כשהמסד לא ענה — null) */
  payment: GuestPaymentInfo | null;
}
