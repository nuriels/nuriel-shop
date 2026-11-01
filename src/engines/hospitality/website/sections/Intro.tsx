// "על המקום": התיאור של המתחם (או של כל מתחם, כשיש כמה) ועובדות מהירות — כניסה, יציאה,
// מספר היחידות, עד כמה אורחים, "החל מ-".
import { Clock, Home, Users } from "lucide-react";
import { useCopy } from "../copy";
import { money } from "../lib/format";
import { useSite } from "../lib/site-context";

export function Intro() {
  const t = useCopy();
  const { site } = useSite();
  const b = site.business;
  const bookable = site.units;
  const maxGuests = Math.max(0, ...bookable.map((u) => u.capacity));
  const physical = bookable.filter((u) => u.kind === "unit").length || bookable.length;
  const priced = bookable.map((u) => u.base_price).filter((p) => p > 0);
  const from = priced.length ? Math.min(...priced) : null;
  const texts = site.properties.filter((p) => p.description?.trim());
  return (
    <section id="about" aria-labelledby="about-title" className="scroll-mt-24 bg-background">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-8 sm:py-28 lg:grid-cols-[1.4fr_1fr] lg:gap-20">
        <div>
          <p className="mb-3 text-xs font-medium tracking-[0.06em] text-[var(--site-gold-ink)]">
            {t.about}
          </p>
          <h2
            id="about-title"
            className="font-display text-3xl leading-tight font-medium sm:text-4xl"
          >
            {site.properties.length === 1 ? site.properties[0]!.name : b.name}
          </h2>
          <span aria-hidden="true" className="mt-6 block h-px w-14 bg-[var(--site-gold)]" />
          <div className="mt-8 space-y-8">
            {texts.map((p) => (
              <div key={p.id}>
                {texts.length > 1 && <h3 className="font-display mb-2 text-xl">{p.name}</h3>}
                <p className="text-lg leading-loose whitespace-pre-line text-foreground/85">
                  {p.description}
                </p>
              </div>
            ))}
          </div>
        </div>
        <dl className="grid grid-cols-2 content-start gap-px self-start overflow-hidden rounded-[var(--radius)] border border-border bg-border">
          {b.check_in_time && (
            <Fact
              icon={<Clock className="size-5" />}
              label={t.facts.checkIn}
              value={b.check_in_time}
            />
          )}
          {b.check_out_time && (
            <Fact
              icon={<Clock className="size-5" />}
              label={t.facts.checkOut}
              value={b.check_out_time}
            />
          )}
          {physical > 0 && (
            <Fact
              icon={<Home className="size-5" />}
              label={t.nav.units}
              value={t.facts.units(physical)}
            />
          )}
          {maxGuests > 0 && (
            <Fact
              icon={<Users className="size-5" />}
              label={t.facts.guests}
              value={t.facts.guestsUpTo(maxGuests)}
            />
          )}
          {from !== null && (
            <div className="col-span-2 bg-[var(--site-sand)] px-6 py-6">
              <dt className="text-sm text-muted-foreground">{t.facts.from}</dt>
              <dd className="font-display mt-1 text-3xl">
                {money(from, b.currency)}{" "}
                <span className="font-sans text-base text-muted-foreground">
                  {t.facts.perNight}
                </span>
              </dd>
            </div>
          )}
        </dl>
      </div>
    </section>
  );
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-card px-6 py-6">
      <dt className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="text-[var(--site-gold-ink)]" aria-hidden="true">
          {icon}
        </span>
        {label}
      </dt>
      <dd className="mt-2 text-lg font-medium">{value}</dd>
    </div>
  );
}
