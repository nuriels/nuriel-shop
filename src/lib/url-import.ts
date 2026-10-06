/**
 * ייבוא מוצר מקישור (חלק 29) — מה שמשותף לדפדפן ולשרת: הטיפוסים, המגבלות
 * ובניית התיאור לטופס המוצר (HTML של העורך — כל הטקסט עובר escape).
 */

/** כמו MAX_GALLERY בטופס המוצר: תמונה ראשית + 9 בגלריה */
export const MAX_IMPORT_IMAGES = 10;
/** כמה תמונות מסומנות מראש בחלון הבחירה */
export const DEFAULT_SELECTED_IMAGES = 5;

export type ScrapedSpec = { name: string; value: string };

export type ScrapedProduct = {
  /** הכותרת המלאה מהעמוד (בלי סיומת האתר) */
  title: string;
  /** הצעה לשם המוצר: עד 8 מילים / 60 תווים, בלי רעשי שיווק */
  shortTitle: string;
  /** תיאור קצר (טקסט) — "" אם אין, או אם זה רק משפט שיווקי של האתר */
  description: string;
  /** המפרט (שם → ערך), לפי הסדר בעמוד */
  specs: ScrapedSpec[];
  /** קישורי התמונות — הגלריה קודם, בלי כפילויות ובלי תמונות מוקטנות */
  images: string[];
  /** המחיר בעמוד, אם פורסם בנתונים המובנים (להצגה בלבד) */
  price: number | null;
  currency: string | null;
  siteName: string | null;
};

export type UrlImportPreview = ScrapedProduct & {
  /** הכתובת הסופית (אחרי הפניות) */
  sourceUrl: string;
};

/** תמונה אחת שנבחרה: נשמרה אצלנו (url) או נכשלה (error) */
export type SavedImportImage = { source: string; url: string } | { source: string; error: string };

/** מה שנכנס לטופס המוצר אחרי הייבוא */
export type ProductPrefill = {
  name: string;
  description: string;
  imageUrl: string;
  extraImages: string[];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** התיאור לטופס: פסקאות התיאור, ואחריהן "מפרט" כרשימה */
export function importDescriptionHtml(
  description: string,
  specs: readonly ScrapedSpec[],
  include: { description: boolean; specs: boolean },
): string {
  const parts: string[] = [];
  if (include.description && description.trim() !== "") {
    for (const paragraph of description.split(/\n+/)) {
      if (paragraph.trim() !== "") parts.push(`<p>${escapeHtml(paragraph.trim())}</p>`);
    }
  }
  if (include.specs && specs.length > 0) {
    parts.push("<p><strong>מפרט</strong></p>");
    parts.push(
      `<ul>${specs
        .map(
          (spec) => `<li><strong>${escapeHtml(spec.name)}:</strong> ${escapeHtml(spec.value)}</li>`,
        )
        .join("")}</ul>`,
    );
  }
  return parts.join("");
}
