// המיילים של מסמכי הלקוחות (מיגרציה 64), באותו עיצוב של מיילי ההזמנות: בקשה לחתימה (קישור אישי)
// ועותק חתום (PDF מצורף). טהור — escape מגיע מהשרת. הקישור מופיע רק כאן, אף פעם לא אצל הצוות.
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

export function contractSignRequestEmail(
  ctx: ContractEmailContext,
  c: {
    signerName: string;
    title: string;
    number: number;
    url: string;
    expiresOn: string;
    about: string | null;
  },
): { subject: string; html: string } {
  const e = ctx.escape;
  const subject = `${c.title} — לחתימה`;
  const inner = `<p style="margin:0;font-size:15px;line-height:1.6">שלום ${e(c.signerName)},</p>
<p style="margin:8px 0 0;font-size:15px;line-height:1.6">מצורף אליך ההסכם מ${e(ctx.businessName)}${c.about ? ` (${e(c.about)})` : ""}. אפשר לקרוא את כל הסעיפים, להשלים את הפרטים החסרים ולחתום באצבע או בעכבר.</p>
<p style="margin:20px 0"><a href="${e(c.url)}" style="background:#1f3d2b;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">לקריאה ולחתימה על ההסכם</a></p>
<p style="margin:0 0 8px;font-size:12px;color:#777">הקישור אישי וחד-פעמי — אין להעביר אותו לאחרים. הוא בתוקף עד ${e(c.expiresOn)}. מספר המסמך: ${c.number}.</p>`;
  return { subject, html: layout(ctx, subject, inner) };
}

export function contractSignedCopyEmail(
  ctx: ContractEmailContext,
  c: { signerName: string; title: string; number: number; signedOn: string },
): { subject: string; html: string } {
  const e = ctx.escape;
  const subject = `${c.title} — העותק החתום שלך`;
  const inner = `<p style="margin:0;font-size:15px;line-height:1.6">שלום ${e(c.signerName)},</p>
<p style="margin:8px 0 0;font-size:15px;line-height:1.6">תודה! ההסכם נחתם ב-${e(c.signedOn)}. העותק החתום מצורף למייל הזה כקובץ PDF (מסמך מס' ${c.number}). כדאי לשמור אותו.</p>`;
  return { subject, html: layout(ctx, subject, inner) };
}
