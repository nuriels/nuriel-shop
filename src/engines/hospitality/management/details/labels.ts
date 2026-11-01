// תוויות בעברית לפרטי היחידה והמתחם (Stage 2d)
import type {
  AllowRule,
  AmenityCategory,
  BedType,
  Parking,
  ParkingType,
  SmokingRule,
} from "../../types/catalog";

export const BED_TYPE_LABELS: Record<BedType, string> = {
  double: "זוגית",
  queen: "קווין",
  king: "קינג",
  single: "יחיד",
  sofa_bed: "ספה נפתחת",
  bunk: "קומותיים",
  crib: "עריסה",
  mattress: "מזרן",
};

export const AMENITY_CATEGORY_LABELS: Record<AmenityCategory, string> = {
  room: "בחדר",
  kitchen: "מטבח",
  outdoor: "בחוץ",
  pool_spa: "בריכה וספא",
  services: "שירותים",
  accessibility: "נגישות",
  other: "אחר",
};

export const PARKING_LABELS: Record<Parking, string> = {
  none: "אין חניה",
  free: "חניה בחינם",
  paid: "חניה בתשלום",
};
export const PARKING_TYPE_LABELS: Record<ParkingType, string> = {
  private: "פרטית",
  shared: "משותפת",
};
export const SMOKING_LABELS: Record<SmokingRule, string> = {
  forbidden: "אסור לעשן",
  outside: "רק בחוץ",
  allowed: "מותר",
};
export const PETS_LABELS: Record<AllowRule, string> = {
  no: "לא",
  on_request: "בתיאום מראש",
  allowed: "מותר",
};
export const EVENTS_LABELS: Record<AllowRule, string> = {
  no: "לא",
  on_request: "בתיאום מראש",
  allowed: "מותר",
};
/** הצעות לשם החדר בשורת מיטות */
export const ROOM_SUGGESTIONS = ["חדר הורים", "חדר ילדים", "סלון", "גלריה"];
