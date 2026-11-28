/**
 * Online payments, platform scope — alerts to the platform team (server only; arch §9).
 *
 * alertPlatformAdmins(reason, attemptId): always one "[pay:platform] ALERT" log line; plus one e-mail per
 * (attempt, reason) — idempotency key pay-review:<attempt>:<reason> — through the existing Resend path to the
 * platform team's address list (SUPPORT_NOTIFY_EMAIL, the operator setting the other platform notices use; when it
 * is empty only the log line is written). Fixed text: the reason and the first 8 characters of the attempt id —
 * no customer data, no amount, no card data. Never throws: an alert must not break a return or a job.
 */
import { createHash } from "node:crypto";
import { escapeHtml, sendBusinessEmail } from "@/platform/email/send.server";
import { platformLog, shortId, type PlatformLogger } from "./log";

const recipientKey = (email: string) =>
  createHash("sha256").update(email, "utf8").digest("hex").slice(0, 12);

/** review reasons (migration 208) and the other alert causes → fixed Hebrew (arch §8.9) */
export const ALERT_REASON_TEXT: Readonly<Record<string, string>> = Object.freeze({
  document_issued: "ייתכן שהופק מסמך אצל ספק התשלומים",
  unexpected_hold: "עסקה מושהית או בתשלומים — לא צפוי",
  amount_mismatch: "הסכום לא תואם",
  currency_mismatch: "המטבע לא תואם",
  duplicate_txn: "מזהה עסקה כפול",
  duplicate_charge: "תשלום כפול",
  late: "התשלום הגיע אחרי שהניסיון פג",
  terminal_mismatch: "המסוף לא תואם",
  installments_exceeded: "מספר התשלומים לא מותר",
  verify_exhausted: "האימות מול ספק התשלומים נכשל שוב ושוב",
  credentials_changed: "פרטי המסוף שונו בזמן האימות",
  mode_not_allowed: "מצב המסוף לא מותר בסביבה",
  target_settled: "החיוב כבר שולם בדרך אחרת",
  target_changed: "החיוב השתנה",
  payer_gone: "העסק נמחק",
  environment_mismatch: "הסביבה של האפליקציה ושל המסד אינן תואמות — שום תשלום לא נסגר",
  credentials: "ספק התשלומים דחה את פרטי המסוף",
  verify_credentials:
    "אי אפשר לאמת חזרה מדף התשלום: פרטי המסוף אינם זמינים — ייתכן שהמסוף שונה בזמן התשלום",
});

const REASON = /^[a-z][a-z_]{1,39}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AlertDeps {
  send: typeof sendBusinessEmail;
  recipients(): string[];
  panelUrl(): string | null;
  log: PlatformLogger;
}

/** the platform team's list (SUPPORT_NOTIFY_EMAIL, comma-separated) */
function recipients(): string[] {
  return (process.env["SUPPORT_NOTIFY_EMAIL"] ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => EMAIL.test(value))
    .slice(0, 10);
}

/** the platform terminal page (https, or http for a local *.localhost platform host) */
function panelUrl(): string | null {
  const host = process.env["PLATFORM_ADMIN_HOST"]?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9.-]+(?::[0-9]{1,5})?$/.test(host)) return null;
  const hostname = host.replace(/:[0-9]+$/, "");
  const local = hostname === "localhost" || hostname.endsWith(".localhost");
  return `${local ? "http" : "https"}://${host}/platform/payments`;
}

export const defaultAlertDeps: AlertDeps = {
  send: sendBusinessEmail,
  recipients,
  panelUrl,
  log: platformLog,
};

function alertEmail(reason: string, attempt: string, url: string | null) {
  const what = ALERT_REASON_TEXT[reason] ?? "תשלום שדורש בדיקה";
  const link = url
    ? `<p><a href="${escapeHtml(url)}">למסך מסוף הפלטפורמה</a></p>`
    : "<p>הפרטים במסך מסוף הפלטפורמה בפאנל.</p>";
  return {
    subject: "תשלום לפלטפורמה ממתין לבדיקה",
    html: `<div dir="rtl" style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6">
<p><strong>תשלום מקוון לפלטפורמה דורש בדיקה.</strong></p>
<p>הסיבה: ${escapeHtml(what)}</p>
<p>מזהה הניסיון (8 התווים הראשונים): <span dir="ltr">${escapeHtml(attempt)}</span></p>
${link}
<p>לא נשלחים כאן פרטי לקוח, סכומים או פרטי כרטיס.</p>
</div>`,
  };
}

export async function alertPlatformAdmins(
  reason: string,
  attemptId: string | null,
  deps: AlertDeps = defaultAlertDeps,
): Promise<void> {
  const cause = typeof reason === "string" && REASON.test(reason) ? reason : "unknown";
  const attempt = shortId(attemptId);
  deps.log.alert("review", { reason: cause, attempt });
  try {
    const to = deps.recipients();
    if (to.length === 0) return;
    const { subject, html } = alertEmail(cause, attempt, deps.panelUrl());
    // one stable key per recipient (the same key twice would be delivered once only)
    await Promise.all(
      to.map((email) =>
        deps.send({
          to: email,
          subject,
          html,
          senderName: "NURIEL",
          replyTo: null,
          idempotencyKey: `pay-review:${attemptId ?? "none"}:${cause}:${recipientKey(email)}`,
        }),
      ),
    );
  } catch {
    deps.log.error("alert_email", { reason: cause, attempt });
  }
}
