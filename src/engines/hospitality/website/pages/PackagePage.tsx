// שלב א' 7: עמוד חבילה (/stay/packages/<slug>) — תמונה גדולה, סוג החבילה, לילות ואורחים, היחידה,
// התיאור, התמונות, תנאי החבילה ותנאי הביטול — ובצד: מחיר החבילה, התקופה, לוח זמינות של היחידה
// (בוחרים רק תאריך הגעה — העזיבה לפי מספר הלילות בחבילה) והזמנה.
import { Link, useParams } from "@tanstack/react-router";
import { ArrowRight, CalendarDays, Home, Images, Moon, Sparkles, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { AvailabilityCalendar, type DateRange } from "../components/AvailabilityCalendar";
import { Lightbox } from "../components/Lightbox";
import { Photo } from "../components/Photo";
import { checkoutParams, siteItem } from "../consent/events";
import { gaEvent } from "../consent/ga";
import { useCopy } from "../copy";
import { money, stayText } from "../lib/format";
import { findPackage, packageImages, packagePeriod, packageUnit } from "../lib/packages";
import { useSite } from "../lib/site-context";
import { MediaMosaic } from "../sections/Gallery";
import { Packages } from "../sections/Packages";
import { Terms } from "../sections/Terms";

export function PackagePage() {
  const t = useCopy();
  const { site, design } = useSite();
  const params = useParams({ strict: false }) as { packageSlug?: string };
  const pkg = findPackage(site, params.packageSlug)!;
  const unit = packageUnit(pkg, site);
  const property = unit ? site.properties.find((p) => p.id === unit.property_id) : undefined;
  const images = packageImages(pkg, site);
  const period = packagePeriod(pkg, t.locale);
  const [open, setOpen] = useState<number | null>(null);
  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const special = pkg.kind === "special";
  // GA4 (רק אחרי הסכמה — consent/ga.ts): צפייה בחבילה, לפי השם והמחיר הציבוריים
  useEffect(() => {
    gaEvent(
      "view_item",
      checkoutParams([siteItem(pkg, "package", pkg.price)], pkg.price, site.business.currency),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkg.slug]);

  return (
    <article data-testid="package-page">
      <header className="relative isolate flex min-h-[62svh] items-end overflow-hidden text-white sm:min-h-[72svh]">
        <Photo
          media={images[0] ?? null}
          alt={pkg.name}
          priority
          sizes="100vw"
          placeholderTone="dark"
          className="absolute inset-0 -z-10 h-full w-full"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[image:var(--site-hero-shade)]"
        />
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-end justify-between gap-6 px-4 pt-28 pb-10 sm:px-8 sm:pb-14">
          <div>
            <Link
              to="/stay"
              hash="packages"
              className="mb-5 inline-flex items-center gap-2 text-sm text-white/80 hover:text-white"
            >
              <ArrowRight className="size-4" aria-hidden="true" />
              {t.packages.back}
            </Link>
            <p className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium tracking-[0.06em] text-white/85">
              {special && <Sparkles className="size-3.5" aria-hidden="true" />}
              {t.packages.kind[pkg.kind]}
            </p>
            <h1 className="font-display text-4xl leading-tight font-medium sm:text-6xl">
              {pkg.name}
            </h1>
          </div>
          {images.length > 1 && (
            <button
              type="button"
              onClick={() => setOpen(0)}
              className="inline-flex h-11 items-center gap-2 rounded-sm bg-white/90 px-5 text-sm font-medium text-[var(--site-deep)] hover:bg-white"
            >
              <Images className="size-4" aria-hidden="true" />
              {t.gallery.all(images.length)}
            </button>
          )}
        </div>
      </header>
      <Lightbox items={images} index={open} onIndex={setOpen} title={pkg.name} />

      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-14 sm:px-8 sm:py-20 lg:grid-cols-[1fr_24rem] lg:gap-16">
        <div className="min-w-0 space-y-14">
          <ul className="flex flex-wrap gap-x-8 gap-y-4 border-b border-border pb-8 text-[0.95rem]">
            <Fact icon={<Moon />} text={t.packages.nights(pkg.nights)} />
            <Fact icon={<Users />} text={t.packages.guests(pkg.max_guests)} />
            {unit && <Fact icon={<Home />} text={t.packages.in(unit.name)} />}
            {period && (
              <Fact icon={<CalendarDays />} text={t.packages.period(period.from, period.to)} />
            )}
          </ul>

          {pkg.description && (
            <section aria-labelledby="package-about-title">
              <h2 id="package-about-title" className="sr-only">
                {t.packages.about}
              </h2>
              <p className="text-lg leading-loose whitespace-pre-line text-foreground/85">
                {pkg.description}
              </p>
            </section>
          )}

          {images.length > 1 && <MediaMosaic items={images.slice(1)} title={pkg.name} max={5} />}

          {pkg.terms && (
            <section aria-labelledby="package-terms-title" data-testid="package-terms">
              <h2 id="package-terms-title" className="font-display mb-4 text-2xl">
                {t.packages.terms}
              </h2>
              <p className="leading-relaxed whitespace-pre-line text-muted-foreground">
                {pkg.terms}
              </p>
            </section>
          )}

          {unit && (
            <section aria-labelledby="package-unit-title">
              <h2 id="package-unit-title" className="font-display mb-4 text-2xl">
                {t.packages.unit}
              </h2>
              <Link
                to="/stay/units/$unitSlug"
                params={{ unitSlug: unit.slug }}
                className="block rounded-[var(--radius)] border border-border px-5 py-4 hover:border-[var(--site-gold)]"
              >
                <span className="font-medium">{unit.name}</span>
                <span className="block text-sm text-muted-foreground">{t.packages.unitLink}</span>
              </Link>
            </section>
          )}

          <section aria-labelledby="package-policy-title">
            <h2 id="package-policy-title" className="font-display mb-6 text-2xl">
              {t.terms.title}
            </h2>
            <Terms property={property} policy={pkg.policy ?? unit?.policy ?? site.policy} compact />
          </section>
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-[var(--radius)] border border-border bg-card p-6 shadow-[var(--site-shadow)] sm:p-7">
            <p>
              <span className="block text-xs text-muted-foreground">{t.packages.price}</span>
              <span className="font-display text-3xl tabular-nums" data-testid="package-price">
                {money(pkg.price, site.business.currency)}
              </span>
              <span className="block text-sm text-muted-foreground">
                {t.packages.pricePer(pkg.nights)} · {t.packages.guests(pkg.max_guests)}
              </span>
            </p>
            {unit && (
              <div className="mt-6 border-t border-border pt-6">
                <h2 className="mb-2 text-sm font-medium">{t.availability.title}</h2>
                <AvailabilityCalendar
                  unitId={unit.id}
                  today={site.today}
                  calendarStyle={design.calendar}
                  months={1}
                  {...(site.booking_open
                    ? { range, onSelect: setRange, fixedNights: pkg.nights }
                    : {})}
                />
                {site.booking_open && (
                  <>
                    <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
                      {range.from && range.to
                        ? stayText(range.from, range.to, t.locale)
                        : t.packages.pickArrival(pkg.nights)}
                    </p>
                    <Link
                      to="/stay/book"
                      search={{
                        package: pkg.slug,
                        ...(range.from ? { from: range.from } : {}),
                      }}
                      className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-sm bg-primary text-base font-medium text-primary-foreground hover:opacity-90"
                    >
                      {t.packages.book}
                    </Link>
                  </>
                )}
                <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                  {t.availability.note}
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>

      <Packages exclude={pkg.id} title={t.packages.others} />
    </article>
  );
}

function Fact({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="text-[var(--site-gold-ink)] [&_svg]:size-5" aria-hidden="true">
        {icon}
      </span>
      {text}
    </li>
  );
}
