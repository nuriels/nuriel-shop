import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * השלמת פרטים בכניסה הראשונה.
 *
 * לקוח שהוקם ע"י מנהל מגיע בלי ח.פ/כתובת/טלפון, ולעיתים עם סיסמה זמנית.
 * עד שהוא משלים את הפרטים (ומחליף סיסמה זמנית) הוא חסום מהקטלוג.
 * העדכון נעשה בשרת כדי שהלקוח לא יוכל לסמן "השלמתי" בלי למלא בפועל.
 */
export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      businessName: string;
      businessAddress: string;
      taxId: string;
      contactName: string;
      phone: string;
      newPassword?: string;
    }) => {
      const businessName = String(input?.businessName ?? "").trim();
      const businessAddress = String(input?.businessAddress ?? "").trim();
      const taxId = String(input?.taxId ?? "").trim();
      const contactName = String(input?.contactName ?? "").trim();
      const phone = String(input?.phone ?? "").trim();

      if (businessName.length < 2) throw new Error("נא להזין שם עסק");
      if (businessAddress.length < 2) throw new Error("נא להזין כתובת מלאה");
      if (taxId.length < 5) throw new Error("נא להזין ח.פ / מספר עוסק מורשה");
      if (contactName.length < 2) throw new Error("נא להזין שם איש קשר");
      if (phone.replace(/\D/g, "").length < 9) throw new Error("נא להזין מספר טלפון תקין");

      const newPassword = String(input?.newPassword ?? "");
      if (newPassword !== "" && newPassword.length < 8) {
        throw new Error("הסיסמה החדשה חייבת להכיל לפחות 8 תווים");
      }

      return { businessName, businessAddress, taxId, contactName, phone, newPassword };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role, must_change_password")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!role) throw new Error("המשתמש לא נמצא");
    if (role.role !== "customer") throw new Error("המסך הזה מיועד ללקוחות עסקיים");

    // מי שנכנס עם סיסמה זמנית חייב לקבוע סיסמה קבועה כדי להמשיך
    if (role.must_change_password) {
      if (data.newPassword === "") throw new Error("יש לקבוע סיסמה קבועה חדשה");
      const { error: passwordError } = await supabaseAdmin.auth.admin.updateUserById(
        context.userId,
        {
          password: data.newPassword,
        },
      );
      if (passwordError) throw new Error(passwordError.message);
      const { error: flagError } = await supabaseAdmin
        .from("user_roles")
        .update({ must_change_password: false })
        .eq("user_id", context.userId);
      if (flagError) throw new Error(flagError.message);
    } else if (data.newPassword !== "") {
      // שינוי סיסמה יזום גם כשלא חויב — לא מזיק, ומייתר מסך נוסף
      const { error: passwordError } = await supabaseAdmin.auth.admin.updateUserById(
        context.userId,
        {
          password: data.newPassword,
        },
      );
      if (passwordError) throw new Error(passwordError.message);
    }

    // upsert: לקוח שנוצר בלי פרופיל (מצב קצה) מקבל כאן שורה חדשה במקום
    // עדכון שמשפיע על 0 שורות ומשאיר אותו תקוע מול מסך ההשלמה
    const { error: profileError } = await supabaseAdmin.from("customer_profiles").upsert(
      {
        user_id: context.userId,
        business_name: data.businessName,
        business_address: data.businessAddress,
        tax_id: data.taxId,
        contact_name: data.contactName,
        phone: data.phone,
        age_confirmed: true,
        profile_completed: true,
      },
      { onConflict: "user_id" },
    );
    if (profileError) throw new Error(profileError.message);

    return { ok: true };
  });
