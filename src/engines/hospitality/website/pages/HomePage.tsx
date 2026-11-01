// עמוד הבית של האתר הציבורי: פתיח, על המקום, היחידות, גלריה, מתקנים, תנאי שהייה, מיקום וקשר.
import { Amenities } from "../sections/Amenities";
import { Gallery } from "../sections/Gallery";
import { Hero } from "../sections/Hero";
import { Intro } from "../sections/Intro";
import { LocationContact } from "../sections/Location";
import { Terms } from "../sections/Terms";
import { Units } from "../sections/Units";

export function HomePage() {
  return (
    <>
      <Hero />
      <Intro />
      <Units />
      <Gallery />
      <Amenities />
      <Terms />
      <LocationContact />
    </>
  );
}
