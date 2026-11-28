/**
 * Online payments (MAX/Hyp DEMO) — the fixed DEMO notice. Rendered INSIDE the online-payment surfaces only
 * (checkout payment option and pay page, the owner's pay section, NURIEL's terminal page, the MAX tab), when the
 * server says the payments environment is DEMO. Not a site-wide bar: a global banner changed every page of the
 * existing sites (screenshot baselines, axe "region", a sticky bar over the phone menu — CI run 210).
 * Inline, in the flow of its section (no sticky / z-index). Fixed, gender-neutral text.
 * Pure and browser-safe: no imports, no data (U17-B1).
 */
export const DEMO_BANNER_TEXT = "סביבת DEMO — אין חיובים אמיתיים";

export function DemoBanner() {
  return (
    <p
      role="note"
      data-testid="demo-banner"
      className="rounded-md border border-amber-300 bg-amber-100 px-3 py-1.5 text-center text-sm font-bold text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      {DEMO_BANNER_TEXT}
    </p>
  );
}
