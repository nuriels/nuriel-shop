// חישובי פריסה לגלריות (בלי DOM): שורות מוצדקות — כל שורה ממלאת את הרוחב בגובה אחיד, ואף תמונה לא נחתכת.
// אותו כלל של הגלריות המוצדקות הנפוצות באתרי Elementor: מוסיפים תמונות לשורה בגובה היעד; כשתמונה כבר לא נכנסת,
// בוחרים מה קרוב יותר לרוחב — לסגור את השורה בלעדיה (והשורה גדלה מעט) או לצרף אותה (והשורה קטנה מעט).
// השורה האחרונה נמתחת רק כשהיא מלאה לפחות 70%; אחרת התמונות בה נשארות בגודל היעד.

export interface JustifiedBox {
  width: number;
  height: number;
}

/**
 * @param ratios רוחב/גובה של כל תמונה, בסדר הגלריה
 * @param containerWidth רוחב הגלריה בפיקסלים
 * @param rowHeight גובה השורה המבוקש
 * @param gap הרווח בין התמונות
 */
export function justifyRows(
  ratios: readonly number[],
  containerWidth: number,
  rowHeight: number,
  gap: number,
): JustifiedBox[] {
  const n = ratios.length;
  const out: JustifiedBox[] = new Array(n);
  if (!n || containerWidth <= 0 || rowHeight <= 0) return out.fill({ width: 0, height: 0 });
  const safe = ratios.map((r) => (Number.isFinite(r) && r > 0 ? r : 2 / 3));
  const ideal = safe.map((r) => Math.min(Math.round(rowHeight * r), containerWidth));
  const place = (start: number, end: number, rowWidth: number) => {
    const avail = Math.max(0, containerWidth - (end - start - 1) * gap);
    for (let i = start; i < end; i++) {
      // מעוגל כלפי מטה (מאיות פיקסל) כדי שהשורה לא תחרוג מהרוחב ותישבר
      const width = Math.floor((ideal[i]! / rowWidth) * avail * 100) / 100;
      out[i] = { width, height: Math.round((width / safe[i]!) * 100) / 100 };
    }
  };
  let start = 0;
  let rowWidth = 0;
  for (let i = 0; i < n; i++) {
    const next = rowWidth + ideal[i]!;
    if (next > containerWidth && i > start && containerWidth - rowWidth < next - containerWidth) {
      place(start, i, rowWidth);
      start = i;
      rowWidth = 0;
      i -= 1;
      continue;
    }
    rowWidth = next;
    const closesRow = next >= containerWidth;
    if (i === n - 1) {
      place(start, n, closesRow || next / containerWidth >= 0.7 ? next : containerWidth);
    } else if (closesRow) {
      place(start, i + 1, next);
      start = i + 1;
      rowWidth = 0;
    }
  }
  return out;
}
