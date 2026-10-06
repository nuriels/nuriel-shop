import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extractUrlFromText } from "@/lib/url";
import { MAX_IMPORT_IMAGES, type SavedImportImage, type UrlImportPreview } from "@/lib/url-import";

/**
 * ייבוא מוצר מקישור (חלק 29) — Server Actions.
 *
 *  previewProductFromUrl     — השרת מוריד את עמוד המוצר (src/server/services/
 *                              page-fetch.ts) ומחלץ ממנו כותרת, תיאור, מפרט,
 *                              תמונות ומחיר (src/lib/import.server.ts).
 *  saveImportedProductImages — רק התמונות שהמנהל בחר (עד 10) יורדות, מוקטנות
 *                              ל-WEBP ונשמרות ב-Storage של החנות — כמו בייבוא
 *                              מ-CSV (image-fetch.ts).
 * המוצר עצמו נשמר מטופס המוצר הרגיל. רק מנהל החנות.
 */

const BLOCKED_MESSAGE =
  "האתר חסם את הקריאה האוטומטית (בדיקת רובוט או התחברות). נסו שוב בעוד כמה דקות, או הדביקו את הקישור המלא של עמוד המוצר.";

async function requireStoreAdmin(userId: string): Promise<void> {
  const { loadCaller } = await import("@/lib/caller.server");
  const caller = await loadCaller(userId);
  if (caller.role !== "admin") throw new Error("רק מנהל החנות יכול לייבא מוצרים");
}

export const previewProductFromUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { url: string }) => {
    const url = extractUrlFromText(String(input?.url ?? "").slice(0, 3000));
    if (!url) throw new Error("לא נמצא קישור — הדביקו את הכתובת של עמוד המוצר");
    return { url };
  })
  .handler(async ({ data, context }): Promise<UrlImportPreview> => {
    await requireStoreAdmin(context.userId);
    const { allowAction } = await import("@/lib/rate-limit.server");
    if (!allowAction(`url-import:${context.userId}`, 40, 10 * 60 * 1000)) {
      throw new Error("יותר מדי ייבואים בדקות האחרונות — נסו שוב בעוד כמה דקות");
    }
    const { describePageError, fetchRemotePage, looksBlocked } =
      await import("@/server/services/page-fetch");
    const { parseProductPage } = await import("@/lib/import.server");
    let page: { html: string; finalUrl: string };
    try {
      page = await fetchRemotePage(data.url);
    } catch (error) {
      throw new Error(describePageError(error));
    }
    const product = parseProductPage(page.html, page.finalUrl);
    if (
      product.images.length === 0 &&
      (product.title === "" || looksBlocked(page.html, page.finalUrl))
    ) {
      throw new Error(
        looksBlocked(page.html, page.finalUrl)
          ? BLOCKED_MESSAGE
          : "לא נמצאו פרטי מוצר בעמוד — ודאו שזה קישור לעמוד של מוצר אחד",
      );
    }
    console.info(
      "[url-import]",
      JSON.stringify({
        user: context.userId,
        host: new URL(page.finalUrl).hostname,
        images: product.images.length,
        specs: product.specs.length,
      }),
    );
    return { ...product, sourceUrl: page.finalUrl };
  });

export const saveImportedProductImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { urls: string[] }) => {
    if (!Array.isArray(input?.urls)) throw new Error("רשימת התמונות לא תקינה");
    const urls = [...new Set(input.urls.map((url) => String(url ?? "").trim()).filter(Boolean))];
    if (urls.length > MAX_IMPORT_IMAGES)
      throw new Error(`אפשר לשמור עד ${MAX_IMPORT_IMAGES} תמונות`);
    if (urls.some((url) => url.length > 2000 || !/^https?:\/\//i.test(url))) {
      throw new Error("קישור תמונה לא תקין");
    }
    return { urls };
  })
  .handler(async ({ data, context }): Promise<SavedImportImage[]> => {
    await requireStoreAdmin(context.userId);
    const { allowAction } = await import("@/lib/rate-limit.server");
    if (!allowAction(`url-import-images:${context.userId}`, 40, 10 * 60 * 1000)) {
      throw new Error("יותר מדי הורדות תמונות בדקות האחרונות — נסו שוב בעוד כמה דקות");
    }
    const { currentTenantId } = await import("@/integrations/supabase/tenant.server");
    const tenantId = currentTenantId();
    const { describeImageError, saveImportedImage, settledPool } =
      await import("@/server/services/image-fetch");
    // כל התמונות יחד — עד דקה (כל אחת עד 12 שניות), 4 במקביל
    const deadline = Date.now() + 55_000;
    const results = await settledPool(data.urls, 4, (url) =>
      saveImportedImage(tenantId, url, { deadline }),
    );
    return results.map((result, index): SavedImportImage => {
      const source = data.urls[index]!;
      return result.status === "fulfilled"
        ? { source, url: result.value.url }
        : { source, error: describeImageError(result.reason) };
    });
  });
