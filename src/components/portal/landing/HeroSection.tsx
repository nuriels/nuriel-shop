import { useState } from "react";
import { ExternalLink, LockKeyhole, Menu, X } from "lucide-react";
import { HOSPITALITY_PRODUCT, STORE_DEMO_URL, trialCta, whatsappHref } from "@/lib/portal-landing";
import { BrandMark, BrowserFrame, NewTabNote, PhoneFrame, Shot, WhatsAppIcon } from "./parts";
import { EXTERNAL, ctaGold, ctaNavy } from "./styles";

export type StartIntent = "store" | "zimmer" | null;

const NAV = [
  { href: "#computers", label: "מחשבים ושירות" },
  { href: "#online-store", label: "חנות אינטרנטית" },
  { href: "#hospitality", label: HOSPITALITY_PRODUCT },
  { href: "#pricing", label: "מחירים" },
  { href: "#faq", label: "שאלות נפוצות" },
  { href: "#contact", label: "צור קשר" },
] as const;

/** הכותרת העליונה — קבועה בראש הדף; בטלפון התפריט נפתח בכפתור */
export function LandingHeader({ onLogin }: { onLogin: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-(--l-line) bg-white/95 supports-[backdrop-filter]:bg-white/90">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
        <a
          href="#top"
          className="shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-(--l-blue)"
        >
          <BrandMark />
          <span className="sr-only">— לראש הדף</span>
        </a>

        <nav aria-label="ניווט בדף" className="ms-auto hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="rounded-lg px-3 py-2 text-[0.95rem] font-medium text-(--l-ink) transition-colors hover:bg-(--l-paper) hover:text-(--l-blue) focus-visible:outline-2 focus-visible:outline-(--l-blue)"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ms-auto flex items-center gap-2 lg:ms-0">
          <a
            href={whatsappHref()}
            {...EXTERNAL}
            aria-label="WhatsApp (נפתח בחלון חדש)"
            className="hidden size-11 items-center justify-center rounded-xl text-[#0f7d6f] transition-colors hover:bg-(--l-paper) focus-visible:outline-2 focus-visible:outline-(--l-blue) sm:inline-flex"
          >
            <WhatsAppIcon className="size-6" />
          </a>
          <button
            type="button"
            onClick={onLogin}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-(--l-line) px-4 text-[0.95rem] font-semibold text-(--l-ink) transition-colors hover:border-(--l-blue)/40 hover:text-(--l-blue) focus-visible:outline-2 focus-visible:outline-(--l-blue)"
          >
            <LockKeyhole className="size-4" aria-hidden="true" />
            כניסה
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="landing-mobile-nav"
            className="inline-flex size-11 items-center justify-center rounded-xl text-(--l-ink) hover:bg-(--l-paper) focus-visible:outline-2 focus-visible:outline-(--l-blue) lg:hidden"
          >
            {open ? (
              <X className="size-6" aria-hidden="true" />
            ) : (
              <Menu className="size-6" aria-hidden="true" />
            )}
            <span className="sr-only">{open ? "סגירת התפריט" : "תפריט"}</span>
          </button>
        </div>
      </div>

      <nav
        id="landing-mobile-nav"
        aria-label="ניווט בדף"
        hidden={!open}
        className="border-t border-(--l-line) bg-white lg:hidden"
      >
        <ul className="mx-auto grid max-w-6xl gap-1 px-4 py-3 sm:px-6">
          {NAV.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-center rounded-lg px-3 text-base font-medium text-(--l-ink) hover:bg-(--l-paper)"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

/**
 * הפתיחה: מי אנחנו, ושלוש הדלתות — לכל קהל הפעולה שלו (החנות, 14 ימי ניסיון לחנות
 * אינטרנטית, 30 ימי ניסיון ל-Hospitality). ליד — צילומי מסך אמיתיים.
 */
export function HeroSection({
  storeTrialDays,
  zimmerTrialDays,
  onStart,
}: {
  storeTrialDays: number | null;
  zimmerTrialDays: number | null;
  onStart: (intent: StartIntent) => void;
}) {
  return (
    <section
      aria-labelledby="hero-title"
      className="relative overflow-hidden border-b border-(--l-line) bg-(--l-paper)"
    >
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:pb-24 lg:pt-16">
        <div>
          <h1
            id="hero-title"
            className="font-display text-[clamp(2.1rem,1.25rem+3.3vw,3.6rem)] font-black leading-[1.1] text-balance text-(--l-ink)"
          >
            נוריאל מחשבים: מחשבים, חנויות אונליין ומערכת לניהול צימרים
          </h1>
          <p className="mt-5 max-w-xl text-[1.0625rem] leading-[1.75] text-pretty text-(--l-muted) sm:text-lg">
            חנות מחשבים ושירות בבית שמש — ופלטפורמה בעברית שבה עסקים מקימים חנות אינטרנטית, ובעלי
            צימרים מנהלים אתר, הזמנות ויומן תפוסה. בלי ידע טכני.
          </p>

          <ul className="mt-8 divide-y divide-(--l-line) overflow-hidden rounded-2xl border border-(--l-line) bg-white">
            <li className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <a
                  href="#computers"
                  className="text-lg font-bold text-(--l-ink) underline-offset-4 hover:text-(--l-blue) hover:underline"
                >
                  מחשבים, חלקים ושירות
                </a>
                <p className="mt-1 text-[0.95rem] leading-6 text-(--l-muted)">
                  ניידים ונייחים, מחודשים, ציוד היקפי ומדפסות — ותיקונים ושדרוגים.
                </p>
              </div>
              <a href={STORE_DEMO_URL} {...EXTERNAL} className={`${ctaNavy} shrink-0`}>
                לחנות של נוריאל מחשבים
                <ExternalLink className="size-4" aria-hidden="true" />
                <NewTabNote />
              </a>
            </li>
            <li className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <a
                  href="#online-store"
                  className="text-lg font-bold text-(--l-ink) underline-offset-4 hover:text-(--l-blue) hover:underline"
                >
                  חנות אינטרנטית לעסק
                </a>
                <p className="mt-1 text-[0.95rem] leading-6 text-(--l-muted)">
                  מקימים לבד חנות מקצועית: מוצרים, הזמנות, משלוחים ושיווק.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onStart("store")}
                className={`${ctaGold} shrink-0`}
                data-testid="hero-store-trial"
              >
                {trialCta(storeTrialDays)}
              </button>
            </li>
            <li className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <a
                  href="#hospitality"
                  className="text-lg font-bold text-(--l-ink) underline-offset-4 hover:text-(--l-blue) hover:underline"
                >
                  <bdi dir="ltr">{HOSPITALITY_PRODUCT}</bdi> — לצימרים
                </a>
                <p className="mt-1 text-[0.95rem] leading-6 text-(--l-muted)">
                  אתר, בקשות הזמנה, זמינות ויומן תפוסה — במקום אחד.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onStart("zimmer")}
                className={`${ctaGold} shrink-0`}
                data-testid="hero-zimmer-trial"
              >
                {trialCta(zimmerTrialDays)}
              </button>
            </li>
          </ul>
        </div>

        <figure className="mx-auto w-full max-w-xl lg:max-w-none">
          <div className="relative pb-14">
            <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-700">
              <BrowserFrame address="nofi-dorit.nuri1.fit">
                <Shot
                  name="zimmer-site"
                  kind="desktop"
                  eager
                  sizes="(min-width: 1024px) 560px, 92vw"
                  alt="אתר מתחם הצימרים נופי דורית: תמונת הבריכה בכניסה, שם המתחם וכפתורי בדיקת זמינות והזמנה"
                />
              </BrowserFrame>
            </div>
            <PhoneFrame className="absolute bottom-0 start-[-0.5rem] w-[29%] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-6 motion-safe:delay-200 motion-safe:duration-700 sm:start-[-1.5rem]">
              <Shot
                name="store-home-phone"
                kind="phone"
                sizes="(min-width: 1024px) 165px, 29vw"
                alt="החנות של נוריאל מחשבים בטלפון: באנר כל עולם המחשבים במקום אחד ומבצעים חמים"
              />
            </PhoneFrame>
          </div>
          <figcaption className="mt-4 text-center text-sm leading-6 text-(--l-muted)">
            צילומי מסך אמיתיים: אתר מתחם הצימרים נופי דורית והחנות של נוריאל מחשבים — שניהם בנויים
            על המערכת.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
