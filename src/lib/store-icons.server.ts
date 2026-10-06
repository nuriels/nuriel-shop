import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { maybeCurrentTenant } from "@/integrations/supabase/tenant.server";
import { renderPwaIcon, type PwaIconName } from "@/lib/pwa-icon-render.server";
import sharp from "sharp";

/**
 * חלק 24: אייקון "הוספה למסך הבית" ותמונת שיתוף (ווטסאפ / רשתות) — מהלוגו של החנות
 * הנוכחית (לפי הדומיין). מוגש מהדומיין של החנות עצמה, כ-PNG בגודל הנכון — בלי תלות
 * בכתובת ה-Storage. אין לוגו → null (הנתיב מחזיר 404, וה-head לא מפנה אליו).
 */
export type StoreIconName = PwaIconName | "og-image.png";

const LOGO_TTL_MS = 60_000;
const logoCache = new Map<string, { at: number; key: string | null; bytes: Buffer | null }>();
const iconCache = new Map<string, Buffer>();

async function tenantLogo(tenantId: string): Promise<{ key: string; bytes: Buffer } | null> {
  const hit = logoCache.get(tenantId);
  if (hit && Date.now() - hit.at < LOGO_TTL_MS)
    return hit.key && hit.bytes ? { key: hit.key, bytes: hit.bytes } : null;
  let found: { key: string; bytes: Buffer } | null = null;
  try {
    const { data } = await supabaseAdmin
      .from("site_settings")
      .select("logo_path")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const path = data?.logo_path?.trim() ?? "";
    if (/^https?:\/\//i.test(path)) {
      const res = await fetch(path);
      if (res.ok) found = { key: path, bytes: Buffer.from(await res.arrayBuffer()) };
    } else if (path) {
      const { data: blob } = await supabaseAdmin.storage.from("branding").download(path);
      if (blob) found = { key: path, bytes: Buffer.from(await blob.arrayBuffer()) };
    }
  } catch (error) {
    console.error("[store-icons] loading the store logo failed", error);
  }
  logoCache.set(tenantId, { at: Date.now(), key: found?.key ?? null, bytes: found?.bytes ?? null });
  return found;
}

/** תמונת שיתוף 1200×630: הלוגו במרכז (בתוך הריבוע המרכזי — ווטסאפ חותך לריבוע) */
async function renderShareImage(logo: Buffer): Promise<Buffer> {
  const square = await renderPwaIcon(logo, "icon-512.png");
  const { data } = await sharp(square)
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const background = { r: data[0] ?? 255, g: data[1] ?? 255, b: data[2] ?? 255 };
  const inner = await sharp(square).resize(560, 560).png().toBuffer();
  const composed = await sharp({ create: { width: 1200, height: 630, channels: 3, background } })
    .composite([{ input: inner, gravity: "centre" }])
    .png()
    .toBuffer();
  return sharp(composed).removeAlpha().png({ compressionLevel: 9 }).toBuffer();
}

export async function storeIcon(name: StoreIconName): Promise<Buffer | null> {
  const tenant = maybeCurrentTenant();
  if (!tenant) return null;
  const logo = await tenantLogo(tenant.id);
  if (!logo) return null;
  const key = `${tenant.id}|${logo.key}|${name}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const png =
    name === "og-image.png"
      ? await renderShareImage(logo.bytes)
      : await renderPwaIcon(logo.bytes, name);
  if (iconCache.size > 200) iconCache.clear();
  iconCache.set(key, png);
  return png;
}
