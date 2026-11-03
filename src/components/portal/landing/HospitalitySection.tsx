import { Check, ExternalLink } from "lucide-react";
import {
  HOSPITALITY_PRODUCT,
  SHOW_CHANNEL_SYNC,
  ZIMMER_DEMO_URL,
  trialCta,
  trialLabel,
} from "@/lib/portal-landing";
import { BrowserFrame, NewTabNote, PhoneFrame, SectionHeading, Shot } from "./parts";
import { EXTERNAL, ctaGold, ctaOutlineDark } from "./styles";

/** מה מקבל בעל הצימר — רק יכולות שקיימות במערכת ("פרימיום" — רק בחבילת הפרימיום) */
const SITE_FEATURES = [
  "אתר מעוצב: עמוד בית, יחידות וגלריה — 4 עיצובים לבחירה",
  "לוח זמינות לאורחים, ב-3 סגנונות",
  "בקשות הזמנה מהאתר — גם לכמה חדרים בבקשה אחת",
  "מותאם לטלפון, עם כפתורי חיוג ו-WhatsApp",
  "מיילים אוטומטיים לאורחים ולעסק",
] as const;

const MANAGE_FEATURES: readonly string[] = [
  "יחידות, חדרים וסוגי חדרים (סוגי חדרים — פרימיום)",
  "פתיחת תאריכים לכל יחידה, ותזכורת כשצריך לפתוח עוד",
  "יומן תפוסה אחד: הזמנה של חדר חוסמת השכרה של כל המתחם באותם תאריכים, ולהפך",
  "אישור או דחייה של בקשות הזמנה",
  "פרטי אורחים לפי הרשאות הצוות",
  "מעקב תשלומים — תשלום טלפוני ויומן תשלומים",
  "דוחות וייצוא",
  // מוסתר כרגע (SHOW_CHANNEL_SYNC ב-portal-landing.ts)
  ...(SHOW_CHANNEL_SYNC ? ["סנכרון יומנים עם Airbnb ו-Booking.com (פרימיום)"] : []),
];

function FeatureList({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div>
      <h3 className="text-xl font-bold text-white">{title}</h3>
      <ul className="mt-5 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5 text-base leading-7 text-(--l-on-navy)">
            <Check className="mt-1.5 size-4 shrink-0 text-(--l-gold)" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Nuriel Hospitality — החלק הבולט בדף (רקע כחול מלא). צילומי המסך: יומן התפוסה ולוח הבקרה
 * מתוך מערכת הניהול (נתוני הדגמה), והאתר של נופי דורית — אתר אמיתי על המערכת.
 */
export function HospitalitySection({
  trialDays,
  onStart,
}: {
  trialDays: number | null;
  onStart: () => void;
}) {
  return (
    <section
      id="hospitality"
      aria-labelledby="hospitality-title"
      className="scroll-mt-20 bg-(--l-navy) text-white"
    >
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <SectionHeading
          id="hospitality-title"
          tone="light"
          title={
            <>
              <bdi dir="ltr">{HOSPITALITY_PRODUCT}</bdi> — כל מה שבעל צימר צריך, במקום אחד
            </>
          }
          lead="מערכת לניהול צימרים ומתחמי אירוח: אתר עם בקשות הזמנה, זמינות ויומן תפוסה, ניהול יחידות וחדרים ומעקב תשלומים — בעברית, מהטלפון או מהמחשב."
        />

        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button type="button" onClick={onStart} className={ctaGold} data-testid="zimmer-trial">
            {trialCta(trialDays)}
          </button>
          <a
            href={ZIMMER_DEMO_URL}
            {...EXTERNAL}
            className={ctaOutlineDark}
            data-testid="zimmer-demo-link"
          >
            צפו באתר לדוגמה
            <ExternalLink className="size-4" aria-hidden="true" />
            <NewTabNote />
          </a>
        </div>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-(--l-on-navy)">
          {trialLabel(trialDays)} ל-<bdi dir="ltr">{HOSPITALITY_PRODUCT}</bdi> בלבד — הכול פתוח, בלי
          תשלום עכשיו. האתר נפתח לגולשים כשאתם מפרסמים אותו.
        </p>

        <figure className="mt-14">
          <BrowserFrame address="יומן התפוסה · Nuriel Hospitality">
            <Shot
              name="hosp-calendar"
              kind="desktop"
              sizes="(min-width: 1152px) 1104px, 92vw"
              alt="יומן התפוסה במערכת הניהול: חודש שלם לכל היחידות, הזמנות לפי צבע מצב, חסימה לשיפוץ וכפתורי פתיחת תאריכים וחסימת תאריכים"
            />
          </BrowserFrame>
          <figcaption className="mt-3 text-sm text-(--l-on-navy)">
            יומן התפוסה — מתוך מערכת הניהול (נתוני הדגמה).
          </figcaption>
        </figure>

        <div className="mt-12 grid items-start gap-10 lg:grid-cols-[1.2fr_1fr]">
          {/* בטלפון לוח הבקרה קטן מדי לקריאה — מספיקים היומן ושני מסכי האתר */}
          <figure className="hidden sm:block">
            <BrowserFrame address="לוח בקרה · Nuriel Hospitality">
              <Shot
                name="hosp-dashboard"
                kind="desktop"
                sizes="(min-width: 1024px) 600px, 92vw"
                alt="לוח הבקרה של בעל הצימר: התקדמות הקמת העסק, פעולות מהירות, הזמנות חדשות, הכנסות, תפוסה ובקשות שממתינות לאישור"
              />
            </BrowserFrame>
            <figcaption className="mt-3 text-sm text-(--l-on-navy)">
              לוח הבקרה: מה ממתין לכם היום (נתוני הדגמה).
            </figcaption>
          </figure>
          <figure>
            <div className="mx-auto grid max-w-md grid-cols-2 gap-4">
              <PhoneFrame>
                <Shot
                  name="zimmer-site-phone"
                  kind="phone"
                  sizes="(min-width: 1024px) 210px, 44vw"
                  alt="עמוד הבית של אתר נופי דורית בטלפון"
                />
              </PhoneFrame>
              <PhoneFrame>
                <Shot
                  name="zimmer-unit-phone"
                  kind="phone"
                  sizes="(min-width: 1024px) 210px, 44vw"
                  alt="עמוד יחידה באתר נופי דורית בטלפון: היחידה אדיר, מספר האורחים, החדרים והתמונות"
                />
              </PhoneFrame>
            </div>
            <figcaption className="mt-3 text-center text-sm text-(--l-on-navy)">
              נופי דורית — מתחם צימרים בישעי, אתר אמיתי על{" "}
              <bdi dir="ltr">{HOSPITALITY_PRODUCT}</bdi>.
            </figcaption>
          </figure>
        </div>

        <div className="mt-16 grid gap-12 border-t border-white/15 pt-12 lg:grid-cols-2">
          <FeatureList title="האתר של המתחם" items={SITE_FEATURES} />
          <FeatureList title="הניהול שלכם" items={MANAGE_FEATURES} />
        </div>
      </div>
    </section>
  );
}
