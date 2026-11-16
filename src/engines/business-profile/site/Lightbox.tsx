// תצוגה מוגדלת (לייטבוקס) לגלריות — כמו באתר הישן: רקע כהה (80%), תמונה במרכז, קודמת / הבאה, מונה
// "3 / 12" וסגירה. נגישות: <dialog> מודאלי (הפוקוס נשאר בתוכו, Esc סוגר והפוקוס חוזר לכפתור שפתח),
// חיצים במקלדת (בעברית: שמאלה = הבאה), שם נגיש לכל כפתור, ומונה שמוקרא בכל מעבר.
import { useEffect, useRef, type ReactNode } from "react";
import type { ImageRef } from "../document/schema";
import { SiteImage } from "./parts";

export interface LightboxItem {
  image: ImageRef;
  title?: string;
  text?: string;
}

export function Lightbox({
  items,
  index,
  onIndex,
  onClose,
  label,
  fallback,
}: {
  items: LightboxItem[];
  /** null — סגור */
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  label: string;
  fallback?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = index !== null && index >= 0 && index < items.length;
  const count = items.length;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const go = (step: number) => {
    if (index === null || count < 2) return;
    onIndex((index + step + count) % count);
  };
  const item = open ? items[index]! : null;
  // כיוון האתר (התיבה נמצאת בתוך האתר, שמסומן dir): בעברית החץ השמאלי = התמונה הבאה
  const rtl = () => ref.current?.closest("[dir]")?.getAttribute("dir") !== "ltr";

  return (
    <dialog
      ref={ref}
      className="bps-lightbox"
      aria-label={item?.title ? `${label}: ${item.title}` : label}
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(rtl() ? 1 : -1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          go(rtl() ? -1 : 1);
        }
      }}
    >
      {item && (
        <div className="bps-lightbox-body">
          <div className="bps-lightbox-bar">
            <p className="bps-lightbox-count" aria-live="polite" aria-atomic="true">
              <span className="bps-sr">תמונה </span>
              {index! + 1} / {count}
            </p>
            <button
              type="button"
              className="bps-lightbox-close"
              aria-label="סגירת התצוגה המוגדלת"
              autoFocus
              onClick={() => ref.current?.close()}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <figure className="bps-lightbox-figure">
            <SiteImage image={item.image} eager fallback={fallback} />
            {(item.title || item.text) && (
              <figcaption>
                {item.title && <p className="bps-lightbox-title">{item.title}</p>}
                {item.text && <p>{item.text}</p>}
              </figcaption>
            )}
          </figure>
          {count > 1 && (
            <>
              <button
                type="button"
                className="bps-lightbox-nav bps-lightbox-prev"
                aria-label="התמונה הקודמת"
                onClick={() => go(-1)}
              >
                <span aria-hidden="true">›</span>
              </button>
              <button
                type="button"
                className="bps-lightbox-nav bps-lightbox-next"
                aria-label="התמונה הבאה"
                onClick={() => go(1)}
              >
                <span aria-hidden="true">‹</span>
              </button>
            </>
          )}
        </div>
      )}
    </dialog>
  );
}
