// הזמנת בעלת האתר (מיגרציה 198) — הצד של האתר: בדיקת הקישור, פתיחת החשבון והשיוך, ואימות המייל.
// הקישור: https://<האתר>.nuri1.fit/studio/invite#t=<טוקן> — הטוקן ב-fragment, נשלח לכאן רק בגוף הבקשה (POST).
// • בדיקה ומימוש — במפתח השירות, רק דרך פונקציות המסד (bp_invite_check / bp_invite_redeem): פעם אחת, רק באתר הזה,
//   רק חשבון חדש, הרשאת בעלת האתר בלבד. כל כישלון נרשם במסד. הגבלת קצב לפי IP ולפי קישור (ניחוש / הצפה).
// • החשבון: אימייל + סיסמה שהיא בוחרת (GoTrue). המייל לא מסומן כמאומת — אימות רק בקוד שנשלח לתיבה; בלי שירות
//   מיילים החשבון נפתח ופעיל, והאימות מחכה (מוצג בבירור בממשק הניהול ובתיק האתר).
// • אחרי המימוש: קוד כניסה חד-פעמי (store_owner, 2 דקות) → /admin-handoff → ממשק הניהול, כמו כל כניסה אחרת.
import { createServerFn } from "@tanstack/react-start";
import type { InviteCheck, InviteRedeemed, InviteStatus, OwnerEmailStatus } from "../types";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
export const INVITE_PASSWORD_MIN = 10;
const PASSWORD_MAX = 72;

export const INVITE_STATUS_MESSAGE: Record<Exclude<InviteStatus, "valid">, string> = {
  invalid: "הקישור לא תקין. ודאו שהעתקתם את כל הקישור, או בקשו קישור חדש מ-Nuriel.",
  expired: "תוקף הקישור פג. בקשו מ-Nuriel קישור חדש.",
  used: "הקישור כבר שימש לפתיחת חשבון. אפשר להיכנס לממשק הניהול עם האימייל והסיסמה שבחרתם.",
  revoked: "הקישור בוטל. בקשו מ-Nuriel קישור חדש.",
  owner_exists: "לאתר הזה כבר יש בעלת אתר. אפשר להיכנס לממשק הניהול עם החשבון הקיים.",
};

const REDEEM_FAIL_MESSAGE: Record<string, string> = {
  account_has_roles: "פתיחת החשבון נכשלה. נסו שוב או פנו ל-Nuriel.",
  platform_admin_account: "פתיחת החשבון נכשלה. נסו שוב או פנו ל-Nuriel.",
  no_account: "פתיחת החשבון נכשלה. נסו שוב.",
};

/** בדיקות הטופס — גם בדפדפן וגם בשרת (טהור) */
export function inviteFormProblem(input: {
  email: string;
  password: string;
  confirm: string;
}): string | null {
  const email = input.email.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL.test(email)) return "כתובת האימייל לא תקינה";
  if (input.password.length < INVITE_PASSWORD_MIN)
    return `הסיסמה צריכה להכיל לפחות ${INVITE_PASSWORD_MIN} תווים`;
  if (input.password.length > PASSWORD_MAX) return `הסיסמה ארוכה מדי (עד ${PASSWORD_MAX} תווים)`;
  if (input.password.trim().toLowerCase() === email) return "הסיסמה לא יכולה להיות האימייל עצמו";
  if (input.password !== input.confirm) return "הסיסמאות אינן תואמות";
  return null;
}

function tokenOf(v: unknown): string {
  const t = String(v ?? "").trim();
  if (!TOKEN.test(t)) throw new Error(INVITE_STATUS_MESSAGE.invalid);
  return t;
}

async function sha256(value: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(value).digest("hex");
}

/** HMAC של קוד האימות — צמוד לאתר ולמשתמשת; במסד נשמר רק הוא */
async function codeHash(siteId: string, userId: string, code: string): Promise<string> {
  const { createHmac } = await import("node:crypto");
  const secret =
    process.env["BUSINESS_PROFILE_SECRET"]?.trim() ||
    process.env["LOGIN_CODE_SECRET"]?.trim() ||
    process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim() ||
    "";
  if (!secret) throw new Error("תקלת הגדרות בשרת");
  const key = createHmac("sha256", secret).update("nuriel-websites:owner-email").digest();
  return createHmac("sha256", key).update(`${siteId}\u0000${userId}\u0000${code}`).digest("hex");
}

async function context() {
  const [{ businessSiteId }, { serviceRpc, ipHash }, { allowAction, requestIp }] =
    await Promise.all([
      import("../data/rpc.server"),
      import("../inquiries/service.server"),
      import("@/platform/security/rate-limit.server"),
    ]);
  const siteId = await businessSiteId();
  const ip = await requestIp();
  return { siteId, ip, ipTag: ipHash(ip, siteId), serviceRpc, allowAction };
}

/** קוד אימות חדש למייל של בעלת האתר (אם צריך) — "sent" רק אם שירות המיילים קיבל את ההודעה */
async function sendVerificationCode(
  siteId: string,
  userId: string,
): Promise<"sent" | "failed" | "not_configured" | "not_needed"> {
  const [{ emailConfigured, sendBusinessEmail, escapeHtml }, { serviceRpc }, { randomInt }] =
    await Promise.all([
      import("@/platform/email/send.server"),
      import("../inquiries/service.server"),
      import("node:crypto"),
    ]);
  if (!emailConfigured()) return "not_configured";
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const hash = await codeHash(siteId, userId, code);
  const issued = await serviceRpc<{ needed: boolean; email?: string }>(
    "bp_owner_email_code_issue",
    { _tenant: siteId, _user_id: userId, _code_hash: hash },
  );
  if (!issued.needed || !issued.email) return "not_needed";
  const html = `<!doctype html><html lang="he" dir="rtl"><body style="font-family:Arial,sans-serif;direction:rtl;text-align:right;color:#1f2937">
<p>שלום,</p>
<p>זה קוד האימות לכתובת המייל שלך בממשק הניהול של האתר ב-Nuriel:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px;direction:ltr;text-align:right">${escapeHtml(code)}</p>
<p>הקוד תקף ל-10 דקות. אם לא ביקשת אותו — אפשר להתעלם מההודעה.</p>
<p style="color:#6b7280;font-size:13px">Nuriel</p></body></html>`;
  const sent = await sendBusinessEmail({
    to: issued.email,
    subject: "קוד לאימות כתובת המייל — Nuriel",
    html,
    senderName: "Nuriel",
    replyTo: null,
    idempotencyKey: `bp-owner-verify:${hash.slice(0, 32)}`,
  });
  return sent.sent ? "sent" : "failed";
}

// ---------- 1. בדיקת הקישור (לפני הטופס) ----------
export const inviteCheck = createServerFn({ method: "POST" })
  .inputValidator((input: { token?: unknown }) => ({ token: tokenOf(input?.token) }))
  .handler(async ({ data }): Promise<InviteCheck> => {
    const { siteId, ip, ipTag, serviceRpc, allowAction } = await context();
    if (!allowAction(`bp-invite-check:${ip}`, 30, 15 * 60 * 1000))
      throw new Error("יותר מדי ניסיונות מהמכשיר הזה. נסו שוב בעוד כמה דקות.");
    const r = await serviceRpc<{ status: InviteStatus; site_name?: string; expires_at?: string }>(
      "bp_invite_check",
      { _token_hash: await sha256(data.token), _tenant: siteId, _ip: ipTag },
    );
    return {
      status: r.status,
      siteName: r.status === "valid" ? (r.site_name ?? null) : null,
      expiresAt: r.status === "valid" ? (r.expires_at ?? null) : null,
    };
  });

// ---------- 2. פתיחת החשבון ומימוש ההזמנה ----------
export const inviteRedeem = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { token?: unknown; email?: unknown; password?: unknown; confirm?: unknown }) => {
      const form = {
        email: String(input?.email ?? "")
          .trim()
          .toLowerCase(),
        password: String(input?.password ?? ""),
        confirm: String(input?.confirm ?? ""),
      };
      const problem = inviteFormProblem(form);
      if (problem) throw new Error(problem);
      return { token: tokenOf(input?.token), ...form };
    },
  )
  .handler(async ({ data }): Promise<InviteRedeemed> => {
    const { siteId, ip, ipTag, serviceRpc, allowAction } = await context();
    const tokenHash = await sha256(data.token);
    if (
      !allowAction(`bp-invite-redeem:${ip}`, 10, 15 * 60 * 1000) ||
      !allowAction(`bp-invite-redeem-token:${tokenHash}`, 8, 15 * 60 * 1000)
    )
      throw new Error("יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.");

    // הקישור עדיין תקף (גם נרשם במסד אם לא)
    const check = await serviceRpc<{ status: InviteStatus }>("bp_invite_check", {
      _token_hash: tokenHash,
      _tenant: siteId,
      _ip: ipTag,
    });
    if (check.status !== "valid") throw new Error(INVITE_STATUS_MESSAGE[check.status]);

    const { createInvitedAccount, deleteNewAccount } =
      await import("@/platform/auth/accounts.server");
    const account = await createInvitedAccount(data.email, data.password);
    if ("exists" in account) {
      await serviceRpc("bp_invite_fail", {
        _token_hash: tokenHash,
        _tenant: siteId,
        _reason: "email_exists",
        _ip: ipTag,
      });
      throw new Error(
        "כתובת האימייל הזו כבר רשומה ב-Nuriel. הזינו כתובת אחרת, או פנו ל-Nuriel כדי לחבר את החשבון הקיים לאתר.",
      );
    }

    const { randomBytes } = await import("node:crypto");
    const handoffCode = randomBytes(32).toString("base64url");
    let redeemed: { ok: boolean; reason?: string; email?: string };
    try {
      redeemed = await serviceRpc("bp_invite_redeem", {
        _token_hash: tokenHash,
        _tenant: siteId,
        _user_id: account.userId,
        _handoff_hash: await sha256(handoffCode),
        _ip: ipTag,
      });
    } catch (e) {
      await deleteNewAccount(account.userId);
      throw e;
    }
    if (!redeemed.ok) {
      // לא משאירים חשבון בלי שיוך (קישור שנוצל / בוטל בינתיים וכו')
      await deleteNewAccount(account.userId);
      const reason = redeemed.reason ?? "invalid";
      throw new Error(
        (INVITE_STATUS_MESSAGE as Record<string, string>)[reason] ??
          REDEEM_FAIL_MESSAGE[reason] ??
          "פתיחת החשבון נכשלה. נסו שוב.",
      );
    }

    // אימות המייל — לא חוסם: אם השליחה לא אפשרית / נכשלה, החשבון פעיל והאימות מחכה בממשק הניהול
    let verification: InviteRedeemed["verification"] = "failed";
    try {
      const sent = await sendVerificationCode(siteId, account.userId);
      verification = sent === "not_needed" ? "failed" : sent;
    } catch (e) {
      console.error("[bp-invite] verification email failed", (e as Error).message);
    }
    return { handoffCode, email: redeemed.email ?? data.email, verification };
  });

// ---------- 3. אימות המייל (בממשק הניהול, אחרי הכניסה) ----------
export const studioOwnerEmailStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<OwnerEmailStatus> => {
    const [{ studioRpc }, { emailConfigured }] = await Promise.all([
      import("../data/rpc.server"),
      import("@/platform/email/send.server"),
    ]);
    const r = await studioRpc<{ needed: boolean; email?: string; verified_at?: string | null }>(
      "bp_owner_email_status",
    );
    return {
      needed: r.needed,
      email: r.email ?? null,
      verifiedAt: r.verified_at ?? null,
      emailConfigured: emailConfigured(),
    };
  },
);

export const studioOwnerEmailSendCode = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ status: "sent" | "failed" | "not_configured" | "not_needed" }> => {
    const [{ requireSession }, { businessSiteId }, { allowAction }] = await Promise.all([
      import("@/platform/auth/session.server"),
      import("../data/rpc.server"),
      import("@/platform/security/rate-limit.server"),
    ]);
    const session = await requireSession();
    if (!allowAction(`bp-owner-email-send:${session.userId}`, 6, 15 * 60 * 1000))
      throw new Error("נשלחו כבר כמה קודים. נסו שוב בעוד רבע שעה.");
    return { status: await sendVerificationCode(await businessSiteId(), session.userId) };
  },
);

export const studioOwnerEmailVerify = createServerFn({ method: "POST" })
  .inputValidator((input: { code?: unknown }) => {
    const code = String(input?.code ?? "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) throw new Error("הקוד הוא 6 ספרות");
    return { code };
  })
  .handler(async ({ data }): Promise<{ verified: true }> => {
    const [{ requireSession }, { businessSiteId }, { allowAction }, { serviceRpc }] =
      await Promise.all([
        import("@/platform/auth/session.server"),
        import("../data/rpc.server"),
        import("@/platform/security/rate-limit.server"),
        import("../inquiries/service.server"),
      ]);
    const session = await requireSession();
    if (!allowAction(`bp-owner-email-verify:${session.userId}`, 15, 15 * 60 * 1000))
      throw new Error("יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.");
    const siteId = await businessSiteId();
    const r = await serviceRpc<{ result: string; left?: number }>("bp_owner_email_code_verify", {
      _tenant: siteId,
      _user_id: session.userId,
      _code_hash: await codeHash(siteId, session.userId, data.code),
    });
    if (r.result === "ok") return { verified: true };
    if (r.result === "invalid")
      throw new Error(r.left ? `הקוד שגוי — נשארו ${r.left} ניסיונות` : "הקוד שגוי. בקשו קוד חדש.");
    if (r.result === "expired" || r.result === "locked")
      throw new Error("הקוד כבר לא בתוקף. בקשו קוד חדש.");
    throw new Error("אין קוד פעיל. בקשו קוד חדש.");
  });
