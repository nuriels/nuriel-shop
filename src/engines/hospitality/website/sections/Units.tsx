// היחידות: כרטיס לכל יחידה פעילה — תמונה, סוג, אורחים / חדרים / מיטות, "החל מ-" ומינימום לילות.
// ארבעה סגנונות כרטיס לפי הערכה (portrait / landscape / minimal / soft). "כל המתחם" מוצג כיחידה.
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/platform/ui";
import type { PublicUnit } from "../../types/website";
import type { Section } from "../design/schema";
import { Photo } from "../components/Photo";
import { PriceFrom } from "../components/PriceFrom";
import { SectionHeading } from "../components/SectionHeading";
import { useCopy } from "../copy";
import { bedsText, unitFacts } from "../lib/format";
import { unitCover } from "../lib/media";
import { useSite } from "../lib/site-context";

export function Units({
  exclude,
  title,
  section,
}: {
  exclude?: string;
  title?: string;
  section?: Section | undefined;
}) {
  const t = useCopy();
  const { site, theme } = useSite();
  const c = section?.content ?? {};
  const units = site.units.filter((u) => u.id !== exclude);
  if (exclude && units.length === 0) return null;
  const variant = theme.layout.unitCards;
  return (
    <section
      id={exclude ? undefined : "units"}
      aria-labelledby={exclude ? "more-units-title" : "units-title"}
      className={cn(
        "scroll-mt-24",
        variant === "minimal" ? "bg-background" : "bg-[var(--site-sand)]",
      )}
    >
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 sm:py-28">
        <SectionHeading
          id={exclude ? "more-units-title" : "units-title"}
          eyebrow={c.eyebrow ?? t.nav.units}
          title={title ?? c.title ?? t.units.title}
          subtitle={exclude ? undefined : (c.subtitle ?? t.units.subtitle)}
        />
        {units.length === 0 ? (
          <p className="mt-12 text-center text-muted-foreground">{t.units.none}</p>
        ) : (
          <ul
            className={cn(
              "mt-14 grid gap-8",
              variant === "landscape"
                ? "lg:grid-cols-2"
                : units.length === 1
                  ? "mx-auto max-w-xl"
                  : "sm:grid-cols-2 lg:grid-cols-3",
            )}
          >
            {units.map((u) => (
              <li key={u.id}>
                <UnitCard unit={u} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function UnitCard({ unit }: { unit: PublicUnit }) {
  const t = useCopy();
  const { site, theme } = useSite();
  const variant = theme.layout.unitCards;
  const type =
    unit.kind === "whole_property"
      ? t.units.wholeProperty
      : unit.unit_type
        ? t.unitTypes[unit.unit_type]
        : "";
  const beds = bedsText(unit.beds, t);
  const landscape = variant === "landscape";
  const minimal = variant === "minimal";
  const soft = variant === "soft";
  return (
    <Link
      to="/stay/units/$unitSlug"
      params={{ unitSlug: unit.slug }}
      className={cn(
        "group block h-full overflow-hidden transition-transform duration-500 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
        minimal
          ? ""
          : "rounded-[var(--radius)] bg-card shadow-[var(--site-shadow)] hover:-translate-y-1",
        landscape && "sm:grid sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]",
        soft && "text-center",
      )}
    >
      <Photo
        media={unitCover(unit, site)}
        alt={unit.name}
        sizes={
          landscape
            ? "(min-width: 1024px) 28vw, (min-width: 640px) 50vw, 100vw"
            : "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
        }
        className={cn(
          landscape
            ? "aspect-[4/3] sm:aspect-auto sm:h-full"
            : minimal
              ? "aspect-[3/2]"
              : "aspect-[4/3]",
          soft && "m-3 rounded-[calc(var(--radius)-0.25rem)]",
        )}
        imgClassName="transition-transform duration-700 group-hover:scale-[1.04]"
      />
      <div className={cn("flex flex-col gap-3", minimal ? "pt-5" : "px-6 pt-6 pb-7")}>
        {type && <p className="text-xs font-medium text-[var(--site-gold-ink)]">{type}</p>}
        <h3 className="font-display text-2xl leading-snug">{unit.name}</h3>
        <p className="text-sm text-muted-foreground">{unitFacts(unit, t).join(" · ")}</p>
        {beds && <p className="text-sm text-muted-foreground">{beds}</p>}
        <div
          className={cn(
            "mt-2 flex items-end justify-between gap-4 border-t border-border pt-4",
            soft && "flex-col items-center",
          )}
        >
          <p>
            <PriceFrom price={unit.base_price} currency={site.business.currency} />
            {unit.min_nights > 1 && (
              <span className="block text-xs text-muted-foreground">
                {t.facts.minNights(unit.min_nights)}
              </span>
            )}
          </p>
          <span className="inline-flex items-center gap-1 text-sm font-medium whitespace-nowrap text-foreground">
            {t.units.details}
            <ArrowLeft
              className="size-4 transition-transform group-hover:-translate-x-1"
              aria-hidden="true"
            />
          </span>
        </div>
      </div>
    </Link>
  );
}
