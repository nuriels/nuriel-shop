import { useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";

declare module "@tanstack/history" {
  interface HistoryState {
    /** מזהה החלון שפתח את רשומת ההיסטוריה הזו (useBackToClose) */
    __kobiModal?: string;
  }
}

let sequence = 0;

/**
 * כפתור "חזור" של הדפדפן / הטלפון סוגר את החלון הפתוח, במקום לצאת מהעמוד
 * ולאבד את מה שהיה על המסך.
 *
 * איך: כשהחלון נפתח נדחפת רשומת היסטוריה לאותה כתובת בדיוק (בלי גלילה למעלה).
 * "חזור" מוציא אותה → מבקשים לסגור. סגירה רגילה (X / שמירה / Escape) מוציאה את
 * הרשומה בעצמה, כך שההיסטוריה נשארת נקייה. חלון בתוך חלון עובד: "חזור" סוגר
 * רק את העליון.
 *
 * אם הבקשה לסגור לא נענתה (למשל "יש שינויים שלא נשמרו — לצאת?"), הרשומה נדחפת
 * מחדש, כך ש"חזור" הבא ישאל שוב במקום לצאת מהעמוד.
 */
export function useBackToClose(open: boolean, requestClose: () => void): void {
  const router = useRouter();
  const closeRef = useRef(requestClose);
  closeRef.current = requestClose;
  const [rearm, setRearm] = useState(0);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const history = router.history;
    const id = `m${Date.now().toString(36)}${++sequence}`;
    const baseIndex = history.location.state.__TSR_index ?? 0;
    const pathname = history.location.pathname;
    let onEntry = true;

    void router.navigate({
      to: ".",
      search: true,
      hash: true,
      state: (previous) => ({ ...previous, __kobiModal: id }),
      resetScroll: false,
    });

    const unsubscribe = history.subscribe(({ location }) => {
      if (!onEntry) return;
      const state = location.state;
      // עדיין על הרשומה שלנו, או שנפתח חלון נוסף מעלינו באותו עמוד
      if (state.__kobiModal === id) return;
      if (location.pathname === pathname && (state.__TSR_index ?? 0) > baseIndex) return;
      onEntry = false;
      closeRef.current();
      setRearm((value) => value + 1);
    });

    return () => {
      unsubscribe();
      if (!onEntry) return;
      onEntry = false;
      // החלון נסגר מתוך הממשק — מוציאים את הרשומה שלנו (רק אם היא זו שעליה עומדים)
      if (history.location.state.__kobiModal === id) history.back();
    };
  }, [open, rearm, router]);
}

/** האם יש לאן לחזור בתוך האתר (רשומה קודמת בהיסטוריה של הסשן הזה) */
export function useCanGoBack(): boolean {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);
  useEffect(() => {
    const update = () => setCanGoBack(router.history.canGoBack());
    update();
    return router.history.subscribe(update);
  }, [router]);
  return canGoBack;
}
