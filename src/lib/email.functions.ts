import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { formatUnitIls } from "@/lib/catalog";

/**
 * שליחת מיילי הזמנה/בקשת הצעת מחיר: סיכום מלא לסוכן המשויך ולמנהלים
 * שנבחרו, ואישור ללקוח. לכל המיילים מצורף אוטומטית מסמך PDF (אישור הזמנה
 * או בקשה להצעת מחיר) עם לוגו העסק, פרטיו, מספר הסוכן ופירוט הפריטים.
 * כשלון שליחה לא מבטל את ההזמנה — היא כבר נשמרה במסד.
 */
export const sendOrderEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    const orderId = String(input?.orderId ?? "").trim();
    if (!orderId) throw new Error("חסר מזהה הזמנה");
    return { orderId };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendEmail, renderEmailHtml, escapeHtml } = await import("@/lib/email.server");
    const { loadOrderDocument } = await import("@/lib/documents.server");
    const { calculateVat } = await import("@/lib/vat");

    const { order, customerEmail, customerName, agentEmail, agentName, pdf } =
      await loadOrderDocument(data.orderId);

    const { data: caller } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    const isOwner = context.userId === order.customer_id || context.userId === order.agent_id;
    if (!isOwner && caller?.role !== "admin") throw new Error("אין הרשאה");

    const { data: customerProfile } = await supabaseAdmin
      .from("customer_profiles")
      .select("business_name, contact_name, phone")
      .eq("user_id", order.customer_id)
      .maybeSingle();

    const recipientEmails = new Set<string>();
    if (agentEmail) recipientEmails.add(agentEmail);

    const { data: emailSettings } = await supabaseAdmin
      .from("email_settings")
      .select("sender_email, notify_admin_user_ids")
      .eq("id", true)
      .maybeSingle();
    if (emailSettings?.notify_admin_user_ids?.length) {
      const { data: admins } = await supabaseAdmin
        .from("user_roles")
        .select("email")
        .in("user_id", emailSettings.notify_admin_user_ids);
      for (const admin of admins ?? []) if (admin.email) recipientEmails.add(admin.email);
    }

    const senderEmail = emailSettings?.sender_email?.trim() || "";
    const isQuote = order.kind === "quote";
    const documentLabel = isQuote ? "בקשה להצעת מחיר" : "הזמנה";

    const itemsTotal = order.order_items.reduce(
      (sum, item) => sum + Number(item.unit_price) * item.quantity,
      0,
    );
    const vat = isQuote
      ? null
      : calculateVat(itemsTotal, {
          pricesIncludeVat: order.prices_include_vat ?? true,
          vatRate: Number(order.vat_rate ?? 18),
        });

    const money = (value: number) => `₪${value.toFixed(2)}`;

    const itemsHtml = order.order_items
      .map((item) => {
        const cells = [
          escapeHtml(item.product_name ?? "מוצר"),
          escapeHtml(item.product_barcode ?? "—"),
          String(item.quantity),
          ...(isQuote
            ? []
            : [
                formatUnitIls(Number(item.unit_price)),
                money(Number(item.unit_price) * item.quantity),
              ]),
        ];
        return `<tr>${cells
          .map((cell) => `<td style="padding:6px 8px;border-bottom:1px solid #eee;">${cell}</td>`)
          .join("")}</tr>`;
      })
      .join("");

    const headers = ["מוצר", "ברקוד", "כמות", ...(isQuote ? [] : ["מחיר יחידה", 'סה"כ'])]
      .map((header) => `<th style="text-align:right;padding:6px 8px;">${header}</th>`)
      .join("");

    const totalsHtml = vat
      ? vat.showBreakdown
        ? `<p style="margin-top:12px;">סה"כ לפני מע"מ: ${money(vat.net)}<br/>מע"מ ${vat.vatRate}%: ${money(vat.vat)}<br/><strong>סה"כ לתשלום: ${money(vat.gross)}</strong></p>`
        : `<p style="margin-top:12px;"><strong>סה"כ לתשלום (כולל מע"מ): ${money(vat.gross)}</strong></p>`
      : `<p style="margin-top:12px;">מסמך זה אינו כולל מחירים. נציג ייצור קשר עם הצעת מחיר מותאמת.</p>`;

    const staffHtml = `
      <p><strong>מספר מסמך:</strong> ${escapeHtml(order.order_number)}</p>
      <p><strong>סוג:</strong> ${documentLabel}</p>
      <p><strong>עסק:</strong> ${escapeHtml(customerProfile?.business_name ?? "")}</p>
      <p><strong>איש קשר:</strong> ${escapeHtml(customerProfile?.contact_name ?? "")} · ${escapeHtml(customerProfile?.phone ?? "")}</p>
      <p><strong>אימייל לקוח:</strong> ${escapeHtml(customerEmail ?? "")}</p>
      <table style="width:100%;border-collapse:collapse;margin-top:12px;">
        <thead><tr>${headers}</tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      ${totalsHtml}
      <p style="margin-top:12px;color:#6b7280;font-size:13px;">המסמך המלא מצורף כקובץ PDF.</p>
    `;

    const customerHtml = isQuote
      ? `
      <p>שלום ${escapeHtml(customerName)},</p>
      <p>בקשתכם להצעת מחיר <strong dir="ltr">${escapeHtml(order.order_number)}</strong> התקבלה.</p>
      <p>נציג יעבור על הפריטים ויחזור אליכם עם הצעת מחיר מותאמת לעסק שלכם.</p>
      ${totalsHtml}
      <p style="margin-top:12px;color:#6b7280;font-size:13px;">פירוט הפריטים מצורף כקובץ PDF.</p>
    `
      : `
      <p>שלום ${escapeHtml(customerName)},</p>
      <p>ההזמנה שלכם <strong dir="ltr">${escapeHtml(order.order_number)}</strong> התקבלה ונשלחה לביצוע.</p>
      <p>${agentName ? `${escapeHtml(agentName)}, הסוכן המטפל שלכם, ייצור` : "סוכן ייצור"} איתכם קשר בהקדם לתיאום המשך הטיפול.</p>
      ${totalsHtml}
      <p style="margin-top:12px;color:#6b7280;font-size:13px;">אישור ההזמנה המלא מצורף כקובץ PDF.</p>
    `;

    const attachments = [{ filename: pdf.filename, content: pdf.base64 }];

    const staffResult =
      recipientEmails.size > 0
        ? await sendEmail({
            from: senderEmail,
            to: [...recipientEmails],
            subject: `${documentLabel} חדשה ${order.order_number}`,
            html: await renderEmailHtml(`${documentLabel} חדשה התקבלה`, staffHtml),
            attachments,
          })
        : { sent: false, reason: "אין נמענים מוגדרים" };

    const customerResult = customerEmail
      ? await sendEmail({
          from: senderEmail,
          to: [customerEmail],
          subject: `${documentLabel} ${order.order_number} התקבלה`,
          html: await renderEmailHtml(`${documentLabel} התקבלה`, customerHtml),
          attachments,
          logFor: {
            userId: order.customer_id,
            kind: isQuote ? "quote" : "order",
            sentBy: context.userId,
          },
        })
      : { sent: false, reason: "אין כתובת מייל ללקוח" };

    return { staff: staffResult, customer: customerResult };
  });

/** כפתור "שליחת מייל בדיקה" בפאנל הניהול — נשלח למנהל המחובר עצמו */
export const sendTestEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendEmail, renderEmailHtml } = await import("@/lib/email.server");

    const { data: caller } = await supabaseAdmin
      .from("user_roles")
      .select("role, email")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (caller?.role !== "admin") throw new Error("אין הרשאה");

    const { data: emailSettings } = await supabaseAdmin
      .from("email_settings")
      .select("sender_email")
      .eq("id", true)
      .maybeSingle();
    const senderEmail = emailSettings?.sender_email?.trim() || "";

    const result = await sendEmail({
      from: senderEmail,
      to: [caller.email],
      subject: "מייל בדיקה",
      // isTest משנה את שורת הסיום ל"אנו מבצעים בדיקה, נא לא להשיב למייל זה"
      html: await renderEmailHtml(
        "מייל בדיקה",
        "<p>זהו מייל בדיקה מפאנל הניהול. אם הוא הגיע — התקשורת עם Resend עובדת תקין.</p>",
        { isTest: true },
      ),
    });
    if (!result.sent) throw new Error(result.reason ?? "השליחה נכשלה");
    return { sentTo: caller.email };
  });

/** הורדת מסמך ה-PDF של הזמנה קיימת (הלקוח עצמו, הסוכן המטפל או מנהל) */
export const downloadOrderDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    const orderId = String(input?.orderId ?? "").trim();
    if (!orderId) throw new Error("חסר מזהה הזמנה");
    return { orderId };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadOrderDocument } = await import("@/lib/documents.server");

    const { order, pdf } = await loadOrderDocument(data.orderId);
    const { data: caller } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    const isOwner = context.userId === order.customer_id || context.userId === order.agent_id;
    if (!isOwner && caller?.role !== "admin") throw new Error("אין הרשאה");

    return { filename: pdf.filename, base64: pdf.base64 };
  });

/**
 * אבחון הגדרות המייל עבור פאנל הניהול: האם מפתח Resend קיים בשרת, מה
 * כתובת השולחת המוגדרת, ומה הדומיין שלה. נועד לענות מיד על "ביקשתי
 * איפוס סיסמה ולא הגיע מייל" בלי לחפש בלוגים.
 */
export const getEmailDiagnostics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: caller } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (caller?.role !== "admin") throw new Error("אין הרשאה");

    const { data: emailSettings } = await supabaseAdmin
      .from("email_settings")
      .select("sender_email")
      .eq("id", true)
      .maybeSingle();

    const senderEmail = emailSettings?.sender_email?.trim() ?? "";
    const apiKey = process.env["RESEND_API_KEY"]?.trim() ?? "";

    return {
      hasApiKey: apiKey !== "",
      // רק 4 תווים אחרונים, כדי לאמת שזה המפתח הנכון בלי לחשוף אותו
      apiKeyHint: apiKey === "" ? null : `••••${apiKey.slice(-4)}`,
      senderEmail,
      senderDomain: senderEmail.includes("@") ? senderEmail.split("@")[1] : null,
      siteUrlConfigured: (process.env["PUBLIC_SITE_URL"]?.trim() ?? "") !== "",
    };
  });
