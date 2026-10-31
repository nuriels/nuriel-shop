// מנוע Ecommerce — תיאור דק מעל הקוד הקיים (plan B1). שום קוד לא הועבר.
// בעלות על פונקציות שרת: ברירת המחדל של הרישום — כל קובץ שהפלטפורמה ומנועים
// אחרים לא טוענים לו (כל הקוד של היום). פעיל תמיד; שער הבקשות של החנויות
// נשאר storeGate ב-src/server.ts כמו היום.
import type { Engine } from "@/platform/engines/contract";

export const ecommerceEngine: Engine = {
  key: "ecommerce",
  label: "Nuriel Ecommerce",
  ownsServerFn: () => false,
  enabledFor: async () => true,
  gate: async () => null,
};
