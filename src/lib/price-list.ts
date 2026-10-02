/** סוג מחירון ללקוח: רגיל (לפי הדרג) או אישי (מחירים מ-user_custom_prices גוברים) */
export type PriceListType = "regular" | "custom";

export const PRICE_LIST_TYPE_LABEL: Record<PriceListType, string> = {
  regular: "מחירון רגיל",
  custom: "מחירון אישי ללקוח",
};

export function toPriceListType(value: string | null | undefined): PriceListType {
  return value === "custom" ? "custom" : "regular";
}
