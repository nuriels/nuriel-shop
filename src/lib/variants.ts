/**
 * וריאציות מוצר (צבע / מידה / ...) — עזרים משותפים לקטלוג, לסל ולניהול.
 *
 * במסד: global_products.variant_attributes = [{name, values[]}] (עד 3
 * מאפיינים), וטבלת product_variants — שורה לכל צירוף (options), עם מק"ט,
 * מחיר (ריק = מחיר המוצר) ומלאי (ריק = המלאי של המוצר). הקטלוג
 * (get_catalog) מחזיר רק וריאציות פעילות, עם המחיר לצופה וזמינות.
 */

export type VariantAttribute = { name: string; values: string[] };
export type VariantOptions = Record<string, string>;

/** וריאציה כפי שהקטלוג מחזיר אותה */
export type CatalogVariant = {
  id: string;
  options: VariantOptions;
  sku: string | null;
  /** המחיר לצופה (משלה, או של המוצר). null = מחיר לפי הצעה */
  price: number | null;
  /** true = מחיר קבוע לוריאציה (לא מחיר המוצר) */
  own_price: boolean;
  available: boolean;
};

export const MAX_ATTRIBUTES = 3;
export const MAX_ATTRIBUTE_VALUES = 30;
export const MAX_VARIANTS = 300;
export const ATTRIBUTE_TEXT_MAX = 30;
export const VARIANT_SKU_FORMAT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** המאפיינים של מוצר (מבנה בטוח גם אם הגיע משהו לא צפוי) */
export function variantAttributesOf(item: { variant_attributes?: unknown }): VariantAttribute[] {
  const raw = item.variant_attributes;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isRecord)
    .map((entry) => ({
      name: typeof entry["name"] === "string" ? entry["name"] : "",
      values: Array.isArray(entry["values"])
        ? entry["values"].filter((value): value is string => typeof value === "string")
        : [],
    }))
    .filter((attribute) => attribute.name !== "" && attribute.values.length > 0);
}

/** הוריאציות הפעילות של מוצר בקטלוג */
export function variantsOf(item: { variants?: unknown }): CatalogVariant[] {
  const raw = item.variants;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map((entry) => {
    const options: VariantOptions = {};
    if (isRecord(entry["options"])) {
      for (const [key, value] of Object.entries(entry["options"])) {
        if (typeof value === "string") options[key] = value;
      }
    }
    const price = entry["price"];
    return {
      id: String(entry["id"] ?? ""),
      options,
      sku: typeof entry["sku"] === "string" ? entry["sku"] : null,
      price: price === null || price === undefined ? null : Number(price),
      own_price: entry["own_price"] === true,
      available: entry["available"] === true,
    };
  });
}

export function hasVariants(item: { variants?: unknown }): boolean {
  return variantsOf(item).length > 0;
}

/** "אדום · S" — הערכים לפי סדר המאפיינים (כמו variant_label במסד) */
export function variantLabel(options: VariantOptions, attributes: VariantAttribute[]): string {
  return attributes
    .map((attribute) => options[attribute.name])
    .filter((value): value is string => typeof value === "string" && value !== "")
    .join(" · ");
}

/** "צבע / מידה" — מה הלקוח צריך לבחור */
export function attributeNames(attributes: VariantAttribute[]): string {
  return attributes.map((attribute) => attribute.name).join(" / ");
}

export function selectionComplete(
  selection: Partial<VariantOptions>,
  attributes: VariantAttribute[],
): boolean {
  return attributes.length > 0 && attributes.every((attribute) => !!selection[attribute.name]);
}

/** הוריאציה שמתאימה לבחירה המלאה (או null) */
export function findVariant(
  variants: CatalogVariant[],
  selection: Partial<VariantOptions>,
  attributes: VariantAttribute[],
): CatalogVariant | null {
  if (!selectionComplete(selection, attributes)) return null;
  return (
    variants.find((variant) =>
      attributes.every(
        (attribute) => variant.options[attribute.name] === selection[attribute.name],
      ),
    ) ?? null
  );
}

export type OptionState = "available" | "soldout" | "missing";

/**
 * מצב כפתור של ערך: יש וריאציה זמינה עם הערך הזה (בהתאם לשאר מה שנבחר),
 * יש רק כזו שאזלה, או שאין צירוף כזה בכלל.
 */
export function optionState(
  variants: CatalogVariant[],
  attributes: VariantAttribute[],
  selection: Partial<VariantOptions>,
  attributeName: string,
  value: string,
): OptionState {
  const matching = variants.filter(
    (variant) =>
      variant.options[attributeName] === value &&
      attributes.every(
        (attribute) =>
          attribute.name === attributeName ||
          !selection[attribute.name] ||
          variant.options[attribute.name] === selection[attribute.name],
      ),
  );
  if (matching.length === 0) return "missing";
  return matching.some((variant) => variant.available) ? "available" : "soldout";
}

/**
 * בחירה התחלתית: מאפיין עם ערך אפשרי אחד בלבד (בין הוריאציות הקיימות) —
 * נבחר לבד. וריאציה אחת בלבד — נבחרת כולה.
 */
export function initialSelection(
  variants: CatalogVariant[],
  attributes: VariantAttribute[],
): Partial<VariantOptions> {
  const selection: Partial<VariantOptions> = {};
  for (const attribute of attributes) {
    const used = new Set(
      variants.map((variant) => variant.options[attribute.name]).filter(Boolean),
    );
    if (used.size === 1) selection[attribute.name] = [...used][0];
  }
  return selection;
}

/** טווח המחירים של הוריאציות (לתצוגת "החל מ-") */
export function variantPriceRange(variants: CatalogVariant[]): { min: number; max: number } | null {
  const prices = variants
    .map((variant) => variant.price)
    .filter((price): price is number => price !== null && Number.isFinite(price));
  if (prices.length === 0) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

// ------------------------------------------------------------
// ניהול: צירופים, טיוטות ושמירה
// ------------------------------------------------------------

/** כל הצירופים של המאפיינים (מכפלה קרטזית), לפי סדר הערכים */
export function combinations(attributes: VariantAttribute[]): VariantOptions[] {
  if (attributes.length === 0) return [];
  return attributes.reduce<VariantOptions[]>(
    (acc, attribute) =>
      acc.flatMap((partial) =>
        attribute.values.map((value) => ({ ...partial, [attribute.name]: value })),
      ),
    [{}],
  );
}

/** מפתח יציב לצירוף (לפי סדר המאפיינים) */
export function optionsKey(options: VariantOptions, attributes: VariantAttribute[]): string {
  return JSON.stringify(attributes.map((attribute) => options[attribute.name] ?? ""));
}

/** שורה בטבלת הוריאציות בטופס המוצר */
export type VariantDraft = {
  options: VariantOptions;
  sku: string;
  /** ריק = מחיר המוצר */
  price: string;
  /** ריק = המלאי של המוצר */
  stock: string;
  isActive: boolean;
};

/** וריאציה כפי שנשמרה במסד (טבלת product_variants) */
export type StoredVariant = {
  id: string;
  options: unknown;
  sku: string | null;
  price: number | null;
  stock_quantity: number | null;
  is_active: boolean;
  sort_order: number;
};

export const VARIANT_ADMIN_COLUMNS =
  "id, options, sku, price, stock_quantity, is_active, sort_order" as const;

function optionsFromJson(value: unknown): VariantOptions {
  const options: VariantOptions = {};
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "string") options[key] = entry;
    }
  }
  return options;
}

export function draftFromStored(variant: StoredVariant): VariantDraft {
  return {
    options: optionsFromJson(variant.options),
    sku: variant.sku ?? "",
    price: variant.price === null ? "" : String(Number(variant.price)),
    stock: variant.stock_quantity === null ? "" : String(variant.stock_quantity),
    isActive: variant.is_active,
  };
}

/**
 * הטבלה אחרי שינוי מאפיינים: כל צירוף קיים שומר את מה שהוזן לו; צירוף חדש
 * נוסף ריק (מחיר ומלאי של המוצר); צירוף שכבר לא קיים — יוצא.
 */
export function syncDrafts(drafts: VariantDraft[], attributes: VariantAttribute[]): VariantDraft[] {
  const byKey = new Map(drafts.map((draft) => [optionsKey(draft.options, attributes), draft]));
  return combinations(attributes).map((options) => {
    const existing = byKey.get(optionsKey(options, attributes));
    return existing
      ? { ...existing, options }
      : { options, sku: "", price: "", stock: "", isActive: true };
  });
}

/** בעיה בשורה (null = תקין) — אותם כללים כמו save_product_variants */
export function variantDraftProblem(draft: VariantDraft, label: string): string | null {
  const sku = draft.sku.trim();
  if (sku !== "" && !VARIANT_SKU_FORMAT.test(sku)) {
    return `${label}: מק"ט — אותיות באנגלית, ספרות, נקודה, מקף (עד 40)`;
  }
  const price = draft.price.trim();
  if (price !== "" && !(Number.isFinite(Number(price)) && Number(price) >= 0)) {
    return `${label}: מחיר לא תקין`;
  }
  const stock = draft.stock.trim();
  if (stock !== "" && !/^\d+$/.test(stock)) {
    return `${label}: מלאי — מספר שלם (0 ומעלה), או ריק למלאי של המוצר`;
  }
  return null;
}

/** בעיה במאפיינים (null = תקין) */
export function attributesProblem(attributes: VariantAttribute[]): string | null {
  if (attributes.length > MAX_ATTRIBUTES) return `עד ${MAX_ATTRIBUTES} מאפיינים למוצר`;
  const names = new Set<string>();
  let total = 1;
  for (const attribute of attributes) {
    const name = attribute.name.trim();
    if (name === "" || name.length > ATTRIBUTE_TEXT_MAX) {
      return `שם מאפיין: 1 עד ${ATTRIBUTE_TEXT_MAX} תווים`;
    }
    if (names.has(name)) return `המאפיין "${name}" מופיע פעמיים`;
    names.add(name);
    if (attribute.values.length === 0) return `הוסיפו לפחות ערך אחד למאפיין "${name}"`;
    if (attribute.values.length > MAX_ATTRIBUTE_VALUES) {
      return `עד ${MAX_ATTRIBUTE_VALUES} ערכים למאפיין "${name}"`;
    }
    const values = new Set<string>();
    for (const value of attribute.values) {
      if (value.length > ATTRIBUTE_TEXT_MAX) {
        return `ערך ארוך מדי במאפיין "${name}" (עד ${ATTRIBUTE_TEXT_MAX} תווים)`;
      }
      if (values.has(value)) return `הערך "${value}" מופיע פעמיים במאפיין "${name}"`;
      values.add(value);
    }
    total *= attribute.values.length;
  }
  if (total > MAX_VARIANTS) return `יותר מדי צירופים (${total}). עד ${MAX_VARIANTS} וריאציות למוצר`;
  return null;
}

/** המבנה ש-save_product_variants מקבל */
export function variantsPayload(drafts: VariantDraft[]): {
  options: VariantOptions;
  sku: string | null;
  price: number | null;
  stock_quantity: number | null;
  is_active: boolean;
}[] {
  return drafts.map((draft) => ({
    options: draft.options,
    sku: draft.sku.trim() || null,
    price: draft.price.trim() === "" ? null : Number(draft.price),
    stock_quantity: draft.stock.trim() === "" ? null : Number(draft.stock),
    is_active: draft.isActive,
  }));
}
