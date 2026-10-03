import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type ShortageInput = { product_id: string; name: string; ordered: number; picked: number };

/**
 * אחרי אישור ליקוט: מייל ללקוח "ההזמנה לוקטה והציוד בדרך" — עם תמונות המוצרים,
 * מה חסר (אם היה), ו-PDF הסיכום מצורף. מותר למי שליקט / אישר / מנהל, ורק
 * להזמנה שכבר סומנה כ"נשלחה". כישלון כאן לא מבטל את האישור (החזרה: sent=false).
 */
export const sendPickedEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string; shortages?: ShortageInput[] }) => {
    const orderId = String(input?.orderId ?? "").trim();
    if (!orderId) throw new Error("חסר מזהה הזמנה");
    const shortages = Array.isArray(input?.shortages)
      ? input.shortages.slice(0, 200).map((s) => ({
          product_id: String(s.product_id ?? ""),
          name: String(s.name ?? "").slice(0, 200),
          ordered: Number(s.ordered) || 0,
          picked: Number(s.picked) || 0,
        }))
      : [];
    return { orderId, shortages };
  })
  .handler(async ({ data, context }): Promise<{ sent: boolean; reason?: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadOrderDocument } = await import("@/lib/documents.server");
    const { sendEmail, renderEmailHtml, escapeHtml } = await import("@/lib/email.server");

    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, order_number, status, picker_id, picking_approved_by, picked_at")
      .eq("id", data.orderId)
      .maybeSingle();
    if (!order) return { sent: false, reason: "ההזמנה לא נמצאה" };
    const { loadCaller } = await import("@/lib/caller.server");
    const caller = await loadCaller(context.userId);
    const allowed =
      caller?.role === "admin" ||
      order.picker_id === context.userId ||
      order.picking_approved_by === context.userId;
    if (!allowed) return { sent: false, reason: "אין הרשאה" };
    if (order.status !== "shipped") return { sent: false, reason: "ההזמנה עוד לא אושרה" };

    const { data: emailSettings } = await supabaseAdmin
      .from("email_settings")
      .select("sender_email")
      .eq("id", true)
      .maybeSingle();
    const senderEmail =
      (emailSettings as { sender_email?: string } | null)?.sender_email?.trim() || "";
    if (!senderEmail) return { sent: false, reason: "לא הוגדרה כתובת שולח בהגדרות המייל" };

    const doc = await loadOrderDocument(data.orderId);
    if (!doc.customerEmail) return { sent: false, reason: "ללקוח אין כתובת מייל" };

    // תמונות המוצרים — לפי השורות הסופיות של ההזמנה
    const { data: items } = await supabaseAdmin
      .from("order_items")
      .select("quantity, product_name, is_deposit, product_id")
      .eq("order_id", data.orderId)
      .eq("is_deposit", false);
    const productIds = [
      ...new Set((items ?? []).map((i) => i.product_id).filter((id): id is string => !!id)),
    ];
    const { data: products } = productIds.length
      ? await supabaseAdmin
          .from("global_products")
          .select("id, image_url, pack_size")
          .in("id", productIds)
      : { data: [] as { id: string; image_url: string | null; pack_size: number | null }[] };
    const byId = new Map((products ?? []).map((p) => [p.id, p]));

    const rows = (items ?? [])
      .map((item) => {
        const product = item.product_id ? byId.get(item.product_id) : undefined;
        const packs =
          product?.pack_size &&
          product.pack_size >= 2 &&
          Number.isInteger(item.quantity / product.pack_size)
            ? ` (${item.quantity / product.pack_size === 1 ? "ארגז אחד" : `${item.quantity / product.pack_size} ארגזים`})`
            : "";
        const img = product?.image_url
          ? `<img src="${escapeHtml(product.image_url)}" alt="" width="56" height="56" style="width:56px;height:56px;object-fit:contain;border-radius:8px;background:#f3f4f6;" />`
          : "";
        return `<tr><td style="padding:6px 8px;width:64px;">${img}</td><td style="padding:6px 8px;">${escapeHtml(item.product_name ?? "")}</td><td style="padding:6px 8px;white-space:nowrap;">${item.quantity} יח׳${packs}</td></tr>`;
      })
      .join("");
    const shortagesHtml = data.shortages.length
      ? `<div style="margin-top:16px;padding:12px;border-radius:10px;background:#fff7ed;border:1px solid #fdba74;"><p style="margin:0 0 6px;font-weight:700;">שימו לב — פריטים שחסרו במלאי ולכן לא נשלחו במלואם:</p><ul style="margin:0;padding-inline-start:18px;">${data.shortages
          .map((s) => `<li>${escapeHtml(s.name)}: נשלחו ${s.picked} מתוך ${s.ordered}</li>`)
          .join("")}</ul><p style="margin:6px 0 0;">ההזמנה והחשבון עודכנו בהתאם.</p></div>`
      : "";
    const body = `
      <p>שלום ${escapeHtml(doc.customerName)},</p>
      <p>הזמנה <strong>${escapeHtml(order.order_number)}</strong> לוקטה במחסן והציוד בדרך אליכם.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:12px;">${rows}</table>
      ${shortagesHtml}
      <p style="margin-top:16px;">מסמך הסיכום המעודכן מצורף כקובץ PDF.</p>`;

    return sendEmail({
      from: senderEmail,
      to: [doc.customerEmail],
      subject: `הזמנה ${order.order_number} בדרך אליכם`,
      html: await renderEmailHtml("ההזמנה לוקטה והציוד בדרך", body),
      attachments: [{ filename: doc.pdf.filename, content: doc.pdf.base64 }],
    });
  });
