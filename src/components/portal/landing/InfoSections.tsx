import {
  Headphones,
  KeyRound,
  Languages,
  Plus,
  ShieldCheck,
  Smartphone,
  Store,
} from "lucide-react";
import { HOSPITALITY_PRODUCT, type FaqItem } from "@/lib/portal-landing";
import { SectionHeading } from "./parts";

/** למה נוריאל — יתרונות אמיתיים בלבד (כל אחד נבדק מול המערכת) */
const REASONS = [
  {
    icon: Store,
    title: "עסק אמיתי, לא רק תוכנה",
    text: "נוריאל מחשבים מוכרים ומתקנים מחשבים בבית שמש — והחנות שלנו עצמה רצה על המערכת.",
  },
  {
    icon: Languages,
    title: "עברית מהיסוד",
    text: "האתר, אזור הניהול והמיילים — בעברית מלאה, מימין לשמאל.",
  },
  {
    icon: Smartphone,
    title: "מותאם לטלפון",
    text: "הלקוחות קונים ומזמינים מהנייד, ואתם מנהלים מכל מקום.",
  },
  {
    icon: ShieldCheck,
    title: "כתובת מאובטחת מהיום הראשון",
    text: "תעודת SSL אוטומטית לכל אתר, וחיבור דומיין משלכם כשתרצו.",
  },
  {
    icon: KeyRound,
    title: "כניסה בלי סיסמאות",
    text: "קוד חד-פעמי למייל או חשבון Google — ומי שבצוות רואה רק את מה שמותר לו.",
  },
  {
    icon: Headphones,
    title: "ליווי בהקמה",
    text: `בעלי צימרים ב-${HOSPITALITY_PRODUCT} מקבלים מדריך הקמה ושיחה מאיתנו תוך יום עסקים.`,
  },
] as const;

export function WhySection() {
  return (
    <section id="why" aria-labelledby="why-title" className="scroll-mt-20 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
        <SectionHeading id="why-title" title="למה לבחור בנוריאל" />
        <dl className="mt-12 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {REASONS.map(({ icon: Icon, title, text }) => (
            <div key={title}>
              <dt className="flex items-center gap-2.5 text-lg font-bold text-(--l-ink)">
                <Icon className="size-5 shrink-0 text-(--l-blue)" aria-hidden="true" />
                {title}
              </dt>
              <dd className="mt-2 text-[0.95rem] leading-7 text-(--l-muted)">{text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/**
 * שאלות נפוצות — <details> רגיל: התשובות נמצאות ב-HTML (גם לסורקים ולקוראי מסך) ונפתחות
 * בלי JavaScript. הטקסט זהה לזה שב-JSON-LD (landingFaq).
 */
export function FaqSection({ items }: { items: FaqItem[] }) {
  return (
    <section
      id="faq"
      aria-labelledby="faq-title"
      className="scroll-mt-20 border-t border-(--l-line) bg-white"
    >
      <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:py-24">
        <SectionHeading id="faq-title" title="שאלות נפוצות" />
        <div className="mt-10 divide-y divide-(--l-line) border-y border-(--l-line)">
          {items.map((item) => (
            <details key={item.q} className="group py-1" data-testid="faq-item">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-start text-lg font-semibold text-(--l-ink) marker:hidden focus-visible:outline-2 focus-visible:outline-(--l-blue) [&::-webkit-details-marker]:hidden">
                <h3 className="text-lg font-semibold">{item.q}</h3>
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full border border-(--l-line) text-(--l-blue) transition-transform motion-reduce:transition-none group-open:rotate-45"
                >
                  <Plus className="size-4" />
                </span>
              </summary>
              <p className="pb-5 text-base leading-7 text-(--l-muted)">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
