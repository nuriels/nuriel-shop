/**
 * מדבקות מוצר (חלק 23): גלריה ברמת החנות. מעלים תמונה פעם אחת, ובכל מוצר
 * בוחרים מהגלריה + גודל ושקיפות. התמונה נשמרת ב-product-images תחת
 * <tenant>/stickers/ (מדיניות ה-Storage: מנהל, רק בתיקייה של החנות שלו).
 */
import { supabase } from "@/integrations/supabase/client";
import { compressStickerImage } from "@/lib/image";
import { PRODUCT_IMAGES_BUCKET, tenantStoragePrefix } from "@/lib/site";

export type Sticker = {
  id: string;
  image_url: string;
  name: string;
  created_at: string;
};

/** גבולות הסליידרים — כמו הבדיקות במסד */
export const STICKER_SIZE = { min: 10, max: 60, default: 30 } as const;
export const STICKER_OPACITY = { min: 10, max: 100, default: 100 } as const;
export const STICKER_NAME_MAX = 60;

export function clampStickerSize(value: number): number {
  if (!Number.isFinite(value)) return STICKER_SIZE.default;
  return Math.min(STICKER_SIZE.max, Math.max(STICKER_SIZE.min, Math.round(value)));
}

export function clampStickerOpacity(value: number): number {
  if (!Number.isFinite(value)) return STICKER_OPACITY.default;
  return Math.min(STICKER_OPACITY.max, Math.max(STICKER_OPACITY.min, Math.round(value)));
}

/** שם ברירת מחדל מהקובץ: "new-badge.png" → "new badge" */
export function stickerNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^./\\]+$/, "");
  return base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, STICKER_NAME_MAX);
}

/**
 * הנתיב בתוך ה-bucket מתוך הכתובת הציבורית — רק לקבצים שהעלינו לתיקיית
 * המדבקות (כתובת חיצונית / אחרת → null, ולא נוגעים בה).
 */
export function stickerStoragePath(publicUrl: string): string | null {
  const marker = `/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/`;
  const at = publicUrl.indexOf(marker);
  if (at === -1) return null;
  const path = decodeURIComponent(publicUrl.slice(at + marker.length).split("?")[0] ?? "");
  return /^[0-9a-f-]{36}\/stickers\/[^/]+$/i.test(path) ? path : null;
}

export async function listStickers(): Promise<Sticker[]> {
  const { data, error } = await supabase
    .from("product_stickers")
    .select("id, image_url, name, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Sticker[];
}

/** העלאה לגלריה: נדחסת ל-PNG (שקיפות נשמרת), עד 400px */
export async function uploadSticker(file: File, name: string): Promise<Sticker> {
  if (!file.type.startsWith("image/")) throw new Error("יש לבחור קובץ תמונה");
  if (file.size > 10 * 1024 * 1024) throw new Error("גודל התמונה המקסימלי הוא 10MB");
  const { file: optimized, extension } = await compressStickerImage(file);
  const path = `${await tenantStoragePrefix()}/stickers/${Date.now()}-${Math.round(Math.random() * 1e6)}.${extension}`;
  const bucket = supabase.storage.from(PRODUCT_IMAGES_BUCKET);
  const { error: uploadError } = await bucket.upload(path, optimized, {
    upsert: false,
    contentType: optimized.type,
    cacheControl: "31536000",
  });
  if (uploadError) throw uploadError;
  const url = bucket.getPublicUrl(path).data.publicUrl;
  const { data, error } = await supabase
    .from("product_stickers")
    .insert({ image_url: url, name: name.trim().slice(0, STICKER_NAME_MAX) })
    .select("id, image_url, name, created_at")
    .single();
  if (error) {
    // השורה לא נשמרה — לא משאירים קובץ יתום
    await bucket.remove([path]);
    throw error;
  }
  return data as Sticker;
}

/** מחיקה מהגלריה: מוצרים שהשתמשו בה פשוט נשארים בלי מדבקה (במסד) */
export async function deleteSticker(sticker: Sticker): Promise<void> {
  const { error } = await supabase.from("product_stickers").delete().eq("id", sticker.id);
  if (error) throw error;
  const path = stickerStoragePath(sticker.image_url);
  if (path) await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([path]);
}
