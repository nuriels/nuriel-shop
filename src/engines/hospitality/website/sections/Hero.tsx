// הפתיח של עמוד הבית — ארבע פריסות לפי הערכה:
//   overlay (יוקרה): תמונה במסך מלא, טקסט למטה; split (טבע): טקסט ותמונה זה לצד זה;
//   editorial (מודרני): כותרת גדולה ותמונה רחבה מתחתיה; centered (רומנטי): טקסט במרכז התמונה.
// התוכן מהעורך (כותרת, משפט, תמונה, כהות, טקסט הכפתור), וברירות מחדל מנתוני העסק.
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/platform/ui";
import type { PublicMedia } from "../../types/website";
import type { Section } from "../design/schema";
import { HeroVideo } from "../components/HeroVideo";
import { Photo } from "../components/Photo";
import { useCopy } from "../copy";
import { firstSentence } from "../lib/format";
import { heroImage, mediaById, videoById } from "../lib/media";
import { useSite } from "../lib/site-context";
import { Editable } from "../components/Editable";

const SHADE: Record<string, string> = {
  light: "opacity-60",
  medium: "opacity-100",
  strong: "opacity-100",
};

export function Hero({ section }: { section?: Section | undefined }) {
  const t = useCopy();
  const { site, theme, design } = useSite();
  const c = section?.content ?? {};
  const image = mediaById(site, c.image) ?? heroImage(site, design.logo);
  // סרטון (עד 15 שניות שהשרת מדד): רק קובץ שהועלה, לא הטמעה — הסרטון, ואחריו התמונה 5 שניות (HeroVideo)
  const video = videoById(site, c.video);
  const property = site.properties[0];
  const kind = property?.property_type ? t.propertyTypes[property.property_type] : "";
  const area = site.business.address?.split(",").slice(-1)[0]?.trim() || property?.address || "";
  const eyebrow = c.eyebrow ?? [kind, area].filter(Boolean).join(" · ");
  const title = c.title ?? site.business.name;
  const subtitle =
    c.subtitle ?? (property?.description ? firstSentence(property.description) : undefined);
  const overlay = c.overlay ?? "medium";
  const variant = theme.layout.hero;

  const actions = (light: boolean) => <HeroActions light={light} button={c.button} />;

  if (variant === "split")
    return (
      <section className="bg-[var(--site-sand)] pt-20 sm:pt-24">
        <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-10 sm:px-8 lg:grid-cols-2 lg:gap-14 lg:py-16">
          <div className="order-2 lg:order-1">
            {eyebrow && (
              <p className="mb-4 text-sm text-[var(--site-gold-ink)]">
                <Editable section={section?.id} field="eyebrow" value={eyebrow} />
              </p>
            )}
            <h1 className="font-display text-4xl leading-tight text-balance sm:text-6xl">
              <Editable section={section?.id} field="title" value={title} />
            </h1>
            {subtitle && (
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
                <Editable section={section?.id} field="subtitle" value={subtitle} />
              </p>
            )}
            <div className="mt-8">{actions(false)}</div>
          </div>
          <FramedMedia
            image={image}
            video={video}
            alt={title}
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="order-1 aspect-[4/3] rounded-[var(--radius)] shadow-[var(--site-shadow)] lg:order-2 lg:aspect-[5/6]"
          />
        </div>
      </section>
    );

  if (variant === "editorial")
    return (
      <section className="bg-background pt-24 sm:pt-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          <div className="grid gap-6 border-b border-foreground pb-8 lg:grid-cols-[1.4fr_1fr] lg:items-end">
            <div>
              {eyebrow && (
                <p className="mb-3 text-sm text-[var(--site-gold-ink)]">
                  <Editable section={section?.id} field="eyebrow" value={eyebrow} />
                </p>
              )}
              <h1 className="font-display text-5xl leading-[0.95] text-balance sm:text-7xl lg:text-8xl">
                <Editable section={section?.id} field="title" value={title} />
              </h1>
            </div>
            <div>
              {subtitle && (
                <p className="text-lg leading-relaxed text-muted-foreground">
                  <Editable section={section?.id} field="subtitle" value={subtitle} />
                </p>
              )}
              <div className="mt-6">{actions(false)}</div>
            </div>
          </div>
          <FramedMedia
            image={image}
            video={video}
            alt={title}
            sizes="100vw"
            className="mt-8 aspect-[16/10] sm:aspect-[21/9]"
          />
        </div>
      </section>
    );

  const centered = variant === "centered";
  return (
    <section
      className={cn(
        "relative isolate flex min-h-[88svh] overflow-hidden text-white sm:min-h-[92svh]",
        centered ? "items-center justify-center text-center" : "items-end",
      )}
    >
      <Photo
        media={image}
        alt={title}
        priority
        sizes="100vw"
        placeholderTone="dark"
        className="absolute inset-0 -z-10 h-full w-full"
        imgClassName="scale-[1.02]"
      />
      {video && (
        <HeroVideo
          video={video}
          className="absolute inset-0 -z-10 h-full w-full"
          buttonClassName={centered ? undefined : "bottom-5 sm:bottom-6"}
        />
      )}
      <div
        aria-hidden="true"
        className={cn("absolute inset-0 -z-10 bg-[image:var(--site-hero-shade)]", SHADE[overlay])}
      />
      {overlay === "strong" && (
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-black/25" />
      )}
      <div
        className={cn(
          "mx-auto w-full max-w-7xl px-4 pt-28 sm:px-8",
          centered ? "max-w-3xl pb-20" : "pb-14 sm:pb-20",
        )}
      >
        {eyebrow && (
          <p className="mb-4 text-xs font-medium text-white/85 sm:text-sm">
            <Editable section={section?.id} field="eyebrow" value={eyebrow} />
          </p>
        )}
        <h1
          className={cn(
            "font-display text-5xl leading-[1.05] text-balance sm:text-7xl lg:text-8xl",
            !centered && "max-w-4xl",
          )}
        >
          <Editable section={section?.id} field="title" value={title} />
        </h1>
        {subtitle && (
          <p
            className={cn(
              "mt-6 text-base leading-relaxed text-white/85 sm:text-lg",
              centered ? "mx-auto max-w-xl" : "max-w-xl",
            )}
          >
            <Editable section={section?.id} field="subtitle" value={subtitle} />
          </p>
        )}
        <div className={cn("mt-9", centered && "flex justify-center")}>{actions(true)}</div>
      </div>
      {!centered && (
        <ScrollHint label={t.hero.scroll}>
          <ChevronDown className="size-7 motion-safe:animate-bounce" aria-hidden="true" />
        </ScrollHint>
      )}
    </section>
  );
}

function ScrollHint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Link
      to="/stay"
      hash="about"
      aria-label={label}
      className="absolute bottom-5 left-1/2 hidden -translate-x-1/2 text-white/70 transition-colors hover:text-white sm:block"
    >
      {children}
    </Link>
  );
}

/** הכפתורים: הזמנה (כשההזמנות פתוחות), יחידות, יצירת קשר */
function HeroActions({ light, button }: { light: boolean; button?: string | undefined }) {
  const t = useCopy();
  const { site } = useSite();
  const solid = light
    ? "bg-white text-[var(--site-deep)] hover:bg-white/90"
    : "bg-primary text-primary-foreground hover:opacity-90";
  const ghost = light
    ? "border border-white/60 backdrop-blur-[2px] hover:bg-white/10"
    : "border border-foreground/25 hover:bg-foreground/5";
  const base =
    "inline-flex h-12 items-center justify-center rounded-[var(--site-button-radius,0.5rem)] px-8 text-base transition-colors";
  return (
    <div className="flex flex-wrap items-center gap-3">
      {site.booking_open && (
        <Link to="/stay/book" className={cn(base, "font-medium", solid)}>
          {button ?? t.hero.book}
        </Link>
      )}
      <Link
        to="/stay"
        hash="units"
        className={cn(base, site.booking_open ? ghost : cn("font-medium", solid))}
      >
        {t.hero.cta}
      </Link>
      {!site.booking_open && (
        <Link to="/stay" hash="contact" className={cn(base, ghost)}>
          {t.hero.contact}
        </Link>
      )}
    </div>
  );
}

/** תמונה ממוסגרת (פריסות "טבע" ו"מודרני") — ועם סרטון: הסרטון באותה מסגרת, מעל התמונה */
function FramedMedia({
  image,
  video,
  alt,
  sizes,
  className,
}: {
  image: PublicMedia | null | undefined;
  video: PublicMedia | null;
  alt: string;
  sizes: string;
  className: string;
}) {
  if (!video)
    return <Photo framed media={image} alt={alt} priority sizes={sizes} className={className} />;
  return (
    <div className={cn("relative overflow-hidden", className)}>
      <Photo
        framed
        media={image}
        alt={alt}
        priority
        sizes={sizes}
        className="absolute inset-0 h-full w-full"
      />
      <HeroVideo video={video} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
