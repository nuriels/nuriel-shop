/**
 * מסך הבית של החנות (חלק 20) — לוגיקה טהורה, בלי גישה לרשת:
 *  • אילו קטגוריות מוצגות כריבועים: אלה שסומנו "הצג קטגוריה במסך הבית"
 *    (show_on_homepage). אף אחת לא סומנה — 5 הקטגוריות הראשונות.
 *  • בלוק "מוצרים נבחרים": המוצרים שסומנו "הקפץ למסך ראשי" (is_featured).
 *    אף אחד לא סומן — המוצרים החדשים ביותר שיש במלאי.
 */
import { inStockFirst, type CatalogItem } from "@/lib/catalog";
import type { CategoryNode, CategoryTree } from "@/lib/category-tree";

/** כמה קטגוריות מוצגות כשהמנהל עוד לא בחר */
export const HOMEPAGE_FALLBACK_CATEGORIES = 5;
/** עד כמה מוצרים נבחרים בבלוק */
export const FEATURED_LIMIT = 12;
/** כמה מוצרים חדשים מוצגים כשאין מוצרים נבחרים */
export const NEWEST_FALLBACK_LIMIT = 8;

export type HomepageCategories = {
  categories: CategoryNode[];
  /** true = המנהל עוד לא בחר — מוצגות 5 הראשונות */
  usingFallback: boolean;
};

/**
 * הקטגוריות לריבועים במסך הבית. ללקוחות ולאורחים — רק קטגוריות שיש בהן
 * מוצרים (includeEmpty = צוות, שרואה גם ריקות כדי לבדוק את התצוגה).
 */
export function homepageCategories(
  tree: CategoryTree,
  counts: Map<string, number>,
  includeEmpty: boolean,
): HomepageCategories {
  const visible = (node: CategoryNode) => includeEmpty || (counts.get(node.name) ?? 0) > 0;
  const chosen = tree.flat.filter((node) => node.show_on_homepage && visible(node));
  if (chosen.length > 0) return { categories: chosen, usingFallback: false };
  return {
    categories: tree.roots.filter(visible).slice(0, HOMEPAGE_FALLBACK_CATEGORIES),
    usingFallback: true,
  };
}

export type FeaturedBlock = {
  items: CatalogItem[];
  /** true = אין מוצרים נבחרים — מוצגים החדשים ביותר */
  fallback: boolean;
};

/**
 * בלוק "מוצרים נבחרים": מה שסומן "הקפץ למסך ראשי" — מה שיש במלאי קודם, מה
 * שאזל בסוף. בלי מוצרים נבחרים — החדשים ביותר (רק מה שיש במלאי).
 */
export function featuredBlock(products: CatalogItem[]): FeaturedBlock {
  const chosen = products.filter((product) => product.is_featured === true);
  if (chosen.length > 0) {
    return { items: inStockFirst(chosen).slice(0, FEATURED_LIMIT), fallback: false };
  }
  const newest = products
    .filter((product) => !product.is_out_of_stock)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, NEWEST_FALLBACK_LIMIT);
  return { items: newest, fallback: true };
}
