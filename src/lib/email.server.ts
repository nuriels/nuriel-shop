// שליחת מיילים דרך Resend (REST API — ללא תלות חבילה נוספת).
//
// תשתית אחת לכל החנויות:
//  - מפתח API גלובלי אחד — משתנה הסביבה RESEND_API_KEY בשרת (לא ב-git).
//  - כתובת השולח: תמיד על דומיין המערכת המאומת ב-Resend (המפתח לא מאפשר
//    דומיין אחר), עם שם החנות כשם השולח — "אלקטרו כהן <electro@nuri1.fit>".
//    החנות בוחרת רק את החלק שלפני ה-@ (email_settings.sender_local_part,
//    ברירת מחדל orders). הדומיין: מ-EMAIL_FROM_ADDRESS, ואם לא הוגדרה —
//    TENANT_BASE_DOMAIN (ברירת מחדל nuri1.fit).
//  - תשובות של לקוחות (Reply-To) מגיעות לחנות עצמה: הכתובת למענה מהגדרות
//    המייל של החנות, או אימייל העסק מהגדרות האתר.
// אם המפתח חסר, השליחה מדולגת (לא חוסמת הזמנה) ונרשמת בלוג.
//
// חלק 17: חנות יכולה לחבר חשבון Resend משלה (מפתח + כתובת שולח על הדומיין
// שלה) — ההתראות ללקוחות נשלחות אז דרכו (transport), ואם נכשלו — חוזרות
// למפתח הפלטפורמה (src/server/services/notifications.ts).

import { DEFAULT_STORE_NAME } from "@/lib/branding";
import { DEFAULT_SENDER_LOCAL_PART, senderLocalPartProblem } from "@/lib/email-sender";

export type EmailAttachment = {
  filename: string;
  /** תוכן הקובץ בקידוד base64 */
  content: string;
};

/** רישום המייל בתיק הלקוח (יומן מיילים) */
export type EmailLogTarget = {
  userId: string;
  kind:
    | "order"
    | "quote"
    | "password_reset"
    | "temp_password"
    | "password_changed"
    | "agreement"
    | "manual"
    | "other";
  sentBy?: string | null;
};

/** שליחה דרך חשבון Resend של החנות (במקום מפתח הפלטפורמה) */
export type EmailTransport = {
  apiKey: string;
  /** כתובת השולח — על דומיין שהחנות אימתה ב-Resend שלה */
  senderAddress: string;
};

export type SendEmailInput = {
  to: string[];
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
  /** אם מצורף — המייל (כולל הצלחה/כישלון) נשמר ביומן המיילים של הלקוח */
  logFor?: EmailLogTarget;
  /**
   * מייל של הפלטפורמה עצמה (לא של חנות — למשל התראות תמיכה, חלק 13): שם
   * השולח וכתובת המענה במקום של החנות. הכתובת עצמה תמיד על דומיין המערכת.
   */
  platformSender?: { name: string; replyTo?: string | null };
  /**
   * כתובת למענה למייל הזה בלבד (למשל התראה למנהל על פנייה מהאתר — "השב"
   * עונה ישירות ללקוח). גוברת על כתובת המענה של החנות.
   */
  replyTo?: string | null;
  /** חלק 17: מפתח וכתובת שולח של החנות עצמה (ברירת מחדל — מפתח הפלטפורמה) */
  transport?: EmailTransport;
};

export type SendResult = {
  sent: boolean;
  reason?: string;
  /** מזהה ההודעה ב-Resend (כשנשלחה) */
  id?: string | null;
  /** לא היה ניסיון שליחה בכלל (אין מפתח / אין נמען תקין) */
  skipped?: boolean;
};

const EMAIL_FORMAT = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export function isValidEmail(value: string | null | undefined): value is string {
  return typeof value === "string" && EMAIL_FORMAT.test(value.trim());
}

/** כתובת השולח ברירת המחדל של המערכת (דומיין הפלטפורמה, מאומת ב-Resend) */
export function systemSenderAddress(): string {
  const explicit = process.env["EMAIL_FROM_ADDRESS"]?.trim().toLowerCase();
  if (explicit && isValidEmail(explicit)) return explicit;
  const base = process.env["TENANT_BASE_DOMAIN"]?.trim().toLowerCase();
  return `${DEFAULT_SENDER_LOCAL_PART}@${base || "nuri1.fit"}`;
}

/** הדומיין היחיד שממנו מותר לשלוח (nuri1.fit) */
export function systemSenderDomain(): string {
  return systemSenderAddress().split("@")[1] ?? "nuri1.fit";
}

/** החלק שלפני ה-@ בכתובת ברירת המחדל (orders) */
export function defaultSenderLocalPart(): string {
  return systemSenderAddress().split("@")[0] || DEFAULT_SENDER_LOCAL_PART;
}

/** כתובת ה-API של Resend (ניתן להחלפה בסביבת בדיקות בלבד — RESEND_API_URL) */
export function resendApiUrl(): string {
  const custom = process.env["RESEND_API_URL"]?.trim().replace(/\/$/, "");
  return custom && /^https?:\/\//.test(custom) ? custom : "https://api.resend.com";
}

/** מפתח ה-API הגלובלי של Resend (null = לא הוגדר בשרת) */
export function resendApiKey(): string | null {
  return process.env["RESEND_API_KEY"]?.trim() || null;
}

/** שם תצוגה בטוח לשורת "מאת": בלי מרכאות / סוגריים משולשים / שבירת שורה */
function cleanDisplayName(name: string): string {
  return name
    .replace(/["<>\\\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
}

export type StoreSender = {
  /** "שם החנות <orders@nuri1.fit>" — מוכן לשדה from */
  from: string;
  name: string;
  address: string;
  /** החלק שלפני ה-@ שבשימוש בפועל */
  localPart: string;
  /** דומיין המערכת — קבוע */
  domain: string;
  /** לאן יגיעו תשובות של לקוחות (null = בלי Reply-To) */
  replyTo: string | null;
};

/**
 * השולח של החנות הנוכחית: שם החנות (שם העסק בהגדרות האתר, או שם החנות
 * בפלטפורמה) + הכתובת שהחנות בחרה על דומיין המערכת ("electro@nuri1.fit";
 * ברירת מחדל orders@nuri1.fit). הדומיין תמיד של המערכת — גם אם במסד יש ערך
 * לא תקין, נופלים לברירת המחדל ולא שולחים מדומיין אחר.
 * Reply-To — הכתובת למענה שהחנות הגדירה, או אימייל העסק; כתובת על דומיין
 * המערכת עצמו לא משמשת למענה (אף אחד לא קורא אותה).
 */
export async function storeSender(): Promise<StoreSender> {
  const systemDomain = systemSenderDomain();
  let localPart = defaultSenderLocalPart();
  let name = "";
  let replyTo: string | null = null;
  try {
    const { maybeCurrentTenant } = await import("@/integrations/supabase/tenant.server");
    const tenant = maybeCurrentTenant();
    if (tenant) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const [{ data: site }, { data: emailSettings }] = await Promise.all([
        supabaseAdmin
          .from("site_settings")
          .select("business_name, site_title, business_email")
          .eq("id", true)
          .maybeSingle(),
        supabaseAdmin
          .from("email_settings")
          .select("sender_local_part, reply_to_email")
          .eq("id", true)
          .maybeSingle(),
      ]);
      name = site?.business_name?.trim() || site?.site_title?.trim() || tenant.name || "";
      const chosen = emailSettings?.sender_local_part?.trim().toLowerCase() ?? "";
      if (chosen !== "" && senderLocalPartProblem(chosen) === null) localPart = chosen;
      replyTo =
        [emailSettings?.reply_to_email, site?.business_email]
          .map((value) => value?.trim().toLowerCase() ?? "")
          .find((value) => isValidEmail(value) && value.split("@")[1] !== systemDomain) ?? null;
    }
  } catch (error) {
    console.error("[email] failed to load the store sender", error);
  }
  const display = cleanDisplayName(name) || DEFAULT_STORE_NAME;
  const address = `${localPart}@${systemDomain}`;
  return {
    from: `"${display}" <${address}>`,
    name: display,
    address,
    localPart,
    domain: systemDomain,
    replyTo,
  };
}

/** שולח של הפלטפורמה: "<שם>" <הכתובת של המערכת> */
function platformSenderFor(name: string, replyTo: string | null): StoreSender {
  const address = systemSenderAddress();
  const display = cleanDisplayName(name) || DEFAULT_STORE_NAME;
  return {
    from: `"${display}" <${address}>`,
    name: display,
    address,
    localPart: address.split("@")[0] ?? DEFAULT_SENDER_LOCAL_PART,
    domain: systemSenderDomain(),
    replyTo: replyTo && isValidEmail(replyTo) ? replyTo.trim().toLowerCase() : null,
  };
}

export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  const result = await deliverEmail(input);
  if (input.logFor) await recordCustomerEmail(input, result);
  return result;
}

/**
 * רישום המייל ביומן המיילים בתיק הלקוח (customer_emails). נקרא מ-sendEmail
 * כשיש logFor, או ישירות — כשמייל עבר כמה ניסיונות (מפתח החנות ואז מפתח
 * הפלטפורמה) ורק התוצאה הסופית נרשמת בתיק.
 */
export async function recordCustomerEmail(
  input: Pick<SendEmailInput, "to" | "subject" | "html" | "logFor">,
  result: SendResult,
): Promise<void> {
  if (!input.logFor) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { memberIdOrNull } = await import("@/lib/caller.server");
    const sentBy = await memberIdOrNull(input.logFor.sentBy);
    await supabaseAdmin.from("customer_emails").insert({
      user_id: input.logFor.userId,
      to_email: input.to.join(", "),
      subject: input.subject,
      kind: input.logFor.kind,
      html: input.html,
      sent: result.sent,
      error: result.sent ? null : (result.reason ?? null),
      sent_by: sentBy,
    });
  } catch (error) {
    // כשל ברישום ליומן לא צריך להפיל שליחה שכבר הצליחה
    console.error("[email] failed to log email", error);
  }
}

async function deliverEmail(input: SendEmailInput): Promise<SendResult> {
  const apiKey = input.transport?.apiKey ?? resendApiKey();
  if (!apiKey) {
    // חשוב לרשום ללוג: בלי המפתח שום מייל לא יוצא, וזה נכשל "בשקט"
    console.error("[email] RESEND_API_KEY missing — email skipped:", input.subject);
    return {
      sent: false,
      skipped: true,
      reason: "מפתח Resend (RESEND_API_KEY) לא הוגדר בשרת",
    };
  }
  const to = input.to.map((address) => address.trim()).filter(isValidEmail);
  if (to.length === 0) return { sent: false, skipped: true, reason: "אין נמענים תקינים" };

  const sender = input.platformSender
    ? platformSenderFor(input.platformSender.name, input.platformSender.replyTo ?? null)
    : await storeSender();
  // חשבון Resend של החנות: אותו שם תצוגה, הכתובת מהדומיין המאומת של החנות
  const from =
    input.transport && isValidEmail(input.transport.senderAddress)
      ? `"${sender.name}" <${input.transport.senderAddress.trim().toLowerCase()}>`
      : sender.from;
  const replyTo =
    input.replyTo && isValidEmail(input.replyTo)
      ? input.replyTo.trim().toLowerCase()
      : sender.replyTo;
  try {
    const response = await fetch(`${resendApiUrl()}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: input.subject,
        html: input.html,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      console.error("[email] Resend error", response.status, body);
      // מחזירים את גוף השגיאה של Resend: בדרך כלל "domain is not verified"
      // או "API key is invalid", וזו בדיוק המידע שהמנהל צריך.
      return { sent: false, reason: `שגיאת שליחה (${response.status}): ${body.slice(0, 300)}` };
    }
    const payload = (await response.json().catch(() => null)) as { id?: unknown } | null;
    return { sent: true, id: typeof payload?.id === "string" ? payload.id.slice(0, 200) : null };
  } catch (error) {
    console.error("[email] send failed", error);
    return { sent: false, reason: error instanceof Error ? error.message : "שגיאה לא ידועה" };
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * הופך טקסט חופשי שהמנהל הקליד לגוף מייל בטוח.
 *
 * כל התוכן עובר escaping (אין הזרקת HTML), ואז קישורים שזוהו בטקסט
 * הופכים לקישורים לחיצים — כדי שאפשר יהיה לשלוח קישור תשלום פשוט
 * בהדבקה לתוך ההודעה. רק http/https מותרים; `javascript:` וכדומה נשארים
 * טקסט רגיל.
 */
export function textToEmailHtml(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const safe = escapeHtml(line);
      const linked = safe.replace(/https?:\/\/[^\s<>"']+/g, (url) => {
        // סימני פיסוק שנדבקו לסוף הקישור אינם חלק ממנו
        const trimmed = url.replace(/[.,;:)\]]+$/, "");
        const tail = url.slice(trimmed.length);
        return `<a href="${trimmed}" style="color:#9C6F22;text-decoration:underline;">${trimmed}</a>${tail}`;
      });
      return `<p style="margin:0 0 10px;">${linked || "&nbsp;"}</p>`;
    })
    .join("");
}

/** כפתור פעולה (למשל "לתשלום") בתוך גוף המייל */
export function emailActionButton(label: string, url: string): string {
  if (!/^https:\/\/|^http:\/\//i.test(url)) return "";
  return `<p style="margin:22px 0;">
      <a href="${escapeHtml(url)}" style="background:#12211F;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold;">
        ${escapeHtml(label)}
      </a>
    </p>`;
}

/** כתובת ציבורית של לוגו האתר מתוך ה-Storage (נטענת ישירות בתוכנת המייל) */
function publicLogoUrl(logoPath: string | null): string | null {
  if (!logoPath) return null;
  if (/^https?:\/\//i.test(logoPath)) return logoPath;
  const base = process.env["SUPABASE_URL"]?.replace(/\/$/, "");
  if (!base) return null;
  return `${base}/storage/v1/object/public/branding/${logoPath}`;
}

/**
 * עטיפת המייל הרשמית של המערכת:
 * לוגו העסק בראש ההודעה, חתימת העסק (נקבעת בפאנל הניהול) בתחתית,
 * ושורת סיום אחת מבין השתיים —
 *  - מייל רגיל ללקוח: "הודעה אוטומטית - אין להשיב למייל זה"
 *  - מייל הבדיקה של המנהל: "אנו מבצעים בדיקה, נא לא להשיב למייל זה"
 */
export async function renderEmailHtml(
  title: string,
  bodyHtml: string,
  options: { isTest?: boolean } = {},
): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let logoUrl: string | null = null;
  let businessName = "";
  let signature = "";
  let supportLine = "";
  try {
    const { data: settings } = await supabaseAdmin
      .from("site_settings")
      .select(
        "site_title, logo_path, business_name, email_signature, support_phone, business_phone, business_address",
      )
      .eq("id", true)
      .maybeSingle();
    logoUrl = publicLogoUrl(settings?.logo_path ?? null);
    businessName = settings?.business_name?.trim() || settings?.site_title?.trim() || "";
    signature = settings?.email_signature?.trim() ?? "";
    // אם המנהל לא כתב חתימה, בונים אחת מפרטי העסק כדי שהמייל לא ייצא ערום
    if (signature === "") {
      signature = [
        businessName,
        settings?.business_address,
        settings?.support_phone || settings?.business_phone,
      ]
        .filter((part) => (part ?? "").trim() !== "")
        .join("\n");
    }
    supportLine = (settings?.support_phone || settings?.business_phone || "").trim();
  } catch (error) {
    console.error("[email] failed to load branding settings", error);
  }

  const signatureHtml = signature
    .split("\n")
    .map((line) => escapeHtml(line))
    .join("<br/>");

  const disclaimer = options.isTest
    ? "אנו מבצעים בדיקה, נא לא להשיב למייל זה"
    : "הודעה אוטומטית - אין להשיב למייל זה";

  const header = logoUrl
    ? `<img src="${logoUrl}" alt="${escapeHtml(businessName)}" style="max-height:56px;max-width:220px;display:block;margin:0 auto 4px;" />`
    : `<div style="font-size:20px;font-weight:bold;color:#ffffff;text-align:center;">${escapeHtml(businessName)}</div>`;

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
  <body style="font-family: Arial, Helvetica, sans-serif; background:#f2f5f2; margin:0; padding:24px;">
    <div style="max-width:560px;margin:0 auto;">
      <div style="background:#12211F;border-radius:12px 12px 0 0;padding:20px 24px;">
        ${header}
      </div>
      <div style="background:#ffffff;padding:24px;border:1px solid #e2e8e2;border-top:none;">
        <h2 style="margin:0 0 16px;color:#12211F;text-align:right;font-size:19px;">${escapeHtml(title)}</h2>
        <div style="text-align:right;color:#1f2933;line-height:1.7;">${bodyHtml}</div>
      </div>
      <div style="background:#f7faf7;border:1px solid #e2e8e2;border-top:none;border-radius:0 0 12px 12px;padding:18px 24px;text-align:right;">
        ${
          signatureHtml
            ? `<div style="color:#3d4a44;font-size:13px;line-height:1.7;">${signatureHtml}</div>`
            : ""
        }
        ${
          supportLine
            ? `<div style="color:#6b7280;font-size:12px;margin-top:8px;">שירות לקוחות: <span dir="ltr">${escapeHtml(supportLine)}</span></div>`
            : ""
        }
        <div style="color:#9aa5a0;font-size:11px;margin-top:12px;border-top:1px solid #e2e8e2;padding-top:10px;">
          ${escapeHtml(disclaimer)}
        </div>
      </div>
    </div>
  </body>
</html>`;
}
