// עמוד יחידה: תמונה גדולה, עובדות (אורחים, חדרים, מיטות), תיאור, תמונות, מיטות לפי חדר,
// מתקנים, תנאי השהייה של המתחם, מיקום — ובצד: "החל מ-", מינימום לילות ולוח זמינות.
import { Link, useParams } from "@tanstack/react-router";
import { ArrowRight, Bath, BedDouble, DoorOpen, Images, Ruler, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { PublicUnit } from "../../types/website";
import { AvailabilityCalendar, type DateRange } from "../components/AvailabilityCalendar";
import { Lightbox } from "../components/Lightbox";
import { Photo } from "../components/Photo";
import { PriceFrom } from "../components/PriceFrom";
import { checkoutParams, siteItem } from "../consent/events";
import { gaEvent } from "../consent/ga";
import { useCopy } from "../copy";
import { findUnit, stayText } from "../lib/format";
import { findType } from "../lib/listing";
import { dedupeMedia, unitMedia } from "../lib/media";
import { useSite } from "../lib/site-context";
import { AmenityGroups } from "../sections/Amenities";
import { uniqueAmenities } from "../lib/media";
import { MediaMosaic } from "../sections/Gallery";
import { MapLinks } from "../sections/Location";
import { Terms } from "../sections/Terms";
import { Units } from "../sections/Units";

/**
 * עמוד יחידה — או עמוד של סוג חדר (מלון): אותו עמוד, עם השם והתיאור של הסוג, התמונות של כל
 * החדרים, זמינות לפי הסוג (לילה תפוס = אין אף חדר פנוי) והזמנה לפי סוג.
 */
export function UnitPage({
  slug,
  typeSlug,
}: { slug?: string | undefined; typeSlug?: string | undefined } = {}) {
  const t = useCopy();
  const { site, design } = useSite();
  const params = useParams({ strict: false }) as { unitSlug?: string; typeSlug?: string };
  const roomType = findType(site, typeSlug ?? params.typeSlug);
  const unit = roomType?.lead ?? findUnit(site.units, slug ?? params.unitSlug)!;
  const property = site.properties.find((p) => p.id === unit.property_id);
  const media = roomType
    ? dedupeMedia(roomType.rooms.flatMap((r) => unitMedia(r, site)))
    : unitMedia(unit, site);
  const name = roomType?.type.name ?? unit.name;
  const description = roomType?.type.description ?? unit.description;
  const capacity = roomType?.capacity ?? unit.capacity;
  const fromPrice = roomType?.fromPrice ?? unit.base_price;
  const minNights = roomType?.minNights ?? unit.min_nights;
  const images = media.filter((m) => m.kind === "image");
  const [open, setOpen] = useState<number | null>(null);
  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const members = site.units.filter((u) => unit.member_ids?.includes(u.id));
  const type = roomType
    ? t.units.roomsOfType(roomType.rooms.length)
    : unit.kind === "whole_property"
      ? t.units.wholeProperty
      : unit.unit_type
        ? t.unitTypes[unit.unit_type]
        : "";
  const amenities = uniqueAmenities([...unit.amenities, ...members.flatMap((m) => m.amenities)]);
  const rooms = groupBeds(unit, members);
  // GA4 (רק אחרי הסכמה — consent/ga.ts): צפייה ביחידה / בסוג החדר, לפי השם והמחיר הציבוריים
  const itemSlug = roomType?.type.slug ?? unit.slug;
  useEffect(() => {
    const item = roomType
      ? siteItem(roomType.type, "room_type", fromPrice)
      : siteItem(unit, "unit", fromPrice);
    gaEvent("view_item", checkoutParams([item], fromPrice, site.business.currency));
    // פעם אחת לכל יחידה / סוג שמוצגים (לא בכל שינוי תאריכים בלוח)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemSlug]);

  return (
    <article>
      <header className="relative isolate flex min-h-[62svh] items-end overflow-hidden text-white sm:min-h-[72svh]">
        <Photo
          media={images[0] ?? null}
          alt={name}
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
              hash="units"
              className="mb-5 inline-flex items-center gap-2 text-sm text-white/80 hover:text-white"
            >
              <ArrowRight className="size-4" aria-hidden="true" />
              {t.units.back}
            </Link>
            {type && (
              <p className="mb-3 text-xs font-medium tracking-[0.06em] text-white/85">{type}</p>
            )}
            <h1 className="font-display text-4xl leading-tight font-medium sm:text-6xl">{name}</h1>
          </div>
          {images.length > 1 && (
            <button
              type="button"
              onClick={() => setOpen(0)}
              className="inline-flex h-11 items-center gap-2 rounded-sm bg-white/90 px-5 text-sm font-medium text-[var(--site-deep)] hover:bg-white"
            >
              <Images className="size-4" aria-hidden="true" />
              {t.gallery.all(media.length)}
            </button>
          )}
        </div>
      </header>
      <Lightbox items={media} index={open} onIndex={setOpen} title={name} />

      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-14 sm:px-8 sm:py-20 lg:grid-cols-[1fr_24rem] lg:gap-16">
        <div className="min-w-0 space-y-14">
          <ul className="flex flex-wrap gap-x-8 gap-y-4 border-b border-border pb-8 text-[0.95rem]">
            <Fact icon={<Users />} text={t.units.guests(capacity)} />
            {!!unit.bedrooms && <Fact icon={<DoorOpen />} text={t.units.bedrooms(unit.bedrooms)} />}
            {!!unit.bathrooms && <Fact icon={<Bath />} text={t.units.bathrooms(unit.bathrooms)} />}
            {!!unit.size_sqm && <Fact icon={<Ruler />} text={t.units.size(unit.size_sqm)} />}
            {rooms.length > 0 && (
              <Fact
                icon={<BedDouble />}
                text={t.units.bedsCount(
                  rooms.reduce((n, r) => n + r.beds.reduce((k, b) => k + b.quantity, 0), 0),
                )}
              />
            )}
          </ul>

          {description && (
            <p className="text-lg leading-loose whitespace-pre-line text-foreground/85">
              {description}
            </p>
          )}

          {members.length > 0 && (
            <section aria-labelledby="members-title">
              <h2 id="members-title" className="font-display mb-4 text-2xl">
                {t.units.includes}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {members.map((m) => (
                  <li key={m.id}>
                    <Link
                      to="/stay/units/$unitSlug"
                      params={{ unitSlug: m.slug }}
                      className="block rounded-[var(--radius)] border border-border px-5 py-4 hover:border-[var(--site-gold)]"
                    >
                      <span className="font-medium">{m.name}</span>
                      <span className="block text-sm text-muted-foreground">
                        {t.units.guests(m.capacity)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {images.length > 1 && <MediaMosaic items={media.slice(1)} title={name} max={5} />}

          {rooms.length > 0 && (
            <section aria-labelledby="beds-title">
              <h2 id="beds-title" className="font-display mb-5 text-2xl">
                {t.units.beds}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rooms.map((r) => (
                  <li
                    key={r.room}
                    className="rounded-[var(--radius)] border border-border bg-card px-5 py-5"
                  >
                    <BedDouble
                      className="mb-3 size-6 text-[var(--site-gold-ink)]"
                      aria-hidden="true"
                    />
                    <p className="font-medium">{r.room}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {r.beds
                        .map(
                          (b) =>
                            `${b.quantity > 1 ? `${b.quantity} ` : ""}${t.beds[b.bed_type] ?? b.bed_type}`,
                        )
                        .join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {amenities.length > 0 && (
            <section aria-labelledby="unit-amenities-title">
              <h2 id="unit-amenities-title" className="font-display mb-6 text-2xl">
                {t.amenities.title}
              </h2>
              <AmenityGroups items={amenities} />
              {property && property.amenities.length > 0 && (
                <>
                  <h3 className="mt-10 mb-5 text-lg font-medium">
                    {t.amenities.shared} — {property.name}
                  </h3>
                  <AmenityGroups items={property.amenities} />
                </>
              )}
            </section>
          )}

          <section aria-labelledby="unit-terms-title">
            <h2 id="unit-terms-title" className="font-display mb-6 text-2xl">
              {t.terms.title}
            </h2>
            <Terms property={property} policy={unit.policy ?? site.policy} compact />
          </section>

          {property && (property.address || property.location) && (
            <section aria-labelledby="unit-location-title">
              <h2 id="unit-location-title" className="font-display mb-3 text-2xl">
                {t.location.title}
              </h2>
              {property.address && <p className="mb-5 text-muted-foreground">{property.address}</p>}
              <MapLinks property={property} address={site.business.address} />
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-[var(--radius)] border border-border bg-card p-6 shadow-[var(--site-shadow)] sm:p-7">
            <p>
              <PriceFrom price={fromPrice} currency={site.business.currency} size="lg" />
            </p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {minNights > 1 && <li>{t.facts.minNights(minNights)}</li>}
              {unit.max_children === 0 && <li>{t.units.adultsOnly}</li>}
              {!!unit.max_children && unit.child_age_limit !== null && (
                <li>{t.units.childrenUpTo(unit.child_age_limit)}</li>
              )}
            </ul>
            <div className="mt-6 border-t border-border pt-6">
              <h2 className="mb-2 text-sm font-medium">{t.availability.title}</h2>
              <AvailabilityCalendar
                {...(roomType ? { typeId: roomType.type.id } : { unitId: unit.id })}
                today={site.today}
                calendarStyle={design.calendar}
                months={1}
                {...(site.booking_open ? { range, onSelect: setRange, minNights } : {})}
              />
              {site.booking_open && (
                <>
                  <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
                    {!range.from
                      ? t.book.pickArrival
                      : !range.to
                        ? t.book.pickDeparture
                        : stayText(range.from, range.to, t.locale)}
                  </p>
                  <Link
                    to="/stay/book"
                    search={{
                      ...(roomType ? { type: roomType.type.slug } : { unit: unit.slug }),
                      ...(range.from && range.to ? { from: range.from, to: range.to } : {}),
                    }}
                    className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-sm bg-primary text-base font-medium text-primary-foreground hover:opacity-90"
                  >
                    {range.from && range.to ? t.unitPage.priceAndBook : t.nav.book}
                  </Link>
                </>
              )}
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                {t.availability.note}
              </p>
            </div>
          </div>
        </aside>
      </div>

      <Units exclude={roomType?.type.id ?? unit.id} title={t.units.other} />
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

/** המיטות לפי חדר (שם החדר, או שם היחידה ב"כל המתחם") */
function groupBeds(unit: PublicUnit, members: PublicUnit[]) {
  const rows = [
    ...unit.beds.map((b) => ({ ...b, room: b.room_label || unit.name })),
    ...members.flatMap((m) =>
      m.beds.map((b) => ({ ...b, room: b.room_label ? `${m.name} — ${b.room_label}` : m.name })),
    ),
  ];
  const map = new Map<string, typeof rows>();
  for (const r of rows) map.set(r.room, [...(map.get(r.room) ?? []), r]);
  return [...map.entries()].map(([room, beds]) => ({ room, beds }));
}
