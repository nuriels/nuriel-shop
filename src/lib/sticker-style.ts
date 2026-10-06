import type { ProductStickerView } from "@/lib/catalog";

/** הגודל (אחוז מרוחב אזור התמונה) והשקיפות של מדבקה — בטווח שהמסד מתיר */
export function stickerStyle(sticker: Pick<ProductStickerView, "size" | "opacity">): {
  width: string;
  opacity: number;
} {
  const size = Math.min(60, Math.max(10, Math.round(Number(sticker.size) || 30)));
  const opacity = Math.min(100, Math.max(10, Math.round(Number(sticker.opacity) || 100)));
  return { width: `${size}%`, opacity: opacity / 100 };
}
