// היחידות: כרטיס לכל יחידה פעילה — תמונה, סוג, אורחים / חדרים / מיטות, "החל מ-" ומינימום לילות.
// "כל המתחם" מוצג כיחידה (עם רשימת היחידות שהוא כולל). סוגי חדרים — בהמשך (יחידה = חדר).
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { PublicUnit } from "../../types/website";
import { Photo } from "../components/Photo";
import { PriceFrom } from "../components/PriceFrom";
import { SectionHeading } from "../components/SectionHeading";
import { useCopy } from "../copy";
import { bedsText, unitFacts } from "../lib/format";
import { unitCover } from "../lib/media";
import { useSite } from "../lib/site-context";

export function Units({ exclude, title }: { exclude?: string; title?: string }) {
  const t = useCopy();
  const { site } = useSite();
  const units = site.units.filter((u) => u.id !== exclude);
  if (exclude && units.length === 0) return null;
  return (
    <section
      id={exclude ? undefined : "units"}
      aria-labelledby={exclude ? "more-units-title" : "units-title"}
      className="scroll-mt-24 bg-[var(--site-sand)]"
    >
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 sm:py-28">
        <SectionHeading
          id={exclude ? "more-units-title" : "units-title"}
          eyebrow={t.nav.units}
          title={title ?? t.units.title}
          subtitle={exclude ? undefined : t.units.subtitle}
        />
        {units.length === 0 ? (
          <p className="mt-12 text-center text-muted-foreground">{t.units.none}</p>
        ) : (
          <ul
            className={
              units.length === 1
                ? "mx-auto mt-14 grid max-w-xl gap-8"
                : "mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3"
            }
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
  const { site } = useSite();
  const type =
    unit.kind === "whole_property"
      ? t.units.wholeProperty
      : unit.unit_type
        ? t.unitTypes[unit.unit_type]
        : "";
  const beds = bedsText(unit.beds, t);
  return (
    <Link
      to="/stay/units/$unitSlug"
      params={{ unitSlug: unit.slug }}
      className="group block h-full overflow-hidden rounded-[var(--radius)] bg-card shadow-[var(--site-shadow)] transition-transform duration-500 hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      <Photo
        media={unitCover(unit, site)}
        alt={unit.name}
        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
        className="aspect-[4/3]"
        imgClassName="transition-transform duration-700 group-hover:scale-[1.04]"
      />
      <div className="flex flex-col gap-3 px-6 pt-6 pb-7">
        {type && (
          <p className="text-xs font-medium tracking-[0.06em] text-[var(--site-gold-ink)]">
            {type}
          </p>
        )}
        <h3 className="font-display text-2xl leading-snug font-medium">{unit.name}</h3>
        <p className="text-sm text-muted-foreground">{unitFacts(unit, t).join(" · ")}</p>
        {beds && <p className="text-sm text-muted-foreground">{beds}</p>}
        <div className="mt-2 flex items-end justify-between gap-4 border-t border-border pt-4">
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
