// שלב F5: "חתימה" לכל ערכה — לא רק צבעים: שורת-העל, הקו שמתחת לכותרת, מספור המקטעים, צורת
// הכפתורים ומסגרת התמונות. CSS קבוע (בלי שום קלט מהעסק), לפי data-site-theme שעל עטיפת האתר;
// הצבעים — מהמשתנים של הערכה ושל העסק (--site-gold, --primary…), ולכן מתאימים לכל צבע שנבחר.
//
//   יוקרה  — שורת-על מרווחת מאוד, קו זהב דק עם יהלום במרכז, כפתורים כמעט חדים, מסגרת פנימית דקה בתמונות.
//   טבע    — שורת-על בתוך "עלה" (גלולה רכה), קו גלי, כפתורים מעוגלים, תמונות בפינות רכות.
//   מודרני — מספור המקטעים ("01", "02"…) בצבע ההדגשה, קו שיער לכל הרוחב, כפתורים ישרים לגמרי.
//   רומנטי — שורת-על בגופן התצוגה, שלוש נקודות במקום קו, כפתורי גלולה, הילה רכה סביב התמונות.

/** קו גלי (טבע) — כמסכה, כדי שיקבל את צבע ההדגשה של העסק */
const WAVE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 8'%3E%3Cpath d='M1 4 Q 8.25 0 15.5 4 T 30 4 T 44.5 4 T 59 4' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E\")";

export const SIGNATURE_CSS = [
  // ---- יוקרה ----
  `[data-site-theme="luxury"]{--site-button-radius:0.125rem}`,
  `[data-site-theme="luxury"] [data-eyebrow]{letter-spacing:.32em;font-size:.68rem;font-weight:500}`,
  `[data-site-theme="luxury"] [data-heading-rule]{position:relative;width:6rem;background:linear-gradient(90deg,transparent,var(--site-gold) 30%,var(--site-gold) 70%,transparent)}`,
  `[data-site-theme="luxury"] [data-heading-rule]::after{content:"";position:absolute;left:50%;top:50%;width:7px;height:7px;transform:translate(-50%,-50%) rotate(45deg);background:var(--background);border:1px solid var(--site-gold)}`,
  `[data-site-theme="luxury"] [data-site-photo]{outline:1px solid rgb(255 255 255 / .55);outline-offset:-10px}`,
  // ---- טבע ----
  `[data-site-theme="nature"]{--site-button-radius:0.85rem}`,
  `[data-site-theme="nature"] [data-eyebrow]{display:inline-block;padding:.32rem .9rem;border-radius:999px 999px 999px 0.35rem;background:var(--secondary);color:var(--primary);letter-spacing:.02em;font-weight:600}`,
  `[data-site-theme="nature"] [data-heading-rule]{width:4.75rem;height:8px;background:var(--site-gold);-webkit-mask:${WAVE} center/contain no-repeat;mask:${WAVE} center/contain no-repeat}`,
  `[data-site-theme="nature"] [data-site-photo]{border-radius:calc(var(--radius) * 1.6)}`,
  // ---- מודרני ----
  `[data-site-theme="modern"]{--site-button-radius:0}`,
  `[data-site-theme="modern"] main{counter-reset:site-sec}`,
  `[data-site-theme="modern"] [data-section-heading]{counter-increment:site-sec}`,
  `[data-site-theme="modern"] [data-section-heading]::before{content:counter(site-sec,decimal-leading-zero);content:counter(site-sec,decimal-leading-zero) / "";display:block;margin-bottom:.9rem;font-weight:800;font-size:.85rem;letter-spacing:.1em;color:var(--site-gold-ink);font-variant-numeric:tabular-nums}`,
  `[data-site-theme="modern"] [data-eyebrow]{letter-spacing:0;font-weight:700;color:var(--foreground)}`,
  `[data-site-theme="modern"] [data-heading-rule]{width:100%;background:var(--border)}`,
  // ---- רומנטי ----
  `[data-site-theme="romantic"]{--site-button-radius:999px}`,
  `[data-site-theme="romantic"] [data-eyebrow]{font-family:var(--site-display-font);font-size:1rem;letter-spacing:0;font-weight:500}`,
  `[data-site-theme="romantic"] [data-heading-rule]{width:2.6rem;height:6px;background:radial-gradient(circle,var(--site-gold) 2.4px,transparent 2.9px) 0 50%/13px 6px repeat-x}`,
  `[data-site-theme="romantic"] [data-site-photo]{box-shadow:0 0 0 6px var(--background),0 0 0 7px var(--border),var(--site-shadow)}`,
].join("");
