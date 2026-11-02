// שלב E2: בקשה לאתר צימר מהשער → מייל למנהלי הפלטפורמה (שרת בלבד).
// מיגרציה 40: גם עסק שבעליו פתחו מהשער (ניסיון) — אותו מייל, "נפתח לניסיון — חזרו אליו", ומייל
// "העסק נפתח" לבעל העסק עם הקישור לאזור הניהול.
// כשל במייל לא מפיל את הבקשה / הפתיחה — הן כבר שמורות במסד ומופיעות בפאנל.
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
  /** מיגרציה 40: העסק כבר נפתח מהשער (ניסיון) — כתובת האתר וסוף הניסיון */
  opened?: { site_url: string; trial_ends_at: string | null };
};

/** "5.12.2026" — שעון ישראל */
export function trialEndText(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).format(date);
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
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
    const opened = request.opened;
    const trialEnd = opened ? trialEndText(opened.trial_ends_at) : null;
    const rows = [
      ["שם העסק", request.business_name],
      ["טלפון", request.phone],
      ["אימייל", request.email],
      ...(opened
        ? [
            ["כתובת האתר", hostOf(opened.site_url)],
            ["הניסיון עד", trialEnd ?? "—"],
          ]
        : []),
      ["יחידות", request.units === null ? "לא צוין" : String(request.units)],
      [opened ? "חבילה (אחרי הניסיון)" : "חבילה", request.plan_name ?? "עוד לא יודעים"],
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
      <h1 style="font-size:20px;margin:0 0 12px;">${opened ? "צימר חדש נפתח לניסיון" : "בקשה חדשה לאתר צימר"}</h1>
      <p style="margin:0 0 12px;line-height:1.6;">${
        opened
          ? "בעל המקום פתח את העסק בעצמו מהשער (nuriel-app2) והתחיל להקים את האתר. כדאי לחזור אליו לשיחת היכרות וליווי בהקמה."
          : "נשלחה מהשער (nuriel-app2). מחכה לשיחה ולתיאום ההקמה."
      }</p>
      <table style="border-collapse:collapse;font-size:15px;">${rows}</table>
      ${message}
      ${url ? emailActionButton("לבקשות בפאנל", url) : ""}
      <p style="margin:18px 0 0;color:#9ca3af;font-size:12px;">התראה אוטומטית. הטיפול בבקשה — בפאנל ("ניהול Hospitality").</p>
    </div>
  </body>
</html>`;
    const result = await sendEmail({
      to,
      subject: opened
        ? `צימר חדש נפתח לניסיון: ${request.business_name}`
        : `בקשה לאתר צימר: ${request.business_name}`,
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

/**
 * מיגרציה 40: "העסק נפתח" לבעל העסק (באימייל המאומת בשער) — הקישור לאזור הניהול, סוף הניסיון
 * ומה עושים עכשיו. כשל לא מבטל את הפתיחה (בעל העסק כבר בדרך לאזור הניהול).
 */
export async function welcomeZimmerOwner(owner: {
  email: string;
  business_name: string;
  manage_url: string;
  trial_ends_at: string | null;
}): Promise<void> {
  try {
    if (!isValidEmail(owner.email)) return;
    const trialEnd = trialEndText(owner.trial_ends_at);
    const html = `<!doctype html>
<html lang="he" dir="rtl">
  <body style="margin:0;padding:24px;background:#f3f5f3;font-family:Heebo,Arial,sans-serif;color:#12211F;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px;border:1px solid #e2e8e2;">
      <h1 style="font-size:20px;margin:0 0 12px;">${escapeHtml(owner.business_name)} נפתח!</h1>
      <p style="margin:0 0 12px;line-height:1.7;">תקופת הניסיון התחילה${
        trialEnd ? ` — היא פעילה עד <strong>${escapeHtml(trialEnd)}</strong>` : ""
      }. באזור הניהול מחכה לכם מדריך ההקמה: פרטי העסק, היחידות, תמונות ומחירים — ואז מפרסמים את האתר.</p>
      ${emailActionButton("לאזור הניהול", owner.manage_url)}
      <p style="margin:16px 0 0;line-height:1.7;">נחזור אליכם בטלפון תוך יום עסקים כדי לעזור בהקמה.</p>
      <p style="margin:12px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">הכניסה לאזור הניהול — בכתובת <span dir="ltr">${escapeHtml(hostOf(owner.manage_url))}/manage</span>, עם קוד חד-פעמי שנשלח ל-<span dir="ltr">${escapeHtml(owner.email)}</span>.</p>
    </div>
  </body>
</html>`;
    const result = await sendEmail({
      to: [owner.email],
      subject: `${owner.business_name} נפתח — אפשר להתחיל להקים את האתר`,
      html,
      platformSender: { name: "נוריאל — אתרים לצימרים" },
    });
    if (!result.sent) console.error("[portal] zimmer welcome failed", result.reason);
  } catch (error) {
    console.error("[portal] zimmer welcome crashed", error);
  }
}
