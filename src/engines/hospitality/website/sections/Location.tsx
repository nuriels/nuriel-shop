// מיקום ויצירת קשר: הכתובת, ניווט ב-Waze / Google Maps (קישורים בלבד — בלי מפה מוטמעת,
// בלי מפתחות ובלי מעקב), טלפון, WhatsApp ואימייל.
import { Mail, MapPin, MessageCircle, Navigation, Phone } from "lucide-react";
import type { ReactNode } from "react";
import type { PublicProperty } from "../../types/website";
import { useCopy } from "../copy";
import { googleMapsHref, telHref, wazeHref, whatsappHref } from "../lib/format";
import { useSite } from "../lib/site-context";
import type { Section } from "../design/schema";

export function MapLinks({
  property,
  address,
}: {
  property?: PublicProperty | undefined;
  address: string | null;
}) {
  const t = useCopy();
  const loc = property?.location ?? null;
  const where = property?.address || address;
  const waze = wazeHref(loc, where);
  const google = googleMapsHref(loc, where);
  if (!waze && !google) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {waze && (
        <a
          href={waze}
          target="_blank"
          rel="noopener"
          className="inline-flex h-11 items-center gap-2 rounded-sm bg-primary px-5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Navigation className="size-4" aria-hidden="true" />
          {t.location.waze}
        </a>
      )}
      {google && (
        <a
          href={google}
          target="_blank"
          rel="noopener"
          className="inline-flex h-11 items-center gap-2 rounded-sm border border-foreground/25 px-5 text-sm font-medium hover:bg-foreground/5"
        >
          <MapPin className="size-4" aria-hidden="true" />
          {t.location.google}
        </a>
      )}
    </div>
  );
}

export function LocationContact({ section }: { section?: Section | undefined }) {
  const t = useCopy();
  const { site } = useSite();
  const c = section?.content ?? {};
  const b = site.business;
  const wa = b.whatsapp || b.phone;
  return (
    <section
      id="location"
      aria-labelledby="location-title"
      className="scroll-mt-24 bg-[var(--site-sand)]"
    >
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-20 sm:px-8 sm:py-28 lg:grid-cols-2">
        <div className="rounded-[var(--radius)] bg-card p-8 shadow-[var(--site-shadow)] sm:p-12">
          <p className="mb-3 text-xs font-medium tracking-[0.06em] text-[var(--site-gold-ink)]">
            {c.eyebrow ?? t.location.subtitle}
          </p>
          <h2 id="location-title" className="font-display text-3xl font-medium sm:text-4xl">
            {c.title ?? t.location.title}
          </h2>
          <div className="mt-8 space-y-8">
            {(site.properties.length ? site.properties : [undefined]).map((p, i) => (
              <div key={p?.id ?? i}>
                {site.properties.length > 1 && p && (
                  <h3 className="font-display mb-1 text-xl">{p.name}</h3>
                )}
                <p className="flex items-start gap-3 text-lg">
                  <MapPin
                    className="mt-1 size-5 shrink-0 text-[var(--site-gold-ink)]"
                    aria-hidden="true"
                  />
                  {p?.address || b.address || "—"}
                </p>
                <div className="mt-5">
                  <MapLinks property={p} address={b.address} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-8 text-sm text-muted-foreground">{c.note ?? t.location.note}</p>
        </div>
        <div
          id="contact"
          className="scroll-mt-24 rounded-[var(--radius)] bg-[var(--site-deep)] p-8 text-[var(--site-deep-foreground)] sm:p-12"
        >
          <p className="mb-3 text-xs font-medium tracking-[0.06em] text-[var(--site-gold)]">
            {t.contact.subtitle}
          </p>
          <h2 className="font-display text-3xl font-medium sm:text-4xl">
            {c.subtitle ?? t.contact.title}
          </h2>
          <ul className="mt-8 space-y-3">
            {b.phone && (
              <ContactRow
                href={telHref(b.phone)}
                icon={<Phone />}
                label={t.contact.phone}
                value={<span dir="ltr">{b.phone}</span>}
              />
            )}
            {wa && (
              <ContactRow
                href={whatsappHref(wa)}
                external
                icon={<MessageCircle />}
                label={t.contact.whatsapp}
                value={t.contact.write}
              />
            )}
            {b.email && (
              <ContactRow
                href={`mailto:${b.email}`}
                icon={<Mail />}
                label={t.contact.email}
                value={<span dir="ltr">{b.email}</span>}
              />
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}

function ContactRow({
  href,
  icon,
  label,
  value,
  external,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  value: ReactNode;
  external?: boolean;
}) {
  return (
    <li>
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener" : undefined}
        className="flex items-center gap-4 rounded-sm border border-white/10 px-5 py-4 transition-colors hover:border-[var(--site-gold)] hover:bg-white/5"
      >
        <span className="text-[var(--site-gold)] [&_svg]:size-5" aria-hidden="true">
          {icon}
        </span>
        <span className="flex flex-col">
          <span className="text-xs opacity-70">{label}</span>
          <span className="text-lg">{value}</span>
        </span>
      </a>
    </li>
  );
}
