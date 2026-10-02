import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import {
  bannerMediaKind,
  isValidBannerLink,
  slidesFor,
  type BannerDevice,
  type BannerSlide,
} from "@/lib/banners";

/** GIF שקוף של פיקסל אחד — מקור "ריק" למכשיר שלא אמור להוריד את התמונה */
const BLANK_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
/** אותה נקודת שבירה כמו md של Tailwind */
const DESKTOP_QUERY = "(min-width: 768px)";
const MOBILE_QUERY = "(max-width: 767.98px)";
const AUTOPLAY_MS = 5000;
const SWIPE_THRESHOLD = 40;

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

function aspectFor(slides: BannerSlide[], device: BannerDevice): string {
  const first = slides[0];
  const width = device === "desktop" ? first?.desktop_width : first?.mobile_width;
  const height = device === "desktop" ? first?.desktop_height : first?.mobile_height;
  if (width && height) return `${width} / ${height}`;
  return device === "desktop" ? "1920 / 600" : "1 / 1";
}

/**
 * באנר במסך הבית. מציג שני קרוסלות נפרדות — למחשב ולנייד — וכל מכשיר מוריד
 * רק את התמונות שלו: ה-<picture> של כל גרסה מפנה את המכשיר השני לתמונה ריקה,
 * כך שהנייד לא טוען תמונת מחשב כבדה והמחשב לא מותח תמונת נייד צרה.
 */
export function HomeBanner({ slides, label }: { slides: BannerSlide[]; label: string }) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const desktop = useMemo(() => slidesFor(slides, "desktop"), [slides]);
  const mobile = useMemo(() => slidesFor(slides, "mobile"), [slides]);
  if (desktop.length === 0 && mobile.length === 0) return null;
  return (
    <>
      {desktop.length > 0 && (
        <div className="hidden md:block">
          <BannerCarousel
            slides={desktop}
            device="desktop"
            active={isDesktop}
            label={label}
            guard
          />
        </div>
      )}
      {mobile.length > 0 && (
        <div className="md:hidden">
          <BannerCarousel slides={mobile} device="mobile" active={!isDesktop} label={label} guard />
        </div>
      )}
    </>
  );
}

export function BannerCarousel({
  slides,
  device,
  label,
  active = true,
  guard = false,
}: {
  slides: BannerSlide[];
  device: BannerDevice;
  label: string;
  /** false = הגרסה מוסתרת כרגע (המכשיר השני) — לא מחליפים תמונות ברקע */
  active?: boolean;
  /** מוסיף מקור ריק למכשיר השני (בחזית האתר). בתצוגה המקדימה — כבוי */
  guard?: boolean;
}) {
  const count = slides.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [mounted, setMounted] = useState<Set<number>>(() => new Set([0]));
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const pointerStart = useRef<number | null>(null);

  // רשימה שהתקצרה (למשל בתצוגה המקדימה אחרי מחיקה) — לא נשארים על אינדקס שלא קיים
  const current = count === 0 ? 0 : Math.min(index, count - 1);

  useEffect(() => {
    setMounted((previous) => {
      const next = (current + 1) % Math.max(count, 1);
      if (previous.has(current) && previous.has(next)) return previous;
      return new Set([...previous, current, next]);
    });
  }, [current, count]);

  const autoplay = active && count > 1 && !paused && !hovering && !reducedMotion;
  useEffect(() => {
    if (!autoplay) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setIndex((value) => (value + 1) % count);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [autoplay, count, current]);

  if (count === 0) return null;

  const go = (target: number) => setIndex(((target % count) + count) % count);

  return (
    <section
      aria-roledescription="carousel"
      aria-label={label}
      className="relative overflow-hidden rounded-xl border border-border bg-secondary"
      style={{ aspectRatio: aspectFor(slides, device) }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocusCapture={() => setHovering(true)}
      onBlurCapture={() => setHovering(false)}
      onPointerDown={(event) => {
        pointerStart.current = event.clientX;
      }}
      onPointerUp={(event) => {
        if (pointerStart.current === null || count < 2) return;
        const delta = event.clientX - pointerStart.current;
        pointerStart.current = null;
        // מימין לשמאל: החלקה ימינה = התמונה הבאה
        if (delta > SWIPE_THRESHOLD) go(current + 1);
        else if (delta < -SWIPE_THRESHOLD) go(current - 1);
      }}
    >
      {slides.map((slide, slideIndex) => {
        if (!mounted.has(slideIndex)) return null;
        const visible = slideIndex === current;
        const image = (
          <SlideImage
            slide={slide}
            device={device}
            guard={guard}
            eager={slideIndex === 0}
            playing={visible && !reducedMotion}
          />
        );
        // הגנה כפולה: גם אם נכנס למסד קישור לא תקין, הוא לא הופך ללחיץ
        const link = slide.link_url && isValidBannerLink(slide.link_url) ? slide.link_url : null;
        const external = link ? /^https?:\/\//i.test(link) : false;
        return (
          <div
            key={slide.key}
            role="group"
            aria-roledescription="slide"
            aria-label={`${slideIndex + 1} מתוך ${count}`}
            aria-hidden={!visible}
            className="absolute inset-0 transition-opacity duration-700 ease-out motion-reduce:transition-none"
            style={{ opacity: visible ? 1 : 0, pointerEvents: visible ? "auto" : "none" }}
          >
            {link ? (
              <a
                href={link}
                tabIndex={visible ? 0 : -1}
                target={external ? "_blank" : undefined}
                rel={external ? "noopener noreferrer" : undefined}
                className="block size-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                draggable={false}
              >
                {image}
              </a>
            ) : (
              image
            )}
          </div>
        );
      })}

      {count > 1 && (
        <>
          {device === "desktop" && (
            <>
              <button
                type="button"
                onClick={() => go(current - 1)}
                aria-label="התמונה הקודמת"
                className="absolute right-3 top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur-sm hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:flex"
              >
                <ChevronRight className="size-5" />
              </button>
              <button
                type="button"
                onClick={() => go(current + 1)}
                aria-label="התמונה הבאה"
                className="absolute left-3 top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm backdrop-blur-sm hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:flex"
              >
                <ChevronLeft className="size-5" />
              </button>
            </>
          )}

          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 bg-gradient-to-t from-black/35 to-transparent px-3 pb-2.5 pt-6">
            <div className="flex items-center gap-1.5">
              {slides.map((slide, dotIndex) => (
                <button
                  key={slide.key}
                  type="button"
                  onClick={() => go(dotIndex)}
                  aria-label={`מעבר לתמונה ${dotIndex + 1}`}
                  aria-current={dotIndex === current}
                  className={`h-2 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    dotIndex === current ? "w-6 bg-accent" : "w-2 bg-white/70 hover:bg-white"
                  }`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPaused((value) => !value)}
              aria-label={paused ? "הפעלת החלפה אוטומטית" : "עצירת החלפה אוטומטית"}
              className="absolute left-2 bottom-1.5 flex size-8 items-center justify-center rounded-full text-white/90 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function SlideImage({
  slide,
  device,
  guard,
  eager,
  playing,
}: {
  slide: BannerSlide;
  device: BannerDevice;
  guard: boolean;
  eager: boolean;
  /** הבאנר מוצג עכשיו — רק אז סרטון מתנגן */
  playing: boolean;
}) {
  const src = device === "desktop" ? slide.desktop_image_url : slide.mobile_image_url;
  if (!src) return null;
  if (bannerMediaKind(src) === "video") {
    return (
      <SlideVideo
        src={src}
        label={slide.alt_text}
        device={device}
        guard={guard}
        playing={playing}
      />
    );
  }
  const image = (
    <img
      src={src}
      alt={slide.alt_text}
      className="size-full select-none object-cover"
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      fetchPriority={eager ? "high" : "auto"}
    />
  );
  if (!guard) return image;
  return (
    <picture className="block size-full">
      <source media={device === "desktop" ? MOBILE_QUERY : DESKTOP_QUERY} srcSet={BLANK_IMAGE} />
      {image}
    </picture>
  );
}

/**
 * באנר וידאו: בלי קול (דפדפנים מאפשרים ניגון אוטומטי רק כך), בלולאה, ומתנגן רק
 * כשהבאנר מוצג. במכשיר הלא נכון (סרטון מחשב בטלפון) הקובץ לא נטען בכלל.
 */
function SlideVideo({
  src,
  label,
  device,
  guard,
  playing,
}: {
  src: string;
  label: string;
  device: BannerDevice;
  guard: boolean;
  playing: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const onDevice = useMediaQuery(device === "desktop" ? DESKTOP_QUERY : MOBILE_QUERY);
  const show = !guard || onDevice;
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = true;
    if (playing) {
      video.currentTime = 0;
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [playing, show]);
  if (!show) return null;
  return (
    <video
      ref={ref}
      src={src}
      aria-label={label || undefined}
      className="size-full select-none object-cover"
      muted
      loop
      playsInline
      autoPlay={playing}
      preload={playing ? "auto" : "metadata"}
      disablePictureInPicture
    />
  );
}
