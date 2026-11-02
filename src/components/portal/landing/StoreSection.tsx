import { Check, ExternalLink } from "lucide-react";
import { STORE_DEMO_URL, trialCta, trialLabel } from "@/lib/portal-landing";
import { BrowserFrame, NewTabNote, PhoneFrame, SectionHeading, Shot } from "./parts";
import { EXTERNAL, ctaGold, ctaOutline } from "./styles";

/** שלושת השלבים — הסדר האמיתי של פתיחת חנות בשער */
const STEPS = [
  { title: "מזינים אימייל", text: "מקבלים קוד חד-פעמי (או נכנסים עם Google). בלי סיסמאות." },
  {
    title: "שם, כתובת ופרטי העסק",
    text: "הכתובת באנגלית נוצרת מהשם, והתקנון מתמלא מפרטי העסק.",
  },
  {
    title: "מוסיפים מוצרים ומוכרים",
    text: "החנות עולה בכתובת מאובטחת (SSL), עם אזור ניהול מלא.",
  },
] as const;

/** היכולות — רק מה שקיים בניהול החנות (נבדק מול הקוד); "פרימיום" — רק בחבילת הפרימיום */
const CAPABILITIES = [
  {
    title: "מוצרים וקטלוג",
    items: [
      "מוצרים וקטגוריות, עם תמונות",
      "וריאציות — מידה וצבע (פרימיום)",
      "מוצרים דיגיטליים ורישיונות (פרימיום)",
      "מחירים מיוחדים ללקוחות מסוימים",
    ],
  },
  {
    title: "הזמנות, מלאי ומשלוחים",
    items: [
      "ניהול הזמנות וסטטוסים",
      "שיטות משלוח ואיסוף עצמי",
      "ליקוט, שליחים ומדבקות משלוח",
      "מלאי, ספירות ומספרים סידוריים",
      "מכירה בקופה (POS)",
    ],
  },
  {
    title: "שיווק ומכירות",
    items: [
      "קופונים ומבצעים בעגלה",
      "תזכורות לעגלות נטושות",
      "ביקורות על מוצרים",
      "הגדרות SEO, Google Analytics ו-Facebook Pixel (אחרי הסכמת הגולש)",
      "מצב שבת וחגים אוטומטי",
    ],
  },
  {
    title: "ניהול ועיצוב",
    items: [
      "לוח בקרה: הכנסות, הזמנות ולקוחות",
      "לוגו, צבע מותג ובאנרים",
      "דפי תוכן, תקנון ומדיניות",
      "צוות והרשאות, ותיבת פניות מהאתר",
      "דומיין משלכם (פרימיום)",
    ],
  },
] as const;

export function StoreSection({
  trialDays,
  onStart,
}: {
  trialDays: number | null;
  onStart: () => void;
}) {
  return (
    <section
      id="online-store"
      aria-labelledby="online-store-title"
      className="scroll-mt-20 border-y border-(--l-line) bg-(--l-paper)"
    >
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
        <SectionHeading
          id="online-store-title"
          title="הקמת חנות אינטרנטית לעסק — בלי ידע טכני"
          lead="פלטפורמה בעברית לבניית חנות אונליין: נרשמים עם קוד למייל, בוחרים שם וכתובת, ונכנסים ישר לניהול החנות. גם החנות של נוריאל מחשבים בנויה עליה."
        />

        <div className="mt-12 grid items-start gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
          <div>
            <h3 className="text-xl font-bold text-(--l-ink)">איך פותחים חנות</h3>
            <ol className="mt-6 space-y-5">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-4">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-(--l-blue) font-bold text-white"
                  >
                    {index + 1}
                  </span>
                  <div>
                    <p className="font-bold text-(--l-ink)">{step.title}</p>
                    <p className="mt-0.5 text-[0.95rem] leading-7 text-(--l-muted)">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <button type="button" onClick={onStart} className={ctaGold} data-testid="store-trial">
                {trialCta(trialDays)}
              </button>
              <a href={STORE_DEMO_URL} {...EXTERNAL} className={ctaOutline}>
                צפו בחנות לדוגמה
                <ExternalLink className="size-4" aria-hidden="true" />
                <NewTabNote />
              </a>
            </div>
            <p className="mt-4 text-sm leading-6 text-(--l-muted)">
              {trialLabel(trialDays)} לחנות אינטרנטית בלבד — כל הכלים של חבילת הפרימיום פתוחים, בלי
              כרטיס אשראי.
            </p>
          </div>

          <figure>
            <div className="relative pb-10">
              <BrowserFrame address="nuriel-shop.nuri1.fit">
                <Shot
                  name="store-home"
                  kind="desktop"
                  sizes="(min-width: 1024px) 600px, 92vw"
                  alt="עמוד הבית של החנות של נוריאל מחשבים: קטגוריות בצד, באנר מחשבים ומבצעים חמים"
                />
              </BrowserFrame>
              <PhoneFrame className="absolute bottom-0 start-[-0.5rem] w-[28%] sm:start-[-1rem]">
                <Shot
                  name="store-product-phone"
                  kind="phone"
                  sizes="(min-width: 1024px) 170px, 28vw"
                  alt="עמוד מוצר בחנות של נוריאל מחשבים בטלפון: תמונת המוצר, שם ומחיר"
                />
              </PhoneFrame>
            </div>
            <figcaption className="mt-4 text-sm leading-6 text-(--l-muted)">
              החנות של נוריאל מחשבים — חנות אמיתית על המערכת: מחשב ונייד.
            </figcaption>
          </figure>
        </div>

        <div className="mt-16 grid gap-x-10 gap-y-10 border-t border-(--l-line) pt-12 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map((group) => (
            <div key={group.title}>
              <h3 className="text-lg font-bold text-(--l-ink)">{group.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {group.items.map((item) => (
                  <li key={item} className="flex gap-2 text-[0.95rem] leading-6 text-(--l-muted)">
                    <Check className="mt-1 size-4 shrink-0 text-(--l-blue)" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
