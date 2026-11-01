// ייבוא יומנים חיצוניים (iCal) בשרת: הורדה רק דרך המוריד של הפלטפורמה — אותה הגנת SSRF כמו ייבוא
// תמונות מקישור ב-2e (https/http בלבד, בלי כתובות פנימיות, הפניות שנבדקות מחדש, עד 10MB ו-12
// שניות), קריאה, והסנכרון התקופתי. הכתיבה עצמה — במסד (_channel_apply): חפיפה לא נכתבת אלא
// נרשמת כהתנגשות. נקרא רק מפונקציות שרת ומה-worker (דרך createServerOnlyFn) — לא מהבאנדל של הדפדפן.
import { serviceHeaders, supabaseUrl } from "@/platform/supabase/env.server";
import { HOSPITALITY_SCHEMA } from "../config";
import { looksLikeIcs, parseIcs, type IcsEvent } from "./ical";

const MAX_PER_TICK = 10;
const TICK_BUDGET_MS = 60_000;

async function serviceRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${supabaseUrl()}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      ...serviceHeaders(),
      "Content-Profile": HOSPITALITY_SCHEMA,
      "Accept-Profile": HOSPITALITY_SCHEMA,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export class CalendarFetchError extends Error {}

/** הורדה וקריאה של יומן חיצוני → האירועים; שגיאה בעברית שאפשר להציג לבעל העסק */
export async function fetchCalendar(url: string): Promise<IcsEvent[]> {
  const { fetchRemoteImage, ImageImportError } =
    await import("@/platform/media/remote-image.server");
  let bytes: Buffer;
  try {
    ({ bytes } = await fetchRemoteImage(url));
  } catch (e) {
    const code = e instanceof ImageImportError ? e.code : undefined;
    throw new CalendarFetchError(
      code === "invalid_url" || code === "redirects"
        ? "הקישור ליומן לא תקין או לא מותר"
        : code === "http_error"
          ? "האתר של היומן החזיר שגיאה — בדקו שהקישור עדיין בתוקף"
          : code === "empty"
            ? "היומן בקישור ריק"
            : code === "too_large"
              ? "היומן גדול מדי (מעל 10MB)"
              : code === "timeout"
                ? "האתר של היומן לא הגיב בזמן"
                : code === "not_image"
                  ? "הקישור מוביל לדף אינטרנט ולא לקובץ יומן (iCal)"
                  : "הורדת היומן נכשלה — בדקו את הקישור",
    );
  }
  const text = bytes.toString("utf8");
  if (!looksLikeIcs(text)) throw new CalendarFetchError("הקישור לא מוביל לקובץ יומן (iCal)");
  return parseIcs(text);
}

/** הסנכרון התקופתי: היומנים שהגיע זמנם (עד 10 בסבב, עד דקה) */
export async function runDueChannelSyncs(): Promise<void> {
  const started = Date.now();
  const due = await serviceRpc<{ id: string; tenant_id: string; url: string }[]>(
    "channel_calendars_due",
    { _limit: MAX_PER_TICK },
  );
  for (const c of due ?? []) {
    if (Date.now() - started > TICK_BUDGET_MS) break;
    let events: IcsEvent[] | null = null;
    let error: string | null = null;
    try {
      events = await fetchCalendar(c.url);
    } catch (e) {
      error = e instanceof CalendarFetchError ? e.message : "הסנכרון נכשל";
    }
    try {
      await serviceRpc("channel_sync_service", {
        _calendar_id: c.id,
        _events: events ?? [],
        _error: error,
      });
    } catch (e) {
      console.error("[hospitality] channel sync failed", c.id, e instanceof Error ? e.message : e);
    }
  }
}
