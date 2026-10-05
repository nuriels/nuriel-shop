/**
 * צבעי מסמך ה-PDF לפי צבע המותג של החנות (חלק 22). לוגיקה טהורה:
 *  • fill      — רקע תיבת סוג המסמך וכותרת הטבלה: צבע המותג (או הכהה של המערכת)
 *  • onFill    — הטקסט עליהם: לבן או כהה, מה שקריא יותר
 *  • onFillSoft — טקסט משני על הרקע (מספר הזמנה, תאריך) — גוון מעורבב
 *  • accent    — קווי הפרדה, הסכום לתשלום וכותרות מודגשות על רקע לבן; צבע
 *                מותג בהיר מדי (צהוב / תכלת בהיר) מוכהה כדי שיהיה קריא
 */
import { contrastRatio, normalizeBrandColor, textColorOn } from "@/lib/brand-theme";

export const PDF_INK = "#12211F";
export const PDF_BRASS = "#9C6F22";

export type PdfPalette = {
  fill: string;
  onFill: string;
  onFillSoft: string;
  accent: string;
};

const toRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb: [number, number, number]) =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/** ערבוב שני צבעים: weight = כמה מ-b (0–1) */
export function mixHex(a: string, b: string, weight: number): string {
  const [ra, ga, ba] = toRgb(a);
  const [rb, gb, bb] = toRgb(b);
  return toHex([ra + (rb - ra) * weight, ga + (gb - ga) * weight, ba + (bb - ba) * weight]);
}

/** מכהה בהדרגה עד שהצבע קריא על לבן (ניגודיות 4.5 לפחות) */
function readableOnWhite(hex: string): string {
  let color = hex;
  for (let step = 0; step < 10 && contrastRatio(color, "#ffffff") < 4.5; step++) {
    color = mixHex(color, "#000000", 0.15);
  }
  return color;
}

export function pdfPalette(brandColor: string | null | undefined): PdfPalette {
  const brand = normalizeBrandColor(brandColor);
  if (!brand) {
    // בלי צבע מותג — העיצוב הקיים (כהה + נחושת)
    return { fill: PDF_INK, onFill: "#ffffff", onFillSoft: "#c9d6cf", accent: PDF_BRASS };
  }
  const onFill = textColorOn(brand) === "#ffffff" ? "#ffffff" : PDF_INK;
  return {
    fill: brand,
    onFill,
    onFillSoft: mixHex(onFill, brand, 0.3),
    accent: readableOnWhite(brand),
  };
}
