/**
 * חישוב מע"מ אחיד לכל המערכת (עגלה, פאנל ניהול ומסמכי PDF).
 *
 * שתי שיטות עבודה, נקבעות בהגדרות הניהול:
 *  - "כולל מע"מ"  — המחירים בקטלוג הם המחיר הסופי; מציגים סה"כ אחד בלבד.
 *  - "לפני מע"מ" — המחירים בקטלוג הם לפני מס; מוסיפים מע"מ ומציגים פירוט.
 */

export type VatSettings = {
  /** true = המחירים בקטלוג כבר כוללים מע"מ */
  pricesIncludeVat: boolean;
  /** שיעור המע"מ באחוזים (ברירת מחדל בישראל: 18) */
  vatRate: number;
};

export type VatBreakdown = {
  /** סכום המוצרים לפני מע"מ */
  net: number;
  /** סכום המע"מ */
  vat: number;
  /** סה"כ לתשלום */
  gross: number;
  /** האם להציג פירוט מע"מ נפרד (רק בשיטת "לפני מע"מ") */
  showBreakdown: boolean;
  vatRate: number;
};

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export const DEFAULT_VAT_RATE = 18;

/**
 * מפרק סכום שורות (מחיר יחידה × כמות, כפי שהוזן במערכת) לנטו/מע"מ/ברוטו.
 * בשיטת "כולל מע"מ" מוצג רק הסה"כ, ולכן showBreakdown=false.
 */
export function calculateVat(itemsTotal: number, settings: VatSettings): VatBreakdown {
  const rate = Number.isFinite(settings.vatRate) ? Math.max(0, settings.vatRate) : DEFAULT_VAT_RATE;
  const factor = rate / 100;

  if (settings.pricesIncludeVat) {
    const gross = round2(itemsTotal);
    const net = round2(gross / (1 + factor));
    return { net, vat: round2(gross - net), gross, showBreakdown: false, vatRate: rate };
  }

  const net = round2(itemsTotal);
  const vat = round2(net * factor);
  return { net, vat, gross: round2(net + vat), showBreakdown: true, vatRate: rate };
}
