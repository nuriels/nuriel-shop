// קישור שגוגל יכול לסרוק — <a href> אמיתי ב-HTML שהשרת שולח — שבלחיצה רגילה מתנהג בדיוק כמו הכפתור
// שהוא מחליף (ניווט בתוך האפליקציה, בלי טעינה מחדש). Ctrl / Cmd / Shift / לחיצה אמצעית — פותחים את
// הכתובת כרגיל (לשונית חדשה), כמו בכל קישור.
// למה: "Google can only crawl your link if it's an <a> HTML element with an href attribute … Don't use
// JavaScript events on other HTML DOM elements for navigation" (Google Search Central — links-crawlable,
// ecommerce site structure). בחנות כל הקטגוריות והמוצרים היו כפתורים — גוגל לא ראה אף קישור אליהם.
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";

/** הכתובת של קטגוריה בחנות — אותו קידוד כמו ה-canonical, מפת האתר והנתונים המובנים (רווח = %20) */
export const categoryHref = (category: string | null): string =>
  category ? `/?category=${encodeURIComponent(category)}` : "/";

/** הכתובת של מוצר בחנות — אותה כתובת כמו ה-canonical שלו */
export const productHref = (productId: string): string => `/product/${productId}`;

/** לחיצה רגילה (כפתור שמאלי בלי מקש) — זו שמתנהגת כמו הכפתור; כל לחיצה אחרת היא של הדפדפן */
export function isPlainClick(
  e: Pick<
    MouseEvent,
    "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented"
  >,
): boolean {
  return (
    !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
  );
}

export function CrawlableLink({
  href,
  onNavigate,
  children,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "onClick" | "href"> & {
  href: string;
  /** מה שהכפתור עשה בלחיצה */
  onNavigate: () => void;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      {...props}
      onClick={(e) => {
        if (!isPlainClick(e)) return;
        e.preventDefault();
        onNavigate();
      }}
    >
      {children}
    </a>
  );
}
