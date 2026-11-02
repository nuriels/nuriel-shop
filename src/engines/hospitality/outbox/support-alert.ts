// המייל לצוות הפלטפורמה על פנייה חדשה / תגובה של עסק (שלב E4). טהור — נבדק ביחידה; השליחה
// ב-server/support.server.ts. הטקסט של העסק מוצג כטקסט (escape), עד 600 תווים.
import { PRIORITY_LABEL, TOPIC_LABEL } from "../management/support/model";
import type { SupportPriority, SupportTopic } from "../types/support";

export interface SupportAlert {
  event: "opened" | "replied";
  ticketId: string;
  number: number;
  subject: string;
  topic: SupportTopic;
  priority: SupportPriority;
  business: string;
  messageId: string;
  body: string;
  files: number;
}

/** הנושא והגוף של המייל לצוות הפלטפורמה */
export function supportAlertEmail(
  a: SupportAlert,
  panelUrl: string | null,
  escape: (s: string) => string,
) {
  const e = escape;
  const urgent = a.priority === "urgent" || a.priority === "high";
  const subject = `${urgent ? `[${PRIORITY_LABEL[a.priority]}] ` : ""}${
    a.event === "opened" ? "פנייה חדשה" : "תגובה בפנייה"
  } #${a.number} — ${a.business}: ${a.subject}`.slice(0, 200);
  const preview = a.body.length > 600 ? `${a.body.slice(0, 600)}…` : a.body;
  const rows = [
    ["עסק", a.business],
    ["נושא", a.subject],
    ["תחום", TOPIC_LABEL[a.topic]],
    ["דחיפות", PRIORITY_LABEL[a.priority]],
    ...(a.files ? [["קבצים מצורפים", String(a.files)]] : []),
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 0 4px 12px;color:#6b7280">${e(k ?? "")}</td><td style="padding:4px 0;font-weight:600">${e(v ?? "")}</td></tr>`,
    )
    .join("");
  const button = panelUrl
    ? `<p style="margin:20px 0 0"><a href="${e(panelUrl)}" style="background:#0f3b45;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;display:inline-block">לפנייה בפאנל</a></p>`
    : "";
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#f3f5f4;font-family:Arial,Helvetica,sans-serif;color:#12211f">
<div dir="rtl" style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;padding:28px;border:1px solid #e2e8e5;text-align:right">
<p style="margin:0 0 6px;font-size:13px;color:#6b7280">תמיכה — Nuriel Hospitality</p>
<h1 style="font-size:20px;margin:0 0 14px">${e(a.event === "opened" ? "פנייה חדשה" : "תגובה חדשה")} #${a.number}</h1>
<table role="presentation" style="border-collapse:collapse;font-size:15px">${rows}</table>
<div style="margin-top:14px;background:#f7f8f7;border-right:4px solid #b08a3e;border-radius:8px;padding:12px 14px;line-height:1.7;white-space:pre-wrap">${e(preview)}</div>
${button}
<p style="margin:18px 0 0;color:#9ca3af;font-size:12px">התראה אוטומטית. המענה — בפאנל, ב"ניהול Hospitality" ← תמיכה.</p>
</div></body></html>`;
  return { subject, html };
}
