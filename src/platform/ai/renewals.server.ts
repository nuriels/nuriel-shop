/**
 * NURIEL AI ASSISTANT — התראות החידוש: 30 / 14 / 7 / 1 ימים לפני תאריך הסיום, וביום הסיום עצמו.
 *
 * רץ בשרת עצמו (setInterval, כמו שאר תהליכי הרקע — נטען מ-src/server.ts), פעם בשעה; לא תלוי בכניסה של
 * לקוח לאתר. כל ההחלטות במסד, לפי היום בישראל (ai_due_notifications):
 *  • מה צריך לצאת היום — הסף הנוכחי בלבד (מתזמן שלא רץ כמה ימים לא שולח כמה התראות בבת אחת);
 *  • חבילה שחודשה — תאריך הסיום זז קדימה, ואין התראה על הסיום הישן; חבילה מושבתת — אין התראות;
 *  • "תפיסה" לפני השליחה (ai_notification_claim, UNIQUE במסד) — אותה התראה לאותה תקופה לא נשלחת
 *    פעמיים, גם כשרצים כמה שרתים במקביל, וגם בניסיון חוזר (Idempotency-Key אצל ספק המיילים);
 *  • נרשם: נשלחה / נכשלה (עם הסיבה) / דולגה (אין כתובת מייל תקינה). מה שנכשל — ניסיון נוסף אחרי שעה,
 *    עד 3 ניסיונות, באותו Idempotency-Key (כך שמייל שכבר יצא לא יוצא שוב);
 *  • שירות המיילים לא מוגדר (אין RESEND_API_KEY) — לא תופסים כלום, וההתראות לא "נשרפות".
 * בלי חיוב אוטומטי: החידוש נעשה בידי מנהל העל, רק אחרי אישור ותשלום.
 * ההתראה בפאנל הניהול של הלקוח מחושבת בכל טעינה מהמצב במסד (endingSoonMessage) — לא נשלחת.
 */
import { emailConfigured, escapeHtml, sendBusinessEmail } from "../email/send.server";
import { formatIsraeliDate, formatShekels } from "./logic";
import * as store from "./store.server";
import type { RenewalRun } from "./types";

export type DueNotice = {
  subscription_id: string;
  tenant_id: string;
  product: string;
  business_name: string | null;
  slug: string | null;
  owner_email: string | null;
  period_ends_on: string;
  days_left: number;
  kind: "d30" | "d14" | "d7" | "d1" | "d0";
  price_agorot: number;
};

export type { RenewalRun } from "./types";

const EMAIL = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[A-Za-z]{2,24}$/;

/** כתובת שאפשר לשלוח אליה (בלי רווחים, בלי כמה נמענים, דומיין עם סיומת) */
export function validEmail(value: unknown): string | null {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

/** "nuriel@example.com" → "n***@example.com" — מה שנשמר ביומן ההתראות */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`.slice(0, 120);
}

function whenText(daysLeft: number): string {
  if (daysLeft <= 0) return "היום";
  if (daysLeft === 1) return "מחר";
  return `בעוד ${daysLeft} ימים`;
}

/** המייל — לפי הנוסח שאושר; התאריך והמחיר מהמסד */
export function renewalEmail(notice: DueNotice): { subject: string; html: string; text: string } {
  const endsOn = formatIsraeliDate(notice.period_ends_on);
  const price = formatShekels(notice.price_agorot);
  const business = notice.business_name?.trim() || "העסק שלך";
  const subject = "חבילת NURIEL AI שלך עומדת להסתיים";
  const paragraphs = [
    "שלום,",
    `חבילת עוזר ה-AI שלך (${business}) עומדת להסתיים בתאריך ${endsOn} — ${whenText(notice.days_left)}.`,
    "כדי להמשיך ליהנות מעוזר ה-AI של Nuriel, ניתן לפנות אלינו לחידוש החבילה.",
    `מחיר החידוש: ${price} לשנה.`,
    "החידוש אינו מתבצע אוטומטית ואין חיוב בלי אישור שלך.",
  ];
  const text = `${paragraphs.join("\n\n")}\n\nתודה,\nNURIEL COMPUTERS`;
  const html = `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;padding:24px;background:#f6f7f9;font-family:Arial,sans-serif;color:#1f2933">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;line-height:1.7;font-size:16px" dir="rtl">
${paragraphs.map((p) => `<p style="margin:0 0 14px">${escapeHtml(p)}</p>`).join("\n")}
<p style="margin:22px 0 0">תודה,<br><strong>NURIEL COMPUTERS</strong></p>
</div></body></html>`;
  return { subject, html, text };
}

function replyToAddress(): string | null {
  const first = (process.env["SUPPORT_NOTIFY_EMAIL"] ?? "").split(",")[0];
  return validEmail(first);
}

/** ריצה אחת: מה שצריך לצאת היום → תפיסה → שליחה → רישום התוצאה */
export async function runRenewalNotices(): Promise<RenewalRun> {
  const run: RenewalRun = {
    due: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    claimedElsewhere: 0,
    emailNotConfigured: false,
  };
  try {
    await store.rpc("ai_notifications_mark_stale", {});
  } catch {
    // לא קריטי
  }
  const due = (await store.rpc<DueNotice[]>("ai_due_notifications", {})) ?? [];
  run.due = due.length;
  // בלי שירות מיילים לא תופסים אף התראה — אחרת כולן היו נרשמות כ"דולגה" ולא יוצאות לעולם
  if (due.length > 0 && !emailConfigured()) {
    run.emailNotConfigured = true;
    return run;
  }
  for (const notice of due) {
    const email = validEmail(notice.owner_email);
    const id = await store.rpc<number | null>("ai_notification_claim", {
      _subscription: notice.subscription_id,
      _period_ends_on: notice.period_ends_on,
      _kind: notice.kind,
      _recipient_masked: email ? maskEmail(email) : null,
    });
    if (id === null || id === undefined) {
      run.claimedElsewhere += 1; // כבר נשלחה / נתפסה בשרת אחר / החבילה חודשה בינתיים
      continue;
    }
    if (!email) {
      await store.rpc("ai_notification_finish", {
        _id: id,
        _status: "skipped",
        _error: "no valid email address",
      });
      run.skipped += 1;
      continue;
    }
    const message = renewalEmail(notice);
    let status: "sent" | "failed" | "skipped" = "failed";
    let error: string | null = null;
    try {
      const result = await sendBusinessEmail({
        to: email,
        subject: message.subject,
        html: message.html,
        senderName: "NURIEL COMPUTERS",
        replyTo: replyToAddress(),
        idempotencyKey: `nuriel-ai-renewal-${id}`,
      });
      status = result.sent ? "sent" : result.skipped ? "skipped" : "failed";
      error = result.sent ? null : (result.reason ?? "not sent").slice(0, 300);
    } catch (cause) {
      status = "failed";
      error = (cause instanceof Error ? cause.message : "send failed").slice(0, 300);
    }
    await store.rpc("ai_notification_finish", { _id: id, _status: status, _error: error });
    if (status === "sent") run.sent += 1;
    else if (status === "skipped") run.skipped += 1;
    else run.failed += 1;
  }
  return run;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // מוני המכסות שהחלון שלהם נגמר — נמחקים (לא קריטי)
    await store.pruneQuota();
    const run = await runRenewalNotices();
    if (run.emailNotConfigured) {
      console.error(
        `[nuriel-ai] renewal notices: email is not configured (RESEND_API_KEY) — ${run.due} due, nothing sent`,
      );
    } else if (run.sent + run.failed + run.skipped > 0) {
      console.log(
        `[nuriel-ai] renewal notices: ${run.sent} sent, ${run.failed} failed, ${run.skipped} skipped`,
      );
    }
  } catch (error) {
    // המיגרציה עוד לא רצה / המסד לא זמין — ננסה בשעה הבאה
    console.error(
      "[nuriel-ai] renewal notices failed",
      error instanceof Error ? error.message.slice(0, 200) : "",
    );
  } finally {
    running = false;
  }
}

/** פעם בשעה (והפעם הראשונה דקה אחרי שהשרת עלה). לא בבדיקות היחידה */
export function startAiRenewalJob(): void {
  if (timer || process.env["NODE_ENV"] === "test" || process.env["AI_RENEWAL_JOB"] === "off")
    return;
  const first = setTimeout(() => void tick(), 60 * 1000);
  first.unref?.();
  timer = setInterval(() => void tick(), 60 * 60 * 1000);
  timer.unref?.();
  // שורה אחת בעליית השרת — כך אפשר לוודא (docker logs) שהבדיקה השעתית רצה בלי שום בקשה מבחוץ
  console.log("[nuriel-ai] renewal notices: hourly check started (first run in 1 minute)");
}
