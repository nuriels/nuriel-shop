import { useEffect } from "react";

/**
 * מסך עם סרגל פעולות קבוע בתחתית בטלפון / טאבלט (הקופה המהירה, מחולל
 * המדבקות): כפתור הנגישות עולה מעליו (--a11y-bottom, כמו בעמוד השליח), רק
 * ברוחב שבו הסרגל מוצג.
 */
export function useLiftA11yButton(offset = "5.5rem", query = "(max-width: 1023px)"): void {
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia(query);
    const apply = () => {
      if (media.matches) root.style.setProperty("--a11y-bottom", offset);
      else root.style.removeProperty("--a11y-bottom");
    };
    apply();
    media.addEventListener("change", apply);
    return () => {
      media.removeEventListener("change", apply);
      root.style.removeProperty("--a11y-bottom");
    };
  }, [offset, query]);
}
