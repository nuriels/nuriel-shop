// מקטעים שהעסק מוסיף בעורך: טקסט (עם תמונה), נקודות בולטות, שאלות ותשובות, וקריאה להזמנה.
// הכל טקסט רגיל (React מקודד אותו) — בלי HTML מהעסק.
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { cn } from "@/platform/ui";
import { AmenityIcon } from "../../management/details/AmenityIcon";
import type { Section } from "../design/schema";
import { Photo } from "../components/Photo";
import { SectionHeading } from "../components/SectionHeading";
import { useCopy } from "../copy";
import { mediaById } from "../lib/media";
import { useSite } from "../lib/site-context";

export function TextSection({ section }: { section: Section }) {
  const { site } = useSite();
  const c = section.content;
  const image = mediaById(site, c.image);
  if (!c.title && !c.body && !image) return null;
  return (
    <section id={section.id} className="scroll-mt-24 bg-background">
      <div
        className={cn(
          "mx-auto max-w-7xl px-4 py-20 sm:px-8 sm:py-24",
          image && "grid items-center gap-10 lg:grid-cols-2 lg:gap-16",
        )}
      >
        <div className={cn(image && c.imageSide === "start" && "lg:order-2")}>
          {c.eyebrow && (
            <p className="mb-3 text-xs font-medium text-[var(--site-gold-ink)]">{c.eyebrow}</p>
          )}
          {c.title && (
            <h2 className="font-display text-3xl leading-tight sm:text-4xl">{c.title}</h2>
          )}
          {c.body && (
            <p className="mt-6 text-lg leading-loose whitespace-pre-line text-foreground/85">
              {c.body}
            </p>
          )}
        </div>
        {image && (
          <Photo
            media={image}
            alt={c.title ?? site.business.name}
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="aspect-[4/3] rounded-[var(--radius)]"
          />
        )}
      </div>
    </section>
  );
}

export function Highlights({ section }: { section: Section }) {
  const c = section.content;
  const items = c.items ?? [];
  if (items.length === 0) return null;
  return (
    <section id={section.id} className="scroll-mt-24 bg-[var(--site-sand)]">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 sm:py-24">
        {(c.title || c.eyebrow) && (
          <SectionHeading eyebrow={c.eyebrow} title={c.title ?? ""} subtitle={c.subtitle} />
        )}
        <ul
          className={cn(
            "grid gap-6 sm:grid-cols-2",
            items.length % 3 === 0 ? "lg:grid-cols-3" : items.length >= 4 ? "lg:grid-cols-4" : "",
            (c.title || c.eyebrow) && "mt-12",
          )}
        >
          {items.map((i, n) => (
            <li key={n} className="rounded-[var(--radius)] bg-card p-6 shadow-[var(--site-shadow)]">
              <AmenityIcon name={i.icon} className="size-7 text-[var(--site-gold-ink)]" />
              <h3 className="font-display mt-4 text-xl">{i.title}</h3>
              {i.text && <p className="mt-2 leading-relaxed text-muted-foreground">{i.text}</p>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Faq({ section }: { section: Section }) {
  const c = section.content;
  const faq = c.faq ?? [];
  if (faq.length === 0) return null;
  return (
    <section id={section.id} className="scroll-mt-24 bg-background">
      <div className="mx-auto max-w-3xl px-4 py-20 sm:px-8 sm:py-24">
        <SectionHeading
          eyebrow={c.eyebrow}
          title={c.title ?? "שאלות נפוצות"}
          subtitle={c.subtitle}
        />
        <div className="mt-10 divide-y divide-border border-y border-border">
          {faq.map((f, n) => (
            <details key={n} className="group py-2">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-3 text-lg font-medium [&::-webkit-details-marker]:hidden">
                {f.q}
                <ChevronDown
                  className="size-5 shrink-0 transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <p className="pb-4 leading-relaxed whitespace-pre-line text-muted-foreground">
                {f.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CtaBanner({ section }: { section: Section }) {
  const t = useCopy();
  const { site } = useSite();
  const c = section.content;
  return (
    <section
      id={section.id}
      className="scroll-mt-24 bg-[var(--site-deep)] text-[var(--site-deep-foreground)]"
    >
      <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-8 sm:py-24">
        <h2 className="font-display text-3xl leading-tight sm:text-5xl">
          {c.title ?? site.business.name}
        </h2>
        {c.body && <p className="mx-auto mt-5 max-w-2xl text-lg opacity-80">{c.body}</p>}
        <div className="mt-9">
          {site.booking_open ? (
            <Link
              to="/stay/book"
              className="inline-flex h-12 items-center justify-center rounded-[min(var(--radius),0.5rem)] bg-[var(--site-gold)] px-8 font-medium text-[var(--site-deep)] hover:opacity-90"
            >
              {c.button ?? t.hero.book}
            </Link>
          ) : (
            <Link
              to="/stay"
              hash="contact"
              className="inline-flex h-12 items-center justify-center rounded-[min(var(--radius),0.5rem)] bg-[var(--site-gold)] px-8 font-medium text-[var(--site-deep)] hover:opacity-90"
            >
              {c.button ?? t.hero.contact}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
