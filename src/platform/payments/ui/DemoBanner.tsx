/**
 * Online payments (MAX/Hyp DEMO) — the fixed DEMO banner. Shown on every page while the server runs the DEMO
 * payments environment (getHostMode().demo; rendered by src/routes/__root.tsx). Fixed, gender-neutral text.
 * Pure and browser-safe: no imports, no data (U17-B1).
 */
export const DEMO_BANNER_TEXT = "סביבת DEMO — אין חיובים אמיתיים";

export function DemoBanner() {
  return (
    <div
      role="note"
      data-testid="demo-banner"
      className="sticky top-0 z-[60] w-full border-b border-amber-300 bg-amber-100 px-3 py-1.5 text-center text-sm font-bold text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      {DEMO_BANNER_TEXT}
    </div>
  );
}
