import { createContext, useContext } from "react";
import type { RestState } from "@/lib/rest-window";

/**
 * חלק 35: מצב השבת / החג של החנות (שעון ישראל) — לכל עמודי האתר.
 * ההגדרות מגיעות מה-root (גם ב-SSR, כדי שהעמוד ייטען כבר "סגור" בלי הבהוב),
 * והמצב מחושב מחדש כל 30 שניות — כך שהאתר נסגר בשעת כניסת השבת גם בלשונית
 * שנשארה פתוחה, ונפתח במוצאי שבת בלי רענון.
 */
export type RestContextValue = {
  state: RestState;
  closed: boolean;
  /** "האתר ייסגר להזמנות היום ב-16:00 לקראת שבת" — עד 3 שעות לפני */
  closingSoon: string | null;
};

export const OPEN_REST_STATE: RestContextValue = {
  state: { closed: false, nextCloseAt: null, nextKind: null, nextName: null },
  closed: false,
  closingSoon: null,
};

export const RestContext = createContext<RestContextValue>(OPEN_REST_STATE);

export function useRestState(): RestContextValue {
  return useContext(RestContext);
}
