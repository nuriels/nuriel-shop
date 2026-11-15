// ההקשר של האתר המוצג: המסמך, כתובות התמונות, השפה ומצב התצוגה (אתר חי / תצוגה מקדימה בממשק הניהול)
import { createContext, useContext } from "react";
import type { Locale, SiteDocument } from "../document/schema";
import { tx } from "../document/normalize";
import type { MediaMap } from "../types";

export interface SiteViewContext {
  doc: SiteDocument;
  media: MediaMap;
  locale: Locale;
  /** preview: תצוגה מקדימה (ממקמי מקום לתמונות חסרות, בלי קישורים יוצאים פעילים) */
  mode: "live" | "preview";
}

const Ctx = createContext<SiteViewContext | null>(null);
export const SiteViewProvider = Ctx.Provider;

export function useSiteView(): SiteViewContext {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSiteView outside SiteViewProvider");
  return v;
}

/** טקסט לפי שפת התצוגה */
export function useT() {
  const { locale } = useSiteView();
  return (text: { he: string; en?: string | undefined } | undefined) => tx(text, locale);
}

export function whatsappHref(number: string, message: string): string | null {
  if (!/^[1-9][0-9]{7,14}$/.test(number)) return null;
  const text = message.trim() ? `?text=${encodeURIComponent(message.trim())}` : "";
  return `https://wa.me/${number}${text}`;
}

export function telHref(phone: string): string | null {
  const digits = phone.replace(/[^0-9+]/g, "");
  return digits.length >= 7 ? `tel:${digits}` : null;
}
