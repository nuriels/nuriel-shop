// פניות מלקוחות (מיגרציה 196) — צד השרת: הקריאות למסד במפתח השירות (שמירה, תור ההתראות, מחיקה לפי
// מדיניות השמירה), טביעת ה-IP (HMAC — אין כתובות IP במסד), ושליחת מייל ההתראה דרך שירות המיילים
// הקיים של Nuriel (src/platform/email — Resend, עם Idempotency-Key). הפנייה נשמרת תמיד לפני המייל;
// כישלון במייל רק נרשם בשורה (מצב, שגיאה, ניסיון חוזר) ולא מבטל אותה.
import { createHmac } from "node:crypto";
import { sendBusinessEmail } from "@/platform/email/send.server";
import { serviceHeaders, supabaseUrl } from "@/platform/supabase/env.server";
import { siteOrigin } from "@/platform/tenancy/current-site.server";
import { BusinessProfileError } from "../data/rpc.server";
import { inquiryEmail, scrubError } from "./logic";

const USER_FACING = /[֐-׿]/;

/** קריאה לפונקציה במסד במפתח השירות; siteId → x-tenant-id (האתר של הפנייה) */
export async function serviceRpc<T>(
  fn: string,
  args: Record<string, unknown>,
  siteId: string | null = null,
): Promise<T> {
  const res = await fetch(`${supabaseUrl()}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { ...serviceHeaders(), ...(siteId ? { "x-tenant-id": siteId } : {}) },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  if (!res.ok) {
    let code: string | null = null;
    let message = "";
    try {
      const body = JSON.parse(text) as { code?: string; message?: string };
      code = body.code ?? null;
      message = body.message ?? "";
    } catch {
      message = "";
    }
    const userFacing = USER_FACING.test(message);
    if (!userFacing) console.error(`[business-profile/inquiries] ${fn} failed`, res.status, code);
    throw new BusinessProfileError(userFacing ? message : "הפעולה נכשלה — נסו שוב", code);
  }
  return (text ? JSON.parse(text) : null) as T;
}

function secret(): string {
  const value =
    process.env["BUSINESS_PROFILE_SECRET"]?.trim() ||
    process.env["LOGIN_CODE_SECRET"]?.trim() ||
    process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim() ||
    "";
  if (!value) throw new Error("תקלת הגדרות בשרת");
  return value;
}

/** טביעה של כתובת ה-IP לאתר מסוים (להגבלת קצב בלבד) — לא ניתנת לשחזור לכתובת */
export function ipHash(ip: string, siteId: string): string | null {
  if (!ip || ip === "unknown") return null;
  const key = createHmac("sha256", secret()).update("nuriel-websites:inquiry-ip").digest();
  return createHmac("sha256", key).update(`${siteId}\u0000${ip}`).digest("hex");
}

interface NotifyJob {
  id: string;
  reference: string;
  attempt: number;
  to: string | null;
  site: { id: string; slug: string; name: string; domain: string | null };
  kind: string;
  form_title: string | null;
  page_path: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  message: string | null;
  created_at: string;
  is_test: boolean;
}

export type NotifyOutcome = "sent" | "failed" | "skipped";

/**
 * שליחת ההתראה על פנייה אחת: claim (נעילה, בלי כפילות בין שרתים) → מייל → תוצאה. NULL מה-claim =
 * כבר נשלחה / בשליחה / ההתראות כבויות. הקישור במייל — תמיד לכתובת של האתר על הדומיין של הפלטפורמה
 * (<slug>.<base>, כמו בכניסה החד-פעמית; SEC-H2), לאזור הפניות. הקישור לא נותן גישה — נדרשת כניסה.
 */
export async function notifyInquiry(id: string): Promise<NotifyOutcome> {
  const job = await serviceRpc<NotifyJob | null>("bp_inquiry_notify_claim", { _id: id });
  if (!job || !job.to) return "skipped";
  let ok = false;
  let reason: string | null = null;
  try {
    const origin = await siteOrigin({ slug: job.site.slug, domain: null });
    const link = origin ? `${origin}/studio/inbox?id=${encodeURIComponent(job.id)}` : null;
    const mail = inquiryEmail({
      siteName: job.site.name,
      reference: job.reference,
      kind: job.kind,
      formTitle: job.form_title,
      fullName: job.full_name,
      phone: job.phone,
      email: job.email,
      message: job.message,
      createdAt: job.created_at,
      isTest: job.is_test,
      link,
    });
    const r = await sendBusinessEmail({
      to: job.to,
      subject: mail.subject,
      html: mail.html,
      senderName: job.site.name.slice(0, 80) || "Nuriel Websites",
      replyTo: job.email,
      // אותו ניסיון לא נשלח פעמיים (ניסיון חוזר של הרשת); ניסיון חדש — מפתח חדש
      idempotencyKey: `bp-inquiry-${job.id}-${job.attempt}`,
    });
    ok = r.sent;
    if (!ok) reason = r.skipped ? "שירות המיילים לא מוגדר בשרת" : r.reason;
  } catch (error) {
    reason = error instanceof Error ? error.message : "תקלה בשליחה";
  }
  await serviceRpc("bp_inquiry_notify_result", {
    _id: id,
    _ok: ok,
    _error: ok ? null : scrubError(reason),
  });
  return ok ? "sent" : "failed";
}

/** תהליך הרקע: ההתראות שהגיע זמנן (ניסיון חוזר / נתקעו) */
export async function notifyDue(limit = 20): Promise<number> {
  const ids = await serviceRpc<string[]>("bp_inquiry_notify_due", { _limit: limit });
  let sent = 0;
  for (const id of ids ?? []) {
    try {
      if ((await notifyInquiry(id)) === "sent") sent += 1;
    } catch (error) {
      console.error(
        "[business-profile/inquiries] notify",
        error instanceof Error ? error.message : error,
      );
    }
  }
  return sent;
}

/** מחיקה לפי מדיניות השמירה של כל אתר (פעם ביום) */
export async function purgeInquiries(): Promise<number> {
  return (await serviceRpc<number>("bp_inquiries_purge", {})) ?? 0;
}
