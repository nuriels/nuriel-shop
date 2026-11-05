// ============================================================
// תבנית המייל "הרישיון הדיגיטלי שלך מוכן!" — פונקציה טהורה, משותפת לשרת (שליחה)
// ולדפדפן (תצוגה מקדימה זהה, בלי לשלוח את המפתח לשרת רק בשביל התצוגה).
// בנויה לתוכנות מייל: טבלאות + עיצוב inline, RTL, רוחב גמיש עד 600px (נייד ומחשב).
// כל טקסט שמגיע מבחוץ עובר escaping.
// ============================================================
import {
  LICENSE_DISCLAIMER,
  LICENSE_PRODUCT_LABEL,
  LINK_MAX_DOWNLOADS,
  LINK_VALID_DAYS,
  type LicenseProduct,
} from "@/lib/licenses";

export type LicenseEmailBranding = {
  businessName: string;
  /** כתובת ציבורית של הלוגו (null = שם העסק בטקסט) */
  logoUrl: string | null;
  phone: string | null;
  email: string | null;
  /** כתובת האתר של החנות */
  website: string | null;
  address: string | null;
  /** צבע המותג (#rrggbb) */
  accent: string;
};

export type LicenseEmailInput = {
  customerName: string;
  product: LicenseProduct;
  /** המפתח המלא (בשליחה) או מוסתר (בתצוגה המקדימה) */
  licenseKey: string;
  orderNumber?: string | null;
  /** קישור ההורדה; null = בלי תוכנת התקנה במייל */
  downloadUrl: string | null;
  /** תצוגה מקדימה: הכפתור מוצג, אבל הקישור ייווצר רק בשליחה */
  downloadPlaceholder?: boolean;
  /** שמות הקבצים המצורפים (מדריך / קבלה) */
  attachments: string[];
};

const NAVY = "#0B1F4D";
const INK = "#334155";
const MUTED = "#64748B";

export function escapeEmailText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeColor(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#1F5FD6";
}

function safeUrl(value: string | null): string | null {
  return value && /^https?:\/\/[^\s"'<>]+$/i.test(value) ? value : null;
}

export function licenseEmailSubject(product: LicenseProduct): string {
  return `הרישיון הדיגיטלי שלך מוכן! — ${LICENSE_PRODUCT_LABEL[product]}`;
}

export function buildLicenseEmailHtml(
  input: LicenseEmailInput,
  branding: LicenseEmailBranding,
): string {
  const e = escapeEmailText;
  const accent = safeColor(branding.accent);
  const product = LICENSE_PRODUCT_LABEL[input.product];
  const name = e(input.customerName.trim() || "לקוח יקר");
  const business = e(branding.businessName.trim() || "נוריאל מחשבים");
  const logo = safeUrl(branding.logoUrl);
  const website = safeUrl(branding.website);
  const link = safeUrl(input.downloadUrl);
  const hasDownload = Boolean(link) || Boolean(input.downloadPlaceholder);
  const productShort = input.product === "office" ? "Office" : "Windows";

  const header = logo
    ? `<img src="${e(logo)}" alt="${business}" width="96" style="display:block;margin:0 auto;max-width:96px;height:auto;border:0;border-radius:50%;background:#ffffff;" />`
    : `<div style="font-size:22px;font-weight:bold;color:#ffffff;">${business}</div>`;

  const orderLine = input.orderNumber?.trim()
    ? `<p style="margin:12px 0 0;color:${MUTED};font-size:13px;">מספר הזמנה: <strong dir="ltr" style="color:${NAVY};">${e(input.orderNumber.trim())}</strong></p>`
    : "";

  const downloadBlock = hasDownload
    ? `<tr><td style="padding:22px 28px 4px;text-align:center;">
        <a href="${link ? e(link) : "#"}" style="display:inline-block;background:${accent};color:#ffffff;font-size:17px;font-weight:bold;text-decoration:none;padding:15px 30px;border-radius:12px;mso-padding-alt:0;">&#11015;&#65039; להורדת תוכנת ההתקנה</a>
        <div style="font-size:12px;color:${MUTED};margin-top:10px;line-height:1.6;">
          הקישור אישי, תקף ל-${LINK_VALID_DAYS} ימים ועד ${LINK_MAX_DOWNLOADS} הורדות.${input.downloadPlaceholder && !link ? "<br/><em>(בתצוגה המקדימה — הקישור ייווצר בעת השליחה)</em>" : ""}
        </div>
      </td></tr>`
    : "";

  const steps = [
    hasDownload
      ? "מורידים את תוכנת ההתקנה מהכפתור למעלה ומפעילים אותה במחשב."
      : `מתקינים את ${productShort} לפי ההוראות.`,
    input.attachments.length > 0
      ? "פועלים לפי מדריך ההתקנה המצורף למייל, שלב אחרי שלב."
      : `מתקינים את ${productShort} במחשב.`,
    `מזינים את מפתח הרישיון ומפעילים את ${productShort} (נדרש חיבור לאינטרנט).`,
  ];
  const stepsHtml = steps
    .map(
      (text, i) => `<tr>
        <td valign="top" width="34" style="padding:0 0 10px;">
          <div style="width:26px;height:26px;line-height:26px;border-radius:50%;background:${accent};color:#ffffff;font-size:13px;font-weight:bold;text-align:center;">${i + 1}</div>
        </td>
        <td valign="top" style="padding:3px 8px 10px 0;color:${INK};font-size:14px;line-height:1.6;">${e(text)}</td>
      </tr>`,
    )
    .join("");

  const attachmentsBlock =
    input.attachments.length > 0
      ? `<tr><td style="padding:6px 28px 4px;">
          <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:12px 14px;font-size:13px;color:${INK};line-height:1.7;">
            &#128206; מצורפים למייל: ${input.attachments.map((a) => `<span dir="ltr" style="font-weight:bold;color:${NAVY};">${e(a)}</span>`).join(" · ")}
          </div>
        </td></tr>`
      : "";

  const contactRows = [
    branding.phone
      ? `טלפון: <a href="tel:${e(branding.phone.replace(/[^\d+]/g, ""))}" dir="ltr" style="color:${accent};text-decoration:none;font-weight:bold;">${e(branding.phone)}</a>`
      : null,
    branding.email
      ? `אימייל: <a href="mailto:${e(branding.email)}" dir="ltr" style="color:${accent};text-decoration:none;">${e(branding.email)}</a>`
      : null,
    website
      ? `אתר: <a href="${e(website)}" dir="ltr" style="color:${accent};text-decoration:none;">${e(website.replace(/^https?:\/\//, ""))}</a>`
      : null,
  ].filter(Boolean);

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>הרישיון הדיגיטלי שלך מוכן!</title>
</head>
<body style="margin:0;padding:0;background:#EEF2F8;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEF2F8;">
<tr><td align="center" style="padding:24px 10px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #DCE3EF;border-radius:16px;font-family:Arial,Helvetica,sans-serif;direction:rtl;text-align:right;">
  <tr><td style="background:${NAVY};background-image:linear-gradient(135deg,${NAVY},${accent});border-radius:16px 16px 0 0;padding:26px 24px;text-align:center;">
    ${header}
    ${logo ? `<div style="color:#D6E2FF;font-size:12px;letter-spacing:1px;margin-top:10px;">${business}</div>` : ""}
  </td></tr>

  <tr><td style="padding:28px 28px 6px;">
    <span style="display:inline-block;background:#E8F0FE;color:${accent};font-size:12px;font-weight:bold;padding:5px 12px;border-radius:999px;">רישיון דיגיטלי · <span dir="ltr">${e(product)}</span></span>
    <h1 style="margin:14px 0 8px;font-size:24px;line-height:1.35;color:${NAVY};">הרישיון הדיגיטלי שלך מוכן!</h1>
    <p style="margin:0;color:${INK};font-size:15px;line-height:1.75;">שלום ${name},<br/>תודה שבחרת ב${business}. כאן כל מה שצריך כדי להתקין ולהפעיל את <strong dir="ltr">${e(product)}</strong>.</p>
    ${orderLine}
  </td></tr>

  <tr><td style="padding:18px 28px 4px;">
    <div style="font-size:13px;color:${MUTED};font-weight:bold;margin-bottom:8px;">מפתח הרישיון שלך</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px dashed ${accent};border-radius:12px;background:#F5F8FF;">
      <tr><td style="padding:18px 10px;text-align:center;">
        <div dir="ltr" style="font-family:Consolas,'Courier New',monospace;font-size:20px;font-weight:bold;letter-spacing:1px;color:${NAVY};word-break:break-all;-webkit-user-select:all;user-select:all;">${e(input.licenseKey)}</div>
        <div style="font-size:12px;color:${MUTED};margin-top:8px;">סמנו את המפתח והעתיקו אותו (Ctrl+C)</div>
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;background:#FFF7E6;border:1px solid #F6D59A;border-radius:10px;">
      <tr><td style="padding:12px 14px;color:#7A4B00;font-size:13px;line-height:1.6;">&#9888;&#65039; ${e(LICENSE_DISCLAIMER)}</td></tr>
    </table>
  </td></tr>

  ${downloadBlock}

  <tr><td style="padding:22px 28px 6px;">
    <div style="font-weight:bold;color:${NAVY};font-size:15px;margin-bottom:12px;">איך מתקינים?</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${stepsHtml}</table>
  </td></tr>

  ${attachmentsBlock}

  <tr><td style="padding:20px 28px 26px;">
    <div style="border-top:1px solid #E2E8F0;padding-top:16px;color:${INK};font-size:14px;line-height:1.9;">
      <strong style="color:${NAVY};">צריכים עזרה? אנחנו כאן בשבילכם.</strong><br/>
      ${contactRows.join("<br/>")}
    </div>
  </td></tr>

  <tr><td style="background:${NAVY};border-radius:0 0 16px 16px;padding:16px 24px;text-align:center;color:#AFC3EA;font-size:12px;line-height:1.7;">
    ${business}${branding.address ? ` · ${e(branding.address)}` : ""}<br/>
    המייל נשלח אליך בעקבות רכישת רישיון דיגיטלי.
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
