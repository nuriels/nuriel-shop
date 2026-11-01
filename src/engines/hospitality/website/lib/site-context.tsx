// נתוני האתר (נטענים פעם אחת במעטפת /stay) + הערכה והטקסטים — לכל רכיבי האתר.
import { createContext, useContext } from "react";
import type { PublicSite } from "../../types/website";
import type { SiteTheme } from "../theme/themes";

export interface SiteContextValue {
  site: PublicSite;
  theme: SiteTheme;
}

export const SiteContext = createContext<SiteContextValue | null>(null);

export function useSite(): SiteContextValue {
  const value = useContext(SiteContext);
  if (!value) throw new Error("useSite outside the site layout");
  return value;
}
