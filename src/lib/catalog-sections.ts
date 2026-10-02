import { subtreeNames, type CategoryTree } from "@/lib/category-tree";

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

/**
 * מסדר את מוצרי הקטגוריה שנבחרה בשורות לפי תת-הקטגוריות הישירות שלה
 * (כל שורה = תת-הקטגוריה וכל מה שמתחתיה), בסדר של עץ הקטגוריות.
 * מוצרים שנמצאים ישירות בקטגוריה שנבחרה — שורה ראשונה בשמה.
 * בלי קטגוריה / קטגוריה בלי תת-קטגוריות — שורה אחת בלי כותרת (כמו היום).
 * הסדר בתוך כל שורה נשמר כפי שהגיע (sort_order ואז מהחדש לישן).
 */
export function groupBySubcategory<T extends { category: string }>(
  tree: CategoryTree,
  selected: string | null,
  items: T[],
): CatalogSection<T>[] {
  const node = selected ? tree.byName.get(selected) : undefined;
  if (!selected || !node || node.children.length === 0) {
    return [{ key: selected ?? "all", title: null, category: selected, isChild: false, items }];
  }
  const sections: CatalogSection<T>[] = [];
  const covered = new Set<T>();
  const direct = items.filter((item) => item.category === selected);
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
    const rows = items.filter((item) => names.has(item.category));
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
    sections.push({ key: "other", title: "אחר", category: null, isChild: false, items: rest });
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
