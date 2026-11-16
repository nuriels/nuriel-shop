// גופני האתר: כללי @font-face מתוך המסמך. כל ערך שנכנס ל-CSS נבדק לפני כן:
//   • משפחה, משקל, סגנון וטווח Unicode — בדפוסים קשיחים במסמך (schema), כך שאין תו שסוגר את הכלל או את התגית;
//   • הכתובת — רק כתובת מספריית המדיה של האתר, ובלי סוגריים, מירכאות, רווחים או < >.
import type { SiteFont } from "../document/schema";

/** כתובת קובץ גופן — רק מכתובת שנבדקה (אין סוגריים, מירכאות או רווחים) */
export const FONT_URL = /^(https?:\/\/[^\s"'()\\<>;{}]+|\/[^\s"'()\\<>;{}]+)$/;

export function fontFaceCss(
  fonts: readonly SiteFont[],
  urlOf: (media: string) => string | undefined,
): string {
  return fonts
    .map((f) => {
      const url = urlOf(f.file.media);
      if (!url || !FONT_URL.test(url)) return "";
      const range = f.unicodeRange ? `unicode-range:${f.unicodeRange};` : "";
      return `@font-face{font-family:"${f.family}";src:url("${url}") format("woff2");font-weight:${f.weight};font-style:${f.style};font-display:swap;${range}}`;
    })
    .filter(Boolean)
    .join("\n");
}
