// שלב א' 2: המייל עם קוד הכניסה ל"ההזמנות שלי" — בשם העסק, בלי קישורים (רק הקוד). טהור — נבדק ביחידה.

export const GUEST_CODE_MINUTES = 10;

export function guestCodeEmail(
  code: string,
  businessName: string,
  escape: (s: string) => string,
): { subject: string; html: string } {
  const e = escape;
  const subject = `קוד הכניסה שלך ל"ההזמנות שלי": ${code}`;
  // בלי רווח באמצע הקוד: מי שמעתיק ומדביק מקבל 6 ספרות נקיות (ההפרדה הוויזואלית — letter-spacing)
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5f5f2;font-family:Arial,Helvetica,sans-serif;color:#1d1d1b">
<div dir="rtl" style="max-width:560px;margin:0 auto;padding:24px 16px;text-align:right">
<div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e5e5e0">
<p style="margin:0 0 8px;font-size:13px;color:#777">${e(businessName)}</p>
<h1 style="margin:0 0 12px;font-size:20px">קוד הכניסה ל"ההזמנות שלי"</h1>
<p style="margin:0;font-size:15px;line-height:1.6">זה הקוד לצפייה בהזמנות שלך ב${e(businessName)}:</p>
<p style="margin:18px 0;text-align:center"><span dir="ltr" style="display:inline-block;font-size:30px;font-weight:bold;letter-spacing:8px;background:#f3f5f3;border:1px solid #e2e8e2;border-radius:10px;padding:12px 22px;color:#12211F">${e(code)}</span></p>
<p style="margin:0;font-size:14px;line-height:1.6;color:#444">הקוד תקף ל-${GUEST_CODE_MINUTES} דקות ולשימוש חד-פעמי.</p>
<p style="margin:12px 0 0;font-size:13px;line-height:1.6;color:#6b7280">לא ביקשתם קוד? אפשר להתעלם מההודעה — בלי הקוד אי אפשר להיכנס. לעולם אל תמסרו את הקוד לאחרים, גם לא לנציגי העסק.</p>
</div>
<p style="margin:12px 0 0;font-size:12px;color:#888;text-align:center">נשלח ממערכת ההזמנות של ${e(businessName)}</p>
</div></body></html>`;
  return { subject, html };
}
