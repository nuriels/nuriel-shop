// מתקנים ושירותים: של המתחם (משותפים) ושל היחידות (איחוד, בלי כפילויות), לפי קבוצה.
import { AmenityIcon } from "../../management/details/AmenityIcon";
import type { PublicAmenity } from "../../types/website";
import { SectionHeading } from "../components/SectionHeading";
import { useCopy } from "../copy";
import { useSite } from "../lib/site-context";
import type { Section } from "../design/schema";
import { uniqueAmenities } from "../lib/media";
import { Editable } from "../components/Editable";

const ORDER = ["room", "kitchen", "pool_spa", "outdoor", "services", "accessibility", "other"];

export function Amenities({ section }: { section?: Section | undefined }) {
  const t = useCopy();
  const { site } = useSite();
  const c = section?.content ?? {};
  const all = uniqueAmenities([
    ...site.properties.flatMap((p) => p.amenities),
    ...site.units.flatMap((u) => u.amenities),
  ]);
  if (all.length === 0) return null;
  return (
    <section
      id="amenities"
      aria-labelledby="amenities-title"
      className="scroll-mt-24 bg-[var(--site-deep)] text-[var(--site-deep-foreground)]"
    >
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-3 text-xs font-medium tracking-[0.06em] text-[var(--site-gold)]">
            <Editable
              section={section?.id}
              field="eyebrow"
              value={c.eyebrow ?? t.amenities.title}
            />
          </p>
          <h2
            id="amenities-title"
            className="font-display text-3xl leading-tight font-medium sm:text-4xl"
          >
            <Editable section={section?.id} field="title" value={c.title ?? t.amenities.subtitle} />
          </h2>
          <span aria-hidden="true" className="mx-auto mt-6 block h-px w-14 bg-[var(--site-gold)]" />
        </div>
        <AmenityGroups items={all} dark className="mt-14" />
      </div>
    </section>
  );
}

export function AmenityGroups({
  items,
  dark = false,
  className,
}: {
  items: PublicAmenity[];
  dark?: boolean;
  className?: string;
}) {
  const t = useCopy();
  const groups = ORDER.map((c) => ({
    key: c,
    items: items.filter(
      (a) => (a.category ?? "other") === c || (c === "other" && !ORDER.includes(a.category ?? "")),
    ),
  })).filter((g) => g.items.length > 0);
  return (
    <div className={className}>
      <div className="grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <div key={g.key}>
            <h3
              className={
                dark
                  ? "mb-4 text-sm tracking-[0.06em] text-[var(--site-gold)]"
                  : "mb-4 text-sm tracking-[0.06em] text-[var(--site-gold-ink)]"
              }
            >
              {t.amenities.categories[g.key] ?? g.key}
            </h3>
            <ul className="space-y-3">
              {g.items.map((a) => (
                <li key={a.name} className="flex items-start gap-3">
                  <AmenityIcon
                    name={a.icon}
                    className={
                      dark
                        ? "mt-0.5 size-5 shrink-0 text-[var(--site-gold)]"
                        : "mt-0.5 size-5 shrink-0 text-[var(--site-gold-ink)]"
                    }
                  />
                  <span>
                    {a.name}
                    {a.note && (
                      <span
                        className={
                          dark ? "block text-sm opacity-70" : "block text-sm text-muted-foreground"
                        }
                      >
                        {a.note}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
