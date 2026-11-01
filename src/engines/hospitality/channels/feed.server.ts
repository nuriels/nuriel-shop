// יומן הייצוא של יחידה (/ical/<token>) — נקרא מהשער של המנוע. בלי הורדות ובלי קוד מתיקיות
// server/ (השער נטען גם בבאנדל של הדפדפן — import protection). לילות תפוסים בלבד, בלי פרטים.
import { serviceHeaders, supabaseUrl } from "@/platform/supabase/env.server";
import { HOSPITALITY_SCHEMA } from "../config";
import { buildIcs } from "./ical";

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

const TOKEN = /^[0-9a-f]{40}$/;

/** הקובץ של יחידה לפי הטוקן; null — טוקן לא מוכר / לא של העסק הזה / המנוע כבוי */
export async function icalFeedResponse(siteId: string, token: string): Promise<Response | null> {
  if (!TOKEN.test(token)) return null;
  // הגבלה משותפת לכל השרתים, לפי הטוקן (Airbnb / Booking.com מושכים כל כמה דקות עד שעה)
  const { checkRate } = await import("../security/rate-limit.server");
  const rate = await checkRate("ical", { token });
  if (!rate.ok)
    return new Response("Too many requests\n", {
      status: 429,
      headers: { "retry-after": String(Math.max(60, rate.retryAfter)), "x-robots-tag": "noindex" },
    });
  const feed = await serviceRpc<{
    unit_name: string;
    events: { uid: string; from: string; to: string }[];
  } | null>("channel_feed", { _tenant_id: siteId, _token: token });
  if (!feed) return null;
  return new Response(buildIcs({ calendarName: feed.unit_name, events: feed.events }), {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
