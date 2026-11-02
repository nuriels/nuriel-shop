// מיילי ההזמנות (Stage 2k) — עברית, מימין לשמאל, בשם העסק. פונקציה טהורה: אירוע + הנתונים
// שנשמרו בתור (payload) + פרטי העסק → נושא ו-HTML. בלי פרטים שלא שייכים לנמען: לאורח —
// ההזמנה שלו ופרטי הקשר של העסק; לעסק — קישור להזמנה באזור הניהול.

export interface EmailPayload {
  booking_number?: number;
  unit_name?: string;
  check_in?: string;
  check_out?: string;
  nights?: number;
  adults?: number;
  children?: number;
  guest_name?: string;
  total?: number;
  currency?: string;
  hold_expires_at?: string | null;
  reason?: string | null;
  [key: string]: unknown;
}

export interface EmailBusiness {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
}

export interface EmailContext {
  business: EmailBusiness;
  /** לעסק: קישור להזמנה באזור הניהול (null — אין כתובת) */
  bookingUrl: string | null;
  /** לאורח: הכתובת של האתר — קישור "ניהול ההזמנה" נבנה מהטוקן שבמייל (null — אין כתובת) */
  siteOrigin?: string | null;
  escape: (s: string) => string;
}

const DAY = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
function dateText(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return `יום ${DAY[d.getUTCDay()]}, ${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
}
function dateTimeText(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
const money = (n: number | undefined, currency = "ILS") =>
  new Intl.NumberFormat("he-IL", { style: "currency", currency }).format(Number(n ?? 0));

type Copy = {
  subject: string;
  intro: string;
  details: boolean;
  outro?: string;
  /** הכפתור לעסק (ברירת המחדל: "לפתיחת ההזמנה") */
  button?: string;
  /** מייל של הפלטפורמה לעסק (תמיכה, שלב E4) — בשם Nuriel Hospitality, לא בשם העסק */
  platform?: boolean;
};

/** השולח של מיילי הפלטפורמה לעסקים */
export const PLATFORM_SENDER = "תמיכה — Nuriel Hospitality";

/** הטקסט של כל אירוע; null — אירוע לא מוכר (לא שולחים) */
export function copyFor(event: string, p: EmailPayload, b: EmailBusiness): Copy | null {
  const n = p.booking_number ? ` #${p.booking_number}` : "";
  const contact = [b.phone, b.email].filter(Boolean).join(" · ");
  const reach = contact ? `לכל שאלה: ${contact}.` : "";
  switch (event) {
    // ---- לאורח ----
    case "request_received":
      return {
        subject: `קיבלנו את בקשת ההזמנה שלך${n} — ${b.name}`,
        // D4: תשלום טלפוני — אותה הודעה כמו באתר אחרי השליחה
        intro: `שלום ${p.guest_name ?? ""}, תודה! בקשת ההזמנה התקבלה. נציג העסק יצור איתך קשר טלפונית להשלמת התשלום ואישור ההזמנה${
          p.hold_expires_at ? ` (עד ${dateTimeText(p.hold_expires_at)})` : ""
        }. עד אז הבקשה עוד לא מאושרת.`,
        details: true,
        outro: `לא ניתן לשלם באתר, ולא נבקש ממך פרטי כרטיס אשראי באימייל. ${reach}`.trim(),
      };
    case "booking_confirmed":
      return {
        subject: `ההזמנה שלך${n} אושרה — ${b.name}`,
        intro: `שלום ${p.guest_name ?? ""}, שמחים לאשר את ההזמנה שלך. מחכים לראותך! אם התשלום עוד לא הושלם — נציג העסק יצור איתך קשר טלפונית (לא ניתן לשלם באתר).`,
        details: true,
        outro: [
          b.checkInTime ? `כניסה מ-${b.checkInTime}` : "",
          b.checkOutTime ? `יציאה עד ${b.checkOutTime}` : "",
          b.address ?? "",
          reach,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "booking_declined":
      return {
        subject: `לא הצלחנו לאשר את הבקשה${n} — ${b.name}`,
        intro: `שלום ${p.guest_name ?? ""}, לצערנו לא נוכל לארח אותך בתאריכים שביקשת.${
          p.reason ? ` ${p.reason}` : ""
        }`,
        details: true,
        outro: reach,
      };
    case "request_expired":
      return {
        subject: `הבקשה${n} פגה — ${b.name}`,
        intro: `שלום ${p.guest_name ?? ""}, בקשת ההזמנה שלך לא אושרה בזמן ולכן בוטלה. אפשר ליצור קשר כדי לבדוק תאריכים.`,
        details: true,
        outro: reach,
      };
    case "booking_cancelled":
      return {
        subject: `ההזמנה${n} בוטלה — ${b.name}`,
        intro: `שלום ${p.guest_name ?? ""}, ההזמנה שלך בוטלה.${p.reason ? ` ${p.reason}` : ""}`,
        details: true,
        outro: reach,
      };
    case "cancellation_received":
      return {
        subject: `קיבלנו את בקשת הביטול${n} — ${b.name}`,
        intro: `שלום ${p.guest_name ?? ""}, בקשת הביטול שלך התקבלה. נעדכן אותך אחרי שנבדוק אותה.`,
        details: true,
        outro: reach,
      };
    case "cancellation_declined":
      return {
        subject: `בקשת הביטול${n} לא אושרה — ${b.name}`,
        intro: `שלום ${p.guest_name ?? ""}, ההזמנה שלך נשארת בתוקף.${p.reason ? ` ${p.reason}` : ""}`,
        details: true,
        outro: reach,
      };
    // ---- לעסק ----
    case "new_request":
      return {
        subject: `בקשת הזמנה חדשה${n} — ממתינה לאישור`,
        intro: `${p.guest_name ?? "אורח"} ביקש/ה להזמין. ${
          p.hold_expires_at ? `יש לאשר או לדחות עד ${dateTimeText(p.hold_expires_at)}.` : ""
        }`,
        details: true,
      };
    case "new_booking":
      return {
        subject: `הזמנה חדשה${n}`,
        intro: `התקבלה הזמנה חדשה מ-${p.guest_name ?? "אורח"}.`,
        details: true,
      };
    case "approval_reminder":
      return {
        subject: `תזכורת: בקשה${n} ממתינה לאישור`,
        intro: `הבקשה של ${p.guest_name ?? "האורח"} עדיין ממתינה.${
          p.hold_expires_at
            ? ` אם לא יאושר עד ${dateTimeText(p.hold_expires_at)} — היא תבוטל אוטומטית.`
            : ""
        }`,
        details: true,
      };
    case "request_expired_owner":
      return {
        subject: `הבקשה${n} פגה בלי אישור`,
        intro: `הבקשה של ${p.guest_name ?? "האורח"} לא אושרה בזמן ובוטלה; התאריכים פנויים שוב.`,
        details: true,
      };
    case "cancellation_requested":
      return {
        subject: `בקשת ביטול${n}`,
        intro: `${p.guest_name ?? "האורח"} ביקש/ה לבטל את ההזמנה. יש לאשר או לדחות את הבקשה.`,
        details: true,
      };
    case "cancelled_by_guest":
      return {
        subject: `הזמנה${n} בוטלה ע"י האורח`,
        intro: `${p.guest_name ?? "האורח"} ביטל/ה את ההזמנה; התאריכים פנויים שוב.`,
        details: true,
      };
    case "request_withdrawn":
      return {
        subject: `הבקשה${n} נמשכה`,
        intro: `${p.guest_name ?? "האורח"} משך/ה את בקשת ההזמנה; התאריכים פנויים שוב.`,
        details: true,
      };
    // D3: אירוע ביומן חיצוני על תאריכים שתפוסים אצלנו — לא נכתב, שום הזמנה לא שונתה
    case "channel_conflict": {
      const channel = String(p["channel_label"] ?? "היומן החיצוני");
      return {
        subject: `התנגשות ביומן ${channel}${p.unit_name ? ` — ${p.unit_name}` : ""}`,
        intro: `ב-${channel} יש תאריכים שכבר תפוסים אצלכם (הזמנה או חסימה). לא שינינו ולא ביטלנו שום הזמנה — אבל כדי למנוע הזמנה כפולה, כדאי לבדוק ולסגור את התאריכים האלה ב-${channel}.`,
        details: true,
        outro:
          p["echo_like"] === true
            ? `אלה בדיוק התאריכים של הזמנה או חסימה שכבר קיימת אצלכם — ייתכן ש-${channel} פשוט מחזיר את התאריכים שהיומן שלנו שלח אליו. אם אין שם הזמנה אמיתית על התאריכים האלה, אין מה לעשות.`
            : "אחרי שהתאריכים ייסגרו שם, ההתנגשות תיעלם בסנכרון הבא (עד 30 דקות).",
        button: "לבדיקת היומנים",
      };
    }
    // E4: צוות התמיכה ענה — בלי תוכן התשובה (המייל עלול להיות מועבר); קריאה באזור הניהול
    case "support_reply": {
      const num = p["ticket_number"] ? ` #${String(p["ticket_number"])}` : "";
      const subj = typeof p["subject"] === "string" ? p["subject"] : "";
      return {
        subject: `תשובה חדשה מהתמיכה בפנייה${num}`,
        intro: `צוות התמיכה של Nuriel Hospitality ענה בפנייה${subj ? ` "${subj}"` : ""}. אפשר לקרוא את התשובה ולהגיב באזור הניהול.`,
        details: false,
        outro: "מטעמי אבטחה התשובה עצמה לא נשלחת במייל — רק באזור הניהול, אחרי התחברות.",
        button: "לקריאת התשובה",
        platform: true,
      };
    }
    default:
      return null;
  }
}

export function renderBookingEmail(
  event: string,
  recipient: "guest" | "owner",
  p: EmailPayload,
  ctx: EmailContext,
): { subject: string; html: string; sender: string | null } | null {
  const copy = copyFor(event, p, ctx.business);
  if (!copy) return null;
  const from = copy.platform ? "Nuriel Hospitality" : ctx.business.name;
  const e = ctx.escape;
  const rows: [string, string][] = [];
  if (p.booking_number) rows.push(["מספר הזמנה", `#${p.booking_number}`]);
  if (p.unit_name) rows.push(["יחידה", p.unit_name]);
  if (p.check_in) rows.push(["הגעה", dateText(p.check_in)]);
  if (p.check_out) rows.push(["עזיבה", dateText(p.check_out)]);
  if (p.nights) rows.push(["לילות", String(p.nights)]);
  if (p.adults)
    rows.push(["אורחים", `${p.adults} מבוגרים${p.children ? `, ${p.children} ילדים` : ""}`]);
  if (p.total !== undefined) rows.push(["סה״כ", money(p.total, p.currency)]);
  if (recipient === "owner" && p.guest_name) rows.unshift(["אורח", p.guest_name]);
  // D3: התנגשויות ביומן חיצוני — רק התאריכים
  const conflicts = Array.isArray(p["conflicts"])
    ? (p["conflicts"] as { from?: unknown; to?: unknown }[]).filter(
        (c) => typeof c?.from === "string" && typeof c?.to === "string",
      )
    : [];
  if (conflicts.length) {
    rows.push([
      "תאריכים",
      conflicts.map((c) => `${dateText(String(c.from))} – ${dateText(String(c.to))}`).join("; "),
    ]);
    const more = Number(p["conflict_count"] ?? conflicts.length) - conflicts.length;
    if (more > 0) rows.push(["ועוד", `${more} התנגשויות נוספות`]);
  }
  const table = copy.details
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:16px 0;font-size:15px">${rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:6px 0;color:#555;width:110px">${e(k)}</td><td style="padding:6px 0;font-weight:600">${e(v)}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const manageUrl = guestManageUrl(recipient, p, ctx.siteOrigin ?? null);
  const link = (href: string, label: string) =>
    `<p style="margin:20px 0"><a href="${e(href)}" style="background:#1f3d2b;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${e(label)}</a></p>`;
  const button =
    recipient === "owner" && ctx.bookingUrl
      ? link(ctx.bookingUrl, copy.button ?? "לפתיחת ההזמנה")
      : manageUrl
        ? `${link(manageUrl, "לצפייה וניהול ההזמנה")}<p style="margin:0 0 8px;font-size:12px;color:#777">הקישור אישי — אין להעביר אותו לאחרים. הוא בתוקף עד 30 יום אחרי העזיבה.</p>`
        : "";
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5f5f2;font-family:Arial,Helvetica,sans-serif;color:#1d1d1b">
<div dir="rtl" style="max-width:560px;margin:0 auto;padding:24px 16px;text-align:right">
<div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e5e5e0">
<p style="margin:0 0 8px;font-size:13px;color:#777">${e(from)}</p>
<h1 style="margin:0 0 12px;font-size:20px">${e(copy.subject)}</h1>
<p style="margin:0;font-size:15px;line-height:1.6">${e(copy.intro)}</p>
${table}${button}
${copy.outro ? `<p style="margin:12px 0 0;font-size:14px;color:#444;line-height:1.6">${e(copy.outro)}</p>` : ""}
</div>
<p style="margin:12px 0 0;font-size:12px;color:#888;text-align:center">${
    copy.platform
      ? `נשלח ממערכת התמיכה של Nuriel Hospitality ל${e(ctx.business.name)}`
      : `נשלח ממערכת ההזמנות של ${e(ctx.business.name)}`
  }</p>
</div></body></html>`;
  return { subject: copy.subject, html, sender: copy.platform ? PLATFORM_SENDER : null };
}

/**
 * קישור "ניהול ההזמנה" לאורח (Stage 4b): רק במייל הראשון שלו, כשהטוקן בתור. הטוקן אחרי #
 * — לא נשלח לשרת בבקשת העמוד, לא נשמר ביומני השרת ולא עובר ב-Referer.
 */
export function guestManageUrl(
  recipient: "guest" | "owner",
  p: EmailPayload,
  origin: string | null,
): string | null {
  const token = typeof p["manage_token"] === "string" ? p["manage_token"] : null;
  if (recipient !== "guest" || !origin || !token || !/^[0-9a-f]{64}$/.test(token)) return null;
  return `${origin}/stay/my-booking#t=${token}`;
}
