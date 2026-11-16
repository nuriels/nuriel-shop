// רכיבים קטנים שכל המקטעים משתמשים בהם: תמונה מספריית המדיה (או ממלא מקום בתצוגה מקדימה), כותרת מקטע
// וכפתור-קישור בטוח
import type { ReactNode } from "react";
import type { ImageRef, LocalizedText } from "../document/schema";
import { SAFE_LINK } from "../document/schema";
import { useSiteView, useT } from "./context";

export function SiteImage({
  image,
  className,
  sizes,
  eager = false,
  fallback,
}: {
  image: ImageRef;
  className?: string;
  sizes?: string;
  eager?: boolean;
  /** מה מוצג כשאין תמונה (בתצוגה המקדימה); באתר החי — כלום */
  fallback?: ReactNode;
}) {
  const { media, mode } = useSiteView();
  const t = useT();
  const item = image.media ? media[image.media] : undefined;
  if (!item) return mode === "preview" && fallback ? <>{fallback}</> : null;
  const alt = t(image.alt);
  const img = (
    <img
      src={item.url}
      srcSet={item.srcset ?? undefined}
      alt={alt}
      className={className}
      width={item.width ?? undefined}
      height={item.height ?? undefined}
      sizes={sizes}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      // תמונה בלי alt היא קישוט (קוראי מסך מדלגים)
      {...(alt ? {} : { role: "presentation" })}
    />
  );
  // AVIF (קטן יותר) לדפדפנים שתומכים; WebP לכל השאר
  return item.avif ? (
    <picture>
      <source type="image/avif" srcSet={item.avif} />
      {img}
    </picture>
  ) : (
    img
  );
}

export function hasImage(image: ImageRef, media: Record<string, unknown>): boolean {
  return Boolean(image.media && media[image.media]);
}

export function SectionHead({
  id,
  eyebrow,
  title,
  accent,
  intro,
  index,
  titleImage,
}: {
  id: string;
  eyebrow?: LocalizedText;
  title: LocalizedText;
  /** המשך הכותרת בצבע ההדגשה ("המומחיות" + "שלי") */
  accent?: LocalizedText;
  intro?: LocalizedText;
  index?: number;
  /** כותרת כתמונה: התמונה מוצגת, והכותרת הכתובה נשארת לקוראי מסך ולמנועי חיפוש */
  titleImage?: ImageRef;
}) {
  const t = useT();
  const { media } = useSiteView();
  const kicker = t(eyebrow);
  const heading = t(title);
  const tail = t(accent);
  const lead = t(intro);
  if (!heading && !kicker) return null;
  if (titleImage && hasImage(titleImage, media)) {
    return (
      <header className="bps-head bps-head-image">
        <h2 id={`${id}-title`} className="bps-sr">
          {heading}
        </h2>
        <SiteImage
          image={{ media: titleImage.media, alt: { he: "" } }}
          className="bps-title-image"
        />
      </header>
    );
  }
  return (
    <header className="bps-head">
      {(kicker || index !== undefined) && (
        <p className="bps-eyebrow">
          {index !== undefined && (
            <span className="bps-index">{String(index).padStart(2, "0")}</span>
          )}
          {kicker && <span>{kicker}</span>}
        </p>
      )}
      {heading && (
        <h2 id={`${id}-title`} className="bps-h2">
          {heading}
          {tail && (
            <>
              {" "}
              <span className="bps-h2-accent">{tail}</span>
            </>
          )}
        </h2>
      )}
      {lead && <p className="bps-lead">{lead}</p>}
    </header>
  );
}

/** קישור שנבדק (https / mailto / tel / עוגן / נתיב באתר); אחר — לא מוצג */
export function LinkButton({
  href,
  label,
  variant = "primary",
  icon,
}: {
  href: string;
  label: LocalizedText;
  variant?: "primary" | "ghost" | "outline" | "soft";
  icon?: "whatsapp" | "none";
}) {
  const t = useT();
  const text = t(label);
  if (!text || !href || !SAFE_LINK.test(href)) return null;
  const external = href.startsWith("https://");
  return (
    <a
      className={`bps-btn bps-btn-${variant}`}
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {icon === "whatsapp" && <WhatsappIcon size={16} />}
      {text}
      {external && <span className="bps-sr"> (נפתח בחלון חדש)</span>}
    </a>
  );
}

export function WhatsappIcon({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.3-.4.8-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.6 1.1 2.8c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"
      />
    </svg>
  );
}

/** כתובת תמונה לרקע (CSS) — רק מכתובת שנבדקה */
const CSS_URL = /^(https?:\/\/[^\s"'()\\<>]+|\/[^\s"'()\\<>]+)$/;
export function cssImage(url: string | undefined): string | undefined {
  return url && CSS_URL.test(url) ? `url("${url}")` : undefined;
}
