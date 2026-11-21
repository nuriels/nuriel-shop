// מנוע Ecommerce — תיאור דק מעל הקוד הקיים (plan B1). שום קוד לא הועבר.
// בעלות על פונקציות שרת: ברירת המחדל של הרישום — כל קובץ שהפלטפורמה ומנועים
// אחרים לא טוענים לו (כל הקוד של היום). פעיל תמיד; שער הבקשות של החנויות
// נשאר storeGate ב-src/server.ts כמו היום.
import { createServerOnlyFn } from "@tanstack/react-start";
import type { Engine } from "@/platform/engines/contract";

// מנוע ה-SEO של הפלטפורמה: ההצעות והעובדות של החנויות (העובד עצמו — בפלטפורמה). בשרת בלבד — בבנייה של
// הדפדפן גוף הפונקציה מוסר, כך שקוד ה-SEO של השרת לא נכנס לבאנדל. כשל נרשם ביומן ולא מפיל את השרת
const registerSeo = createServerOnlyFn(async () => {
  try {
    (await import("@/lib/seo/store-seo.server")).registerStoreSeo();
  } catch (e) {
    console.error("[seo] store handler not registered", e instanceof Error ? e.message : String(e));
  }
});

export const ecommerceEngine: Engine = {
  key: "ecommerce",
  label: "Nuriel Ecommerce",
  ownsServerFn: () => false,
  enabledFor: async () => true,
  gate: async () => null,
  startWorkers() {
    if (typeof window !== "undefined") return;
    void registerSeo();
  },
};
