// לאן "חזרה" ממסך שלא נטען: ממסך פרטים — לרשימה שלו; ממסך רשימה — ללוח הבקרה (טהור, נבדק ביחידה)
export type BackPath = "/manage" | "/manage/bookings" | "/manage/guests" | "/manage/units";

export function backFor(pathname: string): { to: BackPath; label: string } {
  const p = pathname.replace(/\/+$/, "");
  if (/^\/manage\/bookings\/.+/.test(p)) return { to: "/manage/bookings", label: "חזרה להזמנות" };
  if (/^\/manage\/guests\/.+/.test(p)) return { to: "/manage/guests", label: "חזרה לאורחים" };
  if (/^\/manage\/(units|properties)\/.+/.test(p))
    return { to: "/manage/units", label: "חזרה ליחידות ומתחמים" };
  return { to: "/manage", label: "חזרה ללוח הבקרה" };
}
