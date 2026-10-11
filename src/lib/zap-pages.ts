/**
 * חלק 38: עמודי האינדקס לסורקים של זאפ (Web Crawlers) — HTML פרימיטיבי, בלי
 * ה-Layout של החנות (בלי Header / Footer / Tailwind / JavaScript):
 *
 *   /zap (או /zap/index)   — עץ הקטגוריות הפעילות: <ul><li><a href="/zap/cat/{id}">שם</a>
 *   /zap/cat/{categoryId}  — המוצרים של הקטגוריה: <a href="/product/{id}">שם - מחיר</a>
 *                            (+ קישורים לתת-הקטגוריות שלה)
 *
 * "פעיל": מוצר שמוצג באתר, מסומן "הצג בזאפ", במלאי ועם מחיר (כמו בפיד הקודם);
 * קטגוריה — שיש בה (או בתת-קטגוריה שלה) לפחות מוצר כזה.
 * כאן — רק לוגיקה טהורה (נבדקת ביחידה); הטעינה מהמסד ב-zap-pages.server.ts.
 */

export const ZAP_INDEX_PATHS = new Set(["/zap", "/zap/", "/zap/index"]);
const ZAP_CATEGORY_PATH =
  /^\/zap\/cat\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

export type ZapRoute = { kind: "index" } | { kind: "category"; id: string } | { kind: "invalid" };

/** הכתובת → איזה עמוד (null = לא עמוד של זאפ) */
export function zapRoute(pathname: string): ZapRoute | null {
  if (ZAP_INDEX_PATHS.has(pathname)) return { kind: "index" };
  const match = ZAP_CATEGORY_PATH.exec(pathname);
  if (match) return { kind: "category", id: match[1]!.toLowerCase() };
  if (pathname.startsWith("/zap/")) return { kind: "invalid" };
  return null;
}

export type ZapCategory = {
  id: string;
  name: string;
  parent_name: string | null;
  sort_order: number;
};
export type ZapProduct = { id: string; name: string; price: number };

export type ZapCatalog = {
  /** קטגוריה → המוצרים שמשויכים אליה ישירות (ראשית או נוספת) */
  productsByCategory: Map<string, ZapProduct[]>;
  categories: ZapCategory[];
};

/** בונה את העץ ומסמן אילו קטגוריות "פעילות" (יש מוצר בהן או בתת-קטגוריה) */
export function zapTree(catalog: ZapCatalog): {
  roots: ZapCategory[];
  childrenOf: (name: string) => ZapCategory[];
  active: Set<string>;
} {
  const byName = new Map(catalog.categories.map((c) => [c.name, c]));
  const children = new Map<string, ZapCategory[]>();
  const roots: ZapCategory[] = [];
  for (const category of catalog.categories) {
    const parent =
      category.parent_name && byName.has(category.parent_name) ? category.parent_name : null;
    if (parent && parent !== category.name) {
      children.set(parent, [...(children.get(parent) ?? []), category]);
    } else {
      roots.push(category);
    }
  }
  const order = (a: ZapCategory, b: ZapCategory) =>
    a.sort_order - b.sort_order || a.name.localeCompare(b.name, "he");
  roots.sort(order);
  for (const list of children.values()) list.sort(order);

  const active = new Set<string>();
  const visit = (category: ZapCategory, seen: Set<string>): boolean => {
    if (seen.has(category.id)) return false; // הגנה ממעגל בעץ
    seen.add(category.id);
    let has = (catalog.productsByCategory.get(category.id)?.length ?? 0) > 0;
    for (const child of children.get(category.name) ?? []) has = visit(child, seen) || has;
    if (has) active.add(category.id);
    return has;
  };
  const seen = new Set<string>();
  for (const root of roots) visit(root, seen);
  return { roots, childrenOf: (name) => children.get(name) ?? [], active };
}

export function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "149.90 ₪" */
export function zapPrice(value: number): string {
  return `${(Math.round(value * 100) / 100).toFixed(2)} ₪`;
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>${htmlEscape(title)}</title>
</head>
<body>
${body}
</body>
</html>
`;
}

/** /zap — כל הקטגוריות הפעילות, כעץ של רשימות <ul> */
export function renderZapIndex(storeName: string, catalog: ZapCatalog): string {
  const { roots, childrenOf, active } = zapTree(catalog);
  const list = (nodes: ZapCategory[]): string => {
    const items = nodes
      .filter((node) => active.has(node.id))
      .map((node) => {
        const sub = list(childrenOf(node.name));
        return `<li><a href="/zap/cat/${node.id}">${htmlEscape(node.name)}</a>${sub}</li>`;
      });
    return items.length > 0 ? `\n<ul>\n${items.join("\n")}\n</ul>\n` : "";
  };
  const tree = list(roots);
  return page(
    `${storeName} — קטגוריות`,
    `<h1>${htmlEscape(storeName)}</h1>${tree || "\n<p>אין מוצרים להצגה</p>\n"}`,
  );
}

/** /zap/cat/{id} — המוצרים של הקטגוריה (ותת-הקטגוריות שלה). null = לא נמצאה / לא פעילה */
export function renderZapCategory(
  storeName: string,
  catalog: ZapCatalog,
  categoryId: string,
): string | null {
  const { childrenOf, active } = zapTree(catalog);
  const category = catalog.categories.find((c) => c.id === categoryId);
  if (!category || !active.has(category.id)) return null;
  const subs = childrenOf(category.name).filter((child) => active.has(child.id));
  const products = [...(catalog.productsByCategory.get(category.id) ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, "he", { numeric: true }),
  );
  const parts: string[] = [`<h1>${htmlEscape(category.name)}</h1>`];
  if (subs.length > 0) {
    parts.push(
      `<ul>\n${subs.map((sub) => `<li><a href="/zap/cat/${sub.id}">${htmlEscape(sub.name)}</a></li>`).join("\n")}\n</ul>`,
    );
  }
  if (products.length > 0) {
    parts.push(
      `<ul>\n${products
        .map(
          (product) =>
            `<li><a href="/product/${product.id}">${htmlEscape(product.name)} - ${zapPrice(product.price)}</a></li>`,
        )
        .join("\n")}\n</ul>`,
    );
  }
  parts.push(`<p><a href="/zap">כל הקטגוריות</a></p>`);
  return page(`${category.name} — ${storeName}`, parts.join("\n"));
}
