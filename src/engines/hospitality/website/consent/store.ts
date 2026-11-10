// Google SEO שלב 4: מאגר הבחירה של הגולש בדפדפן (Cookie אחד, hosp_consent) — כמו מאגר הנגישות:
// useSyncExternalStore, בשרת תמיד "לא נבחר". גם מצב חלון ההגדרות (פתוח / סגור) כאן — כדי שהקישור
// בפוטר והכפתור "הגדרות" בבאנר יפתחו את אותו חלון.
import { useSyncExternalStore } from "react";
import { consentCookie, nextConsent, readConsent, type ConsentState } from "./consent";

const nowSeconds = () => Math.floor(Date.now() / 1000);
/** מזהה אקראי (UUID v4) — randomUUID קיים רק ב-https / localhost; אחרת מאותו מקור אקראי */
function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const listeners = new Set<() => void>();
let cached: ConsentState | null | undefined;
let panelOpen = false;
let announcement = "";

function read(): ConsentState | null {
  try {
    return readConsent(document.cookie, nowSeconds());
  } catch {
    return null;
  }
}

function publish() {
  for (const cb of listeners) cb();
}

export const consentStore = {
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  getSnapshot(): ConsentState | null {
    if (cached === undefined) cached = typeof document === "undefined" ? null : read();
    return cached;
  },
  getServerSnapshot(): ConsentState | null {
    return null;
  },
  /** שומר בחירה חדשה (באותו מזהה אנונימי) ומחזיר אותה */
  choose(analytics: boolean): ConsentState {
    const next = nextConsent(this.getSnapshot(), analytics, nowSeconds(), newId);
    try {
      document.cookie = consentCookie(next, window.location.protocol === "https:");
    } catch {
      // Cookies חסומים — הבחירה תקפה לביקור הזה בלבד
    }
    cached = next;
    publish();
    return next;
  },
  isPanelOpen(): boolean {
    return panelOpen;
  },
  setPanelOpen(open: boolean): void {
    panelOpen = open;
    publish();
  },
  /** הודעה לקורא המסך (בחירה נשמרה) — מחוץ לחלון, שנסגר מיד אחרי השמירה */
  getAnnouncement(): string {
    return announcement;
  },
  announce(text: string): void {
    announcement = text;
    publish();
  },
};

export function useConsent(): ConsentState | null {
  return useSyncExternalStore(
    consentStore.subscribe,
    () => consentStore.getSnapshot(),
    () => consentStore.getServerSnapshot(),
  );
}

export function useConsentAnnouncement(): string {
  return useSyncExternalStore(
    consentStore.subscribe,
    () => consentStore.getAnnouncement(),
    () => "",
  );
}

export function useConsentPanel(): boolean {
  return useSyncExternalStore(
    consentStore.subscribe,
    () => consentStore.isPanelOpen(),
    () => false,
  );
}
