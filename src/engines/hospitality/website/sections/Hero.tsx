// הפתיח של עמוד הבית — ארבע פריסות לפי הערכה:
//   overlay (יוקרה): תמונה במסך מלא, טקסט למטה; split (טבע): טקסט ותמונה זה לצד זה;
//   editorial (מודרני): כותרת גדולה ותמונה רחבה מתחתיה; centered (רומנטי): טקסט במרכז התמונה.
// התוכן מהעורך (כותרת, משפט, תמונה, כהות, טקסט הכפתור), וברירות מחדל מנתוני העסק.
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/platform/ui";
import type { Section } from "../design/schema";
import { Photo } from "../components/Photo";
import { useCopy } from "../copy";
import { firstSentence } from "../lib/format";
import { heroImage, mediaById } from "../lib/media";
import { useSite } from "../lib/site-context";

const SHADE: Record<string, string> = {
  light: "opacity-60",
  medium: "opacity-100",
  strong: "opacity-100",
};

export function Hero({ section }: { section?: Section | undefined }) {
  const t = useCopy();
  const { site, theme } = useSite();
  const c = section?.content ?? {};
  const image = mediaById(site, c.image) ?? heroImage(site);
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
            {eyebrow && <p className="mb-4 text-sm text-[var(--site-gold-ink)]">{eyebrow}</p>}
            <h1 className="font-display text-4xl leading-tight text-balance sm:text-6xl">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
                {subtitle}
              </p>
            )}
            <div className="mt-8">{actions(false)}</div>
          </div>
          <Photo
            media={image}
            alt={title}
            priority
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
              {eyebrow && <p className="mb-3 text-sm text-[var(--site-gold-ink)]">{eyebrow}</p>}
              <h1 className="font-display text-5xl leading-[0.95] text-balance sm:text-7xl lg:text-8xl">
                {title}
              </h1>
            </div>
            <div>
              {subtitle && (
                <p className="text-lg leading-relaxed text-muted-foreground">{subtitle}</p>
              )}
              <div className="mt-6">{actions(false)}</div>
            </div>
          </div>
          <Photo
            media={image}
            alt={title}
            priority
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
        {eyebrow && <p className="mb-4 text-xs font-medium text-white/85 sm:text-sm">{eyebrow}</p>}
        <h1
          className={cn(
            "font-display text-5xl leading-[1.05] text-balance sm:text-7xl lg:text-8xl",
            !centered && "max-w-4xl",
          )}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            className={cn(
              "mt-6 text-base leading-relaxed text-white/85 sm:text-lg",
              centered ? "mx-auto max-w-xl" : "max-w-xl",
            )}
          >
            {subtitle}
          </p>
        )}
        <div className={cn("mt-9", centered && "flex justify-center")}>{actions(true)}</div>
      </div>
      {!centered && (
        <ScrollHint label={t.hero.scroll}>
          <ChevronDown className="size-7 animate-bounce" aria-hidden="true" />
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
    "inline-flex h-12 items-center justify-center rounded-[min(var(--radius),0.5rem)] px-8 text-base transition-colors";
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
