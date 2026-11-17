import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

/**
 * false בשרת וברינדור הראשון בדפדפן (הידרציה של עמוד שנבנה בשרת), true מיד אחרי — וגם בכל רכיב שעולה
 * אחר כך (ניווט בתוך האתר). לתוכן שנבנה אחרת בשרת ובדפדפן (למשל ניקוי HTML עם DOMPurify, שיש רק בדפדפן).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
