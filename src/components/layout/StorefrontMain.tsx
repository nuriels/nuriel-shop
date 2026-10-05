import type { MouseEvent, ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { cn } from "@/lib/utils";

type SideBanner = { imageUrl: string; link: string | null };

/** הבאנר הצדדי מהגדרות האתר — רק כשהוא פעיל ויש לו תמונה */
function useSideBanner(): SideBanner | null {
  const { settings } = useSiteSettings();
  if (!settings?.desktop_banner_active || !settings.desktop_banner_image_url) return null;
  return {
    imageUrl: settings.desktop_banner_image_url,
    link: settings.desktop_banner_link,
  };
}

/** קישור פנימי באתר ("/…", לא "//…") — מעבר בתוך האפליקציה, בלי טעינה מחדש */
const isInternal = (link: string) => link.startsWith("/") && !link.startsWith("//");

/**
 * הבאנר הצדדי (חלק 19): בעמודה השמאלית, "דביק" — נשאר במקום בזמן הגלילה
 * (מתחת לכותרת האתר). מוצג רק במסכים גדולים (lg ומעלה); בנייד ובטאבלט
 * לא מוצג בכלל (hidden), כדי לא להעמיס על המסך הקטן.
 */
function DesktopSideBanner({ banner }: { banner: SideBanner }) {
  const router = useRouter();
  const image = (
    <img
      src={banner.imageUrl}
      alt="באנר פרסומי"
      loading="lazy"
      className="block h-auto w-full rounded-xl border border-border/60 bg-card object-contain shadow-soft"
    />
  );
  const link = banner.link;
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!link || !isInternal(link)) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    void router.navigate({ href: link });
  };
  return (
    // self-stretch: העמודה בגובה כל התוכן, כדי שלבאנר ה"דביק" יהיה לאן לזוז בגלילה
    <aside aria-label="פרסום" className="hidden lg:block lg:self-stretch" data-desktop-side-banner>
      <div className="sticky top-[calc(var(--site-header-h,4.5rem)+1rem)]">
        {link ? (
          <a
            href={link}
            onClick={onClick}
            className="block rounded-xl transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            {...(isInternal(link) ? {} : { target: "_blank", rel: "noopener noreferrer" })}
          >
            {image}
          </a>
        ) : (
          image
        )}
      </div>
    </aside>
  );
}

/**
 * ה-<main> של חזית החנות (קטלוג, עמוד מוצר). כשהבאנר הצדדי פעיל — במסכים
 * גדולים התוכן והבאנר יושבים ב-Grid: התוכן מימין (RTL — העמודה הראשונה),
 * והבאנר בעמודה צרה משמאל, בשטח שהיה ריק. המסגרת מתרחבת ברוחב הבאנר, כך
 * שהתוכן לא נדחס. בלי באנר — בדיוק כמו קודם.
 *
 * className — ל-<main> (רווחים מלמעלה / למטה); contentClassName — לתוכן עצמו.
 */
export function StorefrontMain({
  children,
  className,
  contentClassName,
  width = "6xl",
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  /** רוחב התוכן בלי הבאנר (כמו קודם בכל עמוד) */
  width?: "5xl" | "6xl";
}) {
  const banner = useSideBanner();
  return (
    <main
      data-storefront-main
      data-has-side-banner={banner ? "true" : undefined}
      className={cn(
        "mx-auto w-full flex-1 px-3 sm:px-4",
        width === "5xl" ? "max-w-5xl" : "max-w-6xl",
        // + רוחב הבאנר (12rem) והרווח (1.5rem) — רק כשהוא מוצג
        banner &&
          (width === "5xl" ? "lg:max-w-[calc(64rem+13.5rem)]" : "lg:max-w-[calc(72rem+13.5rem)]"),
        className,
      )}
    >
      {banner ? (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_12rem] lg:items-start lg:gap-6">
          <div className={cn("min-w-0", contentClassName)}>{children}</div>
          <DesktopSideBanner banner={banner} />
        </div>
      ) : (
        <div className={contentClassName}>{children}</div>
      )}
    </main>
  );
}
