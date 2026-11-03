import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { NURIEL_BUSINESS, whatsappHref } from "@/lib/portal-landing";
import { EXTERNAL } from "./styles";

/** אבני הבניין של דף הנחיתה: הסימן של נוריאל, מסגרות לצילומי המסך האמיתיים, כותרות ו-WhatsApp */
/** הטקסט הנסתר שמסביר לקורא מסך שהקישור נפתח בחלון חדש */
export function NewTabNote() {
  return <span className="sr-only"> (נפתח בחלון חדש)</span>;
}

// ------------------------------------------------------------
// הלוגו של נוריאל מחשבים — הקובץ המקורי (public/brand), בלי שינוי צורה
// ------------------------------------------------------------

/** הטקסט שבתוך הלוגו — לתיאור התמונה (קוראי מסך, ומנועי חיפוש) */
const LOGO_ALT = "הלוגו של נוריאל מחשבים: מחשבים, תיקונים, שדרוגים, בניית אתרים";

/**
 * הלוגו — הקובץ המקורי שהעסק מסר (public/brand/nuriel-computers-logo-original.png), מוקטן
 * פרופורציונלית בלבד ל-WebP (96/192/384). הלוגו עגול על רקע לבן: עיגול התצוגה עובר בשוליים
 * הלבנים שמחוץ לטבעת — כך על רקע כחול הוא נראה כתג לבן, בלי לגעת בלוגו עצמו.
 */
export function BrandLogo({
  className,
  sizes,
  label = LOGO_ALT,
  eager = false,
}: {
  className?: string;
  /** sizes של srcset — הגודל בפועל, למשל "64px" */
  sizes: string;
  /** הטקסט החלופי (ברירת מחדל — הטקסט שבתוך הלוגו) */
  label?: string;
  eager?: boolean;
}) {
  return (
    <img
      src="/brand/nuriel-computers-logo-192.webp"
      srcSet={[96, 192, 384].map((w) => `/brand/nuriel-computers-logo-${w}.webp ${w}w`).join(", ")}
      sizes={sizes}
      width={384}
      height={384}
      alt={label}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={cn("aspect-square shrink-0 rounded-full bg-white object-contain", className)}
      data-testid="brand-logo"
    />
  );
}

/**
 * הסימן בכותרת ובפוטר — הלוגו המקורי בלבד, במקום שם העסק בטקסט (השם כתוב בתוך הלוגו). בכותרת
 * הלוגו הוא קישור לראש הדף, ולכן הטקסט החלופי הוא שם העסק; בפוטר — הטקסט שבתוך הלוגו.
 */
export function BrandMark({ tone = "dark" }: { tone?: "dark" | "light" }) {
  return tone === "dark" ? (
    <BrandLogo
      label={NURIEL_BUSINESS.name}
      eager
      sizes="(min-width: 640px) 64px, 52px"
      className="size-13 sm:size-16"
    />
  ) : (
    <BrandLogo sizes="112px" className="size-28" />
  );
}

/**
 * טבעת המותג — אותה טבעת כמו בלוגו (תכלת → כחול → כחול עמוק), דקה ושקופה למחצה, מאחורי צילומי
 * המסך בפתיחה. קישוט בלבד.
 */
export function BrandRing({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true" focusable="false" className={className}>
      <defs>
        <linearGradient id="landing-ring" x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#00aefe" />
          <stop offset="0.5" stopColor="#005ada" />
          <stop offset="1" stopColor="#001687" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="96" fill="none" stroke="url(#landing-ring)" strokeWidth="2.5" />
    </svg>
  );
}

// ------------------------------------------------------------
// צילומי מסך אמיתיים (public/landing — WebP בשני גדלים)
// ------------------------------------------------------------

type ShotKind = "desktop" | "phone";

const SHOT_SIZES: Record<ShotKind, { widths: [number, number]; width: number; height: number }> = {
  desktop: { widths: [720, 1280], width: 1280, height: 800 },
  phone: { widths: [390, 780], width: 390, height: 844 },
};

export function Shot({
  name,
  kind,
  alt,
  sizes,
  eager = false,
}: {
  name: string;
  kind: ShotKind;
  alt: string;
  /** sizes של srcset — כמה רוחב התמונה תופסת בפועל */
  sizes: string;
  eager?: boolean;
}) {
  const spec = SHOT_SIZES[kind];
  return (
    <img
      src={`/landing/${name}-${spec.widths[0]}.webp`}
      srcSet={spec.widths.map((w) => `/landing/${name}-${w}.webp ${w}w`).join(", ")}
      sizes={sizes}
      width={spec.width}
      height={spec.height}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={eager ? "high" : undefined}
      className="block h-auto w-full"
    />
  );
}

/** מסגרת דפדפן סביב צילום מסך של מחשב — הכתובת בשורה העליונה כמו בדפדפן אמיתי */
export function BrowserFrame({
  address,
  children,
  className,
}: {
  address: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl bg-white shadow-[0_22px_50px_-24px_rgba(11,23,52,0.55)]",
        className,
      )}
    >
      <div className="flex items-center gap-3 bg-[#e9edf5] px-3 py-2" aria-hidden="true">
        <span className="flex gap-1.5" dir="ltr">
          <span className="size-2.5 rounded-full bg-[#ec6a5e]" />
          <span className="size-2.5 rounded-full bg-[#f4bf4f]" />
          <span className="size-2.5 rounded-full bg-[#61c554]" />
        </span>
        <span
          dir="ltr"
          className="mx-auto min-w-0 truncate rounded-md bg-white px-3 py-0.5 text-[11px] text-[#4a5672]"
        >
          {address}
        </span>
      </div>
      {children}
    </div>
  );
}

/** מסגרת טלפון סביב צילום מסך של נייד */
export function PhoneFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[1.6rem] border-[5px] border-(--l-ink) bg-(--l-ink) shadow-[0_18px_40px_-18px_rgba(11,23,52,0.6)]",
        className,
      )}
    >
      <div className="overflow-hidden rounded-[1.15rem]">{children}</div>
    </div>
  );
}

// ------------------------------------------------------------
// כותרות ורשימות
// ------------------------------------------------------------

export function SectionHeading({
  id,
  title,
  lead,
  tone = "dark",
  className,
}: {
  id: string;
  title: ReactNode;
  lead?: ReactNode;
  tone?: "dark" | "light";
  className?: string;
}) {
  return (
    <div className={cn("max-w-3xl", className)}>
      <h2
        id={id}
        className={cn(
          "text-[clamp(1.85rem,1.2rem+2.2vw,2.75rem)] font-extrabold leading-[1.15] tracking-[-0.01em] text-balance",
          tone === "dark" ? "text-(--l-ink)" : "text-white",
        )}
      >
        {title}
      </h2>
      {lead && (
        <p
          className={cn(
            "mt-4 text-[1.0625rem] leading-[1.75] text-pretty",
            tone === "dark" ? "text-(--l-muted)" : "text-(--l-on-navy)",
          )}
        >
          {lead}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// WhatsApp
// ------------------------------------------------------------

/** הסמל של WhatsApp (לקישור לשיחה — שימוש מקובל בסימן) */
export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
      <path
        fill="currentColor"
        d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21c5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2Zm0 18.15c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 4.54 0 8.24 3.7 8.24 8.24 0 4.55-3.7 8.24-8.24 8.24Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.81-.78.97-.14.17-.29.19-.54.07-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.43-.06-.13-.56-1.35-.77-1.85-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28Z"
      />
    </svg>
  );
}

/**
 * כפתור WhatsApp צף — בצד שמאל למטה (כפתור הנגישות של האתר בצד ימין). יעד אמיתי: wa.me עם
 * המספר של נוריאל מחשבים והודעה פותחת.
 */
export function WhatsAppFloat() {
  return (
    <a
      href={whatsappHref()}
      {...EXTERNAL}
      data-testid="whatsapp-float"
      aria-label={`WhatsApp — שיחה עם ${NURIEL_BUSINESS.name} (נפתח בחלון חדש)`}
      className="fixed bottom-4 left-4 z-50 inline-flex min-h-14 items-center gap-2 rounded-full bg-[#0f7d6f] px-4 font-semibold text-white shadow-[0_10px_24px_-10px_rgba(11,23,52,0.7)] transition-colors hover:bg-[#0b675b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--l-ink) focus-visible:ring-offset-2 print:hidden"
    >
      <WhatsAppIcon className="size-7" />
      <span className="hidden sm:inline">WhatsApp</span>
    </a>
  );
}
