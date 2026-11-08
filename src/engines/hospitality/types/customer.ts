// מיגרציה 65: תיקון פרטי הלקוח בהזמנה / באירוע — מה שהמסד מחזיר לצוות
export type CustomerScope = "guest" | "booking";
export type CustomerField = "full_name" | "phone" | "email";

export interface CustomerPatch {
  full_name?: string;
  phone?: string;
  /** null — מחיקת האימייל */
  email?: string | null;
}

export interface CustomerUpdateResult {
  booking_id?: string;
  event_id?: string;
  revision: number;
  scope: CustomerScope;
  guest_id: string;
  /** "רק בהזמנה הזו" — חובר לכרטיס קיים (לפי האימייל / הטלפון) */
  existing_guest: boolean;
  fields: CustomerField[];
  email_changed: boolean;
  email_masked: string | null;
  /** קישורים אישיים שבוטלו (נשלחו לכתובת הקודמת) */
  links_revoked: number;
  /** מיילים לאורח שעוד לא יצאו לכתובת הקודמת — לא יוצאים */
  emails_dropped: number;
  /** מספרי חוזים פתוחים (טרם נחתמו) שפרטי החותם בהם עודכנו — צריך לשלוח אותם שוב */
  open_contracts_updated: number[];
  /** חוזים חתומים — לא משתנים; אפשר להפיק חוזה מתוקן */
  signed_contracts: { id: string; number: number }[];
  /** כמה מיילים "פרטי ההזמנה" נכנסו לתור (רק בהזמנה) */
  details_queued?: number;
}

export interface DetailsResendResult {
  booking_id: string;
  revision: number;
  queued: boolean;
  email_masked: string | null;
}
