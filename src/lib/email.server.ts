// שליחת מיילים דרך Resend (REST API — ללא תלות חבילה נוספת).
// דורש משתני סביבה בצד השרת: RESEND_API_KEY (מפתח ה-API של Resend).
// אם המפתח או כתובת השולח לא הוגדרו, השליחה מדולגת בשקט (לא חוסמת הזמנה).

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

type SendEmailInput = {
  to: string[];
  subject: string;
  html: string;
  from: string;
  attachments?: EmailAttachment[];
  /** אם מצורף — המייל (כולל הצלחה/כישלון) נשמר ביומן המיילים של הלקוח */
  logFor?: EmailLogTarget;
};

type SendResult = { sent: boolean; reason?: string };

export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  const result = await deliverEmail(input);
  if (input.logFor) {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("customer_emails").insert({
        user_id: input.logFor.userId,
        to_email: input.to.join(", "),
        subject: input.subject,
        kind: input.logFor.kind,
        html: input.html,
        sent: result.sent,
        error: result.sent ? null : (result.reason ?? null),
        sent_by: input.logFor.sentBy ?? null,
      });
    } catch (error) {
      // כשל ברישום ליומן לא צריך להפיל שליחה שכבר הצליחה
      console.error("[email] failed to log email", error);
    }
  }
  return result;
}

async function deliverEmail(input: SendEmailInput): Promise<SendResult> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    // חשוב לרשום ללוג: בלי המפתח שום מייל לא יוצא, וזה נכשל "בשקט"
    console.error("[email] RESEND_API_KEY missing — email skipped:", input.subject);
    return { sent: false, reason: "RESEND_API_KEY לא הוגדר בשרת" };
  }
  if (!input.from) {
    console.error("[email] sender address missing — email skipped:", input.subject);
    return { sent: false, reason: "לא הוגדרה כתובת מייל שולחת בהגדרות מייל בפאנל הניהול" };
  }
  if (input.to.length === 0) return { sent: false, reason: "אין נמענים" };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      console.error("[email] Resend error", response.status, body);
      // מחזירים את גוף השגיאה של Resend: בדרך כלל "domain is not verified"
      // או "from address not allowed", וזו בדיוק המידע שהמנהל צריך.
      return { sent: false, reason: `שגיאת שליחה (${response.status}): ${body.slice(0, 300)}` };
    }
    return { sent: true };
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
    : `<div style="font-size:20px;font-weight:bold;color:#12211F;text-align:center;">${escapeHtml(businessName)}</div>`;

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
