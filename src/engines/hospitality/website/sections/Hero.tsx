// הפתיח של עמוד הבית: תמונה במסך מלא (או רקע חם כשעדיין אין תמונה), שם העסק בגופן התצוגה,
// סוג המקום והאזור, והפעולות הראשיות.
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useCopy } from "../copy";
import { firstSentence } from "../lib/format";
import { heroImage } from "../lib/media";
import { useSite } from "../lib/site-context";
import { Photo } from "../components/Photo";

export function Hero() {
  const t = useCopy();
  const { site } = useSite();
  const image = heroImage(site);
  const property = site.properties[0];
  const kind = property?.property_type ? t.propertyTypes[property.property_type] : "";
  const area = site.business.address?.split(",").slice(-1)[0]?.trim() || property?.address || "";
  return (
    <section className="relative isolate flex min-h-[88svh] items-end overflow-hidden text-white sm:min-h-[92svh]">
      <Photo
        media={image}
        alt={site.business.name}
        priority
        sizes="100vw"
        placeholderTone="dark"
        className="absolute inset-0 -z-10 h-full w-full"
        imgClassName="scale-[1.02]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[image:var(--site-hero-shade)]"
      />
      <div className="mx-auto w-full max-w-7xl px-4 pt-28 pb-14 sm:px-8 sm:pb-20">
        {(kind || area) && (
          <p className="mb-4 text-xs font-medium tracking-[0.06em] text-white/85 sm:text-sm">
            {[kind, area].filter(Boolean).join(" · ")}
          </p>
        )}
        <h1 className="font-display max-w-4xl text-5xl leading-[1.05] font-medium text-balance sm:text-7xl lg:text-8xl">
          {site.business.name}
        </h1>
        {property?.description && (
          <p className="mt-6 max-w-xl text-base leading-relaxed text-white/85 sm:text-lg">
            {firstSentence(property.description)}
          </p>
        )}
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <Link
            to="/stay"
            hash="units"
            className="inline-flex h-12 items-center justify-center rounded-sm bg-white px-8 text-base font-medium text-[var(--site-deep)] transition-colors hover:bg-white/90"
          >
            {t.hero.cta}
          </Link>
          <Link
            to="/stay"
            hash="contact"
            className="inline-flex h-12 items-center justify-center rounded-sm border border-white/60 px-8 text-base backdrop-blur-[2px] transition-colors hover:bg-white/10"
          >
            {t.hero.contact}
          </Link>
        </div>
      </div>
      <Link
        to="/stay"
        hash="about"
        aria-label={t.hero.scroll}
        className="absolute bottom-5 left-1/2 hidden -translate-x-1/2 text-white/70 transition-colors hover:text-white sm:block"
      >
        <ChevronDown className="size-7 animate-bounce" aria-hidden="true" />
      </Link>
    </section>
  );
}
