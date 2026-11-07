// A1: האייקונים ותמונת השיתוף של אתר אירוח — מהלוגו שהעסק העלה (מסמך העיצוב המפורסם → מדיה
// "brand", מיגרציה 42). נקרא מהנתיב /stay/brand/… ומה-root של האתר (לדעת אם יש לוגו), בשרת בלבד.
// הלוגו נטען מהאחסון הציבורי של המדיה (אותה כתובת שהאתר מציג), רק כתמונת raster (בלי SVG —
// כמו SEC-H3), בגודל ובזמן מוגבלים; הלוגו והאייקונים שצוירו נשמרים במטמון קצר לכל אתר.
import sharp from "sharp";
import { renderPwaIcon, type PwaIconName } from "@/platform/media/pwa-icons.server";
import { sniffImageType } from "@/platform/media/remote-image.server";
import { supabaseUrl } from "@/platform/supabase/env.server";
import type { RawPublicSite } from "../types/website";
import { normalizeDesign } from "./design/schema";
import { brandAssetUrl, SHARE_IMAGE, type BrandAsset } from "./lib/brand";
import { rpc } from "./seo.server";

const MEDIA_BUCKET = "hosp-media";
const LOOKUP_TTL_MS = 60_000;
// בלי לוגו (או אתר שעוד סגור): בודקים שוב מהר — לוגו שפורסם עכשיו מופיע תוך שניות
const MISS_TTL_MS = 5_000;
const MAX_LOGO_BYTES = 8 * 1024 * 1024;
const RASTER = new Set(["jpeg", "png", "gif", "webp", "avif", "heif", "tiff"]);

const PWA_FILE: Record<Exclude<BrandAsset, "og-image" | "manifest">, PwaIconName> = {
  "apple-touch-icon": "apple-touch-icon.png",
  "icon-192": "icon-192.png",
  "icon-512": "icon-512.png",
  "icon-maskable-512": "icon-maskable-512.png",
};

export interface SiteBrand {
  /** מזהה המדיה של הלוגו (גם הגרסה בכתובות) */
  logoId: string;
  /** שם העסק — למניפסט */
  name: string;
}

type Lookup = { at: number; brand: (SiteBrand & { path: string }) | null };
const lookups = new Map<string, Lookup>();
const logoBytes = new Map<string, Buffer>();
const rendered = new Map<string, Buffer>();

const trimCache = <V>(map: Map<string, V>, max: number) => {
  if (map.size > max) map.clear();
};

/** הלוגו של האתר לפי מסמך העיצוב המפורסם; null — אין לוגו (או שהנתונים לא נטענו) */
async function lookup(siteId: string): Promise<(SiteBrand & { path: string }) | null> {
  const hit = lookups.get(siteId);
  if (hit && Date.now() - hit.at < (hit.brand ? LOOKUP_TTL_MS : MISS_TTL_MS)) return hit.brand;
  let brand: (SiteBrand & { path: string }) | null = null;
  try {
    const raw = await rpc<RawPublicSite>(siteId, "public_site");
    const logoId = normalizeDesign(raw.design?.document ?? null, raw.design?.theme).logo;
    const logo = logoId
      ? (raw.brand ?? []).find((m) => m.id === logoId && m.kind === "image" && !!m.path)
      : undefined;
    if (logo?.path) {
      brand = {
        logoId: logo.id,
        path: logo.path,
        name: raw.business?.name?.trim() || "",
      };
    }
  } catch (error) {
    // אתר שהאתר הציבורי שלו עוד סגור עונה 4xx — אין לוגו להציג (האייקון הכללי), בלי רעש בלוג
    const message = error instanceof Error ? error.message : String(error);
    if (!/: 4\d\d$/.test(message))
      console.error("[hospitality/brand] loading the site logo failed", message);
  }
  trimCache(lookups, 1000);
  lookups.set(siteId, { at: Date.now(), brand });
  return brand;
}

/** יש לוגו לאתר? (ל-head של כל העמודים) — מזהה הלוגו או null */
export async function siteLogoId(siteId: string): Promise<string | null> {
  return (await lookup(siteId))?.logoId ?? null;
}

async function downloadLogo(path: string): Promise<Buffer | null> {
  const cached = logoBytes.get(path);
  if (cached) return cached;
  const url = `${supabaseUrl()}/storage/v1/object/public/${MEDIA_BUCKET}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "error" });
  if (!res.ok) return null;
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_LOGO_BYTES) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) return null;
  const kind = sniffImageType(bytes);
  if (!kind || !RASTER.has(kind)) {
    console.warn("[hospitality/brand] the logo is not a supported raster image — ignoring");
    return null;
  }
  trimCache(logoBytes, 200);
  logoBytes.set(path, bytes);
  return bytes;
}

/** תמונת שיתוף 1200×630: הלוגו במרכז, על צבע הפינה שלו (לוגו שקוף → לבן) */
async function renderShareImage(logo: Buffer): Promise<Buffer> {
  const square = await renderPwaIcon(logo, "icon-512.png");
  const { data } = await sharp(square)
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const background = { r: data[0] ?? 255, g: data[1] ?? 255, b: data[2] ?? 255 };
  const inner = await sharp(square).resize(560, 560).png().toBuffer();
  const composed = await sharp({
    create: { width: SHARE_IMAGE.width, height: SHARE_IMAGE.height, channels: 3, background },
  })
    .composite([{ input: inner, gravity: "centre" }])
    .png()
    .toBuffer();
  return sharp(composed).removeAlpha().png({ compressionLevel: 9 }).toBuffer();
}

/** ציור אחד מהלוגו (בלי גישה למסד) — גם לבדיקות */
export async function renderBrandPng(
  logo: Buffer,
  asset: Exclude<BrandAsset, "manifest">,
): Promise<Buffer> {
  return asset === "og-image" ? renderShareImage(logo) : renderPwaIcon(logo, PWA_FILE[asset]);
}

/** האייקון / תמונת השיתוף של האתר כ-PNG; null — אין לוגו או שהלוגו לא תקין */
export async function brandPng(
  siteId: string,
  asset: Exclude<BrandAsset, "manifest">,
): Promise<Buffer | null> {
  const brand = await lookup(siteId);
  if (!brand) return null;
  const key = `${siteId}|${brand.logoId}|${asset}`;
  const hit = rendered.get(key);
  if (hit) return hit;
  try {
    const logo = await downloadLogo(brand.path);
    if (!logo) return null;
    const png = await renderBrandPng(logo, asset);
    trimCache(rendered, 300);
    rendered.set(key, png);
    return png;
  } catch (error) {
    console.error("[hospitality/brand] rendering failed", error);
    return null;
  }
}

/** מניפסט "הוספה למסך הבית" — שם העסק והאייקונים מהלוגו; null — אין לוגו */
export function manifestFor(brand: SiteBrand): Record<string, unknown> {
  const name = brand.name || "האתר שלנו";
  return {
    name,
    short_name: name.length > 12 ? name.slice(0, 12).trim() : name,
    lang: "he",
    dir: "rtl",
    start_url: "/stay",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      {
        src: brandAssetUrl("icon-192", brand.logoId),
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: brandAssetUrl("icon-512", brand.logoId),
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: brandAssetUrl("icon-maskable-512", brand.logoId),
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

export async function brandManifest(siteId: string): Promise<Record<string, unknown> | null> {
  const brand = await lookup(siteId);
  return brand ? manifestFor(brand) : null;
}
