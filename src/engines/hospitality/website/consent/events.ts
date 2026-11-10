// אירועי Google Analytics 4 באתר האירוח — השמות, הפרמטרים והכתובת "הנקייה" של העמוד. בלי מידע אישי:
// בלי שם, אימייל, טלפון, מספר הזמנה או קישור אישי. הכתובת — בלי מה שאחרי ה-# (שם יושבים הקישורים
// האישיים: /stay/contract#t=…, /stay/my-booking#t=…, /stay/booking-received#t=…), ומהשאילתה — רק פרמטרי
// קמפיין (utm_*), כדי שהמקור יימדד. טהור — גם לבדיקות היחידה. הנתונים האלה נפרדים לגמרי מנתוני הפעילות
// הפנימיים של המערכת (הזמנות, יומן הפעולות) — הם לא נשלחים לשם, ומשם לא נשלח כלום ל-Google.

export const UTM_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
] as const;

/** https://site/stay/units/x?from=…&utm_source=fb#t=… → https://site/stay/units/x?utm_source=fb */
export function cleanPageLocation(href: string): string {
  try {
    const u = new URL(href);
    const keep = new URLSearchParams();
    for (const k of UTM_PARAMS) {
      const v = u.searchParams.get(k);
      if (v) keep.set(k, v.slice(0, 100));
    }
    const q = keep.toString();
    return `${u.origin}${u.pathname}${q ? `?${q}` : ""}`;
  } catch {
    return "";
  }
}

export type ContactMethod = "phone" | "whatsapp" | "email";

/** איזה קישור קשר: tel: / וואטסאפ / mailto: (אחרת — לא אירוע) */
export function contactMethodOf(href: string | null | undefined): ContactMethod | null {
  const h = (href ?? "").trim().toLowerCase();
  if (!h) return null;
  if (h.startsWith("tel:")) return "phone";
  if (h.startsWith("mailto:")) return "email";
  if (
    h.startsWith("whatsapp:") ||
    /^https?:\/\/(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|web\.whatsapp\.com)(\/|$|\?)/.test(h)
  )
    return "whatsapp";
  return null;
}

/** אירוע נפרד לכל דרך קשר — כך הם מופיעים בדוח האירועים של GA4 בלי הגדרות נוספות */
export const CONTACT_EVENT: Record<ContactMethod, string> = {
  phone: "click_phone",
  whatsapp: "click_whatsapp",
  email: "click_email",
};

export interface GaItem {
  item_id: string;
  item_name: string;
  item_category: string;
  price?: number;
}

/** יחידה / סוג חדר / חבילה — לפי ה-slug והשם הציבורי (מה שמופיע באתר) */
export function siteItem(
  x: { slug: string; name: string },
  category: "unit" | "room_type" | "package",
  price?: number | null,
): GaItem {
  return {
    item_id: x.slug.slice(0, 100),
    item_name: x.name.slice(0, 100),
    item_category: category,
    ...(price !== null && price !== undefined && Number.isFinite(price) ? { price } : {}),
  };
}

/** begin_checkout / generate_lead: הפריטים, הסכום והמטבע — בלי פרטי האורח ובלי מספר הזמנה */
export function checkoutParams(
  items: GaItem[],
  total: number | null | undefined,
  currency: string | null | undefined,
): { currency: string; value?: number; items: GaItem[] } {
  return {
    currency: (currency || "ILS").toUpperCase().slice(0, 3),
    ...(total !== null && total !== undefined && Number.isFinite(total) ? { value: total } : {}),
    items,
  };
}
