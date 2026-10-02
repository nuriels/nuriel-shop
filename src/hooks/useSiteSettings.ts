import { useCallback, useEffect, useState } from "react";
import { loadSiteSettings, resolveSiteLogoUrl, type SiteSettings } from "@/lib/site";

/** הגדרות האתר הציבוריות (כותרת, לוגו, תוכן עמודים) — נטענות פעם אחת ומשותפות */
let cached: SiteSettings | null = null;
const listeners = new Set<(next: SiteSettings) => void>();

export async function refreshSiteSettings(): Promise<SiteSettings> {
  const next = await loadSiteSettings();
  cached = next;
  for (const listener of listeners) listener(next);
  return next;
}

export function useSiteSettings() {
  const [settings, setSettings] = useState<SiteSettings | null>(cached);

  const refresh = useCallback(async () => {
    setSettings(await refreshSiteSettings());
  }, []);

  useEffect(() => {
    listeners.add(setSettings);
    if (cached === null) void refresh();
    return () => {
      listeners.delete(setSettings);
    };
  }, [refresh]);

  const logoUrl = settings ? resolveSiteLogoUrl(settings.logo_path) : null;
  return { settings, logoUrl, refresh };
}
