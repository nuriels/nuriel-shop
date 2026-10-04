import { createServerFn } from "@tanstack/react-start";

/**
 * התחברות בקוד למייל (OTP) — אפשרות נוספת לצד אימייל + סיסמה.
 *
 * 1. requestLoginCode: קוד אקראי בן 6 ספרות נשלח למייל מהשולח של החנות
 *    ("שם החנות <orders@nuri1.fit>"). במסד נשמר רק HMAC של הקוד (עם סוד
 *    השרת), בתוקף 10 דקות; קוד חדש מבטל את הקודם.
 * 2. verifyLoginCode: עד 5 ניסיונות לקוד. קוד נכון:
 *    - חשבון קיים בחנות (או מנהל-על) — נפתח חיבור רגיל.
 *    - אין חשבון — נפתח חשבון חדש (הרשמה). הלקוח משלים את פרטי העסק במסך
 *      "השלמת פרטים", בדיוק כמו בהרשמה עם Google, וממתין לאישור מנהל.
 *    - חשבון של חנות אחרת — לא מתחבר כאן (מוצגת הודעה ברורה: בעל המייל
 *      כבר הוכיח שהוא הבעלים, אין כאן חשיפת מידע).
 *
 * התשובה לבקשת קוד זהה תמיד (גם לכתובת שאינה רשומה), כדי לא לחשוף מי רשום.
 */

const EMAIL_FORMAT = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const CODE_TTL_MINUTES = 10;
/** המתנה בין קודים — זהה למסד (issue_login_code) */
export const LOGIN_CODE_RESEND_SECONDS = 30;

function normalizeEmail(value: unknown): string {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  if (email.length > 254 || !EMAIL_FORMAT.test(email)) throw new Error("כתובת אימייל לא תקינה");
  return email;
}

function maskEmail(email: string): string {
  const [name = "", domain = ""] = email.split("@");
  if (name.length <= 2) return `${name[0] ?? ""}***@${domain}`;
  return `${name.slice(0, 2)}${"*".repeat(Math.min(5, name.length - 2))}@${domain}`;
}

/** HMAC של הקוד, צמוד לחנות ולכתובת — גם קריאה של הטבלה לא חושפת קודים */
async function codeHash(tenantId: string, email: string, code: string): Promise<string> {
  const { createHmac } = await import("node:crypto");
  const secret =
    process.env["LOGIN_CODE_SECRET"]?.trim() || process.env["SUPABASE_SERVICE_ROLE_KEY"] || "";
  if (!secret) throw new Error("תקלת הגדרות בשרת");
  return createHmac("sha256", secret).update(`${tenantId}:${email}:${code}`).digest("hex");
}

function logCode(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown>) {
  const line = `[login-code] ${msg} ${JSON.stringify(extra)}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const requestLoginCode = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string }) => ({ email: normalizeEmail(input?.email) }))
  .handler(async ({ data }) => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (!allowAction(`login-code:${ip}`, 10, 15 * 60 * 1000)) {
      throw new Error("יותר מדי בקשות לקוד מהמכשיר הזה. נסו שוב בעוד כמה דקות.");
    }

    const { randomInt } = await import("node:crypto");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { currentTenantId } = await import("@/integrations/supabase/tenant.server");
    const { sendEmail, renderEmailHtml, storeSender, escapeHtml } =
      await import("@/lib/email.server");

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const { error } = await supabaseAdmin.rpc("issue_login_code", {
      _email: data.email,
      _code_hash: await codeHash(currentTenantId(), data.email, code),
      _ip: ip,
    });
    // הודעות המסד ("קוד נשלח זה עתה", "נשלחו כבר כמה קודים") כתובות למשתמש
    if (error) throw new Error(error.message);

    const sender = await storeSender();
    // בלי רווח באמצע: מי שמעתיק את הקוד מהמייל ומדביק — מקבל 6 ספרות נקיות
    // (ההפרדה הוויזואלית — letter-spacing בלבד)
    const result = await sendEmail({
      to: [data.email],
      subject: `קוד הכניסה שלך: ${code}`,
      html: await renderEmailHtml(
        "קוד כניסה",
        `
        <p>שלום,</p>
        <p>זה קוד הכניסה שלך ל<strong>${escapeHtml(sender.name)}</strong>:</p>
        <p style="margin:18px 0;text-align:center;">
          <span dir="ltr" style="display:inline-block;font-size:30px;font-weight:bold;letter-spacing:8px;background:#f3f5f3;border:1px solid #e2e8e2;border-radius:10px;padding:12px 22px;color:#12211F;">${code}</span>
        </p>
        <p>הקוד תקף ל-${CODE_TTL_MINUTES} דקות ולשימוש חד-פעמי. אין לך עדיין חשבון? הקוד יפתח לך חשבון חדש.</p>
        <p style="color:#6b7280;font-size:13px;">לא ביקשתם קוד? אפשר להתעלם מההודעה — בלי הקוד אי אפשר להיכנס לחשבון. לעולם אל תמסרו את הקוד לאחרים.</p>
      `,
      ),
    });
    if (!result.sent) {
      logCode("error", "send failed", { ip, email: maskEmail(data.email), reason: result.reason });
      throw new Error("לא הצלחנו לשלוח את הקוד למייל. נסו שוב בעוד רגע, או התחברו עם סיסמה.");
    }
    logCode("info", "code sent", { ip, email: maskEmail(data.email) });
    return {
      sent: true,
      maskedEmail: maskEmail(data.email),
      expiresInMinutes: CODE_TTL_MINUTES,
      resendAfterSeconds: LOGIN_CODE_RESEND_SECONDS,
    };
  });

type ConsumeResult =
  | { result: "none" | "expired" | "locked" }
  | { result: "invalid"; left: number }
  | {
      result: "ok";
      user_id: string | null;
      member_tenant: string | null;
      same_store: boolean;
      platform_admin: boolean;
      blocked: boolean;
    };

export const verifyLoginCode = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string; code: string }) => {
    const email = normalizeEmail(input?.email);
    const code = String(input?.code ?? "").replace(/\D/g, "");
    if (code.length !== 6) throw new Error("הקוד מכיל 6 ספרות");
    return { email, code };
  })
  .handler(async ({ data }) => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (!allowAction(`login-code-verify:${ip}`, 30, 15 * 60 * 1000)) {
      throw new Error("יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.");
    }

    const { supabaseAdmin, supabaseAdminUnscoped } =
      await import("@/integrations/supabase/client.server");
    const { currentTenantId, isPlatformRequest, isSuspendedStoreRequest } =
      await import("@/integrations/supabase/tenant.server");

    const { data: raw, error } = await supabaseAdmin.rpc("consume_login_code", {
      _email: data.email,
      _code_hash: await codeHash(currentTenantId(), data.email, data.code),
    });
    if (error) {
      logCode("error", "consume failed", { ip, message: error.message });
      throw new Error("תקלה זמנית באימות הקוד. נסו שוב בעוד רגע.");
    }
    const outcome = raw as unknown as ConsumeResult;

    switch (outcome.result) {
      case "none":
        throw new Error("אין קוד פעיל לכתובת הזו. בקשו קוד חדש.");
      case "expired":
        throw new Error(`תוקף הקוד פג (${CODE_TTL_MINUTES} דקות). בקשו קוד חדש.`);
      case "locked":
        throw new Error("יותר מדי ניסיונות שגויים — הקוד בוטל. בקשו קוד חדש.");
      case "invalid":
        logCode("warn", "wrong code", { ip, email: maskEmail(data.email), left: outcome.left });
        throw new Error(
          outcome.left === 1
            ? "הקוד שגוי. נותר ניסיון אחד."
            : `הקוד שגוי. נותרו ${outcome.left} ניסיונות.`,
        );
      case "ok":
        break;
    }

    // חשבון של חנות אחרת — לא מתחבר דרך האתר הזה (מנהל-על הוא החריג)
    if (
      outcome.user_id &&
      outcome.member_tenant &&
      !outcome.same_store &&
      !outcome.platform_admin
    ) {
      logCode("warn", "account belongs to another store", { ip, email: maskEmail(data.email) });
      throw new Error(
        "כתובת המייל הזו רשומה בחנות אחרת במערכת. התחברו דרך האתר של החנות שבה נרשמתם.",
      );
    }

    let isNew = false;
    if (!outcome.user_id) {
      // הרשמה בקוד: לא בפאנל הפלטפורמה ולא בחנות מוקפאת
      if (isPlatformRequest()) throw new Error("אין חשבון מנהל עם הכתובת הזו");
      if (isSuspendedStoreRequest()) throw new Error("החנות סגורה זמנית להרשמה");
      const { error: createError } = await supabaseAdminUnscoped.auth.admin.createUser({
        email: data.email,
        email_confirm: true,
        user_metadata: { signup_method: "email_code" },
      });
      // מרוץ (שתי לשוניות) — החשבון כבר נוצר; ממשיכים להתחבר אליו
      if (createError && !/already|exists|registered/i.test(createError.message)) {
        logCode("error", "create user failed", { ip, message: createError.message });
        throw new Error("פתיחת החשבון נכשלה. נסו שוב או הירשמו בטופס ההרשמה.");
      }
      isNew = !createError;
    }

    const { sessionForEmail } = await import("@/lib/session.server");
    const session = await sessionForEmail(data.email, "login-code");
    logCode("info", isNew ? "signed up" : "signed in", { ip, email: maskEmail(data.email) });
    return { accessToken: session.accessToken, refreshToken: session.refreshToken, isNew };
  });
