import DOMPurify from "dompurify";

/**
 * טקסט עשיר לעמודים המשפטיים (חלק 16א): התקנון, מדיניות הפרטיות ומדיניות
 * הביטולים נשמרים כ-HTML מהעורך בפאנל הניהול.
 *
 * כל הצגה (באתר ובעורך) עוברת ניקוי ב-DOMPurify עם רשימה סגורה: תגיות
 * טקסט בסיסיות, קישורים בטוחים בלבד (http/https/mailto/tel/נתיב פנימי),
 * ומחלקה אחת — "טקסט אדום מודגש" למקומות שבעל החנות צריך להשלים.
 * בלי style, בלי תמונות, בלי סקריפטים ובלי אירועים.
 *
 * תוכן ישן (טקסט רגיל, לפני העורך) מומר ל-HTML: פסקה לכל בלוק, שורה חדשה
 * = <br>.
 */

/** "מקום להשלמה" — טקסט אדום מודגש (בדיוק כמו בנוסחי ברירת המחדל) */
export const RED_MARK_CLASS = "text-red-500 font-bold";

export const RICH_ALLOWED_TAGS = [
  "p",
  "div",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "a",
  "span",
  "blockquote",
  "hr",
] as const;

const ALLOWED_CLASSES = new Set(RED_MARK_CLASS.split(" "));

/** קישורים: אתרים, מייל, טלפון, נתיב פנימי (/terms) או עוגן (#…) */
const SAFE_URL = /^(?:https?:|mailto:|tel:|\/(?!\/)|#)/i;

const HTML_TAG = new RegExp(`<\\/?(?:${RICH_ALLOWED_TAGS.join("|")}|h1|h5|h6)\\b[^>]*>`, "i");

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** האם התוכן כבר HTML מהעורך (ולא טקסט רגיל מהגרסה הקודמת) */
export function looksLikeHtml(content: string): boolean {
  return HTML_TAG.test(content);
}

/** טקסט רגיל → HTML: שורה ריקה = פסקה חדשה, שורה חדשה = <br> */
export function plainTextToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block !== "")
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** תוכן שמור (HTML או טקסט ישן) → HTML לעורך / להצגה (עוד לפני ניקוי) */
export function toRichHtml(content: string | null | undefined): string {
  const value = (content ?? "").trim();
  if (value === "") return "";
  return looksLikeHtml(value) ? value : plainTextToHtml(value);
}

type Purifier = ReturnType<typeof DOMPurify>;
let purifier: Purifier | null | undefined;

/** מופע DOMPurify משלנו (ה-hooks לא משפיעים על שימושים אחרים) — רק בדפדפן */
function getPurifier(): Purifier | null {
  if (purifier !== undefined) return purifier;
  if (typeof window === "undefined") return null;
  const instance = DOMPurify(window);
  if (!instance.isSupported) {
    purifier = null;
    return null;
  }
  instance.addHook("uponSanitizeAttribute", (node, data) => {
    if (data.attrName === "class") {
      // מחלקות: רק "אדום מודגש", ורק על span
      const kept =
        node.nodeName === "SPAN"
          ? data.attrValue
              .split(/\s+/)
              .filter((token) => ALLOWED_CLASSES.has(token))
              .join(" ")
          : "";
      if (kept === "") data.keepAttr = false;
      else data.attrValue = kept;
    }
    if (data.attrName === "href" && !SAFE_URL.test(data.attrValue.trim())) {
      data.keepAttr = false;
    }
  });
  instance.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName !== "A") {
      node.removeAttribute("target");
      node.removeAttribute("rel");
      return;
    }
    const href = node.getAttribute("href") ?? "";
    if (/^https?:/i.test(href)) {
      // קישור החוצה — בלשונית חדשה, בלי גישה לחלון שלנו
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer nofollow");
    } else {
      node.removeAttribute("target");
      node.removeAttribute("rel");
    }
  });
  purifier = instance;
  return purifier;
}

/** תגיות בלבד (לסביבה בלי DOM) — הטקסט נשאר, מוצג כטקסט */
function stripTags(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * HTML בטוח להצגה. בדפדפן — DOMPurify עם הרשימה הסגורה. בשרת (אין DOM)
 * — כל התגיות יורדות והטקסט מוחזר מוברח (escaped), כך שאין סיכון גם אז.
 */
export function sanitizeRichHtml(html: string): string {
  const instance = getPurifier();
  if (!instance) {
    return plainTextToHtml(stripTags(html));
  }
  return instance.sanitize(html, {
    ALLOWED_TAGS: [...RICH_ALLOWED_TAGS],
    ALLOWED_ATTR: ["href", "class", "target", "rel"],
    ALLOWED_URI_REGEXP: SAFE_URL,
    KEEP_CONTENT: true,
    ALLOW_DATA_ATTR: false,
  });
}

/** תוכן שמור → HTML נקי להצגה */
export function richContentHtml(content: string | null | undefined): string {
  const html = toRichHtml(content);
  return html === "" ? "" : sanitizeRichHtml(html);
}

/** אין טקסט אמיתי (רק תגיות ריקות / רווחים) */
export function richTextIsEmpty(html: string): boolean {
  return (
    stripTags(html)
      .replace(/\u00a0/g, " ")
      .trim() === ""
  );
}

/** כמה מקומות "אדומים" (להשלמה) נשארו בטקסט */
export function countRedMarks(html: string): number {
  return (html.match(/class="[^"]*\btext-red-500\b[^"]*"/g) ?? []).length;
}
