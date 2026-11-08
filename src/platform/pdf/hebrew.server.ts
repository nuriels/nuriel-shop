// מתאם (adapter) לכלי ה-PDF העבריים הקיימים (src/lib/pdf): הגופן Heebo (רגיל ומודגש, base64 —
// לשרת בלבד) וסידור שורה עברית לסדר ויזואלי ל-jsPDF. בלי שינוי בקוד הקיים. הקובץ עצמו נטען רק כשצריך
// להפיק PDF (בייבוא דינמי של מודול החוזים בשרת), כך שהגופנים לא נטענים בכל בקשה.
import { HEEBO_BOLD_BASE64 } from "@/lib/pdf/heebo-bold";
import { HEEBO_REGULAR_BASE64 } from "@/lib/pdf/heebo-regular";

export function heeboFonts(): { regular: string; bold: string } {
  return { regular: HEEBO_REGULAR_BASE64, bold: HEEBO_BOLD_BASE64 };
}

export { toVisualRtl } from "@/lib/pdf/rtl";
