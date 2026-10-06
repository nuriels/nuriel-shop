import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Package, Pause, Play } from "lucide-react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

/** כל כמה זמן מתחלפת התמונה (חלק 23: 3 שניות) */
export const PRODUCT_CAROUSEL_MS = 3000;
const SWIPE_THRESHOLD = 40;

/**
 * התמונה הראשית של המוצר (בחלון התצוגה המהירה ובעמוד המוצר). תמונה אחת —
 * תמונה רגילה; כמה תמונות — קרוסלה שמתחלפת לבד כל 3 שניות, עם חצים, נקודות,
 * החלקה באצבע ועצירה / המשך.
 *
 * נעצרת לבד כשהעכבר מעל התמונה, כשהפוקוס בתוכה, כשהלשונית ברקע, וכשהמשתמש
 * ביקש בהגדרות המכשיר פחות תנועה. אחרי מעבר ידני — 3 שניות מלאות עד הבאה.
 *
 * מבוקרת: האינדקס אצל ההורה (גם התמונות הקטנות מתחת בוחרות אותו).
 * children — שכבות קבועות מעל התמונה (מדבקה, "אזל מהמלאי"); לא זזות עם התמונה.
 */
export function ProductImageCarousel({
  images,
  alt,
  index,
  onIndexChange,
  className,
  children,
}: {
  images: string[];
  alt: string;
  index: number;
  onIndexChange: (index: number) => void;
  /** הגובה של אזור התמונה (למשל h-64 sm:h-80) */
  className?: string;
  children?: ReactNode;
}) {
  const count = images.length;
  const multi = count > 1;
  const current = count === 0 ? 0 : Math.min(Math.max(index, 0), count - 1);
  const [userPaused, setUserPaused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const touchStart = useRef<number | null>(null);

  const go = (target: number) => {
    if (count === 0) return;
    onIndexChange(((target % count) + count) % count);
  };

  const autoplay = multi && !userPaused && !hovering && !focused && !reducedMotion;
  useEffect(() => {
    if (!autoplay) return;
    // current בתלויות: אחרי כל מעבר (גם ידני) הספירה מתחילה מחדש. setInterval ולא
    // setTimeout — לשונית ברקע מדלגת על תור, וכשחוזרים אליה ההחלפה ממשיכה
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") onIndexChange((current + 1) % count);
    }, PRODUCT_CAROUSEL_MS);
    return () => window.clearInterval(timer);
  }, [autoplay, current, count, onIndexChange]);

  return (
    <div
      className={cn("relative overflow-hidden", className)}
      role={multi ? "region" : undefined}
      aria-roledescription={multi ? "carousel" : undefined}
      aria-label={multi ? `תמונות המוצר ${alt}` : undefined}
      data-product-carousel={multi ? count : undefined}
      data-carousel-index={current}
      data-carousel-playing={multi ? String(autoplay) : undefined}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovering(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") setHovering(false);
      }}
      onFocus={(event) => {
        // רק פוקוס מהמקלדת עוצר — לחיצה / נגיעה בחץ לא משאירה את הקרוסלה עצורה
        const target = event.target as HTMLElement;
        if (typeof target.matches === "function" && target.matches(":focus-visible")) {
          setFocused(true);
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      onTouchStart={(event) => {
        touchStart.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        touchStart.current = null;
        const end = event.changedTouches[0]?.clientX;
        if (!multi || start === null || end === undefined) return;
        const dx = end - start;
        if (Math.abs(dx) < SWIPE_THRESHOLD) return;
        // מימין לשמאל: התמונה הבאה נמצאת משמאל — גוררים ימינה כדי להגיע אליה
        go(dx > 0 ? current + 1 : current - 1);
      }}
    >
      {count === 0 ? (
        <div className="flex h-full items-center justify-center">
          <Package className="size-16 text-muted-foreground" aria-hidden="true" />
        </div>
      ) : (
        // מסילה מימין לשמאל: התמונה הראשונה מימין, הבאות משמאלה; הזזה ימינה = הבאה
        <div
          dir="rtl"
          className="flex h-full transition-transform duration-500 ease-out motion-reduce:transition-none"
          style={{ transform: `translateX(${current * 100}%)` }}
        >
          {images.map((url, slideIndex) => (
            <div
              key={`${url}-${slideIndex}`}
              className="flex h-full w-full shrink-0 items-center justify-center"
              role={multi ? "group" : undefined}
              aria-roledescription={multi ? "slide" : undefined}
              aria-label={multi ? `${slideIndex + 1} מתוך ${count}` : undefined}
              aria-hidden={multi && slideIndex !== current ? true : undefined}
            >
              <img
                src={url}
                alt={slideIndex === 0 || !multi ? alt : `${alt} — תמונה ${slideIndex + 1}`}
                decoding="async"
                draggable={false}
                className="h-full w-full select-none object-contain mix-blend-multiply"
              />
            </div>
          ))}
        </div>
      )}

      {children}

      {/* האייקונים בלי pointer-events: החלפת האייקון (עצירה ↔ המשך) מתחת לעכבר לא
          "תוקעת" את מצב הריחוף — הקרוסלה ממשיכה כשהעכבר יוצא */}
      {multi && (
        <>
          <button
            type="button"
            onClick={() => go(current - 1)}
            aria-label="התמונה הקודמת"
            className="absolute right-1.5 top-1/2 z-[2] flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-background/85 text-foreground shadow-sm backdrop-blur-sm hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className="pointer-events-none size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => go(current + 1)}
            aria-label="התמונה הבאה"
            className="absolute left-1.5 top-1/2 z-[2] flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-background/85 text-foreground shadow-sm backdrop-blur-sm hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="pointer-events-none size-5" aria-hidden="true" />
          </button>

          <div className="absolute inset-x-0 bottom-1.5 z-[2] flex justify-center">
            <div className="flex items-center gap-1 rounded-full bg-background/85 px-1.5 py-1 shadow-sm backdrop-blur-sm">
              <button
                type="button"
                onClick={() => setUserPaused((value) => !value)}
                aria-label={userPaused ? "המשך החלפת התמונות" : "עצירת החלפת התמונות"}
                aria-pressed={userPaused}
                className="flex size-6 items-center justify-center rounded-full text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {userPaused ? (
                  <Play className="pointer-events-none size-3.5" aria-hidden="true" />
                ) : (
                  <Pause className="pointer-events-none size-3.5" aria-hidden="true" />
                )}
              </button>
              {images.map((url, dotIndex) => (
                <button
                  key={`${url}-dot-${dotIndex}`}
                  type="button"
                  onClick={() => go(dotIndex)}
                  aria-label={`תמונה ${dotIndex + 1} מתוך ${count}`}
                  aria-current={dotIndex === current ? "true" : undefined}
                  className="flex size-6 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className={cn(
                      "pointer-events-none block rounded-full transition-all",
                      dotIndex === current
                        ? "h-2 w-4 bg-primary"
                        : "size-2 bg-muted-foreground/40 hover:bg-muted-foreground/70",
                    )}
                  />
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
