// llms.txt לכל אתר בפלטפורמה (llmstxt.org) — טהור, בלי מסד (נבדק ביחידה).
//
// מה זה ומה לא: הצעה פתוחה לתקציר Markdown של אתר בשביל כלי AI. Google Search מתעלם ממנו (Search Central:
// אין קובץ מיוחד ל-AI Overviews — אותם עמודים, אותו robots.txt), וכלי AI שונים משתמשים בו במידה שונה. לכן
// הוא רק עוזר: תקציר נכון, קצר ועדכני של מה שכבר מפורסם באתר — שם, תיאור, פרטי קשר שמוצגים באתר, העמודים
// החשובים. אף פעם לא: מחירים (משתנים), פרטים פנימיים, אזורי ניהול, נתוני לקוחות.

export type LlmsLink = { title: string; url: string; note?: string | null | undefined };

export type LlmsDocument = {
  name: string;
  summary?: string | null | undefined;
  /** "פרטי העסק": [תווית, ערך] — רק מה שהאתר עצמו מציג לכל גולש */
  facts?: [string, string | null | undefined][];
  sections: { title: string; links: LlmsLink[] }[];
  /** הכתובת של מפת האתר */
  sitemap?: string | null | undefined;
};

/** טקסט בשורה אחת, בלי תווים שמשבשים Markdown של קישור / כותרת */
export const llmsText = (value: string | null | undefined): string =>
  String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[[\]\r\n#>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** המשפט הראשון (או שניים) עד max תווים — לתקציר */
export function llmsSummary(text: string | null | undefined, max = 300): string {
  const t = llmsText(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (end >= 60) return cut.slice(0, end + 1);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > 60 ? space : max - 1)}…`;
}

export function renderLlms(doc: LlmsDocument): string {
  const lines = [`# ${llmsText(doc.name)}`, ""];
  const summary = llmsSummary(doc.summary);
  if (summary) lines.push(`> ${summary}`, "");
  const facts = (doc.facts ?? [])
    .map(([label, value]) => [llmsText(label), llmsText(value)] as const)
    .filter(([, value]) => value !== "");
  if (facts.length > 0) {
    lines.push("## פרטי העסק");
    for (const [label, value] of facts) lines.push(`- ${label}: ${value}`);
    lines.push("");
  }
  for (const section of doc.sections) {
    const links = section.links.filter((l) => llmsText(l.title) && /^https?:\/\//.test(l.url));
    if (links.length === 0) continue;
    lines.push(`## ${llmsText(section.title)}`);
    for (const link of links) {
      const note = llmsText(link.note);
      lines.push(`- [${llmsText(link.title)}](${link.url})${note ? `: ${note}` : ""}`);
    }
    lines.push("");
  }
  if (doc.sitemap) lines.push(`מפת האתר: ${doc.sitemap}`, "");
  return lines.join("\n");
}
