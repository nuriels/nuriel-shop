// תמונה באתר: srcset (480 / 960 / 1600), טעינה עצלה מחוץ למסך, יחס קבוע (בלי קפיצות),
// תווית "תמונה להמחשה" לתמונות הדגמה. בלי תמונה → Placeholder.
import { cn } from "@/platform/ui";
import type { PublicMedia } from "../../types/website";
import { useCopy } from "../copy";
import { Placeholder } from "./Placeholder";

export function Photo({
  media,
  alt,
  sizes = "100vw",
  priority = false,
  className,
  imgClassName,
  placeholderTone,
}: {
  media: PublicMedia | null | undefined;
  alt: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
  imgClassName?: string;
  placeholderTone?: "light" | "dark" | undefined;
}) {
  const t = useCopy();
  if (!media?.url || media.kind !== "image") {
    return (
      <div className={cn("relative overflow-hidden", className)}>
        <Placeholder label={t.gallery.soon} tone={placeholderTone} />
      </div>
    );
  }
  return (
    <div className={cn("relative overflow-hidden bg-muted", className)}>
      <img
        src={media.url}
        srcSet={media.srcset ?? undefined}
        sizes={media.srcset ? sizes : undefined}
        alt={media.alt?.trim() || alt}
        width={media.width ?? undefined}
        height={media.height ?? undefined}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        className={cn("h-full w-full object-cover", imgClassName)}
      />
      {media.is_demo && (
        <span className="absolute bottom-2 start-2 rounded-sm bg-black/45 px-2 py-0.5 text-[11px] text-white/90 backdrop-blur-sm">
          {t.gallery.demo}
        </span>
      )}
    </div>
  );
}
