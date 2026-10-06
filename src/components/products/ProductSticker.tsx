import type { ProductStickerView } from "@/lib/catalog";
import { stickerStyle } from "@/lib/sticker-style";
import { cn } from "@/lib/utils";

/**
 * מדבקת מוצר (חלק 23): תמיד בפינה העליונה השמאלית של תמונת המוצר, עגולה,
 * בגודל ובשקיפות שבעל החנות קבע. ההורה צריך להיות relative.
 * לא תופסת לחיצות — הלחיצה עוברת לתמונה / לכרטיס שמתחת.
 */
export function ProductSticker({
  sticker,
  className,
}: {
  sticker: ProductStickerView | null | undefined;
  className?: string;
}) {
  if (!sticker || !sticker.url) return null;
  return (
    <img
      src={sticker.url}
      alt={sticker.label ?? ""}
      aria-hidden={sticker.label ? undefined : true}
      loading="lazy"
      decoding="async"
      draggable={false}
      data-product-sticker
      className={cn(
        "pointer-events-none absolute left-2 top-2 z-[1] aspect-square select-none rounded-full object-cover shadow-sm sm:left-3 sm:top-3",
        className,
      )}
      style={{ ...stickerStyle(sticker), borderRadius: "50%" }}
    />
  );
}
