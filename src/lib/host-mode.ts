import { getHostMode } from "@/lib/platform.functions";

export type HostMode = {
  platform: boolean;
  /** האתר נעול ללקוחות — מוקפא או שהמנוי פג (הסיבה ב-lock) */
  suspended: boolean;
  /** suspended: הוקפא ע"י מנהל הפלטפורמה | expired: המנוי הסתיים (חלק 13) */
  lock: "suspended" | "expired" | null;
  baseDomain: string | null;
  /** כתובת פאנל הפלטפורמה (מנהל-על) */
  platformUrl: string | null;
};

// הדומיין לא משתנה בזמן שהעמוד פתוח — בדפדפן שואלים את השרת פעם אחת בלבד
let cached: Promise<HostMode> | undefined;

/**
 * פאנל ניהול הפלטפורמה (nuriel.nuri1.fit) או אתר של חנות (<slug>.nuri1.fit)?
 * ב-SSR נקבע לפי הבקשה הנוכחית; בדפדפן — פעם אחת ונשמר.
 */
export function hostMode(): Promise<HostMode> {
  if (typeof window === "undefined") return getHostMode();
  if (!cached) {
    cached = getHostMode().catch((error: unknown) => {
      cached = undefined;
      throw error;
    });
  }
  return cached;
}

/** הנתיבים שזמינים בדומיין של פאנל הפלטפורמה; כל השאר מופנה ל-/platform */
export const PLATFORM_PATHS = /^\/(platform|login|reset-password)(\/|$)/;
