// E5: מפת האתר ו-robots.txt של אתר אירוח — נקרא מהשער של המנוע (engine.ts), בשרת בלבד.
// הנתונים: אותם נתונים ציבוריים שהאתר מציג (public_site, public_room_types), לפי האתר של הבקשה;
// במטמון קצר לכל אתר (ברירת מחדל 5 דקות, SITEMAP_TTL_MS — כמו מפות האתר של החנויות), כך שבקשות
// חוזרות לא מעמיסות על המסד. בלי קוד מתיקיות server/ (השער נטען גם בבאנדל של הדפדפן).
import type { PublicPackage } from "../types/packages";
import { currentSiteAddresses } from "@/platform/tenancy/current-site.server";
import { publishableKey, supabaseUrl } from "@/platform/supabase/env.server";
import { HOSPITALITY_SCHEMA } from "../config";
import type { PublicRoomType, PublicSite, RawPublicSite } from "../types/website";
import { toPublicSite } from "./lib/site-map";
import { buildSitemap, canonicalOrigin, sitemapEntries, siteSeo } from "./seo";

// SITEMAP_TTL_MS=0 — בלי מטמון (בדיקות); לא מוגדר — 5 דקות
const TTL_RAW = process.env["SITEMAP_TTL_MS"];
const TTL_MS =
  TTL_RAW !== undefined && TTL_RAW.trim() !== "" && Number.isFinite(Number(TTL_RAW))
    ? Math.max(0, Number(TTL_RAW))
    : 5 * 60 * 1000;
const cache = new Map<string, { at: number; site: PublicSite }>();

/**
 * המפתח הציבורי (anon) — אותה גישה שיש לגולש: public_site / public_room_types פתוחות לאורחים, אז אין
 * צורך במפתח השירות (פחות הרשאות לשרת בנתיב הזה). מפתחות sb_publishable_ אינם JWT — לא נשלחים כ-Bearer.
 */
function anonHeaders(): Record<string, string> {
  const key = publishableKey();
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_publishable_")) headers["Authorization"] = `Bearer ${key}`;
  return headers;
}

/** קריאה ציבורית (anon) לפונקציית מסד של האתר — גם לאייקונים מהלוגו (brand.server.ts, A1) */
export async function rpc<T>(siteId: string, fn: string): Promise<T> {
  const res = await fetch(`${supabaseUrl()}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      ...anonHeaders(),
      "Content-Profile": HOSPITALITY_SCHEMA,
      "Accept-Profile": HOSPITALITY_SCHEMA,
      "x-tenant-id": siteId,
    },
    body: "{}",
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status}`);
  return (await res.json()) as T;
}

/** הנתונים הציבוריים של האתר (בלי כתובות תמונות — מפת האתר לא צריכה אותן) */
async function publicSite(siteId: string): Promise<PublicSite> {
  const hit = cache.get(siteId);
  if (hit && TTL_MS > 0 && Date.now() - hit.at < TTL_MS) return hit.site;
  const [raw, types, packages] = await Promise.all([
    rpc<RawPublicSite>(siteId, "public_site"),
    rpc<PublicRoomType[]>(siteId, "public_room_types"),
    rpc<PublicPackage[]>(siteId, "public_packages").catch(() => [] as PublicPackage[]),
  ]);
  const site = toPublicSite(raw, () => null, types, packages);
  if (cache.size > 500) cache.clear();
  cache.set(siteId, { at: Date.now(), site });
  return site;
}

/** הכתובת הקנונית של האתר (ל-Sitemap ב-robots.txt); null — לא ידועה / הנתונים לא נטענו */
export async function canonicalSiteOrigin(siteId: string): Promise<string | null> {
  try {
    return canonicalOrigin(await currentSiteAddresses(), siteSeo(await publicSite(siteId)));
  } catch (error) {
    console.error("[hospitality/seo] origin failed", error);
    return null;
  }
}

/** sitemap.xml של האתר; null — לא ניתן לבנות (אין כתובת / שגיאה) */
export async function sitemapResponse(siteId: string): Promise<Response | null> {
  try {
    const site = await publicSite(siteId);
    const origin = canonicalOrigin(await currentSiteAddresses(), siteSeo(site));
    if (!origin) return null;
    return new Response(buildSitemap(origin, sitemapEntries(site)), {
      status: 200,
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, max-age=300",
        "x-robots-tag": "noindex",
      },
    });
  } catch (error) {
    console.error("[hospitality/seo] sitemap failed", error);
    return null;
  }
}
