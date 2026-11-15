/**
 * חישוב מע"מ אחיד לכל המערכת (עגלה, פאנל ניהול ומסמכי PDF).
 *
 * שתי שיטות עבודה, נקבעות בהגדרות הניהול:
 *  - "כולל מע"מ"  — המחירים בקטלוג הם המחיר הסופי; מציגים סה"כ אחד בלבד.
 *  - "לפני מע"מ" — המחירים בקטלוג הם לפני מס; מוסיפים מע"מ ומציגים פירוט.
 * ובנוסף (חלק 23): מע"מ 0% — עוסק פטור (או הזמנה שנשמרה ב-0%) — אין מע"מ
 * בכלל: סה"כ אחד, בלי פירוט ובלי "כולל מע"מ".
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
  /** חלק 23: לא נגבה מע"מ (0%) — "ללא מע"מ" במקום "כולל מע"מ" */
  exempt?: boolean;
};

/** סוג העוסק של החנות (חלק 23): פטור — מע"מ 0% נעול; מורשה / חברה — כרגיל */
export type StoreBusinessType = "exempt" | "authorized";

export const BUSINESS_TYPE_OPTIONS: { value: StoreBusinessType; label: string; hint: string }[] = [
  {
    value: "authorized",
    label: "עוסק מורשה / חברה",
    hint: "מע״מ בשיעור המרכזי (18% היום). בוחרים אם המחירים באתר כוללים מע״מ.",
  },
  {
    value: "exempt",
    label: "עוסק פטור / זעיר",
    hint: "לא גובים מע״מ: 0% נעול באתר, בקופה ובמסמכים, ושום הגדרה לא מוסיפה מע״מ.",
  },
];

/** מצב המע"מ של החנות כפי שהשרת קובע אותו (store_vat_profile, מיגרציה 191) */
export type StoreVatProfile = {
  businessType: StoreBusinessType;
  /** עוסק פטור: תמיד true (המחיר הוא הסופי) */
  pricesIncludeVat: boolean;
  /** השיעור המרכזי לעוסק מורשה, 0 לעוסק פטור */
  vatRate: number;
  /** בעל העסק בחר / אישר את ההגדרה (חנות קיימת לפני 191 — false) */
  confirmed: boolean;
};

/** קורא את תשובת store_vat_profile; ערך לא תקין → null (ואז נשארים עם ההגדרות שנקראו) */
export function parseVatProfile(raw: unknown): StoreVatProfile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const type = v["business_type"];
  const rate = Number(v["vat_rate"]);
  if ((type !== "exempt" && type !== "authorized") || !Number.isFinite(rate) || rate < 0)
    return null;
  return {
    businessType: type,
    pricesIncludeVat: type === "exempt" ? true : v["prices_include_vat"] !== false,
    vatRate: type === "exempt" ? 0 : rate,
    confirmed: v["confirmed"] === true,
  };
}

/**
 * ההודעה ללקוח על המחירים — מראש (בעגלה ובקופה), כדי שלא יופתע בתשלום:
 * פטור — "לא מתווסף מע״מ"; כולל — "המחירים כוללים מע״מ"; לפני מע״מ — "יתווסף בסיכום".
 */
export function vatPriceNotice(profile: {
  businessType: StoreBusinessType | null | undefined;
  pricesIncludeVat: boolean;
  vatRate: number;
}): string {
  if (profile.businessType === "exempt" || !(profile.vatRate > 0)) {
    return profile.businessType === "exempt"
      ? "עוסק פטור — לא מתווסף מע״מ למחירים"
      : "לא מתווסף מע״מ למחירים";
  }
  if (profile.pricesIncludeVat) return "המחירים באתר כוללים מע״מ";
  return `המחירים באתר אינם כוללים מע״מ — מע״מ ${profile.vatRate}% יתווסף בסיכום ההזמנה`;
}

/** הזמנה שנשמרה: הפירוק שהמסד חישב (מיגרציה 191), או — בהזמנה בלי העמודות — אותו חישוב מהערכים השמורים */
export type StoredOrderVat = {
  total: number | string | null;
  vat_rate: number | string | null;
  prices_include_vat: boolean | null;
  net_amount?: number | string | null;
  vat_amount?: number | string | null;
  gross_amount?: number | string | null;
};

export function orderVatBreakdown(order: StoredOrderVat): VatBreakdown {
  const rate = Number(order.vat_rate ?? DEFAULT_VAT_RATE);
  const included = order.prices_include_vat ?? true;
  const fromDb = [order.net_amount, order.vat_amount, order.gross_amount].map((v) =>
    v === null || v === undefined || v === "" ? NaN : Number(v),
  );
  if (fromDb.every((v) => Number.isFinite(v))) {
    const [net, vat, gross] = fromDb as [number, number, number];
    if (!(rate > 0))
      return { net: gross, vat: 0, gross, showBreakdown: false, vatRate: 0, exempt: true };
    return { net, vat, gross, showBreakdown: !included, vatRate: rate };
  }
  return calculateVat(Number(order.total ?? 0), { pricesIncludeVat: included, vatRate: rate });
}

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export const DEFAULT_VAT_RATE = 18;

/**
 * מפרק סכום שורות (מחיר יחידה × כמות, כפי שהוזן במערכת) לנטו/מע"מ/ברוטו.
 * בשיטת "כולל מע"מ" מוצג רק הסה"כ, ולכן showBreakdown=false.
 */
export function calculateVat(itemsTotal: number, settings: VatSettings): VatBreakdown {
  const rate = Number.isFinite(settings.vatRate) ? Math.max(0, settings.vatRate) : DEFAULT_VAT_RATE;
  const factor = rate / 100;

  if (rate === 0) {
    // עוסק פטור: אין מע"מ — הסכום הוא הסה"כ, בלי פירוט
    const total = round2(itemsTotal);
    return { net: total, vat: 0, gross: total, showBreakdown: false, vatRate: 0, exempt: true };
  }

  if (settings.pricesIncludeVat) {
    const gross = round2(itemsTotal);
    const net = round2(gross / (1 + factor));
    return { net, vat: round2(gross - net), gross, showBreakdown: false, vatRate: rate };
  }

  const net = round2(itemsTotal);
  const vat = round2(net * factor);
  return { net, vat, gross: round2(net + vat), showBreakdown: true, vatRate: rate };
}

/**
 * השורה הקטנה מתחת לסה"כ בסל / בקופה: "כולל מע"מ", או — כשלא נגבה מע"מ —
 * "עוסק פטור" (כשהחנות מוגדרת כך) / "ללא מע"מ".
 */
export function vatTotalCaption(
  vat: VatBreakdown,
  businessType?: StoreBusinessType | null,
): string {
  if (vat.exempt) return businessType === "exempt" ? "עוסק פטור — ללא מע״מ" : "ללא מע״מ";
  return "כולל מע״מ";
}
