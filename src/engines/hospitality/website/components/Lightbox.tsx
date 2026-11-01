// תצוגת תמונה במסך מלא (<dialog> של הדפדפן: מלכודת פוקוס, Esc, בלי ספריות). חצים במקלדת
// ובכפתורים; החלקה בנייד. סרטון מוטמע (YouTube / Vimeo) נטען רק כשפותחים אותו.
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import type { PublicMedia } from "../../types/website";
import { useCopy } from "../copy";
import { embedSrc } from "../lib/media";

export function Lightbox({
  items,
  index,
  onIndex,
  title,
}: {
  items: PublicMedia[];
  /** null = סגור */
  index: number | null;
  onIndex: (i: number | null) => void;
  title: string;
}) {
  const t = useCopy();
  const ref = useRef<HTMLDialogElement>(null);
  const touchX = useRef<number | null>(null);
  const open = index !== null && items.length > 0;
  const go = useCallback(
    (delta: number) => {
      if (index === null) return;
      onIndex((index + delta + items.length) % items.length);
    },
    [index, items.length, onIndex],
  );

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // RTL: החץ שמאלה = הבאה
      if (e.key === "ArrowLeft") go(1);
      if (e.key === "ArrowRight") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go]);

  const item = index !== null ? items[index] : null;
  const embed = item ? embedSrc(item) : null;

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={() => onIndex(null)}
      onClick={(e) => e.target === ref.current && onIndex(null)}
      className="m-0 h-[100dvh] max-h-none w-screen max-w-none bg-transparent p-0 text-white backdrop:bg-black/90"
      onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const start = touchX.current;
        const end = e.changedTouches[0]?.clientX;
        if (start === null || end === undefined) return;
        if (Math.abs(end - start) > 50) go(end > start ? 1 : -1);
        touchX.current = null;
      }}
    >
      {item && (
        <div className="flex h-full w-full flex-col">
          <div className="flex items-center justify-between px-4 py-3 text-sm text-white/80">
            <span aria-live="polite">{t.gallery.open((index ?? 0) + 1, items.length)}</span>
            <button
              type="button"
              onClick={() => onIndex(null)}
              className="rounded-full p-2 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
              aria-label={t.gallery.close}
            >
              <X className="size-6" aria-hidden="true" />
            </button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-6 sm:px-16">
            {embed ? (
              <iframe
                src={embed}
                title={item.alt ?? t.gallery.video}
                className="aspect-video w-full max-w-5xl rounded-md"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
              />
            ) : item.kind === "video" && item.url ? (
              <video
                src={item.url}
                controls
                playsInline
                className="max-h-full max-w-full rounded-md"
              >
                <track kind="captions" />
              </video>
            ) : (
              <img
                src={item.url ?? ""}
                srcSet={item.srcset ?? undefined}
                sizes="100vw"
                alt={item.alt?.trim() || title}
                className="max-h-full max-w-full rounded-sm object-contain"
              />
            )}
            {items.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => go(-1)}
                  className="absolute start-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2.5 hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-white sm:start-4"
                  aria-label={t.gallery.prev}
                >
                  <ChevronRight className="size-6" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => go(1)}
                  className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2.5 hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-white sm:end-4"
                  aria-label={t.gallery.next}
                >
                  <ChevronLeft className="size-6" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
