import type { TenantSslStatus } from "@/integrations/supabase/types";

// מצב תעודת ה-SSL של חנות לתצוגה בפאנל הפלטפורמה. הנתונים מגיעים מהשרת
// (deploy/ssl/store-certs.sh מדווח כל דקה ל-tenant_ssl).

export type SslFields = {
  ssl_status: TenantSslStatus | null;
  ssl_issued_at: string | null;
  ssl_expires_at: string | null;
  ssl_error: string | null;
  ssl_renew_requested_at: string | null;
};

export type SslView = {
  tone: "ok" | "warn" | "bad" | "muted";
  label: string;
  detail: string | null;
  /** בקשת חידוש נשלחה וממתינה לשרת */
  renewing: boolean;
  canRenew: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** השרת מדווח כל דקה; אם עברו יותר מזה — הטיימר בשרת כנראה לא רץ */
export const SSL_AGENT_STALE_MS = 5 * 60 * 1000;

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("he-IL");

export function sslView(s: SslFields, now: number = Date.now()): SslView {
  const renewing = s.ssl_renew_requested_at !== null;
  if (renewing) {
    return {
      tone: "muted",
      label: "מחדש…",
      detail: "השרת יטפל בבקשה תוך כדקה",
      renewing,
      canRenew: false,
    };
  }

  switch (s.ssl_status) {
    case null:
      return {
        tone: "muted",
        label: "ממתינה לשרת",
        detail: "השרת בודק חנויות חדשות כל דקה",
        renewing,
        canRenew: false,
      };
    case "pending":
      return { tone: "muted", label: "בהנפקה…", detail: null, renewing, canRenew: false };
    case "blocked":
      return {
        tone: "bad",
        label: "הכתובת תפוסה",
        detail: "הכתובת שייכת לאתר אחר בשרת — אין לחנות תעודה",
        renewing,
        canRenew: false,
      };
    case "external":
      return {
        tone: "muted",
        label: "מנוהלת ידנית",
        detail: "התעודה לא נמצאה בניהול האוטומטי של השרת",
        renewing,
        canRenew: false,
      };
    case "error":
      return {
        tone: "bad",
        label: "ההנפקה נכשלה",
        detail: s.ssl_error ?? "ניסיון חוזר אוטומטי בעוד שעה",
        renewing,
        canRenew: true,
      };
    case "active":
      break;
  }

  if (!s.ssl_expires_at) {
    return { tone: "muted", label: "פעילה", detail: null, renewing, canRenew: true };
  }
  const expires = new Date(s.ssl_expires_at).getTime();
  const days = Math.floor((expires - now) / DAY_MS);
  const until = `בתוקף עד ${formatDate(s.ssl_expires_at)}`;
  if (expires <= now) {
    return {
      tone: "bad",
      label: "פגה!",
      detail: `פגה ב-${formatDate(s.ssl_expires_at)}`,
      renewing,
      canRenew: true,
    };
  }

  // certbot מחדש כשנשאר שליש מתקופת התעודה; אם עבר מזה יותר משלושה ימים
  // והתעודה לא חודשה — החידוש האוטומטי לא עובד
  const issued = s.ssl_issued_at ? new Date(s.ssl_issued_at).getTime() : expires - 90 * DAY_MS;
  const renewDue = expires - (expires - issued) / 3;
  const overdue = now > renewDue + 3 * DAY_MS;

  const label = days === 0 ? "פגה היום" : days === 1 ? "עוד יום אחד" : `עוד ${days} ימים`;
  const notes = [until];
  if (overdue) notes.push("החידוש האוטומטי מתעכב");
  if (s.ssl_error) notes.push(`חידוש אחרון נכשל: ${s.ssl_error}`);
  const detail = notes.join(" · ");
  if (days <= 7) return { tone: "bad", label, detail, renewing, canRenew: true };
  if (overdue || s.ssl_error) return { tone: "warn", label, detail, renewing, canRenew: true };
  return { tone: "ok", label, detail, renewing, canRenew: true };
}
