// קטלוג הטקסטים לפי שפה (D22). כרגע עברית בלבד; שפה נוספת — קובץ חדש ורישום כאן.
import { createContext, useContext } from "react";
import { he, type SiteCopy } from "./he";

export type SiteLocale = "he";
export const SITE_LOCALES: Record<SiteLocale, SiteCopy> = { he };
export const DEFAULT_LOCALE: SiteLocale = "he";

export function siteCopy(locale?: string | null): SiteCopy {
  return SITE_LOCALES[(locale as SiteLocale) ?? DEFAULT_LOCALE] ?? SITE_LOCALES[DEFAULT_LOCALE];
}

export const CopyContext = createContext<SiteCopy>(he);
export const useCopy = () => useContext(CopyContext);
export type { SiteCopy };
