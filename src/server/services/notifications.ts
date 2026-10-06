/**
 * התראות מייל של החנות — צד שרת בלבד (חלק 17).
 *
 *  sendOrderEmail        — אישור הזמנה מעוצב ללקוח הקצה: מספר ההזמנה, סיכום
 *                          העגלה, הסכומים ופרטי המשלוח (+ מסמך PDF מצורף).
 *                          נקרא עם כל הזמנה (sendOrderEmailsInternal) — גם
 *                          אחרי תשלום מאושר ב-Webhook של Hyp.
 *  sendNotificationEmail — שליחה דרך Resend + רישום כל ניסיון ב-notification_logs.
 *  checkResendKey        — בדיקת מפתח Resend של חנות בשמירה (GET /domains).
 *
 * איזה מפתח: אם החנות חיברה חשבון Resend משלה (tenant_email_secrets) — קודם
 * דרכו, מהכתובת שעל הדומיין שלה. אם השליחה נכשלה (מפתח בוטל, דומיין לא
 * מאומת) — שולחים שוב במפתח הפלטפורמה (RESEND_API_KEY), כדי שהלקוח יקבל את
 * המייל בכל מקרה. כל ניסיון — הצלחה, כישלון או דילוג — נרשם ביומן.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  emailActionButton,
  escapeHtml,
  isValidEmail,
  recordCustomerEmail,
  renderEmailHtml,
  resendApiUrl,
  sendEmail,
  type EmailAttachment,
  type EmailLogTarget,
  type EmailTransport,
  type SendResult,
} from "@/lib/email.server";
import {
  formatMoney,
  prepareOrderEmail,
  type PreparedOrderEmail,
} from "@/lib/order-email-data.server";
import { formatUnitIls } from "@/lib/catalog";

export type NotificationTemplate = "order_confirmation" | "order_staff" | "order_shipped" | "test";
export type NotificationProvider = "tenant" | "platform";

export type NotificationResult = SendResult & {
  /** דרך איזה מפתח יצא המייל בסוף (null = לא נשלח בכלל) */
  provider: NotificationProvider | null;
  /** מפתח החנות נכשל ועברנו למפתח הפלטפורמה */
  fellBack: boolean;
  /** השגיאה של מפתח החנות (אם נכשל) */
  storeKeyError?: string | null;
};

export type NotificationInput = {
  template: NotificationTemplate;
  orderId?: string | null;
  to: string[];
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
  /** רישום בתיק הלקוח (יומן המיילים) — פעם אחת, לתוצאה הסופית */
  logFor?: EmailLogTarget;
  replyTo?: string | null;
  /** false = תמיד דרך הפלטפורמה (התראות פנימיות לצוות החנות) */
  useStoreKey?: boolean;
};

/** מפתח Resend של חנות: re_ ואחריו אותיות / ספרות / _ / - */
export const RESEND_KEY_FORMAT = /^re_[A-Za-z0-9_-]{8,200}$/;

/** "re_••••abcd" — לזיהוי המפתח בפאנל בלי לחשוף אותו */
export function resendKeyHint(apiKey: string): string {
  return `re_••••${apiKey.slice(-4)}`;
}

/** חשבון ה-Resend של החנות הנוכחית (null = לא חובר — שולחים במפתח הפלטפורמה) */
export async function tenantEmailTransport(): Promise<EmailTransport | null> {
  try {
    const { maybeCurrentTenant } = await import("@/integrations/supabase/tenant.server");
    if (!maybeCurrentTenant()) return null;
    const { data } = await supabaseAdmin
      .from("tenant_email_secrets")
      .select("resend_api_key, sender_email")
      .maybeSingle();
    if (!data || !RESEND_KEY_FORMAT.test(data.resend_api_key) || !isValidEmail(data.sender_email)) {
      return null;
    }
    return { apiKey: data.resend_api_key, senderAddress: data.sender_email };
  } catch (error) {
    console.error("[notifications] failed to load the store email key", error);
    return null;
  }
}

function statusOf(result: SendResult): "sent" | "failed" | "skipped" {
  return result.sent ? "sent" : result.skipped ? "skipped" : "failed";
}

/** שורה ביומן ההתראות של החנות. כשל ברישום לא מפיל את השליחה. */
export async function logNotification(
  input: Pick<NotificationInput, "template" | "orderId" | "to" | "subject">,
  result: SendResult,
  provider: NotificationProvider | null,
): Promise<void> {
  try {
    const { maybeCurrentTenant } = await import("@/integrations/supabase/tenant.server");
    if (!maybeCurrentTenant()) return;
    const status = statusOf(result);
    const { error } = await supabaseAdmin.from("notification_logs").insert({
      order_id: input.orderId ?? null,
      type: "email",
      template: input.template,
      recipient: input.to.join(", ").slice(0, 1000),
      subject: input.subject.slice(0, 300),
      status,
      provider: status === "skipped" ? null : provider,
      provider_message_id: result.id ?? null,
      error: result.sent ? null : (result.reason ?? "שגיאה לא ידועה").slice(0, 1000),
    });
    if (error) console.error("[notifications] log insert failed", error.message);
  } catch (error) {
    console.error("[notifications] log failed", error);
  }
}

/** מצב מפתח החנות אחרי ניסיון: הצלחה → הדומיין מאומת; כישלון → השגיאה האחרונה */
async function markStoreKey(result: SendResult): Promise<void> {
  try {
    const nowIso = new Date().toISOString();
    await supabaseAdmin.from("tenant_email_secrets").update(
      result.sent
        ? { domain_status: "verified", last_error: null, last_error_at: null }
        : {
            last_error: (result.reason ?? "שגיאה לא ידועה").slice(0, 500),
            last_error_at: nowIso,
          },
    );
  } catch (error) {
    console.error("[notifications] failed to update the store key status", error);
  }
}

/**
 * שליחת התראה: מפתח החנות (אם חובר) ← גיבוי במפתח הפלטפורמה. כל ניסיון נרשם
 * ב-notification_logs; בתיק הלקוח (logFor) נרשמת רק התוצאה הסופית.
 */
export async function sendNotificationEmail(input: NotificationInput): Promise<NotificationResult> {
  const message = {
    to: input.to,
    subject: input.subject,
    html: input.html,
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  };
  const finish = async (
    result: SendResult,
    provider: NotificationProvider | null,
    extra: { fellBack: boolean; storeKeyError?: string | null },
  ): Promise<NotificationResult> => {
    if (input.logFor) await recordCustomerEmail({ ...message, logFor: input.logFor }, result);
    return { ...result, provider: result.sent ? provider : null, ...extra };
  };

  const transport = input.useStoreKey === false ? null : await tenantEmailTransport();
  let storeKeyError: string | null = null;
  if (transport) {
    const viaStore = await sendEmail({ ...message, transport });
    await logNotification(input, viaStore, "tenant");
    // אין נמען תקין — גם הפלטפורמה לא תשלח
    if (viaStore.sent || viaStore.skipped) {
      if (viaStore.sent) await markStoreKey(viaStore);
      return finish(viaStore, "tenant", { fellBack: false });
    }
    storeKeyError = viaStore.reason ?? "שגיאה לא ידועה";
    await markStoreKey(viaStore);
    console.error(
      `[notifications] store Resend key failed (${input.template}) — falling back to the platform key:`,
      storeKeyError,
    );
  }

  const viaPlatform = await sendEmail(message);
  await logNotification(input, viaPlatform, "platform");
  return finish(viaPlatform, "platform", { fellBack: transport !== null, storeKeyError });
}

// ============================================================
// אישור הזמנה ללקוח
// ============================================================

const CELL =
  "padding:9px 10px;border-bottom:1px solid #e8ece8;text-align:right;vertical-align:top;";

function formatOrderDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("he-IL", {
      timeZone: "Asia/Jerusalem",
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return "";
  }
}

/** תיבת "פרטי המשלוח" ללקוח */
function customerDeliveryHtml(prepared: PreparedOrderEmail): string {
  const box = (title: string, body: string, accent = "#e2e8e2", background = "#f7faf7") =>
    `<div style="margin:0 0 16px;padding:12px 14px;border:1px solid ${accent};border-radius:10px;background:${background};">
      <p style="margin:0 0 6px;font-weight:bold;color:#12211F;">${title}</p>
      ${body}
    </div>`;
  const method = prepared.cart.shipping
    ? `<p style="margin:0 0 6px;"><strong>שיטת משלוח:</strong> ${escapeHtml(prepared.cart.shipping.label)}${
        prepared.isQuote
          ? ""
          : ` · ${prepared.cart.shipping.free ? "חינם 🎉" : formatMoney(prepared.cart.shipping.amount)}`
      }</p>`
    : "";

  if (prepared.shippingKind === "pickup") {
    return box(
      "🏬 איסוף עצמי",
      `${method}<p style="margin:0;">${
        prepared.pickupAddress
          ? `הכתובת לאיסוף: ${escapeHtml(prepared.pickupAddress)}`
          : "נעדכן אתכם כשההזמנה מוכנה לאיסוף."
      }</p>`,
      "#c4b5fd",
      "#f5f3ff",
    );
  }
  if (prepared.shippingKind === "digital") {
    return box(
      "📧 מוצרים דיגיטליים",
      `<p style="margin:0;">הרישיונות / הקבצים יישלחו אליכם במייל נפרד.</p>`,
    );
  }
  const { delivery } = prepared;
  if (!delivery.address && !method) return "";
  return box(
    delivery.isAlternate ? "📦 משלוח לכתובת אחרת" : "📦 משלוח עד הבית",
    `${method}
      ${delivery.name ? `<p style="margin:0;">${escapeHtml(delivery.name)}${delivery.phone ? ` · <span dir="ltr">${escapeHtml(delivery.phone)}</span>` : ""}</p>` : ""}
      ${delivery.address ? `<p style="margin:2px 0 0;">${escapeHtml(delivery.address)}</p>` : ""}`,
    delivery.isAlternate ? "#d97706" : "#e2e8e2",
    delivery.isAlternate ? "#fffbeb" : "#f7faf7",
  );
}

/** טבלת סיכום העגלה ללקוח (בלי ברקודים) */
function customerCartHtml(prepared: PreparedOrderEmail): string {
  const priced = !prepared.isQuote;
  const head = ["מוצר", "כמות", ...(priced ? ["מחיר", 'סה"כ'] : [])]
    .map(
      (label) =>
        `<th style="padding:9px 10px;text-align:right;font-size:13px;font-weight:bold;">${label}</th>`,
    )
    .join("");
  const rows = prepared.cart.lines
    .map((line, index) => {
      const background = index % 2 === 1 ? "background:#fafcfa;" : "";
      const name = `${escapeHtml(line.name)}${
        line.digital
          ? `<div style="font-size:12px;color:#6b7280;">מוצר דיגיטלי — נשלח במייל</div>`
          : ""
      }`;
      const cells = [
        name,
        String(line.quantity),
        ...(priced ? [formatUnitIls(line.unitPrice), formatMoney(line.lineTotal)] : []),
      ];
      return `<tr>${cells.map((cell) => `<td style="${CELL}${background}">${cell}</td>`).join("")}</tr>`;
    })
    .join("");
  const extraRows: string[] = [];
  const { shipping, discount } = prepared.cart;
  if (shipping) {
    const price = shipping.free ? "חינם" : formatMoney(shipping.amount);
    extraRows.push(
      `<tr>${[`משלוח: ${escapeHtml(shipping.label)}`, "1", ...(priced ? [price, price] : [])]
        .map((cell) => `<td style="${CELL}background:#f7faf7;">${cell}</td>`)
        .join("")}</tr>`,
    );
  }
  if (discount && priced) {
    extraRows.push(
      `<tr>${[
        escapeHtml(discount.label),
        "1",
        `-${formatMoney(discount.amount)}`,
        `-${formatMoney(discount.amount)}`,
      ]
        .map((cell) => `<td style="${CELL}background:#f0fdf4;color:#15803d;">${cell}</td>`)
        .join("")}</tr>`,
    );
  }
  return `<table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;border:1px solid #e2e8e2;border-radius:10px;overflow:hidden;margin:0 0 14px;">
      <thead><tr style="background:#12211F;color:#ffffff;">${head}</tr></thead>
      <tbody>${rows}${extraRows.join("")}</tbody>
    </table>`;
}

/** תיבת הסכומים */
function customerTotalsHtml(prepared: PreparedOrderEmail): string {
  const { vat, lines, shipping, discount } = prepared.cart;
  if (!vat) {
    return `<p style="margin:0 0 16px;color:#3d4a44;">בקשה זו אינה כוללת מחירים — נציג יחזור אליכם עם הצעת מחיר מותאמת.</p>`;
  }
  const row = (label: string, value: string, strong = false, color = "#1f2933") =>
    `<tr><td style="padding:4px 0;color:${color};${strong ? "font-weight:bold;font-size:16px;" : ""}">${label}</td><td style="padding:4px 0;text-align:left;color:${color};${strong ? "font-weight:bold;font-size:16px;" : ""}" dir="ltr">${value}</td></tr>`;
  const itemsSum = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const parts = [row("סכום הפריטים", formatMoney(itemsSum))];
  if (shipping) parts.push(row("משלוח", shipping.free ? "חינם" : formatMoney(shipping.amount)));
  if (discount)
    parts.push(
      row(escapeHtml(discount.label), `-${formatMoney(discount.amount)}`, false, "#15803d"),
    );
  if (vat.showBreakdown) {
    parts.push(row('סה"כ לפני מע"מ', formatMoney(vat.net)));
    parts.push(row(`מע"מ ${vat.vatRate}%`, formatMoney(vat.vat)));
    parts.push(row('סה"כ לתשלום', formatMoney(vat.gross), true));
  } else if (vat.exempt) {
    // חלק 23: לא נגבה מע"מ (עוסק פטור)
    parts.push(row('סה"כ לתשלום', formatMoney(vat.gross), true));
    parts.push(row('ללא מע"מ', "", false, "#5b6670"));
  } else {
    parts.push(row('סה"כ לתשלום (כולל מע"מ)', formatMoney(vat.gross), true));
  }
  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;padding:12px 14px;background:#f7faf7;border:1px solid #e2e8e2;border-radius:10px;">
      <tr><td style="padding:10px 14px;"><table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;">${parts.join("")}</table></td></tr>
    </table>`;
}

/** "אמצעי תשלום" ללקוח (חלק 17ב): טלפוני / ביט (ממתין לאישור) / אשראי */
function customerPaymentHtml(prepared: PreparedOrderEmail): string {
  if (prepared.isQuote) return "";
  const { method, status, bitReference, bitReceipt } = prepared.payment;
  const box = (title: string, body: string, accent: string, background: string) =>
    `<div style="margin:0 0 16px;padding:12px 14px;border:1px solid ${accent};border-radius:10px;background:${background};">
      <p style="margin:0 0 6px;font-weight:bold;color:#12211F;">${title}</p>
      ${body}
    </div>`;
  if (method === "bit") {
    const proof = [
      bitReference ? `מספר אסמכתא: <span dir="ltr">${escapeHtml(bitReference)}</span>` : "",
      bitReceipt ? "צילום מסך של ההעברה צורף" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return status === "paid"
      ? box(
          "💳 תשלום בביט",
          `<p style="margin:0;">התשלום התקבל ואושר. ${proof}</p>`,
          "#86efac",
          "#f0fdf4",
        )
      : box(
          "💳 תשלום בביט — ממתין לאישור",
          `<p style="margin:0 0 4px;">קיבלנו את פרטי ההעברה${proof ? ` (${proof})` : ""}.</p>
           <p style="margin:0;">ההזמנה תטופל מיד לאחר שבעל החנות יאשר את קבלת התשלום.</p>`,
          "#fcd34d",
          "#fffbeb",
        );
  }
  if (method === "credit_card" && status === "paid") {
    return box("💳 תשלום באשראי", `<p style="margin:0;">התשלום התקבל.</p>`, "#86efac", "#f0fdf4");
  }
  return box(
    "📞 תשלום טלפוני מול נציג",
    `<p style="margin:0;">אין חיוב באתר — נציג ייצור איתכם קשר לסידור התשלום.</p>`,
    "#e2e8e2",
    "#f7faf7",
  );
}

/** גוף אישור ההזמנה ללקוח (בתוך העטיפה של renderEmailHtml) — פונקציה טהורה */
export function renderOrderConfirmationBody(
  prepared: PreparedOrderEmail,
  accountUrl: string | null = null,
): string {
  const greeting = escapeHtml(prepared.greetingName || "לקוח יקר");
  const intro = prepared.isQuote
    ? `<p style="margin:0 0 16px;">בקשתכם להצעת מחיר התקבלה. נציג יעבור על הפריטים ויחזור אליכם עם הצעת מחיר מותאמת.</p>`
    : `<p style="margin:0 0 16px;">תודה על ההזמנה! ההזמנה שלכם התקבלה ונשלחה לביצוע.</p>`;
  const date = formatOrderDate(prepared.createdAt);
  const summaryCell = (label: string, value: string, ltr = false) =>
    `<td style="padding:12px 14px;vertical-align:top;">
        <div style="font-size:12px;color:#6b7280;">${label}</div>
        <div style="font-size:17px;font-weight:bold;color:#12211F;"${ltr ? ' dir="ltr"' : ""}>${value}</div>
      </td>`;
  const summary = `<table role="presentation" style="width:100%;border-collapse:collapse;background:#f0f5f1;border:1px solid #d6e2d9;border-radius:10px;margin:0 0 20px;">
      <tr>
        ${summaryCell(prepared.isQuote ? "מספר בקשה" : "מספר הזמנה", escapeHtml(prepared.orderNumber), true)}
        ${date ? summaryCell("תאריך", escapeHtml(date)) : ""}
        ${prepared.cart.vat ? summaryCell('סה"כ', formatMoney(prepared.cart.vat.gross), true) : ""}
      </tr>
    </table>`;
  const sectionTitle = (title: string) =>
    `<h3 style="margin:0 0 10px;font-size:16px;color:#12211F;">${title}</h3>`;
  const contact = prepared.isQuote
    ? ""
    : `<p style="margin:0 0 12px;">${
        prepared.agentName
          ? `${escapeHtml(prepared.agentName)}, הסוכן המטפל שלכם, ייצור`
          : "נציג ייצור"
      } איתכם קשר בהקדם לתיאום המשך הטיפול.</p>`;
  const deliverySection = customerDeliveryHtml(prepared);
  const paymentSection = customerPaymentHtml(prepared);

  return `
    <p style="margin:0 0 8px;">שלום ${greeting},</p>
    ${intro}
    ${summary}
    ${sectionTitle(prepared.isQuote ? "הפריטים בבקשה" : "סיכום ההזמנה")}
    ${customerCartHtml(prepared)}
    ${customerTotalsHtml(prepared)}
    ${deliverySection ? `${sectionTitle("פרטי משלוח")}${deliverySection}` : ""}
    ${paymentSection ? `${sectionTitle("אמצעי תשלום")}${paymentSection}` : ""}
    ${prepared.note ? `<p style="margin:0 0 12px;"><strong>הערות להזמנה:</strong> ${escapeHtml(prepared.note)}</p>` : ""}
    ${contact}
    ${accountUrl ? emailActionButton("למעקב אחרי ההזמנה", accountUrl) : ""}
    <p style="margin-top:12px;color:#6b7280;font-size:13px;">${
      prepared.isQuote ? "פירוט הפריטים מצורף כקובץ PDF." : "אישור ההזמנה המלא מצורף כקובץ PDF."
    }</p>
  `;
}

/** קישור ל"ההזמנות שלי" — רק ללקוח רשום (לאורח אין חשבון) */
async function accountOrdersUrl(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  try {
    const { tenantSiteOrigin } = await import("@/integrations/supabase/tenant.server");
    return `${tenantSiteOrigin()}/account?tab=orders`;
  } catch {
    return null;
  }
}

/**
 * אישור הזמנה / בקשת הצעת מחיר ללקוח הקצה. prepared — כשהנתונים כבר נטענו
 * (sendOrderEmailsInternal שולח גם לצוות מאותם נתונים).
 */
export async function sendOrderEmail(
  orderId: string,
  options: { sentBy?: string | null; prepared?: PreparedOrderEmail | null } = {},
): Promise<NotificationResult> {
  const prepared =
    options.prepared !== undefined ? options.prepared : await prepareOrderEmail(orderId);
  if (!prepared) {
    // ממתינה לתשלום — המייל יישלח אחרי אישור התשלום (לא ניסיון, לא נרשם)
    return {
      sent: false,
      skipped: true,
      reason: "ההזמנה ממתינה לתשלום",
      provider: null,
      fellBack: false,
    };
  }
  const subject = `${prepared.documentLabel} ${prepared.orderNumber} התקבלה`;
  if (!prepared.customerEmail) {
    const result: SendResult = { sent: false, skipped: true, reason: "אין כתובת מייל ללקוח" };
    await logNotification(
      { template: "order_confirmation", orderId, to: [], subject },
      result,
      null,
    );
    return { ...result, provider: null, fellBack: false };
  }

  const html = await renderEmailHtml(
    `${prepared.documentLabel} התקבלה`,
    renderOrderConfirmationBody(prepared, await accountOrdersUrl(prepared.customerId)),
  );
  return sendNotificationEmail({
    template: "order_confirmation",
    orderId,
    to: [prepared.customerEmail],
    subject,
    html,
    attachments: prepared.attachments,
    // יומן המיילים בתיק הלקוח — רק ללקוח רשום (לאורח אין תיק)
    ...(prepared.customerId
      ? {
          logFor: {
            userId: prepared.customerId,
            kind: prepared.isQuote ? ("quote" as const) : ("order" as const),
            sentBy: options.sentBy ?? null,
          },
        }
      : {}),
  });
}

// ============================================================
// בדיקת מפתח Resend של חנות
// ============================================================

export type ResendKeyCheck =
  | { ok: false; error: string }
  | { ok: true; domainStatus: "verified" | "unverified" | "unknown"; message: string };

type ResendDomain = { name?: unknown; status?: unknown };

/**
 * בודק מול Resend שהמפתח תקף ושהדומיין של כתובת השולח נמצא בחשבון:
 *  - מפתח שגוי / מבוטל → שגיאה (לא נשמר)
 *  - הדומיין לא בחשבון → שגיאה, עם הדומיינים שכן נמצאו
 *  - הדומיין בחשבון אבל לא מאומת עדיין → נשמר עם אזהרה (עד האימות — שליחה
 *    דרך הפלטפורמה)
 *  - מפתח "שליחה בלבד" (restricted) → נשמר; אי אפשר לבדוק את הדומיין מראש
 */
export async function checkResendKey(apiKey: string, senderEmail: string): Promise<ResendKeyCheck> {
  const domain = senderEmail.split("@")[1]?.toLowerCase() ?? "";
  let response: Response;
  try {
    response = await fetch(`${resendApiUrl()}/domains`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    console.error("[notifications] Resend key check failed", error);
    return { ok: false, error: "אין חיבור ל-Resend כרגע. נסו שוב בעוד רגע." };
  }
  const body = (await response.json().catch(() => null)) as {
    name?: unknown;
    message?: unknown;
    data?: unknown;
  } | null;
  const errorName = typeof body?.name === "string" ? body.name : "";
  const errorMessage = typeof body?.message === "string" ? body.message : "";

  if (!response.ok) {
    if (errorName === "restricted_api_key" || /restricted/i.test(errorMessage)) {
      return {
        ok: true,
        domainStatus: "unknown",
        message: `המפתח הוא מפתח "שליחה בלבד", ולכן אי אפשר לבדוק מראש שהדומיין ${domain} מאומת. שלחו מייל בדיקה כדי לוודא שהכול עובד.`,
      };
    }
    if (
      response.status === 401 ||
      response.status === 403 ||
      errorName === "invalid_api_key" ||
      errorName === "missing_api_key"
    ) {
      return {
        ok: false,
        error:
          "מפתח ה-API של Resend שגוי או שבוטל. צרו מפתח חדש בחשבון ה-Resend שלכם (API Keys) והדביקו אותו כאן.",
      };
    }
    return { ok: false, error: `Resend החזיר שגיאה (${response.status}). נסו שוב בעוד רגע.` };
  }

  const domains = (Array.isArray(body?.data) ? (body.data as ResendDomain[]) : [])
    .map((entry) => ({
      name: typeof entry.name === "string" ? entry.name.trim().toLowerCase() : "",
      status: typeof entry.status === "string" ? entry.status : "",
    }))
    .filter((entry) => entry.name !== "");
  const match =
    domains.find((entry) => entry.name === domain) ??
    domains.find((entry) => domain.endsWith(`.${entry.name}`));
  if (!match) {
    const known = domains.map((entry) => entry.name).join(", ");
    return {
      ok: false,
      error: `הדומיין ${domain} לא נמצא בחשבון ה-Resend שלכם. הוסיפו ואמתו אותו ב-Resend (Domains)${
        known ? `, או בחרו כתובת שולח על דומיין שכבר נמצא שם: ${known}` : ""
      }.`,
    };
  }
  if (match.status === "verified") {
    return {
      ok: true,
      domainStatus: "verified",
      message: `הדומיין ${match.name} מאומת ב-Resend — המיילים ללקוחות יישלחו מ-${senderEmail}.`,
    };
  }
  return {
    ok: true,
    domainStatus: "unverified",
    message: `הדומיין ${match.name} עדיין לא מאומת ב-Resend (סטטוס: ${match.status || "לא ידוע"}). עד שהאימות יסתיים, המיילים ימשיכו לצאת דרך מערכת השליחה של הפלטפורמה.`,
  };
}
