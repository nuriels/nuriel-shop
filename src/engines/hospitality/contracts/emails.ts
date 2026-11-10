// המיילים של מסמכי הלקוחות (מיגרציה 64 + מסמכים עצמאיים), באותו עיצוב של מיילי ההזמנות: בקשה לחתימה
// (קישור אישי) ועותק חתום (PDF מצורף, וקישור לאזור האישי). טהור — escape מגיע מהשרת. בדרך א' הקישור
// לחתימה מופיע רק כאן; בדרך ב' העסק מקבל אותו פעם אחת כדי להעביר ללקוח.
export interface ContractEmailContext {
  businessName: string;
  businessPhone: string | null;
  businessEmail: string | null;
  escape: (s: string) => string;
}

const layout = (ctx: ContractEmailContext, subject: string, inner: string) => {
  const e = ctx.escape;
  const contact = [ctx.businessPhone, ctx.businessEmail].filter(Boolean).join(" · ");
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5f5f2;font-family:Arial,Helvetica,sans-serif;color:#1d1d1b">
<div dir="rtl" style="max-width:560px;margin:0 auto;padding:24px 16px;text-align:right">
<div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e5e5e0">
<p style="margin:0 0 8px;font-size:13px;color:#777">${e(ctx.businessName)}</p>
<h1 style="margin:0 0 12px;font-size:20px">${e(subject)}</h1>
${inner}
${contact ? `<p style="margin:16px 0 0;font-size:13px;color:#555">שאלות? ${e(contact)}</p>` : ""}
</div>
<p style="margin:12px 0 0;font-size:12px;color:#888;text-align:center">נשלח ממערכת ההזמנות של ${e(ctx.businessName)}</p>
</div></body></html>`;
};

/** "ההסכם" בחוזה, "המסמך" במסמך מדיניות */
const docWord = (kind: string | undefined) => (kind === "policy" ? "המסמך" : "ההסכם");
const hello = (e: (s: string) => string, name: string | null | undefined) =>
  name ? `שלום ${e(name)},` : "שלום,";

export function contractSignRequestEmail(
  ctx: ContractEmailContext,
  c: {
    signerName: string | null;
    title: string;
    number: number;
    url: string;
    expiresOn: string;
    about: string | null;
    /** הודעת שעות הבריכה (poolNotice) — מחוץ לנוסח ההסכם */
    poolNote?: string | null;
    /** policy — מסמך מדיניות ("המסמך"); אחרת — חוזה ("ההסכם") */
    kind?: string;
    /** דרך ב': הלקוח משלים את הפרטים שלו בעצמו */
    customerFills?: boolean;
  },
): { subject: string; html: string } {
  const e = ctx.escape;
  const doc = docWord(c.kind);
  const subject = `${c.title} — לחתימה`;
  const what =
    c.kind === "policy"
      ? `מצורף אליך המסמך "${e(c.title)}" מ${e(ctx.businessName)}. אפשר לקרוא אותו במלואו ולחתום באצבע או בעכבר.`
      : `מצורף אליך ההסכם מ${e(ctx.businessName)}${c.about ? ` (${e(c.about)})` : ""}. אפשר לקרוא את כל הסעיפים, ${c.customerFills ? "למלא את הפרטים שלכם" : "להשלים את הפרטים החסרים"} ולחתום באצבע או בעכבר.`;
  const inner = `<p style="margin:0;font-size:15px;line-height:1.6">${hello(e, c.signerName)}</p>
<p style="margin:8px 0 0;font-size:15px;line-height:1.6">${what}</p>
${c.poolNote ? `<p style="margin:12px 0 0;padding:10px 12px;font-size:14px;line-height:1.6;background:#fff7e6;border:1px solid #f0c36d;border-radius:8px"><strong>שימו לב — שעות הבריכה:</strong> ${e(c.poolNote)}</p>` : ""}
<p style="margin:20px 0"><a href="${e(c.url)}" style="background:#1f3d2b;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">לקריאה ולחתימה על ${doc}</a></p>
<p style="margin:0 0 8px;font-size:12px;color:#777">הקישור אישי וחד-פעמי — אין להעביר אותו לאחרים. הוא בתוקף עד ${e(c.expiresOn)}. מספר המסמך: ${c.number}.</p>`;
  return { subject, html: layout(ctx, subject, inner) };
}

export function contractSignedCopyEmail(
  ctx: ContractEmailContext,
  c: {
    signerName: string | null;
    title: string;
    number: number;
    signedOn: string;
    kind?: string;
    /** "ההזמנות שלי" באתר — שם המסמכים החתומים זמינים בכל עת (כניסה עם קוד למייל, בלי סיסמה) */
    areaUrl?: string | null;
  },
): { subject: string; html: string } {
  const e = ctx.escape;
  const doc = docWord(c.kind);
  const subject = `${c.title} — העותק החתום שלך`;
  const inner = `<p style="margin:0;font-size:15px;line-height:1.6">${hello(e, c.signerName)}</p>
<p style="margin:8px 0 0;font-size:15px;line-height:1.6">תודה! ${doc} נחתם ב-${e(c.signedOn)}. העותק החתום מצורף למייל הזה כקובץ PDF (מסמך מס' ${c.number}). כדאי לשמור אותו.</p>
${c.areaUrl ? `<p style="margin:12px 0 0;font-size:14px;line-height:1.6">המסמכים החתומים שלכם שמורים גם <a href="${e(c.areaUrl)}" style="color:#1f3d2b">באזור האישי באתר</a> — כניסה עם קוד שנשלח לאימייל הזה, בלי סיסמה.</p>` : ""}`;
  return { subject, html: layout(ctx, subject, inner) };
}
