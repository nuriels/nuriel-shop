// שלב א' 7: החבילות באתר — כרטיס לכל חבילה מוצגת: תמונה (מהגלריה של היחידה), סוג (חבילת אירוח /
// חבילה מיוחדת), שם, לילות ואורחים, היחידה, ומחיר החבילה. בלי חבילות — לא מוצג כלום.
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Sparkles } from "lucide-react";
import { cn } from "@/platform/ui";
import type { PublicPackage } from "../../types/packages";
import { Photo } from "../components/Photo";
import { SectionHeading } from "../components/SectionHeading";
import { useCopy } from "../copy";
import { money } from "../lib/format";
import { packageImages, packageUnit, sitePackages } from "../lib/packages";
import { useSite } from "../lib/site-context";

export function Packages({ exclude, title }: { exclude?: string; title?: string }) {
  const t = useCopy();
  const { site } = useSite();
  const list = sitePackages(site).filter((p) => p.id !== exclude);
  if (list.length === 0) return null;
  return (
    <section
      id={exclude ? undefined : "packages"}
      aria-labelledby={exclude ? "more-packages-title" : "packages-title"}
      className="scroll-mt-24 bg-background"
      data-testid="site-packages"
    >
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 sm:py-28">
        <SectionHeading
          id={exclude ? "more-packages-title" : "packages-title"}
          eyebrow={t.packages.title}
          title={title ?? t.packages.title}
          subtitle={exclude ? undefined : t.packages.subtitle}
        />
        <ul
          className={cn(
            "mt-14 grid gap-8",
            list.length === 1 ? "mx-auto max-w-xl" : "sm:grid-cols-2 lg:grid-cols-3",
          )}
        >
          {list.map((p) => (
            <li key={p.id}>
              <PackageCard pkg={p} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PackageCard({ pkg }: { pkg: PublicPackage }) {
  const t = useCopy();
  const { site } = useSite();
  const unit = packageUnit(pkg, site);
  const special = pkg.kind === "special";
  return (
    <Link
      to="/stay/packages/$packageSlug"
      params={{ packageSlug: pkg.slug }}
      className="group block h-full overflow-hidden rounded-[var(--radius)] bg-card shadow-[var(--site-shadow)] transition-transform duration-500 hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      data-package={pkg.name}
    >
      <div className="relative">
        <Photo
          framed
          media={packageImages(pkg, site)[0] ?? null}
          alt={pkg.name}
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          className="aspect-[4/3]"
          imgClassName="transition-transform duration-700 group-hover:scale-[1.04]"
        />
        <span
          className={cn(
            "absolute top-4 start-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
            special ? "bg-[var(--site-deep)] text-white" : "bg-white/90 text-[var(--site-deep)]",
          )}
        >
          {special && <Sparkles className="size-3.5" aria-hidden="true" />}
          {t.packages.kind[pkg.kind]}
        </span>
      </div>
      <div className="flex flex-col gap-3 px-6 pt-6 pb-7">
        <h3 className="font-display text-2xl leading-snug">{pkg.name}</h3>
        <p className="text-sm text-muted-foreground">
          {[t.packages.nights(pkg.nights), t.packages.guests(pkg.max_guests)].join(" · ")}
          {unit && <span className="block">{t.packages.in(unit.name)}</span>}
        </p>
        <div className="mt-2 flex items-end justify-between gap-4 border-t border-border pt-4">
          <p>
            <span className="block text-xs text-muted-foreground">{t.packages.price}</span>
            <span className="font-display text-2xl tabular-nums">
              {money(pkg.price, site.business.currency)}
            </span>
            <span className="block text-xs text-muted-foreground">
              {t.packages.pricePer(pkg.nights)}
            </span>
          </p>
          <span className="inline-flex items-center gap-1 text-sm font-medium whitespace-nowrap text-foreground">
            {t.packages.details}
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
