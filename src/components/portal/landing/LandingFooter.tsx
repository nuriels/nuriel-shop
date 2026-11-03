import {
  HOSPITALITY_PRODUCT,
  NURIEL_BUSINESS,
  STORE_DEMO_URL,
  ZIMMER_DEMO_URL,
  fullAddress,
  mailHref,
  telHref,
} from "@/lib/portal-landing";
import { BrandMark, NewTabNote } from "./parts";
import { EXTERNAL } from "./styles";

/** קישורים בפוטר — גובה מגע של 32px לפחות (לא רק שורת טקסט) */
const linkClass =
  "inline-block py-1 text-(--l-on-navy) underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-(--l-gold)";

export function LandingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-(--l-navy-deep) text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1.2fr]">
        <div>
          <BrandMark tone="light" />
          <p className="mt-4 max-w-xs text-[0.95rem] leading-7 text-(--l-on-navy)">
            חנויות אינטרנטיות לעסקים ואתרי הזמנות לצימרים — מבית נוריאל מחשבים, בית שמש.
          </p>
        </div>
        <nav aria-label="באתר">
          <p className="text-base font-bold">באתר</p>
          <ul className="mt-3 space-y-1 text-[0.95rem]">
            <li>
              <a href="#online-store" className={linkClass}>
                הקמת חנות אינטרנטית
              </a>
            </li>
            <li>
              <a href="#hospitality" className={linkClass}>
                <bdi dir="ltr">{HOSPITALITY_PRODUCT}</bdi>
              </a>
            </li>
            <li>
              <a href="#pricing" className={linkClass}>
                חבילות ומחירים
              </a>
            </li>
            <li>
              <a href="#computers" className={linkClass}>
                מי אנחנו
              </a>
            </li>
            <li>
              <a href="#faq" className={linkClass}>
                שאלות נפוצות
              </a>
            </li>
          </ul>
        </nav>
        <nav aria-label="דוגמאות">
          <p className="text-base font-bold">דוגמאות אמיתיות</p>
          <ul className="mt-3 space-y-1 text-[0.95rem]">
            <li>
              <a href={STORE_DEMO_URL} {...EXTERNAL} className={linkClass}>
                החנות של נוריאל מחשבים
                <NewTabNote />
              </a>
            </li>
            <li>
              <a href={ZIMMER_DEMO_URL} {...EXTERNAL} className={linkClass}>
                נופי דורית — אתר צימרים
                <NewTabNote />
              </a>
            </li>
          </ul>
        </nav>
        <div>
          <p className="text-base font-bold">{NURIEL_BUSINESS.name}</p>
          <address className="mt-3 space-y-1 text-[0.95rem] not-italic">
            <p className="py-1 text-(--l-on-navy)">{fullAddress()}</p>
            <p>
              <a href={telHref()} className={linkClass}>
                <span dir="ltr">{NURIEL_BUSINESS.phone}</span>
              </a>
            </p>
            <p>
              <a href={mailHref()} className={linkClass}>
                <span dir="ltr">{NURIEL_BUSINESS.email}</span>
              </a>
            </p>
          </address>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-(--l-on-navy) sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            © {year} {NURIEL_BUSINESS.name}. כל הזכויות שמורות.
          </p>
          <nav aria-label="מידע משפטי">
            <ul className="flex flex-wrap gap-x-5 gap-y-2">
              <li>
                <a href="/terms" className={linkClass}>
                  תנאי שימוש
                </a>
              </li>
              <li>
                <a href="/privacy" className={linkClass}>
                  מדיניות פרטיות
                </a>
              </li>
              <li>
                <a href="/accessibility" className={linkClass}>
                  הצהרת נגישות
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  );
}
