import { useEffect, useMemo, useState, type ReactNode } from "react";
import { OPEN_REST_STATE, RestContext, type RestContextValue } from "@/hooks/useRestState";
import {
  closingSoonText,
  computeRestState,
  DEFAULT_REST_SETTINGS,
  restSettingsFrom,
  type RestSettings,
} from "@/lib/rest-window";

/** חלק 35: מחשב את מצב השבת / החג (שעון ישראל) ומעדכן כל 30 שניות */
export function RestStateProvider({
  settings,
  children,
}: {
  settings:
    | {
        enabled: boolean;
        startTime: string;
        endTime: string;
        holidays: unknown;
        shabbatMessage?: string | null;
        shabbatImageUrl?: string | null;
      }
    | null
    | undefined;
  children: ReactNode;
}) {
  const rest: RestSettings = useMemo(
    () =>
      settings
        ? restSettingsFrom({
            shabbat_auto_enabled: settings.enabled,
            shabbat_start_time: settings.startTime,
            shabbat_end_time: settings.endTime,
            holidays: settings.holidays,
            shabbat_message: settings.shabbatMessage ?? null,
            shabbat_image_url: settings.shabbatImageUrl ?? null,
          })
        : DEFAULT_REST_SETTINGS,
    [settings],
  );
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!rest.enabled) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, [rest.enabled]);

  const value = useMemo<RestContextValue>(() => {
    if (!rest.enabled) return OPEN_REST_STATE;
    const state = computeRestState(rest, now);
    return { state, closed: state.closed, closingSoon: closingSoonText(state, now) };
  }, [rest, now]);

  return <RestContext.Provider value={value}>{children}</RestContext.Provider>;
}
