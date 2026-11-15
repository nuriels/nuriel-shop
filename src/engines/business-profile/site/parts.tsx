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
  return (
    <img
      src={item.url}
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
}

export function hasImage(image: ImageRef, media: Record<string, unknown>): boolean {
  return Boolean(image.media && media[image.media]);
}

export function SectionHead({
  id,
  eyebrow,
  title,
  intro,
  index,
}: {
  id: string;
  eyebrow?: LocalizedText;
  title: LocalizedText;
  intro?: LocalizedText;
  index?: number;
}) {
  const t = useT();
  const kicker = t(eyebrow);
  const heading = t(title);
  const lead = t(intro);
  if (!heading && !kicker) return null;
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
}: {
  href: string;
  label: LocalizedText;
  variant?: "primary" | "ghost";
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
      {text}
      {external && <span className="bps-sr"> (נפתח בחלון חדש)</span>}
    </a>
  );
}
