// נוסח החוזה (כפי שהמסד מרכיב אותו מהתבנית — מיגרציה 64) → בלוקים לתצוגה, ל-PDF ולבדיקות.
// הסימון: "# " כותרת · "^ " שורת משנה · "## " סעיף · "- " נקודה · "**…**" שורה מודגשת · "> " תיבה ·
// "[[signatures]]" אזור החתימות · "\ " פסקה כלשונה (בלי סימון) · שורה ריקה — סוף פסקה.
// טהור (בלי HTML — הכל טקסט).
export type ContractBlock =
  | { kind: "title"; text: string }
  | { kind: "subtitle"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "item"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "box"; text: string }
  | { kind: "signatures" };

export function contractBlocks(body: string): ContractBlock[] {
  const out: ContractBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "paragraph", text: para.join(" ") });
    para = [];
  };
  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    // "\ " — פסקה כלשונה (במסמך מדיניות: שורה של מסמך האתר שהייתה נקראת כסימון, למשל "# …" או "**…**")
    if (line.startsWith("\\ ")) {
      para.push(line.slice(2).trim());
    } else if (line === "[[signatures]]") {
      flush();
      out.push({ kind: "signatures" });
    } else if (line.startsWith("## ")) {
      flush();
      out.push({ kind: "heading", text: line.slice(3).trim() });
    } else if (line.startsWith("# ")) {
      flush();
      out.push({ kind: "title", text: line.slice(2).trim() });
    } else if (line.startsWith("^ ")) {
      flush();
      out.push({ kind: "subtitle", text: line.slice(2).trim() });
    } else if (line.startsWith("- ")) {
      flush();
      out.push({ kind: "item", text: line.slice(2).trim() });
    } else if (line.startsWith("> ")) {
      flush();
      out.push({ kind: "box", text: line.slice(2).trim() });
    } else if (/^\*\*.+\*\*$/.test(line)) {
      flush();
      out.push({ kind: "strong", text: line.slice(2, -2).trim() });
    } else {
      para.push(line);
    }
  }
  flush();
  return out;
}

/** שדות שעוד לא מולאו ("________") — לסימון בתצוגה המקדימה */
export const BLANK = "________";
export const hasBlank = (text: string) => text.includes(BLANK);
