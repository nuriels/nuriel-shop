import { createContext, useContext } from "react";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { cn } from "@/lib/utils";

/**
 * המסגרת הרחבה של חזית החנות (קטלוג, קטגוריות, עמוד מוצר) — משותפת לכל החנויות.
 *
 * עד מחשב נייד קטן (מתחת ל-xl, 1280px) — בדיוק כמו קודם (max-w-6xl; בטאבלט ובטלפון
 * המסגרת ממילא ברוחב המסך). מ-xl ומעלה המסגרת מתרחבת לרוחב המסך פחות שוליים, עד
 * 110rem (1760px) — כך שבמסך רחב התוכן, הכרטיסים והתמונות גדלים במקום להישאר
 * באמצע עם שטחים ריקים. הכותרת, התוכן והפוטר משתמשים באותה מסגרת, ולכן מיושרים.
 *
 * עמודים שלא ביקשו את המסגרת הרחבה (ניהול, קופה, חשבון…) לא מושפעים.
 */
export function storefrontFrameClass(hasSideBanner: boolean): string {
  return cn(
    "max-w-6xl",
    // + רוחב הבאנר הצדדי (12rem) והרווח (1.5rem) — כמו קודם, במחשב קטן (lg)
    hasSideBanner && "lg:max-w-[calc(72rem+13.5rem)]",
    "xl:max-w-[min(110rem,calc(100vw-3rem))]",
  );
}

type SideBanner = { imageUrl: string; link: string | null };

/** הבאנר הצדדי מהגדרות האתר — רק כשהוא פעיל ויש לו תמונה */
export function useSideBanner(): SideBanner | null {
  const { settings } = useSiteSettings();
  if (!settings?.desktop_banner_active || !settings.desktop_banner_image_url) return null;
  return {
    imageUrl: settings.desktop_banner_image_url,
    link: settings.desktop_banner_link,
  };
}

/** המחלקה של מסגרת הכותרת / הפוטר: רחבה בעמודי החנות, max-w-6xl בכל השאר */
export function useStorefrontFrame(wide: boolean): string {
  const banner = useSideBanner();
  return wide ? storefrontFrameClass(banner !== null) : "max-w-6xl";
}

/**
 * האם הרכיב נמצא בתוך המסגרת הרחבה (StorefrontMain width="wide"). רשתות המוצרים,
 * הקטגוריות והמבצעים גדלות במסך רחב רק כאן — בניהול ובחלונות (יצירת הזמנה) לא.
 */
export const StorefrontWideContext = createContext(false);

export function useStorefrontWide(): boolean {
  return useContext(StorefrontWideContext);
}
