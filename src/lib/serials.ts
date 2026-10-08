/**
 * חלק 35: מספרים סידוריים ואחריות — עזרים טהורים (דפדפן + שרת + PDF).
 * הבדיקות זהות למסד (serial_normalize / serial_check_format), כדי שהסריקה
 * תציג שגיאה מיד, עוד לפני הקריאה למסד.
 */

/** אותיות באנגלית (גדולות), ספרות ו- . _ / # : - ; עד 64 תווים */
export const SERIAL_PATTERN = /^[A-Z0-9][A-Z0-9._/#:-]{0,63}$/;

/** עד כמה יחידות בקליטה אחת (כמו במסד) */
export const SERIAL_RECEIVE_MAX = 500;

/** סריקה / הקלדה → הצורה שנשמרת: בלי רווחים ותווי בקרה, באותיות גדולות */
export function normalizeSerial(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\s\u0000-\u001f\u007f]/g, "").toUpperCase();
}

/** שגיאה במספר סידורי (null = תקין) */
export function serialProblem(value: string): string | null {
  const serial = normalizeSerial(value);
  if (serial === "") return "נא להזין / לסרוק מספר סידורי";
  if (!SERIAL_PATTERN.test(serial)) {
    return `מספר סידורי לא תקין: "${serial.slice(0, 70)}" (אותיות באנגלית, ספרות ו- . _ / # : - — עד 64 תווים)`;
  }
  return null;
}

/**
 * הדבקה / סריקה של כמה מספרים יחד (שורה לכל אחד, או מופרדים בפסיק / רווח)
 * → רשימה מנוקה, בלי כפילויות, בסדר הסריקה.
 */
export function parseSerialList(text: string): {
  serials: string[];
  duplicates: string[];
  invalid: string[];
} {
  const serials: string[] = [];
  const duplicates: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[\s,;]+/)) {
    const serial = normalizeSerial(raw);
    if (serial === "") continue;
    if (!SERIAL_PATTERN.test(serial)) {
      invalid.push(serial);
      continue;
    }
    if (seen.has(serial)) {
      if (!duplicates.includes(serial)) duplicates.push(serial);
      continue;
    }
    seen.add(serial);
    serials.push(serial);
  }
  return { serials, duplicates, invalid };
}

/** order_items.serial_number ("A1, A2") → ["A1", "A2"] */
export function splitSerials(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((serial) => serial.trim())
    .filter((serial) => serial !== "");
}

/** "2027-10-08" → "08/10/2027" */
export function formatWarrantyDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * השורה ללקוח (אזור אישי, קבלה, מייל):
 * "מספר סידורי: RT-100 | תוקף אחריות עד: 08/10/2027".
 * כמה יחידות: "מספרים סידוריים: RT-100, RT-101 | …". בלי מספר — null.
 */
export function serialLineText(
  serialNumber: string | null | undefined,
  warrantyUntil: string | null | undefined,
): string | null {
  const serials = splitSerials(serialNumber);
  if (serials.length === 0) return null;
  const label = serials.length === 1 ? "מספר סידורי" : "מספרים סידוריים";
  const warranty = formatWarrantyDate(warrantyUntil);
  return warranty
    ? `${label}: ${serials.join(", ")} | תוקף אחריות עד: ${warranty}`
    : `${label}: ${serials.join(", ")}`;
}

/** "12 חודשי אחריות" / "שנה אחריות" / "שנתיים אחריות" / null (בלי) */
export function warrantyLabel(months: number | null | undefined): string | null {
  const value = Math.floor(Number(months) || 0);
  if (value <= 0) return null;
  if (value === 12) return "שנה אחריות";
  if (value === 24) return "שנתיים אחריות";
  if (value % 12 === 0) return `${value / 12} שנות אחריות`;
  if (value === 1) return "חודש אחריות";
  return `${value} חודשי אחריות`;
}

/**
 * תוקף האחריות (זהה ל-serial_warranty_until במסד): יום הרכישה בישראל + חודשים,
 * בתוספת חודשים קלנדרית (31/01 + חודש = 28/02 או 29/02). "YYYY-MM-DD" או null.
 */
export function warrantyUntil(purchasedAt: Date | string, months: number): string | null {
  const value = Math.floor(Number(months) || 0);
  if (value <= 0) return null;
  const date = typeof purchasedAt === "string" ? new Date(purchasedAt) : purchasedAt;
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const year = get("year");
  const month = get("month") - 1 + value;
  const day = get("day");
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = month % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const result = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
  return result.toISOString().slice(0, 10);
}

/** האחריות עדיין בתוקף (כולל היום האחרון) */
export function warrantyActive(
  until: string | null | undefined,
  today: Date = new Date(),
): boolean {
  if (!until) return false;
  const todayIsrael = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(today);
  return until.slice(0, 10) >= todayIsrael;
}

/** כמה מספרים חסרים בשורה (לתג "חסר מספר סידורי 1 מתוך 2") */
export function missingSerials(item: {
  quantity: number;
  serial_number?: string | null;
  serial_required?: boolean | null;
}): number {
  if (!item.serial_required) return 0;
  return Math.max(0, item.quantity - splitSerials(item.serial_number).length);
}

export type SerialProduct = {
  product_id: string;
  name: string;
  sku: string;
  barcode: string | null;
  warranty_months: number;
  stock_quantity: number;
  in_stock_serials: number;
  sold_serials: number;
  missing_serials: number;
};

export type SerialUnit = {
  id: string;
  serial_number: string;
  status: "in_stock" | "sold";
  received_at: string;
  sold_at: string | null;
  warranty_until: string | null;
  order_id: string | null;
  order_number: string | null;
  customer_name: string | null;
};

export type AvailableSerial = { id: string; serial_number: string; received_at: string };

export type AssignedSerial = {
  id: string;
  serial_number: string;
  sold_at: string;
  warranty_until: string | null;
};

export type SerialLookupRow = {
  id: string;
  serial_number: string;
  status: "in_stock" | "sold";
  product_id: string;
  product_name: string;
  product_sku: string;
  received_at: string;
  sold_at: string | null;
  warranty_until: string | null;
  warranty_active: boolean;
  order_id: string | null;
  order_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
};

export type ReceiveMode = "receive" | "existing";

export type ReceiveResult = {
  added: number;
  stock_quantity: number;
  in_stock_serials: number;
  missing_serials: number;
};

/** אירוע בדפדפן: מספרים סידוריים שויכו / נקלטו — לרענון מסכים אחרים */
export const SERIALS_CHANGED = "serials-changed";
