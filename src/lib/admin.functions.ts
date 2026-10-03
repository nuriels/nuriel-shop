import type { InviteRow } from "@/lib/invite.server";
import type { PriceListType } from "@/lib/price-list";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type CreateUserInput = {
  email: string;
  role: "admin" | "agent" | "customer" | "warehouse";
  businessName?: string;
  businessAddress?: string;
  taxId?: string;
  contactName?: string;
  phone?: string;
  /** חובה עבור role="customer": 1/2/3, או null במפורש ("ללא קבוצה / אורח") */
  priceTier?: 1 | 2 | 3 | null;
  /** סוג מחירון: "regular" (ברירת מחדל) או "custom" — מחירון אישי ללקוח. מנהל בלבד */
  priceListType?: PriceListType;
  agentId?: string | null;
  /**
   * "link" — נשלח ללקוח קישור חד-פעמי ליצירת סיסמה משלו.
   * "temp" — המנהל קובע סיסמה זמנית; הלקוח יחויב להחליף אותה בכניסה.
   */
  passwordMode?: "link" | "temp";
  tempPassword?: string;
  /** שם מלא בעברית לעובד (סוכן/מנהל) — מוצג ללקוחות במקום שם המשתמש */
  displayName?: string;
  /** במצב "temp": לשלוח את הסיסמה הזמנית גם למייל של הלקוח */
  emailTempPassword?: boolean;
};

function parsePriceListType(value: unknown): PriceListType | undefined {
  if (value === undefined || value === null) return undefined;
  if (value !== "regular" && value !== "custom") throw new Error("סוג מחירון לא תקין");
  return value;
}

/** סיסמה זמנית קריאה: 3 קבוצות של 4 תווים ללא תווים מתחלפים (O/0, l/1) */
export function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const pick = () =>
    Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `${pick()}-${pick()}-${pick()}`;
}

/**
 * יצירת משתמש חדש ע"י סוכן (לקוחות בלבד, משויכים אליו אוטומטית) או
 * אדמין (כל תפקיד). המשתמש נוצר מאושר, וכתובת "קביעת סיסמה" נשלחת למייל.
 */
export const createStaffUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreateUserInput) => {
    const email = String(input?.email ?? "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("כתובת אימייל לא תקינה");
    const role = input?.role;
    if (role !== "admin" && role !== "agent" && role !== "customer" && role !== "warehouse") {
      throw new Error("תפקיד לא תקין");
    }
    let priceTier: 1 | 2 | 3 | null = null;
    if (role === "customer") {
      // רק שם העסק חובה בהקמה. את השאר (ח.פ, כתובת, טלפון, איש קשר)
      // הלקוח מחויב להשלים בעצמו במסך החסימה בכניסה הראשונה.
      if (!String(input?.businessName ?? "").trim()) throw new Error("נא למלא את שם העסק");
      // שדה חובה בטופס הניהול: יש לבחור דרג במפורש, או להשאיר "ללא קבוצה" (null)
      // במפורש — אך לא ניתן פשוט להשמיט את השדה.
      if (input?.priceTier === undefined) {
        throw new Error("יש לבחור קבוצת מחיר ללקוח, או לסמן במפורש 'ללא קבוצה / אורח'");
      }
      if (input.priceTier !== null && ![1, 2, 3].includes(input.priceTier)) {
        throw new Error("קבוצת מחיר לא תקינה");
      }
      priceTier = input.priceTier;
    }
    return {
      email,
      role,
      businessName: String(input?.businessName ?? "").trim(),
      businessAddress: String(input?.businessAddress ?? "").trim(),
      taxId: String(input?.taxId ?? "").trim(),
      contactName: String(input?.contactName ?? "").trim(),
      phone: String(input?.phone ?? "").trim(),
      priceTier,
      priceListType:
        role === "customer" ? (parsePriceListType(input?.priceListType) ?? "regular") : "regular",
      agentId: input?.agentId ?? null,
      passwordMode: input?.passwordMode === "temp" ? ("temp" as const) : ("link" as const),
      tempPassword: String(input?.tempPassword ?? ""),
      emailTempPassword: input?.emailTempPassword === true,
      displayName: (() => {
        const name = String(input?.displayName ?? "")
          .trim()
          .replace(/\s{2,}/g, " ");
        if (role !== "customer" && name === "") {
          throw new Error("נדרש שם מלא בעברית לעובד — כך הלקוחות יראו אותו");
        }
        if (name.length > 60) throw new Error("השם המלא ארוך מדי (עד 60 תווים)");
        return role === "customer" ? null : name;
      })(),
    };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { loadCaller } = await import("@/lib/caller.server");
    const caller = await loadCaller(context.userId);

    const callerRole = caller?.role;
    if (callerRole !== "admin" && callerRole !== "agent") throw new Error("אין הרשאה");
    if (callerRole === "agent" && data.role !== "customer") {
      throw new Error("סוכן יכול ליצור לקוחות בלבד");
    }

    // חסימת כפילות אימייל *לפני* יצירת המשתמש: גם בטבלת התפקידים שלנו
    // וגם ב-auth (למשל שורה שנשארה מיצירה שנכשלה באמצע בעבר).
    const { data: existingRole } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("email", data.email)
      .maybeSingle();
    if (existingRole) throw new Error("כתובת האימייל הזו כבר רשומה במערכת");

    // במצב "temp" משתמשים בסיסמה שהמנהל הקליד (או אחת שחוללה בטופס);
    // במצב "link" נוצרת סיסמה אקראית שאף אחד לא רואה, והלקוח קובע משלו.
    const tempPassword =
      data.passwordMode === "temp"
        ? data.tempPassword.trim() || generateTempPassword()
        : generateTempPassword();
    if (data.passwordMode === "temp" && tempPassword.length < 6) {
      throw new Error("הסיסמה הזמנית חייבת להכיל לפחות 6 תווים");
    }

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: tempPassword,
      email_confirm: true,
    });
    if (createError || !created.user) {
      const message = createError?.message ?? "";
      if (/already|exists|registered|duplicate/i.test(message)) {
        throw new Error("כתובת האימייל הזו כבר רשומה במערכת");
      }
      throw new Error(message || "יצירת המשתמש נכשלה");
    }

    const { error: roleError } = await supabaseAdmin.from("user_roles").insert({
      user_id: created.user.id,
      email: data.email,
      role: data.role,
      is_approved: true,
      is_blocked: false,
      // סיסמה זמנית = חייב להחליף בכניסה הראשונה
      must_change_password: data.passwordMode === "temp",
      display_name: data.displayName,
    });
    if (roleError) throw new Error(roleError.message);

    if (data.role === "customer") {
      const agentId = callerRole === "agent" ? context.userId : data.agentId;
      const { error: profileError } = await supabaseAdmin.from("customer_profiles").insert({
        user_id: created.user.id,
        business_name: data.businessName,
        business_address: data.businessAddress || null,
        tax_id: data.taxId || null,
        contact_name: data.contactName || null,
        phone: data.phone || null,
        price_tier: data.priceTier,
        // מחירון אישי נקבע ע"י מנהל בלבד; לקוח שסוכן מקים מתחיל במחירון הרגיל
        price_list_type: callerRole === "admin" ? data.priceListType : "regular",
        agent_id: agentId,
        age_confirmed: true,
        // הלקוח יחויב לאשר/להשלים את הפרטים בכניסה הראשונה
        profile_completed: false,
      });
      if (profileError) throw new Error(profileError.message);
    }

    // טופס ההצטרפות לחתימה נשלח לכל לקוח חדש שמוקם בפאנל
    if (data.role === "customer") {
      const { sendAgreementEmail } = await import("@/lib/agreement.server");
      await sendAgreementEmail(created.user.id);
    }

    if (data.passwordMode === "link") {
      // קישור חד-פעמי (3 שעות) לקביעת סיסמה אישית
      const { sendPasswordResetLinkInternal } = await import("@/lib/reset-link.server");
      const result = await sendPasswordResetLinkInternal(
        created.user.id,
        context.userId,
        "welcome",
      );
      return {
        userId: created.user.id,
        mode: "link" as const,
        tempPassword: null,
        emailed: result.sent,
      };
    }

    let emailed = false;
    if (data.emailTempPassword) {
      const { sendTempPasswordEmail } = await import("@/lib/reset-link.server");
      const result = await sendTempPasswordEmail(created.user.id, tempPassword);
      emailed = result.sent;
    }

    // הסיסמה מוחזרת פעם אחת בלבד, כדי שהמנהל יוכל להעתיק ולשלוח בוואטסאפ
    return { userId: created.user.id, mode: "temp" as const, tempPassword, emailed };
  });

/**
 * מחיקת משתמש ע"י מנהל. מוחקת גם את חשבון ההתחברות (auth) — בלי זה
 * כתובת האימייל נשארת "תפוסה" ואי אפשר להקים אותה מחדש, וזה גם הבאג
 * שגרם לכך שמחיקת משתמש נכשלה.
 *
 * ההזמנות של לקוח נמחקות יחד איתו (מפתח זר ON DELETE CASCADE), ולכן
 * מחיקת לקוח שיש לו היסטוריה דורשת אישור מפורש (force=true).
 * מחיקת סוכן משאירה את ההזמנות והלקוחות שלו במערכת, בלי שיוך לסוכן.
 */
export const deleteUserAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; force?: boolean }) => {
    const userId = String(input?.userId ?? "").trim();
    if (!userId) throw new Error("חסר מזהה משתמש");
    return { userId, force: input?.force === true };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { loadCaller } = await import("@/lib/caller.server");
    const caller = await loadCaller(context.userId);
    if (caller?.role !== "admin") throw new Error("אין הרשאה");
    if (data.userId === context.userId)
      throw new Error("אי אפשר למחוק את המשתמש שאיתו את/ה מחובר/ת");

    const { data: target } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, email, role, is_protected")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (!target) throw new Error("המשתמש לא נמצא");
    if (target.is_protected) throw new Error("אי אפשר למחוק את המנהל הראשי של המערכת");

    if (target.role === "admin") {
      const { count } = await supabaseAdmin
        .from("user_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("role", "admin");
      if ((count ?? 0) <= 1) throw new Error("לא ניתן למחוק את המנהל האחרון במערכת");
    }

    const { count: orderCount } = await supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", data.userId);

    if ((orderCount ?? 0) > 0 && !data.force) {
      return { deleted: false, requiresConfirmation: true, orderCount: orderCount ?? 0 };
    }

    // מוחקים קודם את חשבון ההתחברות. אם הוא כבר לא קיים (למשל נמחק
    // ידנית ב-Studio) ממשיכים בכל זאת לניקוי השורות שלנו.
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (authError && !/not found|does not exist/i.test(authError.message)) {
      throw new Error(`מחיקת חשבון ההתחברות נכשלה: ${authError.message}`);
    }

    // customer_profiles / orders / password_reset_tokens נמחקים בשרשור
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId);
    if (roleError) throw new Error(roleError.message);

    return { deleted: true, requiresConfirmation: false, orderCount: orderCount ?? 0 };
  });

/**
 * עדכון פרטי משתמש קיים ע"י מנהל (או סוכן, עבור הלקוחות שלו בלבד).
 *
 * מנהל יכול לשנות תפקיד, קבוצת מחיר, שיוך סוכן וכל פרטי העסק.
 * סוכן יכול לעדכן רק את פרטי הקשר של לקוח שמשויך אליו — לא תפקיד,
 * לא קבוצת מחיר ולא שיוך לסוכן אחר.
 */
export const updateUserDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      userId: string;
      role?: "admin" | "agent" | "customer" | "warehouse";
      priceTier?: 1 | 2 | 3 | null;
      priceListType?: PriceListType;
      agentId?: string | null;
      businessName?: string;
      businessAddress?: string;
      taxId?: string;
      contactName?: string;
      phone?: string;
      agentNumber?: string | null;
      /** שם מלא בעברית לעובד — מנהל בלבד */
      displayName?: string | null;
    }) => {
      const userId = String(input?.userId ?? "").trim();
      if (!userId) throw new Error("חסר מזהה משתמש");
      if (input.role !== undefined && !["admin", "agent", "customer"].includes(input.role)) {
        throw new Error("תפקיד לא תקין");
      }
      if (
        input.priceTier !== undefined &&
        input.priceTier !== null &&
        ![1, 2, 3].includes(input.priceTier)
      ) {
        throw new Error("קבוצת מחיר לא תקינה");
      }
      return {
        userId,
        role: input.role,
        priceTier: input.priceTier,
        priceListType: parsePriceListType(input.priceListType),
        agentId: input.agentId,
        businessName: input.businessName?.trim(),
        businessAddress: input.businessAddress?.trim(),
        taxId: input.taxId?.trim(),
        contactName: input.contactName?.trim(),
        phone: input.phone?.trim(),
        // undefined = לא נשלח (לא לגעת); מחרוזת ריקה = למחוק את המספר
        agentNumber:
          input.agentNumber === undefined ? undefined : input.agentNumber?.trim() || null,
        displayName:
          input.displayName === undefined
            ? undefined
            : (() => {
                const name = (input.displayName ?? "").trim().replace(/\s{2,}/g, " ");
                if (name.length > 60) throw new Error("השם המלא ארוך מדי (עד 60 תווים)");
                return name || null;
              })(),
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { loadCaller } = await import("@/lib/caller.server");
    const caller = await loadCaller(context.userId);
    const isAdmin = caller?.role === "admin";
    const isAgent = caller?.role === "agent";
    if (!isAdmin && !isAgent) throw new Error("אין הרשאה");

    const { data: target } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role, is_protected")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (!target) throw new Error("המשתמש לא נמצא");

    if (isAgent) {
      const { data: profile } = await supabaseAdmin
        .from("customer_profiles")
        .select("agent_id")
        .eq("user_id", data.userId)
        .maybeSingle();
      if (profile?.agent_id !== context.userId) {
        throw new Error("אפשר לערוך רק לקוחות המשויכים אליך");
      }
    }

    // המנהל הראשי מוגן — אי אפשר לשנות לו תפקיד (גם המסד חוסם)
    if (target.is_protected && data.role !== undefined && data.role !== "admin") {
      throw new Error("אי אפשר לשנות את ההרשאות של המנהל הראשי");
    }

    if (isAdmin) {
      const rolePatch: {
        role?: string;
        agent_number?: string | null;
        is_approved?: boolean;
        display_name?: string | null;
      } = {};
      if (data.role !== undefined && data.role !== target.role) {
        rolePatch.role = data.role;
        // עובד שנרשם בטעות כלקוח ממתין — קידום לצוות מאשר אותו אוטומטית,
        // אחרת הוא ממשיך להיספר ב"ממתינים לאישור"
        if (data.role === "agent" || data.role === "admin") rolePatch.is_approved = true;
      }
      if (data.agentNumber !== undefined) rolePatch.agent_number = data.agentNumber;
      if (data.displayName !== undefined) rolePatch.display_name = data.displayName;
      if (Object.keys(rolePatch).length > 0) {
        const { error } = await supabaseAdmin
          .from("user_roles")
          .update(rolePatch)
          .eq("user_id", data.userId);
        if (error) throw new Error(error.message);
      }
    }

    const profilePatch: {
      business_name?: string;
      business_address?: string;
      tax_id?: string;
      contact_name?: string;
      phone?: string;
      price_tier?: number | null;
      price_list_type?: PriceListType;
      agent_id?: string | null;
    } = {};
    if (data.businessName) profilePatch.business_name = data.businessName;
    if (data.businessAddress) profilePatch.business_address = data.businessAddress;
    if (data.taxId) profilePatch.tax_id = data.taxId;
    if (data.contactName) profilePatch.contact_name = data.contactName;
    if (data.phone) profilePatch.phone = data.phone;
    if (isAdmin) {
      if (data.priceTier !== undefined) profilePatch.price_tier = data.priceTier;
      // מעבר למחירון רגיל לא מוחק את המחירים האישיים — הם נשמרים ולא פעילים
      if (data.priceListType !== undefined) profilePatch.price_list_type = data.priceListType;
      if (data.agentId !== undefined) profilePatch.agent_id = data.agentId;
    }

    if (Object.keys(profilePatch).length > 0) {
      const { data: existing } = await supabaseAdmin
        .from("customer_profiles")
        .select("user_id")
        .eq("user_id", data.userId)
        .maybeSingle();
      // לצוות (מנהל/סוכן) אין פרופיל עסקי — מעדכנים רק אם הוא קיים
      if (existing) {
        const { error } = await supabaseAdmin
          .from("customer_profiles")
          .update(profilePatch)
          .eq("user_id", data.userId);
        if (error) throw new Error(error.message);
      }
    }

    return { ok: true };
  });

/**
 * הרשמת לקוח חדש דרך השרת.
 *
 * ההרשמה עוברת דרך service role ולא דרך signUp בדפדפן, משתי סיבות:
 * (א) חשבון נוצר מאומת מייל, כך שאפשר להתחבר מיד גם כשאין SMTP מוגדר
 *     בסטאק ה-Supabase העצמאי (זו הייתה סיבה אפשרית לכשל התחברות);
 * (ב) אפשר לחסום אימייל כפול לפני יצירת החשבון, במקום להיכשל באמצע
 *     ולהשאיר משתמש auth יתום בלי שורת תפקיד.
 */
export const registerCustomer = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      email: string;
      password: string;
      businessName: string;
      businessAddress: string;
      taxId: string;
      contactName: string;
      phone: string;
      /** קישור הזמנה ממנהל/סוכן — החשבון נפתח מאושר, עם קבוצת המחיר והמטפל שבהזמנה */
      inviteToken?: string;
    }) => {
      const email = String(input?.email ?? "")
        .trim()
        .toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("כתובת אימייל לא תקינה");
      const password = String(input?.password ?? "");
      if (password.length < 6) throw new Error("הסיסמה חייבת להכיל לפחות 6 תווים");
      if (password.length > 72) throw new Error("הסיסמה ארוכה מדי");
      const fields = {
        businessName: String(input?.businessName ?? "").trim(),
        businessAddress: String(input?.businessAddress ?? "").trim(),
        taxId: String(input?.taxId ?? "").trim(),
        contactName: String(input?.contactName ?? "").trim(),
        phone: String(input?.phone ?? "").trim(),
      };
      for (const value of Object.values(fields)) {
        if (value === "") throw new Error("נא למלא את כל פרטי העסק");
      }
      const inviteToken = String(input?.inviteToken ?? "").trim();
      return { email, password, ...fields, inviteToken: inviteToken || null };
    },
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");

    // הרשמה פתוחה לכל אחד: בלי מגבלה אפשר להציף את המערכת בחשבונות
    // ולהשתמש בה כדי לשלוח מיילים לכתובות זרות (טופס ההצטרפות).
    const ip = await requestIp();
    if (!allowAction(`register:${ip}`, 5, 60 * 60 * 1000)) {
      throw new Error("יותר מדי הרשמות מהכתובת הזו. נסו שוב מאוחר יותר או פנו אלינו בטלפון.");
    }

    const { data: existing } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("email", data.email)
      .maybeSingle();
    if (existing) {
      throw new Error("כתובת האימייל הזו כבר רשומה. אפשר להתחבר או לאפס סיסמה מדף ההתחברות.");
    }

    // הזמנה: בודקים ו"תופסים" אותה לפני יצירת החשבון, כך שאי אפשר לנצל
    // את אותו קישור פעמיים. אם משהו נכשל בהמשך — משחררים אותה.
    const invites = await import("@/lib/invite.server");
    let invite: InviteRow | null = null;
    if (data.inviteToken) {
      const found = await invites.findValidInvite(data.inviteToken);
      if ("reason" in found) throw new Error(found.reason);
      if (found.invite.email && found.invite.email !== data.email) {
        throw new Error("ההזמנה נשלחה לכתובת מייל אחרת. הירשמו עם הכתובת שאליה קיבלתם את ההזמנה.");
      }
      if (!(await invites.claimInvite(found.invite.id))) {
        throw new Error("קישור ההזמנה כבר נוצל.");
      }
      invite = found.invite;
    }
    const releaseInvite = async () => {
      if (invite) await invites.releaseInvite(invite.id);
    };

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      await releaseInvite();
      const message = createError?.message ?? "";
      if (/already|exists|registered|duplicate/i.test(message)) {
        throw new Error("כתובת האימייל הזו כבר רשומה. אפשר להתחבר או לאפס סיסמה מדף ההתחברות.");
      }
      throw new Error(message || "ההרשמה נכשלה");
    }

    const { error: roleError } = await supabaseAdmin.from("user_roles").insert({
      user_id: created.user.id,
      email: data.email,
      role: "customer",
      // לקוח שהוזמן ע"י הצוות לא צריך לחכות לאישור
      is_approved: invite !== null,
      is_blocked: false,
    });
    if (roleError) {
      // ניקוי החשבון שנוצר, כדי לא להשאיר אימייל "תפוס" בלי משתמש במערכת
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      await releaseInvite();
      throw new Error(roleError.message);
    }

    const { error: profileError } = await supabaseAdmin.from("customer_profiles").insert({
      user_id: created.user.id,
      business_name: data.businessName,
      business_address: data.businessAddress,
      tax_id: data.taxId,
      contact_name: data.contactName,
      phone: data.phone,
      age_confirmed: true,
      // בהרשמה עצמית כל הפרטים כבר מולאו — אין סיבה להציג מסך השלמה
      profile_completed: true,
      price_tier: invite?.price_tier ?? null,
      agent_id: invite?.agent_id ?? null,
    });
    if (profileError) {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", created.user.id);
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      await releaseInvite();
      throw new Error(profileError.message);
    }
    if (invite) await invites.markInviteUser(invite.id, created.user.id);

    // טופס ההצטרפות לחתימה נשלח מיד; כשל בשליחה לא מבטל את ההרשמה
    const { sendAgreementEmail } = await import("@/lib/agreement.server");
    const agreement = await sendAgreementEmail(created.user.id);

    return { userId: created.user.id, agreementSent: agreement.sent, approved: invite !== null };
  });

/** מחיקת הזמנה — מנהל בלבד */
export const deleteOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    const orderId = String(input?.orderId ?? "").trim();
    if (!orderId) throw new Error("מזהה הזמנה חסר");
    return { orderId };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { loadCaller } = await import("@/lib/caller.server");
    const caller = await loadCaller(context.userId);
    if (caller?.role !== "admin") throw new Error("אין הרשאה למחוק הזמנות");

    const { error } = await supabaseAdmin.from("orders").delete().eq("id", data.orderId);
    if (error) throw new Error(error.message);

    return { deleted: true };
  });

/**
 * שליחת מייל לסוכן/מנהל שקיבל לקוח חדש לטיפול. ההתראה באזור האישי
 * נוצרת אוטומטית בטריגר במסד (customer_profiles_notify_assigned); זו רק
 * שכבת המייל, שמופעלת מהאפליקציה אחרי שהשיוך נשמר בהצלחה בלקוח.
 */
export const notifyCustomerAssigned = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { customerId: string }) => {
    const customerId = String(input?.customerId ?? "").trim();
    if (!customerId) throw new Error("חסר מזהה לקוח");
    return { customerId };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendEmail, renderEmailHtml, escapeHtml, emailActionButton } =
      await import("@/lib/email.server");

    const { loadCaller } = await import("@/lib/caller.server");
    const caller = await loadCaller(context.userId);
    if (caller?.role !== "admin" && caller?.role !== "agent") throw new Error("אין הרשאה");

    const { data: profile } = await supabaseAdmin
      .from("customer_profiles")
      .select("business_name, agent_id")
      .eq("user_id", data.customerId)
      .maybeSingle();
    if (!profile?.agent_id) return { sent: false };

    const [{ data: recipient }, { data: customerRole }, { data: emailSettings }] =
      await Promise.all([
        supabaseAdmin
          .from("user_roles")
          .select("email, role")
          .eq("user_id", profile.agent_id)
          .maybeSingle(),
        supabaseAdmin
          .from("user_roles")
          .select("email")
          .eq("user_id", data.customerId)
          .maybeSingle(),
        supabaseAdmin.from("email_settings").select("sender_email").eq("id", true).maybeSingle(),
      ]);
    if (!recipient?.email) return { sent: false };

    const { tenantSiteOrigin } = await import("@/integrations/supabase/tenant.server");
    const origin = tenantSiteOrigin();
    const link = `${origin}${recipient.role === "admin" ? "/admin?tab=users" : "/agent"}`;
    const customerLabel = profile.business_name?.trim() || customerRole?.email || "לקוח";

    const result = await sendEmail({
      from: emailSettings?.sender_email?.trim() || "",
      to: [recipient.email],
      subject: "לקוח חדש שויך אליך",
      html: await renderEmailHtml(
        "לקוח חדש שויך אליך",
        `
        <p>שלום,</p>
        <p>הלקוח <strong>${escapeHtml(customerLabel)}</strong> שויך אליך לטיפול.</p>
        ${emailActionButton("צפייה בלקוח", link)}
      `,
      ),
    });
    return { sent: result.sent };
  });
