// שלב א' 7: בדיקת הקלט של החבילות — לפני המסד (המסד נשאר הסמכות הסופית). הודעות בעברית.
import type {
  PackageAddonsInput,
  PackageInput,
  PackageKind,
  PackageRoomChoice,
} from "../types/packages";
import {
  InputError,
  intInRange,
  isoDate,
  money,
  oneOf,
  optionalText,
  parseRequestBooking,
  text,
  uuid,
} from "./input";

type Raw = Record<string, unknown> | null | undefined;
const field = (input: Raw, key: string): unknown => (input ?? {})[key];

export const PACKAGE_KINDS = ["package", "special"] as const satisfies readonly PackageKind[];
export const PACKAGE_MAX_NIGHTS = 14;
export const PACKAGE_MAX_PRICE = 1_000_000;
export const PACKAGE_MAX_MEDIA = 12;
export const PACKAGE_TEXT_MAX = 4000;
/** מיגרציה 202: עד 8 יחידות שאפשר להציע כחדר נוסף, מחיר ללילה עד 100,000 */
export const PACKAGE_ADDON_MAX_UNITS = 8;
export const PACKAGE_ADDON_MAX_PRICE = 100_000;

const DAY = 86_400_000;
const days = (a: string, b: string) =>
  (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY;

function optionalDate(value: unknown, what: string): string | null {
  return value === undefined || value === null || value === "" ? null : isoDate(value, what);
}

/** יצירה / עדכון של חבילה (מסך "חבילות" בניהול) */
export function parsePackageSave(input: Raw): PackageInput {
  const id = field(input, "id") ? uuid(field(input, "id"), "החבילה") : null;
  const nights = intInRange(field(input, "nights"), 1, PACKAGE_MAX_NIGHTS, "מספר הלילות");
  const price = money(field(input, "price"), "מחיר החבילה");
  if (price <= 0 || price > PACKAGE_MAX_PRICE) throw new InputError("מחיר החבילה לא תקין");
  const stayFrom = optionalDate(field(input, "stayFrom"), "תחילת התקופה");
  const stayTo = optionalDate(field(input, "stayTo"), "סוף התקופה");
  if (stayFrom && stayTo && days(stayFrom, stayTo) < nights)
    throw new InputError("התקופה של החבילה קצרה ממספר הלילות בה");
  const rawMedia = field(input, "mediaIds");
  const list = Array.isArray(rawMedia) ? rawMedia : [];
  if (list.length > PACKAGE_MAX_MEDIA)
    throw new InputError(`עד ${PACKAGE_MAX_MEDIA} תמונות לחבילה`);
  const mediaIds = list.map((m) => uuid(m, "התמונה"));
  if (new Set(mediaIds).size !== mediaIds.length) throw new InputError("כל תמונה — פעם אחת בחבילה");
  const rev = field(input, "expectedRevision");
  const addons = parsePackageAddons(field(input, "addons"));
  return {
    id,
    unitId: uuid(field(input, "unitId"), "היחידה"),
    kind: oneOf(field(input, "kind"), PACKAGE_KINDS, "סוג החבילה"),
    name: text(field(input, "name"), 80, "שם החבילה", { min: 2 }),
    nights,
    price,
    maxGuests: intInRange(field(input, "maxGuests"), 1, 50, "מספר האורחים"),
    description: optionalText(field(input, "description"), PACKAGE_TEXT_MAX, "התיאור"),
    terms: optionalText(field(input, "terms"), PACKAGE_TEXT_MAX, "התנאים"),
    stayFrom,
    stayTo,
    policyId: field(input, "policyId") ? uuid(field(input, "policyId"), "מדיניות הביטול") : null,
    mediaIds,
    expectedRevision: typeof rev === "number" && Number.isInteger(rev) ? rev : null,
    addons,
  };
}

/**
 * מיגרציה 202: החדרים הנוספים של חבילה. חסר (undefined / null) — בלי שינוי בהם (המסד שומר את הקיים);
 * רשימה ריקה — מבטל אותם. היחידה של החבילה / "כל המתחם" / יחידה של עסק אחר — המסד דוחה.
 */
export function parsePackageAddons(value: unknown): PackageAddonsInput | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value))
    throw new InputError("פרטי החדרים הנוספים לא תקינים");
  const raw = value as Record<string, unknown>;
  const list = raw["unitIds"];
  if (list !== undefined && !Array.isArray(list))
    throw new InputError("פרטי החדרים הנוספים לא תקינים");
  const unitIds = (Array.isArray(list) ? list : []).map((u) => uuid(u, "החדר הנוסף"));
  if (unitIds.length > PACKAGE_ADDON_MAX_UNITS)
    throw new InputError(`אפשר להציע עד ${PACKAGE_ADDON_MAX_UNITS} חדרים נוספים לחבילה`);
  if (new Set(unitIds).size !== unitIds.length)
    throw new InputError("כל חדר נוסף — פעם אחת בחבילה");
  if (unitIds.length === 0) return { unitIds: [], nightlyPrice: null, max: 0 };
  const nightlyPrice = money(raw["nightlyPrice"], "המחיר ללילה לחדר נוסף");
  if (nightlyPrice <= 0 || nightlyPrice > PACKAGE_ADDON_MAX_PRICE)
    throw new InputError("המחיר ללילה לחדר נוסף לא תקין");
  const max = intInRange(raw["max"], 1, unitIds.length, "מספר החדרים הנוספים");
  return { unitIds, nightlyPrice, max };
}

/** מיגרציה 202: החדרים הנוספים שהאורח בחר — 0 עד 8, כל אחד פעם אחת, אורחים לכל חדר */
export function parsePackageRooms(value: unknown): PackageRoomChoice[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > PACKAGE_ADDON_MAX_UNITS)
    throw new InputError("בחירת החדרים הנוספים לא תקינה");
  const rooms = value.map((r) => {
    if (!r || typeof r !== "object") throw new InputError("בחירת החדרים הנוספים לא תקינה");
    const room = r as Record<string, unknown>;
    return {
      unitId: uuid(room["unitId"], "החדר הנוסף"),
      adults: intInRange(room["adults"], 1, 50, "מספר המבוגרים בחדר הנוסף", 2),
      children: intInRange(room["children"], 0, 50, "מספר הילדים בחדר הנוסף", 0),
    };
  });
  if (new Set(rooms.map((r) => r.unitId)).size !== rooms.length)
    throw new InputError("כל חדר נוסף — פעם אחת בבקשה");
  return rooms;
}

/** הפורמט שהמסד מקבל לחדרים הנוספים */
export function roomsArg(rooms: PackageRoomChoice[]) {
  return rooms.map((r) => ({ unit_id: r.unitId, adults: r.adults, children: r.children }));
}

export function parsePackageId(input: Raw): { id: string } {
  return { id: uuid(field(input, "id"), "החבילה") };
}

export function parsePackageActive(input: Raw): { id: string; active: boolean } {
  const active = field(input, "active");
  if (typeof active !== "boolean") throw new InputError("חסר מצב התצוגה");
  return { id: uuid(field(input, "id"), "החבילה"), active };
}

/** הצעת מחיר לחבילה: החבילה, תאריך ההגעה (העזיבה — לפי מספר הלילות בחבילה), אורחים */
export function parsePackageQuote(input: Raw) {
  return {
    packageId: uuid(field(input, "packageId"), "החבילה"),
    checkIn: isoDate(field(input, "checkIn"), "תאריך ההגעה"),
    adults: intInRange(field(input, "adults"), 1, 50, "מספר המבוגרים", 2),
    children: intInRange(field(input, "children"), 0, 50, "מספר הילדים", 0),
  };
}

/** מיגרציה 202: החדרים הנוספים הפנויים לחבילה בתאריך ההגעה */
export function parsePackageAddonsQuote(input: Raw) {
  return {
    packageId: uuid(field(input, "packageId"), "החבילה"),
    checkIn: isoDate(field(input, "checkIn"), "תאריך ההגעה"),
  };
}

/** מיגרציה 202: הצעה אחת לחבילה + החדרים שנבחרו */
export function parsePackageRoomsQuote(input: Raw) {
  return { ...parsePackageQuote(input), rooms: parsePackageRooms(field(input, "rooms")) };
}

/**
 * בקשת הזמנה לחבילה — אותם פרטי אורח ואותן בדיקות כמו בקשה ליחידה (parseRequestBooking), עם
 * מזהה החבילה במקום היחידה. תאריך העזיבה שהדפדפן שולח לא קובע: המסד מחשב לפי החבילה.
 */
export function parseRequestPackage(input: Raw) {
  const packageId = uuid(field(input, "packageId"), "החבילה");
  const r = parseRequestBooking({ ...(input ?? {}), unitId: packageId, promoCode: null });
  return {
    packageId,
    checkIn: r.checkIn,
    adults: r.adults,
    children: r.children,
    fullName: r.fullName,
    email: r.email,
    phone: r.phone,
    idempotencyKey: r.idempotencyKey,
    policyHash: r.policyHash,
    specialRequests: r.specialRequests,
    marketingConsent: r.marketingConsent,
    language: r.language,
    // מיגרציה 202: חדרים נוספים (ריק — הבקשה הרגילה לחבילה, בלי שינוי)
    rooms: parsePackageRooms(field(input, "rooms")),
  };
}
