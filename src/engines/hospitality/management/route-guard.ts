// נתיבי אזור הניהול קיימים רק באתר אירוח: בכל אתר אחר (חנות) — "לא נמצא",
// עם עמוד ה-404 הרגיל של האתר (ובשרת: סטטוס 404). רץ גם ב-SSR (ssr: "data-only").
import { notFound } from "@tanstack/react-router";

export function hospitalitySiteOnly({ context }: { context: { hostMode: { siteType: string } } }) {
  if (context.hostMode.siteType !== "hospitality") throw notFound();
}
