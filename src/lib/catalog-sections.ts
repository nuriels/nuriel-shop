import {
  inCategories,
  productCategoryNames,
  subtreeNames,
  type CategoryTree,
  type MultiCategoryProduct,
} from "@/lib/category-tree";

/** שורה בקטלוג: כותרת (תת-קטגוריה) + המוצרים שלה */
export type CatalogSection<T> = {
  key: string;
  /** null = תצוגה רגילה בלי כותרות (קטגוריה בלי תת-קטגוריות / "כל המוצרים") */
  title: string | null;
  /** הקטגוריה שהשורה מייצגת (לסידור בגרירה ולמעבר אליה). null = לא ניתן לסדר */
  category: string | null;
  /** שורה של תת-קטגוריה (אפשר לעבור אליה) */
  isChild: boolean;
  items: T[];
};

/** כותרת השורה של מוצרים שהקטגוריה הזו היא קטגוריה נוספת שלהם (בניהול) */
export const LINKED_SECTION_TITLE = "משויכים גם לקטגוריה הזו";

/**
 * מסדר את מוצרי הקטגוריה שנבחרה בשורות לפי תת-הקטגוריות הישירות שלה
 * (כל שורה = תת-הקטגוריה וכל מה שמתחתיה), בסדר של עץ הקטגוריות.
 * מוצרים שנמצאים ישירות בקטגוריה שנבחרה — שורה ראשונה בשמה.
 * בלי קטגוריה / קטגוריה בלי תת-קטגוריות — שורה אחת בלי כותרת (כמו היום).
 * הסדר בתוך כל שורה נשמר כפי שהגיע (sort_order ואז מהחדש לישן).
 *
 * חלק 18 — מוצר בכמה קטגוריות:
 *  • באתר (ברירת המחדל): מוצר מופיע בכל שורה שאחת הקטגוריות שלו שייכת לה.
 *  • בניהול (primaryOnly): השורות לפי הקטגוריה הראשית בלבד — כי הגרירה
 *    לשינוי סדר עובדת רק שם — ומוצרים שהקטגוריה הזו היא קטגוריה נוספת שלהם
 *    מופיעים בשורה נפרדת בסוף (בלי גרירה).
 */
export function groupBySubcategory<T extends MultiCategoryProduct>(
  tree: CategoryTree,
  selected: string | null,
  items: T[],
  options: { primaryOnly?: boolean } = {},
): CatalogSection<T>[] {
  const primaryOnly = options.primaryOnly === true;
  const node = selected ? tree.byName.get(selected) : undefined;
  if (!selected) {
    return [{ key: "all", title: null, category: null, isChild: false, items }];
  }
  if (!node || node.children.length === 0) {
    if (!primaryOnly) {
      return [{ key: selected, title: null, category: selected, isChild: false, items }];
    }
    const own = items.filter((item) => item.category === selected);
    const linked = items.filter((item) => item.category !== selected);
    const sections: CatalogSection<T>[] = [];
    if (own.length > 0 || linked.length === 0) {
      sections.push({
        key: selected,
        title: linked.length > 0 ? selected : null,
        category: selected,
        isChild: false,
        items: own,
      });
    }
    if (linked.length > 0) {
      sections.push({
        key: "linked",
        title: LINKED_SECTION_TITLE,
        category: null,
        isChild: false,
        items: linked,
      });
    }
    return sections;
  }
  const member = (item: T, names: Set<string>) =>
    primaryOnly ? names.has(item.category) : inCategories(item, names);
  const sections: CatalogSection<T>[] = [];
  const covered = new Set<T>();
  const direct = items.filter((item) =>
    primaryOnly ? item.category === selected : productCategoryNames(item).includes(selected),
  );
  if (direct.length > 0) {
    direct.forEach((item) => covered.add(item));
    sections.push({
      key: `direct:${selected}`,
      title: selected,
      category: selected,
      isChild: false,
      items: direct,
    });
  }
  for (const child of node.children) {
    const names = subtreeNames(tree, child.name);
    const rows = items.filter((item) => member(item, names));
    if (rows.length === 0) continue;
    rows.forEach((item) => covered.add(item));
    sections.push({
      key: child.name,
      title: child.name,
      category: child.name,
      isChild: true,
      items: rows,
    });
  }
  const rest = items.filter((item) => !covered.has(item));
  if (rest.length > 0) {
    sections.push({
      key: primaryOnly ? "linked" : "other",
      title: primaryOnly ? LINKED_SECTION_TITLE : "אחר",
      category: null,
      isChild: false,
      items: rest,
    });
  }
  return sections;
}

/** סדר מוצרים: מה שהמנהל סידר קודם (לפי sort_order), ואחריו מהחדש לישן — כמו במסד */
export function compareProductOrder(
  a: { sort_order?: number | null; created_at?: string | null },
  b: { sort_order?: number | null; created_at?: string | null },
): number {
  const sa = a.sort_order ?? null;
  const sb = b.sort_order ?? null;
  if (sa !== null && sb !== null && sa !== sb) return sa - sb;
  if (sa !== null && sb === null) return -1;
  if (sa === null && sb !== null) return 1;
  // בלי תאריך (רשימת הניהול) — 0: המיון יציב, ונשאר הסדר שהגיע מהשרת
  if (a.created_at && b.created_at) return b.created_at.localeCompare(a.created_at);
  return 0;
}

export const REORDER_ERROR =
  "שגיאה: לא ניתן להעביר מוצר לקטגוריה אחרת בגרירה. כדי לשנות קטגוריית מוצר, יש להיכנס לעריכת המוצר ולשנות זאת משם.";
