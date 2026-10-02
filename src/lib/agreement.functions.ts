import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * חתימה דיגיטלית על תנאי השירות.
 *
 * לקוח חדש מקבל אוטומטית מייל עם קישור לטופס. בטופס מוצג נוסח התנאים
 * המלא, והלקוח חותם בשמו ובציור חתימה. הטופס החתום נשמר בתיק הלקוח יחד
 * עם נוסח התנאים שנחתם בפועל, כדי שנוכל להראות בדיוק על מה נחתם.
 */

/** שליחת (או שליחה מחדש של) קישור החתימה ללקוח */
export const sendAgreementLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => {
    const userId = String(input?.userId ?? "").trim();
    if (!userId) throw new Error("חסר מזהה משתמש");
    return { userId };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendAgreementEmail } = await import("@/lib/agreement.server");

    const { data: caller } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    const isSelf = context.userId === data.userId;
    if (!isSelf && caller?.role !== "admin" && caller?.role !== "agent")
      throw new Error("אין הרשאה");

    const result = await sendAgreementEmail(data.userId);
    if (!result.sent) throw new Error(result.reason ?? "שליחת הטופס נכשלה");
    return { sent: true };
  });

/** פתיחת טופס החתימה לפי הטוקן מהמייל */
export const loadAgreementForm = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => {
    const token = String(input?.token ?? "").trim();
    if (!token) throw new Error("קישור לא תקין");
    return { token };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { hashAgreementToken } = await import("@/lib/agreement.server");
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");

    if (!allowAction(`agreement-load:${await requestIp()}`, 30, 60 * 60 * 1000)) {
      throw new Error("יותר מדי ניסיונות. נסו שוב מאוחר יותר.");
    }

    const { data: agreement } = await supabaseAdmin
      .from("service_agreements")
      .select("user_id, signed_at, signer_name, token_expires_at")
      .eq("token_hash", hashAgreementToken(data.token))
      .maybeSingle();
    if (!agreement) throw new Error("הקישור אינו תקין. אפשר לבקש קישור חדש מהסוכן או מהמנהל.");
    if (
      agreement.signed_at === null &&
      agreement.token_expires_at &&
      new Date(agreement.token_expires_at).getTime() < Date.now()
    ) {
      throw new Error("תוקף הקישור פג. יש לבקש קישור חדש מהסוכן או מהמנהל.");
    }

    const [{ data: user }, { data: profile }, { data: settings }] = await Promise.all([
      supabaseAdmin
        .from("user_roles")
        .select("email")
        .eq("user_id", agreement.user_id)
        .maybeSingle(),
      supabaseAdmin
        .from("customer_profiles")
        .select("business_name, business_address, tax_id, contact_name, phone")
        .eq("user_id", agreement.user_id)
        .maybeSingle(),
      supabaseAdmin
        .from("site_settings")
        .select("terms_content, business_name, site_title")
        .eq("id", true)
        .maybeSingle(),
    ]);

    return {
      alreadySigned: agreement.signed_at !== null,
      signedAt: agreement.signed_at,
      signerName: agreement.signer_name,
      email: user?.email ?? "",
      businessName: profile?.business_name ?? "",
      businessAddress: profile?.business_address ?? "",
      taxId: profile?.tax_id ?? "",
      contactName: profile?.contact_name ?? "",
      phone: profile?.phone ?? "",
      companyName: settings?.business_name?.trim() || settings?.site_title || "",
      terms: settings?.terms_content ?? "",
    };
  });

/** שמירת החתימה */
export const submitAgreement = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; signerName: string; signatureSvg?: string | null }) => {
    const token = String(input?.token ?? "").trim();
    const signerName = String(input?.signerName ?? "").trim();
    if (!token) throw new Error("קישור לא תקין");
    if (signerName.length < 2) throw new Error("נא להזין שם מלא של החותם");
    // אין לשמור SVG שהגיע מהדפדפן כמו שהוא: זה קלט חופשי שמוצג אחר כך
    // במסך של המנהל, כלומר וקטור XSS מאוחסן. מחלצים אך ורק את נתוני
    // ה-path (אותיות M/L/Z ומספרים) ובונים את ה-SVG מחדש בשרת.
    const raw = typeof input?.signatureSvg === "string" ? input.signatureSvg.slice(0, 100_000) : "";
    const signaturePaths: string[] = [];
    for (const match of raw.matchAll(/d="([^"]{1,4000})"/g)) {
      const d = (match[1] ?? "").trim();
      if (/^[MLmlZz0-9.,\s-]+$/.test(d)) signaturePaths.push(d);
      if (signaturePaths.length >= 60) break;
    }
    if (signaturePaths.length === 0) throw new Error("נא לחתום במסגרת החתימה");
    return { token, signerName, signaturePaths };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { hashAgreementToken, notifyAgreementSigned } = await import("@/lib/agreement.server");

    const tokenHash = hashAgreementToken(data.token);
    const { data: agreement } = await supabaseAdmin
      .from("service_agreements")
      .select("user_id, signed_at, token_expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (!agreement) throw new Error("הקישור אינו תקין");
    if (agreement.signed_at) throw new Error("הטופס הזה כבר נחתם");
    if (agreement.token_expires_at && new Date(agreement.token_expires_at).getTime() < Date.now()) {
      throw new Error("תוקף הקישור פג. יש לבקש קישור חדש מהסוכן או מהמנהל.");
    }

    const { data: settings } = await supabaseAdmin
      .from("site_settings")
      .select("terms_content")
      .eq("id", true)
      .maybeSingle();

    let ip: string | null = null;
    let userAgent: string | null = null;
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const request = getRequest();
      ip = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      userAgent = request?.headers.get("user-agent") ?? null;
    } catch {
      // אין הקשר בקשה — נשמור בלי פרטי הזיהוי
    }

    const { error } = await supabaseAdmin
      .from("service_agreements")
      .update({
        signed_at: new Date().toISOString(),
        signer_name: data.signerName,
        // ה-SVG נבנה בשרת מנתוני ה-path בלבד — לא נשמר קלט חופשי
        signature_svg:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200">' +
          data.signaturePaths
            .map(
              (d: string) =>
                `<path d="${d}" fill="none" stroke="#12211F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
            )
            .join("") +
          "</svg>",
        terms_snapshot: settings?.terms_content ?? "",
        signer_ip: ip,
        user_agent: userAgent,
      })
      .eq("token_hash", tokenHash)
      .is("signed_at", null);
    if (error) throw new Error(error.message);

    await notifyAgreementSigned(agreement.user_id, data.signerName);
    return { ok: true };
  });
