import { staffLabel } from "@/lib/staff";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * תיק לקוח: כל המידע על לקוח במסך אחד — פרטי העסק, העגלה שהוא אוסף
 * כרגע, הזמנות פתוחות, היסטוריה מלאה וסטטוס טופס תנאי השירות.
 * בנוסף: שליחת מייל אישי מהמנהל ללקוח.
 */

type Caller = { role: string | null };

/** מנהל רואה כל לקוח; סוכן רק את הלקוחות המשויכים אליו */
async function assertCanViewCustomer(callerId: string, customerId: string): Promise<Caller> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { loadCaller } = await import("@/lib/caller.server");
  const caller = await loadCaller(callerId);
  if (caller.role === "admin") return { role: "admin" };
  if (caller.role === "agent") {
    const { data: profile } = await supabaseAdmin
      .from("customer_profiles")
      .select("agent_id")
      .eq("user_id", customerId)
      .maybeSingle();
    if (profile?.agent_id === callerId) return { role: "agent" };
  }
  throw new Error("אין הרשאה לצפות בתיק הלקוח הזה");
}

export const getCustomerFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => {
    const userId = String(input?.userId ?? "").trim();
    if (!userId) throw new Error("חסר מזהה לקוח");
    return { userId };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertCanViewCustomer(context.userId, data.userId);

    const [roleResult, profileResult, cartResult, ordersResult, agreementResult, emailsResult] =
      await Promise.all([
        supabaseAdmin
          .from("user_roles")
          .select(
            "user_id, email, username, role, is_approved, is_blocked, agent_number, created_at",
          )
          .eq("user_id", data.userId)
          .maybeSingle(),
        supabaseAdmin
          .from("customer_profiles")
          .select(
            "business_name, business_address, tax_id, contact_name, phone, price_tier, agent_id, created_at",
          )
          .eq("user_id", data.userId)
          .maybeSingle(),
        supabaseAdmin
          .from("customer_carts")
          .select("items, updated_at")
          .eq("user_id", data.userId)
          .maybeSingle(),
        supabaseAdmin
          .from("orders")
          .select(
            "id, order_number, status, kind, total, created_at, order_items (quantity, unit_price, product_name)",
          )
          .eq("customer_id", data.userId)
          .order("created_at", { ascending: false }),
        supabaseAdmin
          .from("service_agreements")
          .select("sent_at, signed_at, signer_name, signature_svg")
          .eq("user_id", data.userId)
          .maybeSingle(),
        supabaseAdmin
          .from("customer_emails")
          .select("id, to_email, subject, kind, html, sent, error, created_at")
          .eq("user_id", data.userId)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);

    let agentLabel: string | null = null;
    if (profileResult.data?.agent_id) {
      const { data: agent } = await supabaseAdmin
        .from("user_roles")
        .select("email, username, agent_number, display_name")
        .eq("user_id", profileResult.data.agent_id)
        .maybeSingle();
      agentLabel = agent ? staffLabel(agent) : null;
    }

    type CartRow = { productId: string; name: string; price: number; quantity: number };
    const cartItems = Array.isArray(cartResult.data?.items)
      ? (cartResult.data?.items as unknown as CartRow[])
      : [];

    const orders = (ordersResult.data ?? []).map((order) => ({
      id: order.id,
      orderNumber: order.order_number,
      status: order.status,
      kind: order.kind,
      total: Number(order.total),
      createdAt: order.created_at,
      itemCount: order.order_items?.length ?? 0,
      items: (order.order_items ?? []).map((item) => ({
        name: item.product_name ?? "מוצר",
        quantity: item.quantity,
        unitPrice: Number(item.unit_price),
      })),
    }));

    return {
      account: {
        email: roleResult.data?.email ?? "",
        username: roleResult.data?.username ?? "",
        isApproved: roleResult.data?.is_approved ?? false,
        isBlocked: roleResult.data?.is_blocked ?? false,
        createdAt: roleResult.data?.created_at ?? null,
      },
      profile: {
        businessName: profileResult.data?.business_name ?? "",
        businessAddress: profileResult.data?.business_address ?? "",
        taxId: profileResult.data?.tax_id ?? "",
        contactName: profileResult.data?.contact_name ?? "",
        phone: profileResult.data?.phone ?? "",
        priceTier: profileResult.data?.price_tier ?? null,
        agentLabel,
      },
      cart: { items: cartItems, updatedAt: cartResult.data?.updated_at ?? null },
      // הזמנות "פתוחות" = כל מה שעוד בטיפול; השאר היסטוריה
      openOrders: orders.filter((order) =>
        ["pending", "agent_review", "picking", "picked"].includes(order.status),
      ),
      pastOrders: orders.filter(
        (order) => !["pending", "agent_review", "picking", "picked"].includes(order.status),
      ),
      emails: (emailsResult.data ?? []).map((email) => ({
        id: email.id,
        toEmail: email.to_email,
        subject: email.subject,
        kind: email.kind,
        html: email.html,
        sent: email.sent,
        error: email.error,
        createdAt: email.created_at,
      })),
      agreement: {
        sentAt: agreementResult.data?.sent_at ?? null,
        signedAt: agreementResult.data?.signed_at ?? null,
        signerName: agreementResult.data?.signer_name ?? null,
        signatureSvg: agreementResult.data?.signature_svg ?? null,
      },
    };
  });

/**
 * הודעת מייל שנשלחת ידנית מהמערכת.
 *
 * הנמען הוא לקוח קיים (לפי מזהה) או כתובת חופשית שהוקלדה — למשל לקוח
 * פוטנציאלי שעדיין אין לו חשבון. הגוף הוא טקסט חופשי: הוא עובר escaping,
 * וקישורים שמודבקים בו (כמו קישור תשלום) הופכים ללחיצים. אפשר להוסיף גם
 * כפתור פעולה בולט עם קישור.
 */
export const sendManualMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      userId?: string | null;
      email?: string | null;
      subject: string;
      body: string;
      ctaLabel?: string;
      ctaUrl?: string;
    }) => {
      const userId = String(input?.userId ?? "").trim();
      const email = String(input?.email ?? "")
        .trim()
        .toLowerCase();
      if (userId === "" && email === "") throw new Error("נא לבחור לקוח או להזין כתובת מייל");
      if (userId === "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("כתובת אימייל לא תקינה");
      }

      const subject = String(input?.subject ?? "").trim();
      const body = String(input?.body ?? "").trim();
      if (subject.length < 2) throw new Error("נא להזין נושא להודעה");
      if (subject.length > 200) throw new Error("הנושא ארוך מדי");
      if (body.length < 2) throw new Error("נא להזין תוכן להודעה");
      if (body.length > 5000) throw new Error("ההודעה ארוכה מדי");

      const ctaLabel = String(input?.ctaLabel ?? "")
        .trim()
        .slice(0, 60);
      const ctaUrl = String(input?.ctaUrl ?? "").trim();
      if (ctaUrl !== "" && !/^https?:\/\//i.test(ctaUrl)) {
        throw new Error("קישור הכפתור חייב להתחיל ב-https://");
      }
      if (ctaUrl !== "" && ctaLabel === "") throw new Error("נא להזין טקסט לכפתור");

      return { userId, email, subject, body, ctaLabel, ctaUrl };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendEmail, renderEmailHtml, textToEmailHtml, emailActionButton } =
      await import("@/lib/email.server");

    let recipient = data.email;
    if (data.userId !== "") {
      // לקוח קיים: בדיקת הרשאה רגילה (מנהל, או סוכן ללקוח שלו)
      await assertCanViewCustomer(context.userId, data.userId);
      const { data: user } = await supabaseAdmin
        .from("user_roles")
        .select("email")
        .eq("user_id", data.userId)
        .maybeSingle();
      if (!user?.email) throw new Error("אין כתובת מייל ללקוח");
      recipient = user.email;
    } else {
      // כתובת חופשית אינה מקושרת לאף לקוח, ולכן שמורה למנהל בלבד
      const { loadCaller } = await import("@/lib/caller.server");
      const caller = await loadCaller(context.userId);
      if (caller?.role !== "admin") throw new Error("שליחה לכתובת חופשית מותרת למנהל בלבד");
    }

    const bodyHtml =
      textToEmailHtml(data.body) +
      (data.ctaUrl !== "" ? emailActionButton(data.ctaLabel, data.ctaUrl) : "");

    const { data: emailSettings } = await supabaseAdmin
      .from("email_settings")
      .select("sender_email")
      .eq("id", true)
      .maybeSingle();

    const result = await sendEmail({
      from: emailSettings?.sender_email?.trim() || "",
      to: [recipient],
      subject: data.subject,
      html: await renderEmailHtml(data.subject, bodyHtml),
      // כתובת חופשית אינה מקושרת ללקוח ולכן אין לה יומן
      ...(data.userId !== ""
        ? { logFor: { userId: data.userId, kind: "manual" as const, sentBy: context.userId } }
        : {}),
    });
    if (!result.sent) throw new Error(result.reason ?? "שליחת ההודעה נכשלה");
    return { sentTo: recipient };
  });
