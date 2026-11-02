import { ExternalLink, MapPin, Phone } from "lucide-react";
import {
  COMPUTER_GROUPS,
  COMPUTER_SERVICES,
  MAPS_URL,
  NURIEL_BUSINESS,
  STORE_DEMO_URL,
  fullAddress,
  storeCategoryUrl,
  telHref,
  whatsappHref,
} from "@/lib/portal-landing";
import { NewTabNote, SectionHeading, WhatsAppIcon } from "./parts";
import { EXTERNAL, ctaNavy, ctaOutline } from "./styles";

/**
 * נוריאל מחשבים — החנות והשירות. הקטגוריות הן הקטגוריות האמיתיות בחנות (כל קישור מוביל
 * לקטגוריה קיימת), והשירותים — כפי שהעסק מתאר אותם בחנות שלו.
 */
export function ComputersSection() {
  return (
    <section id="computers" aria-labelledby="computers-title" className="scroll-mt-20 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
        <SectionHeading
          id="computers-title"
          title="נוריאל מחשבים — מחשבים, ציוד ושירות בבית שמש"
          lead="מחשבים ניידים ונייחים, מחשבים מחודשים, רכיבים לשדרוג, מסכים, מדפסות וציוד היקפי — לבית ולעסק. מזמינים בחנות באתר, ולשירות, תיקון ושדרוג פונים אלינו ישירות."
        />

        <div className="mt-12 grid gap-12 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
          <div>
            <h3 className="text-xl font-bold text-(--l-ink)">מה יש בחנות</h3>
            <p id="store-links-note" className="mt-1 text-sm text-(--l-muted)">
              כל קישור פותח את הקטגוריה בחנות של נוריאל מחשבים, בחלון חדש.
            </p>
            <div className="mt-6 grid gap-8 sm:grid-cols-2">
              {COMPUTER_GROUPS.map((group) => (
                <div key={group.title}>
                  <h4 className="text-[0.95rem] font-bold text-(--l-blue)">{group.title}</h4>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {group.items.map((item) => (
                      <li key={item.category}>
                        <a
                          href={storeCategoryUrl(item.category)}
                          {...EXTERNAL}
                          aria-describedby="store-links-note"
                          className="inline-flex min-h-10 items-center rounded-full border border-(--l-line) bg-(--l-paper) px-4 text-[0.95rem] font-medium text-(--l-ink) transition-colors hover:border-(--l-blue)/40 hover:bg-white hover:text-(--l-blue) focus-visible:outline-2 focus-visible:outline-(--l-blue)"
                        >
                          {item.label ?? item.category}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xl font-bold text-(--l-ink)">שירות ותמיכה</h3>
            <dl className="mt-6 divide-y divide-(--l-line) border-y border-(--l-line)">
              {COMPUTER_SERVICES.map((service) => (
                <div key={service.title} className="py-4">
                  <dt className="font-bold text-(--l-ink)">{service.title}</dt>
                  <dd className="mt-1 text-[0.95rem] leading-7 text-(--l-muted)">{service.text}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 flex items-start gap-2 text-[0.95rem] leading-7 text-(--l-muted)">
              <MapPin className="mt-1 size-4 shrink-0 text-(--l-blue)" aria-hidden="true" />
              <span>
                {fullAddress()} ·{" "}
                <a
                  href={MAPS_URL}
                  {...EXTERNAL}
                  className="font-medium text-(--l-blue) underline underline-offset-4"
                >
                  ניווט בגוגל מפות
                  <NewTabNote />
                </a>
              </span>
            </p>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <a href={STORE_DEMO_URL} {...EXTERNAL} className={ctaNavy}>
            לחנות של נוריאל מחשבים
            <ExternalLink className="size-4" aria-hidden="true" />
            <NewTabNote />
          </a>
          <a
            href={whatsappHref("שלום, אשמח לעזרה עם מחשב (תיקון / שדרוג / קנייה)")}
            {...EXTERNAL}
            className={ctaOutline}
          >
            <WhatsAppIcon className="size-5 text-[#0f7d6f]" />
            WhatsApp לשירות
            <NewTabNote />
          </a>
          <a href={telHref()} className={ctaOutline}>
            <Phone className="size-4" aria-hidden="true" />
            <span dir="ltr">{NURIEL_BUSINESS.phone}</span>
          </a>
        </div>
      </div>
    </section>
  );
}
