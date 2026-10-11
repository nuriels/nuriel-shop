/**
 * חלק 38: עמודי האינדקס לזאפ (/zap, /zap/cat/{id}) — צד שרת: טעינה מהמסד
 * ורינדור HTML נקי (src/lib/zap-pages.ts).
 *
 * נקרא מ-src/server.ts לפני האפליקציה, בתוך runWithTenant — supabaseAdmin
 * כבר מוגבל לחנות של הבקשה. נפתח רק עם התוסף "חיבור לזאפ" פעיל (אחרי אישור
 * התשלום ע"י מנהל הפלטפורמה — חלק 38), ורק בחנות פתוחה.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isPlatformRequest, storeLockReason } from "@/integrations/supabase/tenant.server";
import {
  feedOrigin,
  loadFeedProducts,
  textResponse,
  zapFeedUnlocked,
  zapStore,
} from "@/lib/feeds.server";
import {
  renderZapCategory,
  renderZapIndex,
  zapRoute,
  type ZapCatalog,
  type ZapCategory,
  type ZapProduct,
} from "@/lib/zap-pages";

const HTML = "text/html; charset=utf-8";

const message = (title: string, status: number) =>
  textResponse(
    `<!doctype html>\n<html lang="he" dir="rtl">\n<head>\n<meta charset="utf-8">\n<title>${title}</title>\n</head>\n<body>\n<p>${title}</p>\n</body>\n</html>\n`,
    HTML,
    0,
    status,
  );

async function loadPaged<T>(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 100_000; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

/** הקטגוריות + המוצרים הפעילים לזאפ, לפי שיוך (קטגוריה ראשית + נוספות) */
async function loadZapCatalog(vatMultiplier: number): Promise<ZapCatalog> {
  const [products, categories, links] = await Promise.all([
    loadFeedProducts(),
    loadPaged<ZapCategory>((from, to) =>
      supabaseAdmin
        .from("categories")
        .select("id, name, parent_name, sort_order")
        .order("id")
        .range(from, to),
    ),
    loadPaged<{ product_id: string; category_id: string }>((from, to) =>
      supabaseAdmin
        .from("product_categories")
        .select("product_id, category_id")
        .order("product_id")
        .order("category_id")
        .range(from, to),
    ),
  ]);
  const listed = new Map<string, ZapProduct & { category: string }>();
  for (const p of products) {
    if (!p.show_in_zap || !p.in_stock || !(p.price > 0)) continue;
    listed.set(p.id, {
      id: p.id,
      name: p.name,
      price: p.price * vatMultiplier,
      category: p.category,
    });
  }
  const idByName = new Map(categories.map((c) => [c.name, c.id]));
  const byCategory = new Map<string, Map<string, ZapProduct>>();
  const add = (categoryId: string | undefined, product: ZapProduct) => {
    if (!categoryId) return;
    const bucket = byCategory.get(categoryId) ?? new Map<string, ZapProduct>();
    bucket.set(product.id, product);
    byCategory.set(categoryId, bucket);
  };
  for (const product of listed.values()) {
    add(idByName.get(product.category), {
      id: product.id,
      name: product.name,
      price: product.price,
    });
  }
  for (const link of links) {
    const product = listed.get(link.product_id);
    if (product)
      add(link.category_id, { id: product.id, name: product.name, price: product.price });
  }
  return {
    categories: categories.map((c) => ({ ...c, sort_order: Number(c.sort_order) || 0 })),
    productsByCategory: new Map([...byCategory].map(([id, bucket]) => [id, [...bucket.values()]])),
  };
}

export async function renderZapPage(pathname: string, request: Request): Promise<Response> {
  const route = zapRoute(pathname);
  if (!route || route.kind === "invalid") return message("Not found", 404);
  // דומיין פאנל הפלטפורמה / חנות נעולה — לא לסריקה
  if (isPlatformRequest() || storeLockReason() !== null) return message("Not found", 404);
  // רק עם התוסף "חיבור לזאפ" פעיל (אושר ע"י מנהל הפלטפורמה)
  if (!zapFeedUnlocked()) {
    return message("Zap pages are not enabled for this store (add-on required)", 403);
  }
  try {
    const store = await zapStore(feedOrigin(request));
    const catalog = await loadZapCatalog(store.vatMultiplier);
    if (route.kind === "index") {
      return textResponse(renderZapIndex(store.name, catalog), HTML, 1800);
    }
    const html = renderZapCategory(store.name, catalog, route.id);
    return html ? textResponse(html, HTML, 1800) : message("Not found", 404);
  } catch (error) {
    console.error("[zap] failed", pathname, error);
    return message("Temporarily unavailable", 503);
  }
}
