// פרטי היחידה והמתחם (Stage 2d): מיטות, מתקנים, חניה, מיקום, מידע לאורחים, כללי המקום,
// מידע פרטי להגעה וקטלוג המתקנים — אותם כללים והודעות כמו הפונקציות במסד (מיגרציה 11;
// המסד נשאר הסמכות הסופית). משמש את הטפסים ואת פונקציות השרת.
import {
  AMENITY_CATEGORIES,
  ARRIVAL_KEYS,
  BED_TYPES,
  type AmenityCategory,
  type AmenityLink,
  type ArrivalKey,
  type ArrivalSaveInput,
  type ArrivalValues,
  type BedRow,
  type PropertyDetailFields,
  type PropertyDetailKey,
} from "../types/catalog";
import { InputError, uuid } from "./input";

export const MAX_BED_ROWS = 30;
export const MAX_AMENITIES = 80;
export const MAX_RULES = 20;
export const RULE_MAX = 200;
export const NOTE_MAX = 120;

/** האייקונים שאפשר לבחור למתקן משלכם — אותה רשימה במסד (_amenity_icons) */
export const AMENITY_ICONS = [
  "wifi",
  "air-vent",
  "tv",
  "cooking-pot",
  "refrigerator",
  "microwave",
  "coffee",
  "fence",
  "trees",
  "mountain",
  "flame",
  "waves",
  "bath",
  "croissant",
  "accessibility",
  "sparkles",
  "star",
  "heart",
  "sun",
  "snowflake",
  "baby",
  "paw-print",
  "bike",
  "gamepad-2",
  "book-open",
  "music",
  "washing-machine",
  "utensils",
  "bed-double",
  "sofa",
  "shower-head",
  "flower-2",
  "car-front",
  "dumbbell",
  "check",
] as const;
export type AmenityIcon = (typeof AMENITY_ICONS)[number];

export const PROPERTY_DETAIL_LABELS: Record<PropertyDetailKey, string> = {
  location: "המיקום במפה",
  parking: "חניה",
  parking_type: "סוג החניה",
  parking_spaces: "מספר מקומות החניה",
  parking_fee_note: "מחיר החניה",
  parking_instructions: "הוראות החניה",
  guest_info: "מידע שימושי לאורחים",
  rules_smoking: "עישון",
  rules_pets: "בעלי חיים",
  rules_pets_note: "התנאים לבעלי חיים",
  rules_events: "מסיבות ואירועים",
  quiet_from: "שעות שקט — מ",
  quiet_to: "שעות שקט — עד",
  rules_custom: "כללים משלכם",
  amenities: "מתקנים במתחם",
};

export const ARRIVAL_LABELS: Record<ArrivalKey, string> = {
  entry_code: "קוד הכניסה",
  gate_code: "קוד השער",
  wifi_name: "שם רשת ה-Wi-Fi",
  wifi_password: "סיסמת ה-Wi-Fi",
  instructions: "הוראות הגעה",
};
const ARRIVAL_MAX: Record<ArrivalKey, number> = {
  entry_code: 60,
  gate_code: 60,
  wifi_name: 60,
  wifi_password: 100,
  instructions: 2000,
};

const isText = (v: unknown): v is string => typeof v === "string";
const textOrNull = (v: unknown): string | null => (isText(v) && v.trim() !== "" ? v.trim() : null);
const tooLong = (label: string, max: number) => `${label} ארוך מדי (עד ${max} תווים)`;

// ---------- מיטות ----------

/** השגיאה הראשונה ברשימת המיטות, או null */
export function bedsError(rows: unknown): string | null {
  if (!Array.isArray(rows)) return "מיטות — ערך לא תקין";
  if (rows.length > MAX_BED_ROWS) return `אפשר להגדיר עד ${MAX_BED_ROWS} שורות מיטות ביחידה`;
  for (const [i, r] of rows.entries()) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return `מיטות — שורה ${i + 1} לא תקינה`;
    const row = r as Record<string, unknown>;
    if (Object.keys(row).some((k) => !["bed_type", "quantity", "room_label"].includes(k)))
      return `מיטות — שורה ${i + 1} לא תקינה`;
    if (!(BED_TYPES as readonly unknown[]).includes(row["bed_type"]))
      return "סוג המיטה — יש לבחור מהרשימה";
    const q = row["quantity"];
    if (typeof q !== "number" || !Number.isInteger(q) || q < 1 || q > 20)
      return "מספר המיטות בשורה חייב להיות מספר שלם בין 1 ל-20";
    const label = row["room_label"];
    if (label !== null && label !== undefined && !isText(label)) return "שם החדר — ערך לא תקין";
    if (isText(label) && label.trim().length > 60) return tooLong("שם החדר", 60);
  }
  return null;
}

export function cleanBeds(rows: unknown): BedRow[] {
  const e = bedsError(rows);
  if (e) throw new InputError(e);
  return (rows as Record<string, unknown>[]).map((r) => ({
    bed_type: r["bed_type"] as BedRow["bed_type"],
    quantity: r["quantity"] as number,
    room_label: textOrNull(r["room_label"]),
  }));
}

/** כמה אנשים ישנים במיטות (עריסה — תינוק, לא נספרת) */
export const BED_SLEEPS: Record<BedRow["bed_type"], number> = {
  double: 2,
  queen: 2,
  king: 2,
  single: 1,
  sofa_bed: 2,
  bunk: 2,
  crib: 0,
  mattress: 1,
};
export const sleepsIn = (rows: readonly BedRow[]) =>
  rows.reduce((n, r) => n + BED_SLEEPS[r.bed_type] * r.quantity, 0);

// ---------- מתקנים ----------

export function amenitiesError(items: unknown): string | null {
  if (!Array.isArray(items)) return "מתקנים — ערך לא תקין";
  if (items.length > MAX_AMENITIES) return `אפשר לסמן עד ${MAX_AMENITIES} מתקנים`;
  const seen = new Set<string>();
  for (const it of items) {
    if (!it || typeof it !== "object" || Array.isArray(it)) return "מתקנים — ערך לא תקין";
    const row = it as Record<string, unknown>;
    if (Object.keys(row).some((k) => k !== "amenity_id" && k !== "note"))
      return "מתקנים — ערך לא תקין";
    const id = row["amenity_id"];
    if (!isText(id) || !/^[0-9a-f-]{36}$/i.test(id)) return "מתקנים — ערך לא תקין";
    if (seen.has(id)) return "אותו מתקן סומן פעמיים";
    seen.add(id);
    const note = row["note"];
    if (note !== null && note !== undefined && !isText(note)) return "הערה למתקן — ערך לא תקין";
    if (isText(note) && note.trim().length > NOTE_MAX) return tooLong("הערה למתקן", NOTE_MAX);
  }
  return null;
}

export function cleanAmenities(items: unknown): AmenityLink[] {
  const e = amenitiesError(items);
  if (e) throw new InputError(e);
  return (items as Record<string, unknown>[]).map((r) => ({
    amenity_id: r["amenity_id"] as string,
    note: textOrNull(r["note"]),
  }));
}

/** מתקן משלכם: שם (עד 60), קבוצה ואייקון מהרשימות הקבועות */
export function amenityError(
  name: unknown,
  category: unknown,
  icon: unknown,
  partial = false,
): string | null {
  if (!partial || name !== undefined) {
    if (!isText(name) || name.trim() === "") return "יש למלא את שם המתקן";
    if (name.trim().length > 60) return tooLong("שם המתקן", 60);
  }
  if (category !== undefined && !(AMENITY_CATEGORIES as readonly unknown[]).includes(category))
    return "קבוצה — יש לבחור מהרשימה";
  if (icon !== undefined && !(AMENITY_ICONS as readonly unknown[]).includes(icon))
    return "אייקון — יש לבחור מהרשימה";
  return null;
}

// ---------- המתחם ----------

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const DETAIL_TEXT_MAX: Partial<Record<PropertyDetailKey, number>> = {
  parking_fee_note: 120,
  parking_instructions: 1000,
  guest_info: 4000,
  rules_pets_note: 300,
};
const CHOICES: Partial<Record<PropertyDetailKey, readonly string[]>> = {
  parking: ["none", "free", "paid"],
  parking_type: ["private", "shared"],
  rules_smoking: ["forbidden", "outside", "allowed"],
  rules_pets: ["no", "on_request", "allowed"],
  rules_events: ["no", "on_request", "allowed"],
};

/** שגיאה לשדה אחד של פרטי המתחם (בלי הקשר לשדות אחרים), או null */
export function propertyDetailError(key: PropertyDetailKey, value: unknown): string | null {
  const label = PROPERTY_DETAIL_LABELS[key];
  switch (key) {
    case "location": {
      if (value === null) return null;
      const v = value as Record<string, unknown> | undefined;
      if (
        !v ||
        typeof v !== "object" ||
        typeof v["lat"] !== "number" ||
        typeof v["lng"] !== "number"
      )
        return "המיקום — יש להדביק קישור למפה או לכתוב קואורדינטות";
      if (Math.abs(v["lat"]) > 90 || Math.abs(v["lng"]) > 180)
        return "המיקום — קואורדינטות מחוץ לטווח";
      return null;
    }
    case "parking_spaces":
      if (value === null) return null;
      return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 500
        ? null
        : `${label} חייב להיות מספר שלם בין 0 ל-500`;
    case "quiet_from":
    case "quiet_to":
      return value === null || (isText(value) && TIME.test(value))
        ? null
        : `${label} — יש לכתוב שעה בצורה 22:00`;
    case "rules_custom": {
      if (!Array.isArray(value) || value.some((x) => !isText(x))) return `${label} — ערך לא תקין`;
      const items = (value as string[]).filter((x) => x.trim() !== "");
      if (items.length > MAX_RULES) return `אפשר לכתוב עד ${MAX_RULES} כללים משלכם`;
      if (items.some((x) => x.trim().length > RULE_MAX)) return `כל כלל — עד ${RULE_MAX} תווים`;
      return null;
    }
    case "amenities":
      return amenitiesError(value);
    default: {
      const choices = CHOICES[key];
      if (choices)
        return value === null || choices.includes(value as string)
          ? null
          : `${label} — יש לבחור מהרשימה`;
      const max = DETAIL_TEXT_MAX[key]!;
      if (value !== null && !isText(value)) return `${label} — ערך לא תקין`;
      return isText(value) && value.trim().length > max ? tooLong(label, max) : null;
    }
  }
}

/** הכללים שבין השדות (כמו המסד): חניה בחינם / בתשלום — פרטית או משותפת; שעות שקט — שתיהן */
export function propertyDetailCrossErrors(
  f: Pick<PropertyDetailFields, "parking" | "parking_type" | "quiet_from" | "quiet_to">,
): Partial<Record<PropertyDetailKey, string>> {
  const out: Partial<Record<PropertyDetailKey, string>> = {};
  if ((f.parking === "free" || f.parking === "paid") && !f.parking_type)
    out.parking_type = "סוג החניה — יש לבחור פרטית או משותפת";
  if ((f.quiet_from === null) !== (f.quiet_to === null))
    out[f.quiet_from === null ? "quiet_from" : "quiet_to"] =
      "שעות שקט — יש למלא מתי מתחילות ומתי נגמרות";
  return out;
}

/** ניקוי ובדיקה של שדה פרטי מתחם שהגיע מהדפדפן (השרת) */
export function cleanPropertyDetail(key: PropertyDetailKey, raw: unknown): unknown {
  let value: unknown = raw === undefined ? null : raw;
  if (key === "rules_custom" && Array.isArray(raw))
    value = raw.map((x) => (isText(x) ? x.trim() : x)).filter((x) => x !== "");
  else if (key === "amenities") value = raw;
  else if (key in DETAIL_TEXT_MAX)
    value = textOrNull(raw) ?? (isText(raw) || raw == null ? null : raw);
  const e = propertyDetailError(key, value);
  if (e) throw new InputError(e);
  return key === "amenities" ? cleanAmenities(value) : value;
}

// ---------- מיקום מקישור למפה ----------

const num = (s: string | undefined) => (s === undefined ? Number.NaN : Number(s));
const valid = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
const COORD = String.raw`(-?\d{1,3}(?:\.\d+)?)`;

export type MapParse =
  | { ok: true; lat: number; lng: number }
  | { ok: false; reason: "empty" | "short_link" | "invalid" };

/**
 * קישור למפה או קואורדינטות → {lat, lng}. בדפדפן בלבד, בלי שום בקשה לרשת (גם לא
 * לקישור עצמו): Google Maps ("@32.1,35.2", "?q=32.1,35.2", "!3d32.1!4d35.2"), Waze
 * ("ll=32.1,35.2" / "ll=32.1%2C35.2"), OpenStreetMap ("mlat=…&mlon=…" או "#map=z/lat/lng"),
 * "geo:32.1,35.2" וקואורדינטות פשוטות "32.1, 35.2". קישור מקוצר (goo.gl / maps.app.goo.gl
 * / waze.com/ul/h…) — אי אפשר בלי לפתוח אותו: מבקשים להעתיק את הקואורדינטות.
 */
export function parseMapLocation(input: string): MapParse {
  const text = input.trim();
  if (text === "") return { ok: false, reason: "empty" };
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    /* נשאר כמו שהוא */
  }
  const tries: RegExp[] = [
    new RegExp(String.raw`!3d${COORD}!4d${COORD}`), // Google: מיקום הסיכה המדויק
    new RegExp(String.raw`@${COORD},\s*${COORD}`), // Google: מרכז המפה
    new RegExp(String.raw`[?&](?:q|query|ll|center|daddr|destination)=${COORD},\s*${COORD}`),
    new RegExp(String.raw`^geo:${COORD},\s*${COORD}`, "i"),
    new RegExp(String.raw`#map=\d{1,2}/${COORD}/${COORD}`), // OpenStreetMap
    new RegExp(String.raw`^${COORD}\s*[,\s]\s*${COORD}$`), // "32.1, 35.2"
  ];
  for (const re of tries) {
    const m = decoded.match(re);
    if (m) {
      const lat = num(m[1]);
      const lng = num(m[2]);
      if (valid(lat, lng)) return { ok: true, lat: round6(lat), lng: round6(lng) };
      return { ok: false, reason: "invalid" };
    }
  }
  const osm = decoded.match(new RegExp(String.raw`[?&]mlat=${COORD}&mlon=${COORD}`));
  if (osm) {
    const lat = num(osm[1]);
    const lng = num(osm[2]);
    if (valid(lat, lng)) return { ok: true, lat: round6(lat), lng: round6(lng) };
  }
  if (/^(https?:\/\/)?(goo\.gl|maps\.app\.goo\.gl|waze\.com\/ul\/h|bit\.ly)/i.test(text))
    return { ok: false, reason: "short_link" };
  return { ok: false, reason: "invalid" };
}
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export const MAP_PARSE_MESSAGES: Record<"short_link" | "invalid", string> = {
  short_link:
    "זה קישור מקוצר — פתחו אותו, ובמפה לחצו לחיצה ארוכה על המקום והעתיקו את הקואורדינטות (למשל 32.79, 35.53).",
  invalid:
    "לא הצלחנו לקרוא מיקום מהקישור. אפשר להדביק קישור מ-Google Maps / Waze, או לכתוב קואורדינטות.",
};

export const googleMapsLink = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
export const wazeLink = (lat: number, lng: number) =>
  `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;

// ---------- מידע פרטי להגעה ----------

export function arrivalError(key: ArrivalKey, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (!isText(value)) return `${ARRIVAL_LABELS[key]} — ערך לא תקין`;
  return value.trim().length > ARRIVAL_MAX[key]
    ? tooLong(ARRIVAL_LABELS[key], ARRIVAL_MAX[key])
    : null;
}

type Raw = Record<string, unknown> | null | undefined;

export function parseArrivalSave(input: Raw): ArrivalSaveInput {
  const i = input ?? {};
  const raw = i["values"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new InputError("חסרים הפרטים לשמירה");
  const values: Partial<ArrivalValues> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(ARRIVAL_KEYS as readonly string[]).includes(k))
      throw new InputError(`שדה לא מוכר: ${k.slice(0, 40)}`);
    const e = arrivalError(k as ArrivalKey, v);
    if (e) throw new InputError(e);
    values[k as ArrivalKey] = textOrNull(v);
  }
  const rev = i["revision"];
  if (rev !== null && (typeof rev !== "number" || !Number.isInteger(rev) || rev < 1))
    throw new InputError("הגרסה לא תקינה");
  const unit = i["unitId"];
  return {
    propertyId: uuid(i["propertyId"], "המתחם"),
    unitId: unit === null || unit === undefined ? null : uuid(unit, "היחידה"),
    values,
    revision: rev as number | null,
  };
}

export function parseAmenityCreate(input: Raw): {
  name: string;
  category: AmenityCategory;
  icon: AmenityIcon;
} {
  const i = input ?? {};
  const e = amenityError(i["name"], i["category"], i["icon"]);
  if (e) throw new InputError(e);
  return {
    name: (i["name"] as string).trim(),
    category: i["category"] as AmenityCategory,
    icon: i["icon"] as AmenityIcon,
  };
}

export function parseAmenityUpdate(input: Raw): {
  id: string;
  data: { name?: string; category?: AmenityCategory; icon?: AmenityIcon };
} {
  const i = input ?? {};
  const e = amenityError(i["name"], i["category"], i["icon"], true);
  if (e) throw new InputError(e);
  const data: { name?: string; category?: AmenityCategory; icon?: AmenityIcon } = {};
  if (i["name"] !== undefined) data.name = (i["name"] as string).trim();
  if (i["category"] !== undefined) data.category = i["category"] as AmenityCategory;
  if (i["icon"] !== undefined) data.icon = i["icon"] as AmenityIcon;
  if (Object.keys(data).length === 0) throw new InputError("אין שינויים לשמירה");
  return { id: uuid(i["id"], "המתקן"), data };
}

export function parsePresetCode(input: Raw): { code: string } {
  const code = (input ?? {})["code"];
  if (!isText(code) || !/^[a-z][a-z_]{1,29}$/.test(code)) throw new InputError("המתקן לא ברשימה");
  return { code };
}
