// עמוד הבית של האתר הציבורי — לפי מסמך העיצוב: המקטעים בסדר שהעסק קבע, בלי המוסתרים.
// בלי מסמך (עוד לא עוצב) — הסדר הרגיל: פתיח, על המקום, יחידות, גלריה, מתקנים, תנאים, מיקום וקשר.
import { Fragment, type ReactNode } from "react";
import type { Section, SectionType } from "../design/schema";
import { useSite } from "../lib/site-context";
import { Amenities } from "../sections/Amenities";
import { CtaBanner, Faq, Highlights, TextSection } from "../sections/Custom";
import { Gallery } from "../sections/Gallery";
import { Hero } from "../sections/Hero";
import { Intro } from "../sections/Intro";
import { Packages } from "../sections/Packages";
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
  const shown = design.sections.filter((s) => !s.hidden);
  // שלב א' 7: החבילות — מיד אחרי היחידות (בלי מקטע יחידות — אחרי הפתיח); בלי חבילות — כלום
  const at = Math.max(
    shown.findIndex((s) => s.type === "units"),
    0,
  );
  return (
    <>
      {shown.map((s, i) => (
        <Fragment key={s.id}>
          <div data-section-id={s.id}>{RENDER[s.type](s)}</div>
          {i === at && <Packages />}
        </Fragment>
      ))}
      {shown.length === 0 && <Packages />}
    </>
  );
}
