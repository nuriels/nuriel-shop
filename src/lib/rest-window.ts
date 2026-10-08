/**
 * חלק 35: שמירת שבת וחג אוטומטית — עזרים טהורים (דפדפן + שרת).
 *
 * זהה ל-store_rest_state במסד (מיגרציה 20261019410000): הכל לפי שעון ישראל
 * (Asia/Jerusalem), גם כשהדפדפן / השרת באזור זמן אחר.
 *   • שבת: מיום שישי בשעת הכניסה (למשל 16:00) עד מוצאי שבת בשעת היציאה (20:30).
 *   • חגים: רשימה של התחלה וסיום ("YYYY-MM-DDTHH:MM", שעון ישראל).
 *   • שבת שנצמדת לחג — האתר חוזר לפעילות רק בסוף שניהם.
 * בתוך החלון: הגלישה והאזור האישי פתוחים; אין הוספה לסל ואין קופה. המסד אוכף
 * את זה בכל מקרה (הזמנה חדשה מהאתר נחסמת) — כאן זה בשביל המסך.
 *
 * זמנים "מקומיים" מיוצגים כמספר: Date.UTC של השעה בישראל (בלי אזור זמן) —
 * כך החישוב פשוט ואחיד, והתצוגה פשוט מציגה את השעה כמו שהיא.
 */

export const REST_TIME_ZONE = "Asia/Jerusalem";

/** ההודעה בקופה ובמסד — אותו נוסח */
export const REST_CHECKOUT_MESSAGE = "האתר שומר שבת/חג ויחזור לפעילות בצאת השבת/חג";

export type Holiday = {
  name: string | null;
  /** "YYYY-MM-DDTHH:MM" שעון ישראל */
  start: string;
  end: string;
};

export type RestSettings = {
  enabled: boolean;
  /** "HH:MM" — כניסת שבת ביום שישי */
  startTime: string;
  /** "HH:MM" — צאת שבת במוצאי שבת */
  endTime: string;
  holidays: Holiday[];
};

export type RestKind = "shabbat" | "holiday";

export type RestState =
  | {
      closed: true;
      kind: RestKind;
      name: string | null;
      /** מתי האתר חוזר לפעילות (שעון ישראל, "מקומי") */
      reopensAt: number;
    }
  | {
      closed: false;
      /** הסגירה הקרובה בשבוע הקרוב (או null) */
      nextCloseAt: number | null;
      nextKind: RestKind | null;
      nextName: string | null;
    };

export const DEFAULT_REST_SETTINGS: RestSettings = {
  enabled: false,
  startTime: "16:00",
  endTime: "20:30",
  holidays: [],
};

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

/** "16:00" / "16:00:00" → דקות מתחילת היום (null אם לא תקין) */
export function timeToMinutes(value: string | null | undefined): number | null {
  const match = TIME_PATTERN.exec((value ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** "16:00:00" (מהמסד) → "16:00" */
export function shortTime(value: string | null | undefined, fallback: string): string {
  const minutes = timeToMinutes(value);
  if (minutes === null) return fallback;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "2026-10-13T17:00" → זמן מקומי (null אם לא תקין / תאריך לא קיים) */
export function parseLocal(value: string | null | undefined): number | null {
  const match = LOCAL_PATTERN.exec((value ?? "").trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return null;
  const ms = Date.UTC(year, month - 1, day, hour, minute);
  // 30/02 → 02/03: תאריך שלא קיים
  if (new Date(ms).getUTCDate() !== day) return null;
  return ms;
}

/** זמן מקומי → "2026-10-13T17:00" */
export function formatLocalValue(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

const israelFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: REST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** רגע אמיתי → השעה בישראל באותו רגע (כזמן "מקומי") */
export function israelLocal(at: Date): number {
  const parts: Record<string, number> = {};
  for (const part of israelFormatter.formatToParts(at)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return Date.UTC(
    parts["year"] ?? 1970,
    (parts["month"] ?? 1) - 1,
    parts["day"] ?? 1,
    (parts["hour"] ?? 0) % 24,
    parts["minute"] ?? 0,
  );
}

/** הגדרות החנות מהשורה של site_settings */
export function restSettingsFrom(
  row:
    | {
        shabbat_auto_enabled?: boolean | null;
        shabbat_start_time?: string | null;
        shabbat_end_time?: string | null;
        holidays?: unknown;
      }
    | null
    | undefined,
): RestSettings {
  if (!row) return DEFAULT_REST_SETTINGS;
  return {
    enabled: row.shabbat_auto_enabled === true,
    startTime: shortTime(row.shabbat_start_time, DEFAULT_REST_SETTINGS.startTime),
    endTime: shortTime(row.shabbat_end_time, DEFAULT_REST_SETTINGS.endTime),
    holidays: parseHolidays(row.holidays),
  };
}

/** רשימת החגים מה-JSON (רשומות לא תקינות — מדולגות) */
export function parseHolidays(raw: unknown): Holiday[] {
  if (!Array.isArray(raw)) return [];
  const list: Holiday[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const start = typeof record["start"] === "string" ? record["start"] : "";
    const end = typeof record["end"] === "string" ? record["end"] : "";
    if (parseLocal(start) === null || parseLocal(end) === null) continue;
    const name = typeof record["name"] === "string" ? record["name"].trim() || null : null;
    list.push({ name, start, end });
  }
  return list;
}

type RestWindow = { start: number; end: number; kind: RestKind; name: string | null };

/** חלונות המנוחה שחופפים לטווח (זהה ל-store_rest_windows) */
export function restWindows(settings: RestSettings, from: number, to: number): RestWindow[] {
  if (!settings.enabled) return [];
  const windows: RestWindow[] = [];
  const startMinutes = timeToMinutes(settings.startTime);
  const endMinutes = timeToMinutes(settings.endTime);
  if (startMinutes !== null && endMinutes !== null) {
    const firstDay = Math.floor(from / DAY) * DAY - 8 * DAY;
    for (let day = firstDay; day <= to + DAY; day += DAY) {
      if (new Date(day).getUTCDay() !== 5) continue;
      const start = day + startMinutes * MINUTE;
      const end = day + DAY + endMinutes * MINUTE;
      if (start < to && end > from) windows.push({ start, end, kind: "shabbat", name: null });
    }
  }
  for (const holiday of settings.holidays) {
    const start = parseLocal(holiday.start);
    const end = parseLocal(holiday.end);
    if (start === null || end === null || end <= start) continue;
    if (start < to && end > from) windows.push({ start, end, kind: "holiday", name: holiday.name });
  }
  return windows;
}

/** האם החנות בשבת / חג ברגע `at` (ברירת מחדל: עכשיו) */
export function computeRestState(settings: RestSettings, at: Date = new Date()): RestState {
  const now = israelLocal(at);
  const around = restWindows(settings, now - 9 * DAY, now + 9 * DAY);
  const current = around
    .filter((w) => w.start <= now && w.end > now)
    .sort((a, b) => (a.kind !== b.kind ? (a.kind === "holiday" ? -1 : 1) : b.end - a.end))[0];
  if (!current) {
    const next = restWindows(settings, now, now + 8 * DAY)
      .filter((w) => w.start > now)
      .sort((a, b) => a.start - b.start)[0];
    return {
      closed: false,
      nextCloseAt: next?.start ?? null,
      nextKind: next?.kind ?? null,
      nextName: next?.name ?? null,
    };
  }
  let reopensAt = current.end;
  for (let i = 0; i < 20; i += 1) {
    const chained = restWindows(settings, reopensAt - 9 * DAY, reopensAt + 9 * DAY)
      .filter((w) => w.start <= reopensAt && w.end > reopensAt)
      .sort((a, b) => b.end - a.end)[0];
    if (!chained) break;
    reopensAt = chained.end;
  }
  return { closed: true, kind: current.kind, name: current.name, reopensAt };
}

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/** "20:30" */
export function formatLocalTime(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

/** "11/10" */
export function formatLocalDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCDate()}/${date.getUTCMonth() + 1}`;
}

/** "יום ראשון 11/10" */
export function formatLocalDay(ms: number): string {
  return `יום ${WEEKDAYS[new Date(ms).getUTCDay()]} ${formatLocalDate(ms)}`;
}

/** הכותרת במסך / בפס: "שבת שלום" / "חג שמח" */
export function restGreeting(state: Extract<RestState, { closed: true }>): string {
  return state.kind === "shabbat" ? "שבת שלום" : "חג שמח";
}

/**
 * מתי חוזרים: "במוצאי שבת בשעה 20:30" (כשהפתיחה במוצאי השבת הזו),
 * אחרת "ביום ראשון 11/10 בשעה 20:00".
 */
export function reopenText(state: Extract<RestState, { closed: true }>): string {
  const reopen = new Date(state.reopensAt);
  if (state.kind === "shabbat" && reopen.getUTCDay() === 6) {
    return `במוצאי שבת בשעה ${formatLocalTime(state.reopensAt)}`;
  }
  return `ב${formatLocalDay(state.reopensAt)} בשעה ${formatLocalTime(state.reopensAt)}`;
}

/**
 * פס אזהרה לפני הסגירה (עד `withinMinutes` לפני): "האתר ייסגר היום ב-16:00
 * לקראת שבת". null — כשאין סגירה קרובה.
 */
export function closingSoonText(
  state: RestState,
  at: Date = new Date(),
  withinMinutes = 180,
): string | null {
  if (state.closed || state.nextCloseAt === null) return null;
  const now = israelLocal(at);
  if (state.nextCloseAt - now > withinMinutes * MINUTE) return null;
  const reason =
    state.nextKind === "holiday"
      ? state.nextName
        ? `לקראת ${state.nextName}`
        : "לקראת החג"
      : "לקראת שבת";
  return `האתר ייסגר להזמנות היום ב-${formatLocalTime(state.nextCloseAt)} ${reason} — אפשר להשלים הזמנה עד אז`;
}

// ------------------------------------------------------------
// חגי ישראל (ימים טובים) — לפי הלוח העברי של הדפדפן (Intl, calendar: hebrew)
// ------------------------------------------------------------

type YomTov = { name: string; month: string; day: number; days: number };

/** ימים טובים בארץ: ערב החג בשעת הכניסה → היום האחרון בשעת היציאה */
const YAMIM_TOVIM: YomTov[] = [
  { name: "ראש השנה", month: "Tishri", day: 1, days: 2 },
  { name: "יום כיפור", month: "Tishri", day: 10, days: 1 },
  { name: "סוכות", month: "Tishri", day: 15, days: 1 },
  { name: "שמחת תורה", month: "Tishri", day: 22, days: 1 },
  { name: "פסח", month: "Nisan", day: 15, days: 1 },
  { name: "שביעי של פסח", month: "Nisan", day: 21, days: 1 },
  { name: "שבועות", month: "Sivan", day: 6, days: 1 },
];

let hebrewFormatter: Intl.DateTimeFormat | null | undefined;

function hebrewDateOf(dayMs: number): { month: string; day: number } | null {
  if (hebrewFormatter === undefined) {
    try {
      hebrewFormatter = new Intl.DateTimeFormat("en-u-ca-hebrew", {
        timeZone: "UTC",
        month: "long",
        day: "numeric",
      });
    } catch {
      hebrewFormatter = null;
    }
  }
  if (!hebrewFormatter) return null;
  let month = "";
  let day = 0;
  for (const part of hebrewFormatter.formatToParts(new Date(dayMs + 12 * 60 * MINUTE))) {
    if (part.type === "month") month = part.value;
    if (part.type === "day") day = Number(part.value);
  }
  return month && day ? { month, day } : null;
}

/**
 * החגים של השנה הקרובה (מהיום ועד `days` ימים קדימה), עם שעות הכניסה
 * והיציאה של החנות. חג שכבר ברשימה (אותה התחלה) — לא חוזר.
 */
export function upcomingYamimTovim(
  settings: Pick<RestSettings, "startTime" | "endTime" | "holidays">,
  from: Date = new Date(),
  days = 380,
): Holiday[] {
  const startMinutes = timeToMinutes(settings.startTime) ?? 16 * 60;
  const endMinutes = timeToMinutes(settings.endTime) ?? 20 * 60 + 30;
  const today = Math.floor(israelLocal(from) / DAY) * DAY;
  const existing = new Set(settings.holidays.map((h) => h.start));
  const found: Holiday[] = [];
  for (let day = today; day <= today + days * DAY; day += DAY) {
    const hebrew = hebrewDateOf(day);
    if (!hebrew) return [];
    const match = YAMIM_TOVIM.find((y) => y.month === hebrew.month && y.day === hebrew.day);
    if (!match) continue;
    const start = day - DAY + startMinutes * MINUTE;
    const end = day + (match.days - 1) * DAY + endMinutes * MINUTE;
    const holiday = {
      name: match.name,
      start: formatLocalValue(start),
      end: formatLocalValue(end),
    };
    // חג שכבר נכנס — לא מציעים (אפשר להוסיף ידנית)
    if (start <= israelLocal(from) || existing.has(holiday.start)) continue;
    found.push(holiday);
  }
  return found;
}

/** בעיות ברשימת החגים לפני שמירה (זהה לבדיקה במסד) */
export function holidayProblem(holiday: Holiday): string | null {
  const start = parseLocal(holiday.start);
  const end = parseLocal(holiday.end);
  const label = holiday.name?.trim() || "ללא שם";
  if (start === null || end === null) return `בחג "${label}": תאריך או שעה לא תקינים`;
  if (end <= start) return `בחג "${label}": שעת הסיום חייבת להיות אחרי שעת הכניסה`;
  if (end - start > 8 * DAY) return `החג "${label}" ארוך מדי (עד 8 ימים ברצף)`;
  if ((holiday.name ?? "").trim().length > 60) return "שם החג: עד 60 תווים";
  return null;
}
