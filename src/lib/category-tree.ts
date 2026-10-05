/**
 * עץ הקטגוריות — לוגיקה טהורה, בלי גישה לרשת.
 *
 * המפתח של קטגוריה הוא השם שלה (ייחודי בכל העץ). תת-קטגוריה מצביעה על
 * האב לפי שם. למוצר יש קטגוריה ראשית אחת (global_products.category) — בכל
 * רמה בעץ — ומחלק 18 גם קטגוריות נוספות (product_categories).
 */

export const MAX_CATEGORY_DEPTH = 3;
export const CATEGORY_NAME_MAX = 30;

export type CategoryRow = {
  /** מזהה הקטגוריה (חלק 18 — לקישור מוצר לכמה קטגוריות) */
  id?: string;
  name: string;
  parent_name: string | null;
  sort_order: number;
  image_url: string | null;
  /** חלק 20: "הצג קטגוריה במסך הבית" — ריבוע בעמוד הראשי של הקטלוג */
  show_on_homepage: boolean;
};

export type CategoryNode = CategoryRow & {
  /** 1 = קטגוריה ראשית */
  depth: number;
  /** השמות מהשורש ועד הקטגוריה עצמה, כולל */
  path: string[];
  children: CategoryNode[];
};

export type CategoryTree = {
  roots: CategoryNode[];
  byName: Map<string, CategoryNode>;
  /** כל הצמתים בסדר תצוגה (עומק-תחילה) */
  flat: CategoryNode[];
};

const collator = new Intl.Collator("he");

function bySortOrder(a: CategoryRow, b: CategoryRow): number {
  return a.sort_order - b.sort_order || collator.compare(a.name, b.name);
}

export function buildCategoryTree(rows: CategoryRow[]): CategoryTree {
  const byName = new Map<string, CategoryNode>();
  for (const row of rows) {
    byName.set(row.name, { ...row, depth: 1, path: [row.name], children: [] });
  }

  const roots: CategoryNode[] = [];
  for (const node of byName.values()) {
    const parent = node.parent_name ? byName.get(node.parent_name) : undefined;
    // אב שלא קיים (לא אמור לקרות בזכות ה-FK) — מציגים כקטגוריה ראשית
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const flat: CategoryNode[] = [];
  const visit = (nodes: CategoryNode[], parentPath: string[]) => {
    nodes.sort(bySortOrder);
    for (const node of nodes) {
      node.path = [...parentPath, node.name];
      node.depth = node.path.length;
      flat.push(node);
      visit(node.children, node.path);
    }
  };
  visit(roots, []);

  return { roots, byName, flat };
}

/** הקטגוריה עצמה וכל מה שמתחתיה — לסינון "לחיצה על אב מציגה הכל" */
export function subtreeNames(tree: CategoryTree, name: string): Set<string> {
  const result = new Set<string>();
  const start = tree.byName.get(name);
  if (!start) {
    result.add(name);
    return result;
  }
  const stack = [start];
  while (stack.length > 0) {
    const node = stack.pop()!;
    result.add(node.name);
    stack.push(...node.children);
  }
  return result;
}

/** גובה הענף מתחת לצומת (0 = אין ילדים) */
export function subtreeHeight(node: CategoryNode): number {
  if (node.children.length === 0) return 0;
  return 1 + Math.max(...node.children.map(subtreeHeight));
}

/**
 * ספירת מוצרים לכל קטגוריה, כולל כל מה שמתחתיה.
 * @param direct מספר המוצרים שמשויכים ישירות לכל שם קטגוריה
 */
export function totalCounts(tree: CategoryTree, direct: Map<string, number>): Map<string, number> {
  const totals = new Map<string, number>();
  const sum = (node: CategoryNode): number => {
    let total = direct.get(node.name) ?? 0;
    for (const child of node.children) total += sum(child);
    totals.set(node.name, total);
    return total;
  };
  for (const root of tree.roots) sum(root);
  return totals;
}

/** מוצר עם קטגוריה ראשית ואולי קטגוריות נוספות (חלק 18) */
export type MultiCategoryProduct = { category: string; categories?: string[] | null };

/** כל הקטגוריות של המוצר — הראשית ראשונה, בלי כפילויות */
export function productCategoryNames(product: MultiCategoryProduct): string[] {
  const names = [product.category];
  for (const name of product.categories ?? []) if (!names.includes(name)) names.push(name);
  return names;
}

/** האם המוצר נמצא באחת הקטגוריות (ראשית או נוספת) */
export function inCategories(product: MultiCategoryProduct, names: Set<string>): boolean {
  if (names.has(product.category)) return true;
  return (product.categories ?? []).some((name) => names.has(name));
}

/**
 * ספירת מוצרים לכל קטגוריה, כולל כל מה שמתחתיה — לפי כל הקטגוריות של כל
 * מוצר. מוצר נספר פעם אחת בכל קטגוריה (גם אם הוא בשתי תתי-קטגוריות שלה).
 */
export function productCountsByCategory(
  tree: CategoryTree,
  products: MultiCategoryProduct[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const product of products) {
    const reached = new Set<string>();
    for (const name of productCategoryNames(product)) {
      const node = tree.byName.get(name);
      if (!node) continue;
      for (const ancestor of node.path) reached.add(ancestor);
    }
    for (const name of reached) totals.set(name, (totals.get(name) ?? 0) + 1);
  }
  return totals;
}

/** ספירה ישירה מתוך רשימת מוצרים שנטענה (קטגוריה ראשית בלבד) */
export function countByCategory(products: { category: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const product of products) {
    counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
  }
  return counts;
}

/**
 * לאן מותר להעביר קטגוריה: לא לעצמה, לא לתוך הענף שלה, ובלי לעבור
 * 3 רמות כולל הילדים שנגררים איתה. null = להפוך לקטגוריה ראשית.
 * אותה בדיקה נאכפת גם במסד (categories_tree_guard).
 */
export function validMoveTargets(tree: CategoryTree, name: string): (CategoryNode | null)[] {
  const node = tree.byName.get(name);
  if (!node) return [];
  const blocked = subtreeNames(tree, name);
  const height = subtreeHeight(node);
  const targets: (CategoryNode | null)[] = [];
  if (node.parent_name !== null) targets.push(null);
  for (const candidate of tree.flat) {
    if (blocked.has(candidate.name)) continue;
    if (candidate.name === node.parent_name) continue;
    if (candidate.depth + 1 + height > MAX_CATEGORY_DEPTH) continue;
    targets.push(candidate);
  }
  return targets;
}

export function formatPath(node: CategoryNode): string {
  return node.path.join(" › ");
}

export function normalizeCategoryName(input: string): string {
  return input.trim().replace(/\s{2,}/g, " ");
}
