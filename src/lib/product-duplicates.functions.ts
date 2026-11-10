import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  parseCards,
  parseGroups,
  parseMergeOutcome,
  validateIdList,
  validateMergeInput,
  type DuplicateGroupsResult,
  type DuplicateProduct,
  type MergeOutcome,
} from "@/lib/product-duplicates";

/**
 * מוצרים כפולים בחנות — פונקציות השרת של מסך "מוצרים כפולים" (רק מנהל החנות). עטיפה דקה: ההרשאה
 * נבדקת כאן (לפני המסד) ושוב במסד, שבו נמצא כל ההיגיון (supabase/migrations/20261110230000_product_duplicates.sql).
 * לכל קריאה — הגבלת קצב ושורת [product-duplicates] ביומן (בלי שמות מוצרים ובלי מידע על לקוחות).
 * הצעות ה-AI — בקובץ נפרד (product-duplicates-ai.functions.ts), דרך הצינור של NURIEL AI.
 */

const HOUR = 60 * 60 * 1000;

async function requireStoreAdmin(userId: string, bucket: string, perHour: number) {
  const { loadCaller } = await import("@/lib/caller.server");
  const caller = await loadCaller(userId);
  if (caller.role !== "admin") throw new Error("רק מנהל החנות יכול לנהל מוצרים כפולים");
  const { allowAction } = await import("@/lib/rate-limit.server");
  if (!allowAction(`product-duplicates-${bucket}:${userId}`, perHour, HOUR)) {
    throw new Error("יותר מדי פעולות בשעה האחרונה — נסו שוב מאוחר יותר");
  }
}

function logLine(entry: Record<string, unknown>) {
  console.info("[product-duplicates]", JSON.stringify(entry));
}

/** הקבוצות שנמצאו בחנות (שם / תמונה / ברקוד), בלי מה שסומן "לא כפול" */
export const productDuplicateGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DuplicateGroupsResult> => {
    await requireStoreAdmin(context.userId, "read", 600);
    const started = Date.now();
    const { data, error } = await context.supabase.rpc("product_duplicate_groups");
    if (error) throw new Error(error.message);
    const result = parseGroups(data);
    logLine({
      user: context.userId,
      action: "groups",
      groups: result.groups.length,
      ms: Date.now() - started,
    });
    return result;
  });

/** פרטי המוצרים של הצעת AI (רק מוצרים של החנות הזו חוזרים) */
export const productDuplicateCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ids: string[] }) => ({ ids: validateIdList(input, 1, 200) }))
  .handler(async ({ data, context }): Promise<DuplicateProduct[]> => {
    await requireStoreAdmin(context.userId, "read", 600);
    const { data: raw, error } = await context.supabase.rpc("product_duplicate_cards", {
      _ids: data.ids,
    });
    if (error) throw new Error(error.message);
    return parseCards(raw);
  });

/** "לא כפול" — הקבוצה לא תוצג שוב (עד שיתווסף לה מוצר נוסף) */
export const productDuplicateDismiss = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ids: string[] }) => ({ ids: validateIdList(input, 2, 50) }))
  .handler(async ({ data, context }): Promise<{ dismissed: number }> => {
    await requireStoreAdmin(context.userId, "write", 300);
    const { error } = await context.supabase.rpc("product_duplicate_dismiss", {
      _product_ids: data.ids,
    });
    if (error) throw new Error(error.message);
    logLine({ user: context.userId, action: "dismiss", products: data.ids.length });
    return { dismissed: data.ids.length };
  });

/** "להציג שוב הכול" — מוחק את כל הסימונים "לא כפול" של החנות */
export const productDuplicateDismissalsClear = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ cleared: number }> => {
    await requireStoreAdmin(context.userId, "write", 300);
    const { data, error } = await context.supabase.rpc("product_duplicate_dismissals_clear");
    if (error) throw new Error(error.message);
    const cleared = Number((data as { cleared?: unknown } | null)?.cleared ?? 0);
    logLine({ user: context.userId, action: "dismissals_clear", cleared });
    return { cleared: Number.isFinite(cleared) ? cleared : 0 };
  });

/** המיזוג — אטומי במסד (הכול או כלום), עם יומן מלא לשחזור */
export const productMerge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => validateMergeInput(input))
  .handler(async ({ data, context }): Promise<MergeOutcome> => {
    await requireStoreAdmin(context.userId, "merge", 200);
    const started = Date.now();
    const { data: raw, error } = await context.supabase.rpc("product_merge", {
      _keep: data.keep,
      _others: data.others,
      _stock_mode: data.stockMode,
      _stock_from: data.stockFrom,
      _stock: data.stock,
      _hide: data.hide,
    });
    if (error) throw new Error(error.message);
    const outcome = parseMergeOutcome(raw);
    logLine({
      user: context.userId,
      action: "merge",
      merge: outcome.mergeId,
      products: data.others.length + 1,
      mode: data.stockMode,
      deleted: outcome.deleted,
      hidden: outcome.hidden,
      ms: Date.now() - started,
    });
    return outcome;
  });
