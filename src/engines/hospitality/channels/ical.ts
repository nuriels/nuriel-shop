// iCal (RFC 5545) — רק מה שצריך לסנכרון זמינות עם Airbnb / Booking.com: קריאת אירועים (UID,
// DTSTART, DTEND) מיומן חיצוני, ובניית יומן הייצוא שלנו (לילות תפוסים בלבד, בלי פרטים אישיים).
// טהור — נבדק ביחידה עם דוגמאות בפורמט של Airbnb ו-Booking.com.

export interface IcsEvent {
  uid: string;
  /** יום ההגעה (YYYY-MM-DD) */
  from: string;
  /** יום העזיבה — לא כולל (YYYY-MM-DD) */
  to: string;
}

const MAX_EVENTS = 2000;

/** "פריסת" שורות מקופלות (שורה שמתחילה ברווח / טאב היא המשך של הקודמת) */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
}

/** "20270210" / "20270210T140000Z" / "2027-02-10" → "2027-02-10" (התאריך כפי שנכתב) */
export function icsDate(value: string): string | null {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(value.trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

const addDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * האירועים ביומן. אירוע בלי UID / בלי תאריך התחלה — מדולג; בלי DTEND — לילה אחד; DTEND לא
 * אחרי DTSTART — מדולג. בלי SUMMARY / DESCRIPTION — לא צריך אותם (ולא שומרים פרטים אישיים).
 */
export function parseIcs(text: string): IcsEvent[] {
  const out: IcsEvent[] = [];
  let cur: { uid?: string; from?: string | null; to?: string | null } | null = null;
  for (const line of unfold(text)) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (upper === "END:VEVENT") {
      if (cur?.uid && cur.from) {
        const to = cur.to && cur.to > cur.from ? cur.to : cur.to ? null : addDay(cur.from);
        if (to) out.push({ uid: cur.uid, from: cur.from, to });
      }
      cur = null;
      if (out.length >= MAX_EVENTS) break;
      continue;
    }
    if (!cur) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon).split(";")[0]!.toUpperCase();
    const value = line.slice(colon + 1).trim();
    if (name === "UID") cur.uid = value.slice(0, 300);
    else if (name === "DTSTART") cur.from = icsDate(value);
    else if (name === "DTEND") cur.to = icsDate(value);
  }
  return out;
}

/** נראה כמו יומן iCal (ולא דף HTML / שגיאה) */
export const looksLikeIcs = (text: string) => /BEGIN:VCALENDAR/i.test(text.slice(0, 2000));

const escapeText = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** קיפול שורה ל-75 בתים (RFC 5545 §3.1) */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = "";
      size = 0;
    }
    cur += ch;
    size += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

/**
 * יומן הייצוא של יחידה: כל טווח תפוס כאירוע של יום שלם, "Not available" — בלי שם האורח, טלפון,
 * אימייל או סיבת החסימה.
 */
export function buildIcs(input: {
  calendarName: string;
  events: { uid: string; from: string; to: string }[];
  now?: Date;
}): string {
  const now = stamp(input.now ?? new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nuriel//Hospitality//HE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(input.calendarName)}`,
  ];
  for (const e of input.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeText(e.uid)}@nuriel-hospitality`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${e.from.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${e.to.replace(/-/g, "")}`,
      "SUMMARY:Not available",
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
