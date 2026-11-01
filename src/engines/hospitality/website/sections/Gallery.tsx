// גלריה: פסיפס של עד 7 תמונות (הראשונה גדולה) + "כל התמונות"; לחיצה → מסך מלא.
// בלי תמונות בכלל — החלק לא מוצג (התמונות מועלות מאזור הניהול).
import { Play } from "lucide-react";
import { useState } from "react";
import type { PublicMedia } from "../../types/website";
import { Lightbox } from "../components/Lightbox";
import { Photo } from "../components/Photo";
import { SectionHeading } from "../components/SectionHeading";
import { useCopy } from "../copy";
import { siteGallery } from "../lib/media";
import { useSite } from "../lib/site-context";
import type { Section } from "../design/schema";
import { cn } from "@/platform/ui";

/** פריסת הפסיפס לפי מספר התמונות (1 / 2 / 3 / 4+), כך שאין "חורים" */
function tiles(n: number): string[] {
  if (n === 1) return ["col-span-2 row-span-2 sm:col-span-4"];
  if (n === 2) return ["col-span-2 row-span-2", "col-span-2 row-span-2"];
  if (n === 3)
    return ["col-span-2 row-span-2", "col-span-2 sm:col-span-2", "col-span-2 sm:col-span-2"];
  if (n === 4) return ["col-span-2 row-span-2", "", "", "col-span-2"];
  if (n === 5) return ["col-span-2 row-span-2", "", "", "", ""];
  if (n === 6) return ["col-span-2 row-span-2", "", "", "", "", "col-span-2 sm:col-span-4"];
  return ["col-span-2 row-span-2", "", "", "", "", "col-span-2 sm:col-span-1", "hidden sm:block"];
}

export function Gallery({ section }: { section?: Section | undefined }) {
  const t = useCopy();
  const { site, design } = useSite();
  const c = section?.content ?? {};
  const all = siteGallery(site, design.logo);
  // נבחרו תמונות בעורך — רק הן, בסדר שנבחר
  const picked = c.images?.length
    ? c.images
        .map((id) => all.find((m) => m.id === id))
        .filter((m): m is (typeof all)[number] => !!m)
    : [];
  const items = picked.length ? picked : all;
  if (items.length === 0) return null;
  return (
    <section id="gallery" aria-labelledby="gallery-title" className="scroll-mt-24 bg-background">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8 sm:py-28">
        <SectionHeading
          section={section?.id}
          id="gallery-title"
          eyebrow={c.eyebrow ?? t.gallery.title}
          title={c.title ?? t.gallery.subtitle}
          subtitle={c.subtitle}
        />
        <MediaMosaic items={items} title={site.business.name} className="mt-14" />
      </div>
    </section>
  );
}

export function MediaMosaic({
  items,
  title,
  className,
  max = 7,
}: {
  items: PublicMedia[];
  title: string;
  className?: string;
  max?: number;
}) {
  const t = useCopy();
  const [open, setOpen] = useState<number | null>(null);
  const shown = items.slice(0, max);
  const tile = tiles(shown.length);
  return (
    <div className={className}>
      <ul className="grid auto-rows-[38vw] grid-cols-2 gap-2 sm:auto-rows-[15rem] sm:grid-cols-4 sm:gap-3">
        {shown.map((m, i) => (
          <li key={m.id} className={cn("relative", tile[i] ?? "")}>
            <button
              type="button"
              onClick={() => setOpen(i)}
              className="group block h-full w-full overflow-hidden rounded-[var(--radius)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-label={`${m.alt?.trim() || title} — ${t.gallery.open(i + 1, items.length)}`}
            >
              {m.kind === "image" ? (
                <Photo
                  framed
                  media={m}
                  alt={title}
                  sizes={
                    i === 0 ? "(min-width: 640px) 50vw, 100vw" : "(min-width: 640px) 25vw, 50vw"
                  }
                  className="h-full w-full"
                  imgClassName="transition-transform duration-700 group-hover:scale-[1.05]"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-[var(--site-deep)] text-white">
                  <Play className="size-10" aria-hidden="true" />
                  <span className="sr-only">{t.gallery.video}</span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {items.length > shown.length && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => setOpen(0)}
            className="inline-flex h-11 items-center rounded-sm border border-foreground/25 px-6 text-sm hover:bg-foreground/5"
          >
            {t.gallery.all(items.length)}
          </button>
        </div>
      )}
      <Lightbox items={items} index={open} onIndex={setOpen} title={title} />
    </div>
  );
}
