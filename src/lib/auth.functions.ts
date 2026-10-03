import { createServerFn } from "@tanstack/react-start";

/**
 * התחברות דרך השרת.
 *
 * למה לא ישירות מהדפדפן: תרגום שם משתמש לאימייל דרש פונקציית DB חשופה
 * ל-anon, כלומר כל אחד עם המפתח הציבורי היה יכול למפות שמות משתמש
 * לכתובות מייל. כאן התרגום נעשה בשרת, התשובה על כישלון היא תמיד זהה
 * (בלי לחשוף אם החשבון קיים), ואפשר להגביל קצב ניסיונות.
 */

/** הודעה אחידה לכל כישלון — לא חושפת אם המשתמש קיים */
const GENERIC_FAILURE = "שם המשתמש או הסיסמה אינם נכונים";

/** תקלה בצד השרת (לא בפרטי המשתמש) — בטוח להציג, לא חושף אם חשבון קיים */
const SERVER_FAILURE = "תקלה זמנית בשרת ההתחברות. נסו שוב בעוד רגע או פנו למנהל המערכת.";

/**
 * לוג שרת להתחברות. לעולם לא רושם סיסמה. האימייל ממוסך חלקית.
 * לצפייה: בלוגים של הקונטיינר (Coolify → Logs) לחפש '[login]'
 */
function logLogin(
  level: "info" | "warn" | "error",
  msg: string,
  extra: Record<string, unknown> = {},
) {
  const line = `[login] ${msg} ${JSON.stringify(extra)}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return email.slice(0, 2) + "***";
  return `${(user ?? "").slice(0, 2)}***@${domain}`;
}

export const loginWithIdentifier = createServerFn({ method: "POST" })
  .inputValidator((input: { identifier: string; password: string }) => {
    const identifier = String(input?.identifier ?? "")
      .trim()
      .toLowerCase();
    const password = String(input?.password ?? "");
    if (identifier === "") throw new Error("נא להזין אימייל או שם משתמש");
    if (password === "") throw new Error("נא להזין סיסמה");
    return { identifier, password };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");

    const ip = await requestIp();
    // 15 ניסיונות לרבע שעה מאותה כתובת — מרווח לטעויות הקלדה, חוסם ניחוש
    if (!allowAction(`login:${ip}`, 15, 15 * 60 * 1000)) {
      logLogin("warn", "rate limited", { ip });
      throw new Error("יותר מדי ניסיונות התחברות. נסו שוב בעוד כמה דקות.");
    }

    let email = data.identifier;
    if (!email.includes("@")) {
      const { data: user, error: lookupError } = await supabaseAdmin
        .from("user_roles")
        .select("email")
        .eq("username", data.identifier)
        .maybeSingle();
      if (lookupError) {
        // תקלת DB / מפתח service role — לא "משתמש לא קיים"
        logLogin("error", "username lookup failed", {
          ip,
          username: data.identifier,
          code: lookupError.code,
          message: lookupError.message,
          details: lookupError.details,
          hint: lookupError.hint,
        });
        throw new Error(SERVER_FAILURE);
      }
      if (!user?.email) {
        logLogin("warn", "username not found", { ip, username: data.identifier });
        throw new Error(GENERIC_FAILURE);
      }
      email = user.email;
    }

    const SUPABASE_URL = process.env["SUPABASE_URL"];
    const SUPABASE_PUBLISHABLE_KEY = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      logLogin("error", "missing env", {
        SUPABASE_URL: Boolean(SUPABASE_URL),
        SUPABASE_PUBLISHABLE_KEY: Boolean(SUPABASE_PUBLISHABLE_KEY),
      });
      throw new Error("תקלת הגדרות בשרת");
    }

    // ההתחברות עצמה נעשית עם המפתח הציבורי, לא עם service role — כך
    // ש-GoTrue מפעיל את כל הבדיקות שלו כרגיל ומחזיר session אמיתי.
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let result: Awaited<ReturnType<typeof client.auth.signInWithPassword>>["data"];
    let error: Awaited<ReturnType<typeof client.auth.signInWithPassword>>["error"];
    try {
      ({ data: result, error } = await client.auth.signInWithPassword({
        email,
        password: data.password,
      }));
    } catch (thrown) {
      const e = thrown as Error & { cause?: unknown };
      logLogin("error", "gotrue request threw", {
        ip,
        email: maskEmail(email),
        url: SUPABASE_URL,
        message: e?.message,
        cause: e?.cause ? String((e.cause as Error)?.message ?? e.cause) : undefined,
      });
      throw new Error(SERVER_FAILURE);
    }
    if (error || !result.session) {
      const status = (error as { status?: number } | null)?.status;
      const code = (error as { code?: string } | null)?.code;
      const cause = (error as { originalError?: { message?: string } } | null)?.originalError
        ?.message;
      logLogin(status === 400 ? "warn" : "error", "gotrue sign-in failed", {
        ip,
        email: maskEmail(email),
        url: SUPABASE_URL,
        status,
        code,
        message: error?.message ?? "no session returned",
        name: error?.name,
        cause,
      });
      // status 0 / 5xx = תקשורת או קריסה בצד השרת, לא סיסמה שגויה
      if (status === undefined || status === 0 || status >= 500) {
        throw new Error(SERVER_FAILURE);
      }
      if (error && /email not confirmed/i.test(error.message)) {
        throw new Error(
          "החשבון עדיין לא אומת. פנו למנהל המערכת או אפסו סיסמה כדי להשלים את ההרשמה.",
        );
      }
      throw new Error(GENERIC_FAILURE);
    }

    // חשבון של חנות אחרת לא מתחבר דרך האתר הזה (אותה הודעה כמו סיסמה שגויה —
    // לא חושף שהחשבון קיים במקום אחר במערכת)
    const { supabaseAdminUnscoped } = await import("@/integrations/supabase/client.server");
    const { currentTenantId } = await import("@/integrations/supabase/tenant.server");
    const { isPlatformAdminUser } = await import("@/integrations/supabase/client.server");
    const { data: membership } = await supabaseAdminUnscoped
      .from("user_roles")
      .select("tenant_id")
      .eq("user_id", result.session.user.id)
      .maybeSingle();
    // חריג יחיד: מנהל-על (God Mode) — נכנס לפאנל הפלטפורמה ולניהול של כל חנות
    if (
      membership &&
      membership.tenant_id !== currentTenantId() &&
      !(await isPlatformAdminUser(result.session.user.id))
    ) {
      logLogin("warn", "account belongs to another store", { ip, email: maskEmail(email) });
      throw new Error(GENERIC_FAILURE);
    }

    logLogin("info", "success", { ip, email: maskEmail(email) });
    return {
      accessToken: result.session.access_token,
      refreshToken: result.session.refresh_token,
    };
  });
