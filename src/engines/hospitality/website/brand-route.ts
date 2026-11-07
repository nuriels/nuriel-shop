// A1: הנתיב /stay/brand/<asset> — אייקוני "הוספה למסך הבית", תמונת השיתוף והמניפסט של האתר, מהלוגו
// שהעסק העלה. השער של המנוע (edge/gate.ts) מעביר את הנתיב רק באתר אירוח פעיל שהאתר או אזור הניהול
// שלו פתוחים; כאן — רק באתר אירוח, ובלי לוגו → 404 (ה-head אז לא מפנה לכאן).
import { isBrandAsset } from "./lib/brand";

const notFound = () =>
  new Response("Not found\n", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });

export async function brandAssetResponse(asset: string): Promise<Response> {
  if (!isBrandAsset(asset)) return notFound();
  try {
    const { currentSite } = await import("@/platform/tenancy/current-site.server");
    const site = await currentSite();
    if (!site || site.siteType !== "hospitality") return notFound();
    const brand = await import("./brand.server");
    if (asset === "manifest") {
      const manifest = await brand.brandManifest(site.id);
      if (!manifest) return notFound();
      return new Response(JSON.stringify(manifest), {
        headers: {
          "content-type": "application/manifest+json; charset=utf-8",
          "cache-control": "public, max-age=3600",
        },
      });
    }
    const png = await brand.brandPng(site.id, asset);
    if (!png) return notFound();
    // הכתובת כוללת את גרסת הלוגו (?v=) — לוגו חדש = כתובת חדשה, אז אפשר מטמון של יום
    return new Response(new Uint8Array(png), {
      headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" },
    });
  } catch (error) {
    console.error("[hospitality/brand] serving failed", error);
    return notFound();
  }
}
