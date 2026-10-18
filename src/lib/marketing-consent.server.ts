/**
 * חלק 40: דיוור לפי חוק הספאם — צד שרת.
 *
 *  - recordMarketingConsent — רישום הסכמה / סירוב (marketing_set_consent במסד,
 *    עם הנוסח שהוצג ללקוח), ואם מגיע — שליחת מייל "ברוכים הבאים" עם קופון.
 *  - marketingSendToken — מותר לשלוח דיוור לכתובת? (טוקן ההסרה, או null)
 *  - marketingFooterHtml / unsubscribeHeaders — החלק שחובה בכל מייל שיווקי:
 *    פרטי העסק, הודעה על הזכות לסרב וקישור הסרה בלחיצה אחת.
 * רק בתוך בקשה של חנות (supabaseAdmin מוגבל לחנות של הבקשה).
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { tenantSiteOrigin } from "@/integrations/supabase/tenant.server";
import { couponLabel, type CouponType } from "@/lib/coupons";
import {
  adSubject,
  marketingConsentText,
  unsubscribePath,
  type ConsentSource,
} from "@/lib/marketing-consent";

type ConsentResult = { subscribed: boolean; token: string | null; welcome_due: boolean };

export async function marketingSendToken(email: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("marketing_send_token", { _email: email });
  if (error) {
    console.error("[marketing] send-token lookup failed", error.message);
    return null;
  }
  return typeof data === "string" && data ? data : null;
}

/** שם החנות ופרטי הקשר — לנוסח ההסכמה ולתחתית המייל השיווקי */
async function storeContact(): Promise<{
  name: string;
  email: string;
  phone: string;
  address: string;
}> {
  const { data } = await supabaseAdmin
    .from("site_settings")
    .select(
      "business_name, site_title, business_email, business_phone, support_phone, business_address",
    )
    .eq("id", true)
    .maybeSingle();
  return {
    name: data?.business_name?.trim() || data?.site_title?.trim() || "",
    email: data?.business_email?.trim() ?? "",
    phone: (data?.support_phone || data?.business_phone || "").trim(),
    address: data?.business_address?.trim() ?? "",
  };
}

export function unsubscribeUrl(token: string): string {
  return `${tenantSiteOrigin()}${unsubscribePath(token)}`;
}

/** כותרות "הסרה בלחיצה אחת" (Gmail / Outlook מציגים כפתור "בטל הרשמה") */
export function unsubscribeHeaders(token: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${tenantSiteOrigin()}/api/unsubscribe/${token}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/** תחתית חובה למייל שיווקי: פרטי העסק + הזכות לסרב + קישור הסרה */
export async function marketingFooterHtml(token: string): Promise<string> {
  const { escapeHtml } = await import("@/lib/email.server");
  const contact = await storeContact();
  const details = [contact.name, contact.address, contact.phone, contact.email]
    .filter((part) => part !== "")
    .map((part) => escapeHtml(part))
    .join(" · ");
  const url = escapeHtml(unsubscribeUrl(token));
  return `<div style="margin-top:22px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;line-height:1.6;">
      <p style="margin:0 0 4px;">קיבלת את ההודעה כי אישרת לקבל מאיתנו דיוור. ${details ? `השולח: ${details}.` : ""}</p>
      <p style="margin:0;">אינך חייב/ת להמשיך לקבל דיוור — <a href="${url}" style="color:#6b7280;text-decoration:underline;">להסרה מרשימת הדיוור לחצו כאן</a>. ההסרה מיידית.</p>
    </div>`;
}

/**
 * רישום ההסכמה (או הסירוב) עם הנוסח שהוצג ללקוח. אם זו הצטרפות ראשונה
 * בהרשמה / ב"החשבון שלי" והחנות הגדירה קופון ברוכים הבאים — המייל נשלח.
 * כשל בשליחה לא מפיל את הפעולה שקראה לנו (הרשמה, קופה).
 */
export async function recordMarketingConsent(input: {
  email: string;
  subscribed: boolean;
  source: ConsentSource;
  userId?: string | null;
  name?: string | null;
}): Promise<ConsentResult | null> {
  const contact = await storeContact();
  const { data, error } = await supabaseAdmin.rpc("marketing_set_consent", {
    _email: input.email,
    _subscribed: input.subscribed,
    _source: input.source,
    _consent_text: input.subscribed ? marketingConsentText(contact.name, input.source) : "",
    ...(input.userId ? { _user_id: input.userId } : {}),
  });
  if (error) {
    console.error("[marketing] consent save failed", error.message);
    return null;
  }
  const result = data as unknown as ConsentResult;
  if (result?.welcome_due) {
    await sendWelcomeCouponEmail(input.email, input.name ?? null).catch((sendError: unknown) =>
      console.error("[marketing] welcome email failed", sendError),
    );
  }
  return result;
}

/**
 * מייל "ברוכים הבאים" עם קופון — רק אם החנות בחרה קופון פעיל, ורק פעם אחת
 * לכל כתובת (marketing_claim_welcome). אם השליחה נכשלה — משחררים לניסיון הבא.
 */
export async function sendWelcomeCouponEmail(
  email: string,
  name: string | null,
): Promise<{ sent: boolean; reason?: string }> {
  const { data: site } = await supabaseAdmin
    .from("site_settings")
    .select("welcome_coupon_code")
    .eq("id", true)
    .maybeSingle();
  const code = site?.welcome_coupon_code ?? null;
  if (!code) return { sent: false, reason: "לא הוגדר קופון ברוכים הבאים" };

  const { data: coupon } = await supabaseAdmin
    .from("coupons")
    .select(
      "code, discount_type, discount_value, is_active, starts_at, expires_at, min_order_total",
    )
    .eq("code", code)
    .maybeSingle();
  const now = Date.now();
  if (
    !coupon ||
    !coupon.is_active ||
    (coupon.expires_at && Date.parse(coupon.expires_at) <= now) ||
    (coupon.starts_at && Date.parse(coupon.starts_at) > now)
  ) {
    return { sent: false, reason: "קופון ברוכים הבאים לא פעיל" };
  }

  const { data: claimed, error: claimError } = await supabaseAdmin.rpc("marketing_claim_welcome", {
    _email: email,
  });
  const token = typeof claimed === "string" && claimed ? claimed : null;
  if (claimError || !token) return { sent: false, reason: "כבר נשלח / לא מנוי" };

  const { escapeHtml, emailActionButton, renderEmailHtml, sendEmail } =
    await import("@/lib/email.server");
  const contact = await storeContact();
  const storeName = contact.name || "החנות";
  const label = couponLabel(
    (["percent", "fixed", "free_shipping"].includes(coupon.discount_type)
      ? coupon.discount_type
      : "percent") as CouponType,
    Number(coupon.discount_value),
  );
  const conditions = [
    coupon.min_order_total ? `בהזמנה מעל ₪${Number(coupon.min_order_total).toFixed(0)}` : "",
    coupon.expires_at
      ? `בתוקף עד ${new Date(coupon.expires_at).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" })}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const body = `
      <p>${name ? `שלום ${escapeHtml(name)},` : "שלום,"}</p>
      <p>תודה שהצטרפת לרשימת הדיוור של ${escapeHtml(storeName)}! כמתנת הצטרפות — קוד קופון להזמנה הבאה:</p>
      <div style="margin:18px 0;padding:14px 16px;border:2px dashed #16a34a;border-radius:10px;background:#f0fdf4;text-align:center;">
        <p style="margin:0 0 6px;font-weight:bold;color:#166534;">🎁 ${escapeHtml(label)}</p>
        <p style="margin:0;font-size:22px;font-weight:bold;letter-spacing:2px;color:#14532d;" dir="ltr">${escapeHtml(coupon.code)}</p>
        ${conditions ? `<p style="margin:6px 0 0;font-size:12px;color:#166534;">${escapeHtml(conditions)}</p>` : ""}
      </div>
      <p>מקלידים את הקוד בקופה, בשדה "קוד קופון".</p>
      ${emailActionButton("לחנות", tenantSiteOrigin())}
      ${await marketingFooterHtml(token)}
    `;
  const result = await sendEmail({
    to: [email],
    subject: adSubject(`ברוכים הבאים ל${storeName} — קופון ${label} מחכה לכם 🎁`),
    html: await renderEmailHtml(`ברוכים הבאים ל${storeName}`, body),
    headers: unsubscribeHeaders(token),
  });
  if (!result.sent) {
    await supabaseAdmin.rpc("marketing_release_welcome", { _email: email });
    return { sent: false, reason: result.reason ?? "השליחה נכשלה" };
  }
  return { sent: true };
}
