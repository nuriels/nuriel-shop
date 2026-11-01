// עמוד הבית של האתר הציבורי — לפי מסמך העיצוב: המקטעים בסדר שהעסק קבע, בלי המוסתרים.
// בלי מסמך (עוד לא עוצב) — הסדר הרגיל: פתיח, על המקום, יחידות, גלריה, מתקנים, תנאים, מיקום וקשר.
import type { ReactNode } from "react";
import type { Section, SectionType } from "../design/schema";
import { useSite } from "../lib/site-context";
import { Amenities } from "../sections/Amenities";
import { CtaBanner, Faq, Highlights, TextSection } from "../sections/Custom";
import { Gallery } from "../sections/Gallery";
import { Hero } from "../sections/Hero";
import { Intro } from "../sections/Intro";
import { LocationContact } from "../sections/Location";
import { Terms } from "../sections/Terms";
import { Units } from "../sections/Units";

const RENDER: Record<SectionType, (s: Section) => ReactNode> = {
  hero: (s) => <Hero section={s} />,
  about: (s) => <Intro section={s} />,
  units: (s) => <Units section={s} />,
  gallery: (s) => <Gallery section={s} />,
  amenities: (s) => <Amenities section={s} />,
  terms: (s) => <Terms section={s} />,
  location: (s) => <LocationContact section={s} />,
  text: (s) => <TextSection section={s} />,
  highlights: (s) => <Highlights section={s} />,
  faq: (s) => <Faq section={s} />,
  cta: (s) => <CtaBanner section={s} />,
};

export function HomePage() {
  const { design } = useSite();
  return (
    <>
      {design.sections
        .filter((s) => !s.hidden)
        .map((s) => (
          <div key={s.id} data-section-id={s.id}>
            {RENDER[s.type](s)}
          </div>
        ))}
    </>
  );
}
