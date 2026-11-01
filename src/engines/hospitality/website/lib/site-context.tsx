// נתוני האתר (נטענים פעם אחת במעטפת /stay, או בתצוגה המקדימה בעורך), הערכה, מסמך העיצוב
// והטקסטים — לכל רכיבי האתר.
import { createContext, useContext } from "react";
import type { PublicSite } from "../../types/website";
import type { SiteDesign } from "../design/schema";
import type { SiteTheme } from "../theme/themes";

export interface SiteContextValue {
  site: PublicSite;
  theme: SiteTheme;
  /** מסמך העיצוב אחרי normalizeDesign (המפורסם באתר, הטיוטה בתצוגה המקדימה) */
  design: SiteDesign;
  /** תצוגה מקדימה בעורך (קישורים לא מנווטים) */
  preview: boolean;
  /** העמוד מתחיל בתמונה גדולה (הכותרת שקופה מעליה) */
  heroPage: boolean;
}

export const SiteContext = createContext<SiteContextValue | null>(null);

export function useSite(): SiteContextValue {
  const value = useContext(SiteContext);
  if (!value) throw new Error("useSite outside the site layout");
  return value;
}
