// שלב E2: בקשה לאתר צימר מהשער → מייל למנהלי הפלטפורמה (שרת בלבד).
// כשל במייל לא מפיל את הבקשה — היא כבר שמורה במסד ומופיעה בפאנל.
import { emailActionButton, escapeHtml, isValidEmail, sendEmail } from "@/lib/email.server";

export type ZimmerRequestNotice = {
  id: string;
  email: string;
  business_name: string;
  phone: string;
  units: number | null;
  plan_name: string | null;
  area: string | null;
  message: string | null;
  notify: string[];
};

function recipients(notify: string[]): string[] {
  const override = (process.env["SUPPORT_NOTIFY_EMAIL"] ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => isValidEmail(value));
  return override.length > 0 ? override : notify.filter((value) => isValidEmail(value));
}

function panelUrl(): string | null {
  const host = process.env["PLATFORM_ADMIN_HOST"]?.trim().toLowerCase();
  return host ? `https://${host}/platform/hospitality#site-requests` : null;
}

export async function notifyPlatformOfZimmerRequest(request: ZimmerRequestNotice): Promise<void> {
  try {
    const to = recipients(request.notify);
    if (to.length === 0) {
      console.warn("[portal] zimmer request: no platform admin email to notify");
      return;
    }
    const rows = [
      ["שם העסק", request.business_name],
      ["טלפון", request.phone],
      ["אימייל", request.email],
      ["יחידות", request.units === null ? "לא צוין" : String(request.units)],
      ["חבילה", request.plan_name ?? "עוד לא יודעים"],
      ["אזור", request.area ?? "לא צוין"],
    ]
      .map(
        ([label, value]) =>
          `<tr><td style="padding:4px 0 4px 12px;color:#6b7280;">${escapeHtml(label ?? "")}</td><td style="padding:4px 0;">${escapeHtml(value ?? "")}</td></tr>`,
      )
      .join("");
    const message = request.message
      ? `<div style="margin-top:14px;background:#f7f8f7;border-right:4px solid #b08a3e;border-radius:8px;padding:12px 14px;line-height:1.7;">${escapeHtml(request.message).replace(/\n/g, "<br />")}</div>`
      : "";
    const url = panelUrl();
    const html = `<!doctype html>
<html lang="he" dir="rtl">
  <body style="margin:0;padding:24px;background:#f3f5f3;font-family:Heebo,Arial,sans-serif;color:#12211F;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px;border:1px solid #e2e8e2;">
      <h1 style="font-size:20px;margin:0 0 12px;">בקשה חדשה לאתר צימר</h1>
      <p style="margin:0 0 12px;line-height:1.6;">נשלחה מהשער (nuriel-app2). מחכה לשיחה ולתיאום ההקמה.</p>
      <table style="border-collapse:collapse;font-size:15px;">${rows}</table>
      ${message}
      ${url ? emailActionButton("לבקשות בפאנל", url) : ""}
      <p style="margin:18px 0 0;color:#9ca3af;font-size:12px;">התראה אוטומטית. הטיפול בבקשה — בפאנל ("ניהול Hospitality").</p>
    </div>
  </body>
</html>`;
    const result = await sendEmail({
      to,
      subject: `בקשה לאתר צימר: ${request.business_name}`,
      html,
      platformSender: { name: "בקשות לאתרי צימר", replyTo: request.email },
    });
    if (!result.sent) console.error("[portal] zimmer request notify failed", result.reason);
  } catch (error) {
    console.error("[portal] zimmer request notify crashed", error);
  }
}

/** אישור קצר למי ששלח את הבקשה (באימייל המאומת בשער) — כשל לא מפיל את הבקשה */
export async function confirmZimmerRequestToRequester(request: {
  email: string;
  business_name: string;
}): Promise<void> {
  try {
    if (!isValidEmail(request.email)) return;
    const html = `<!doctype html>
<html lang="he" dir="rtl">
  <body style="margin:0;padding:24px;background:#f3f5f3;font-family:Heebo,Arial,sans-serif;color:#12211F;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px;border:1px solid #e2e8e2;">
      <h1 style="font-size:20px;margin:0 0 12px;">קיבלנו את הבקשה לאתר של ${escapeHtml(request.business_name)}</h1>
      <p style="margin:0 0 12px;line-height:1.7;">תודה! נחזור אליכם בטלפון תוך יום עסקים כדי לתאם את ההקמה: הדומיין, העיצוב, התמונות והטקסטים, וההגדרות בגוגל.</p>
    </div>
  </body>
</html>`;
    const result = await sendEmail({
      to: [request.email],
      subject: "קיבלנו את הבקשה לאתר הצימר",
      html,
      platformSender: { name: "נוריאל — אתרים לצימרים" },
    });
    if (!result.sent) console.error("[portal] zimmer request confirmation failed", result.reason);
  } catch (error) {
    console.error("[portal] zimmer request confirmation crashed", error);
  }
}
