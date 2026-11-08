// לאן "חזרה" ממסך שלא נטען: ממסך פרטים — לרשימה שלו; ממסך רשימה — ללוח הבקרה (טהור, נבדק ביחידה)
export type BackPath =
  | "/manage"
  | "/manage/bookings"
  | "/manage/guests"
  | "/manage/units"
  | "/manage/events"
  | "/manage/client-documents";

export function backFor(pathname: string): { to: BackPath; label: string } {
  const p = pathname.replace(/\/+$/, "");
  if (/^\/manage\/bookings\/.+/.test(p)) return { to: "/manage/bookings", label: "חזרה להזמנות" };
  if (/^\/manage\/guests\/.+/.test(p)) return { to: "/manage/guests", label: "חזרה לאורחים" };
  if (/^\/manage\/events\/.+/.test(p)) return { to: "/manage/events", label: "חזרה לאירועים" };
  if (/^\/manage\/client-documents\/.+/.test(p))
    return { to: "/manage/client-documents", label: "חזרה למסמכי לקוחות" };
  if (/^\/manage\/(units|properties)\/.+/.test(p))
    return { to: "/manage/units", label: "חזרה ליחידות ומתחמים" };
  return { to: "/manage", label: "חזרה ללוח הבקרה" };
}
