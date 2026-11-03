import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  HOSPITALITY_PRODUCT,
  commonSetupFee,
  shekels,
  trialCta,
  trialLabel,
  type LandingData,
} from "@/lib/portal-landing";
import { SectionHeading } from "./parts";
import { ctaGold, ctaNavy } from "./styles";

type PlanView = {
  code: string;
  name: string;
  price: number | null;
  badge: string | null;
  fit: string;
  tagline: string;
  features: string[];
  /** דמי הקמה — רק לחבילה שיש לה, ורק אם הם לא אחידים לכל החבילות (אחרת בהערה למטה) */
  setupFee: number | null;
};

function PlanCard({
  plan,
  product,
  cta,
  onStart,
  highlight,
}: {
  plan: PlanView;
  product: "store" | "zimmer";
  cta: string;
  onStart: () => void;
  highlight: boolean;
}) {
  return (
    <li
      className={cn(
        "flex flex-col rounded-2xl border bg-white p-6 sm:p-7",
        highlight
          ? "border-(--l-blue) shadow-[0_18px_40px_-28px_rgba(30,58,138,0.7)]"
          : "border-(--l-line)",
      )}
      data-plan={`${product}-${plan.code}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xl font-bold text-(--l-ink)">{plan.name}</h4>
        {plan.badge && (
          <span className="rounded-full bg-(--l-gold)/25 px-3 py-1 text-sm font-semibold text-(--l-gold-ink)">
            {plan.badge}
          </span>
        )}
      </div>
      {plan.price !== null && (
        <p className="mt-4 flex items-baseline gap-2 text-(--l-ink)">
          <span className="font-display text-[2.6rem] font-black leading-none tabular-nums">
            {shekels(plan.price)}
          </span>
          <span className="text-base text-(--l-muted)">לחודש</span>
        </p>
      )}
      {plan.setupFee !== null && (
        <p className="mt-2 text-sm text-(--l-muted)">
          + דמי הקמה חד-פעמיים: <span className="tabular-nums">{shekels(plan.setupFee)}</span>
        </p>
      )}
      <p className="mt-4 font-semibold leading-7 text-(--l-ink)">{plan.fit}</p>
      {plan.tagline && (
        <p className="mt-1 text-[0.95rem] leading-6 text-(--l-muted)">{plan.tagline}</p>
      )}
      {plan.features.length > 0 && (
        <ul className="mt-5 space-y-2.5 border-t border-(--l-line) pt-5">
          {plan.features.map((feature) => (
            <li key={feature} className="flex gap-2 text-[0.95rem] leading-6 text-(--l-ink)">
              <Check className="mt-1 size-4 shrink-0 text-(--l-blue)" aria-hidden="true" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto pt-7">
        <button
          type="button"
          onClick={onStart}
          className={cn(highlight ? ctaGold : ctaNavy, "w-full")}
          data-testid={`plan-cta-${product}-${plan.code}`}
        >
          {cta}
        </button>
      </div>
    </li>
  );
}

/**
 * החבילות והמחירים — מהמסד בלבד (LandingData). שני מוצרים נפרדים, וכל אחד עם תקופת הניסיון
 * שלו: חנות אינטרנטית (14 ימים) ו-Nuriel Hospitality (30 ימים).
 */
export function PricingSection({
  data,
  onStart,
}: {
  data: LandingData;
  onStart: (intent: "store" | "zimmer") => void;
}) {
  const storeDays = data.store.trialDays;
  const zimmerDays = data.hospitality.trialDays;
  const fee = commonSetupFee(data.hospitality.plans);
  const storePlans: PlanView[] = data.store.plans.map((p) => ({
    code: p.code,
    name: p.title,
    price: p.monthlyPrice,
    badge: p.badge,
    fit: p.fit,
    tagline: p.tagline,
    features: p.features,
    setupFee: null,
  }));
  const zimmerPlans: PlanView[] = data.hospitality.plans.map((p) => ({
    code: p.code,
    name: p.name,
    price: p.monthlyPrice,
    badge: null,
    fit: p.fit,
    tagline: p.tagline,
    features: p.highlights,
    setupFee: fee === null ? p.setupFee : null,
  }));

  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 bg-(--l-paper)">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-24">
        <SectionHeading
          id="pricing-title"
          title="חבילות ומחירים"
          lead="שני מוצרים, ולכל אחד תקופת ניסיון משלו. בוחרים חבילה רק בסוף הניסיון."
        />

        {/* חנות אינטרנטית */}
        <div className="mt-12" data-testid="pricing-store">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-2xl font-bold text-(--l-ink)">חנות אינטרנטית</h3>
            <span className="rounded-full bg-(--l-blue) px-3 py-1 text-sm font-semibold text-white">
              {trialLabel(storeDays)} בחינם — לחנות אינטרנטית בלבד
            </span>
          </div>
          <p className="mt-3 max-w-3xl text-[0.95rem] leading-7 text-(--l-muted)">
            בתקופת הניסיון כל הכלים של חבילת הפרימיום פתוחים. בסוף התקופה בוחרים חבילה כדי להמשיך
            למכור — בלי חבילה החנות נסגרת ללקוחות עד שבוחרים.
          </p>
          <ul className="mt-6 grid gap-5 md:grid-cols-2">
            {storePlans.map((plan) => (
              <PlanCard
                key={plan.code}
                plan={plan}
                product="store"
                cta={trialCta(storeDays)}
                onStart={() => onStart("store")}
                highlight={plan.badge !== null}
              />
            ))}
          </ul>
          {(data.store.paymentNote || data.store.vatNote) && (
            <p className="mt-4 max-w-2xl text-sm leading-6 text-(--l-muted)">
              {data.store.paymentNote} {data.store.vatNote}
            </p>
          )}
        </div>

        {/* Nuriel Hospitality */}
        <div className="mt-16 border-t border-(--l-line) pt-14" data-testid="pricing-zimmer">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-2xl font-bold text-(--l-ink)">
              <bdi dir="ltr">{HOSPITALITY_PRODUCT}</bdi>
            </h3>
            <span className="rounded-full bg-(--l-navy) px-3 py-1 text-sm font-semibold text-white">
              {trialLabel(zimmerDays)} בחינם — ל-<bdi dir="ltr">{HOSPITALITY_PRODUCT}</bdi> בלבד
            </span>
          </div>
          <p className="mt-3 max-w-3xl text-[0.95rem] leading-7 text-(--l-muted)">
            בתקופת הניסיון הכול פתוח, בלי תשלום עכשיו. בסוף התקופה מספרים לנו איזו חבילה מתאימה לכם,
            ומקבלים קישור לתשלום לפי החבילה.
          </p>
          {zimmerPlans.length > 0 ? (
            <ul className="mt-6 grid gap-5 md:grid-cols-2">
              {zimmerPlans.map((plan) => (
                <PlanCard
                  key={plan.code}
                  plan={plan}
                  product="zimmer"
                  cta={trialCta(zimmerDays)}
                  onStart={() => onStart("zimmer")}
                  highlight={plan.badge !== null}
                />
              ))}
            </ul>
          ) : (
            <p className="mt-6 rounded-2xl border border-(--l-line) bg-white p-6 text-(--l-ink)">
              לפרטים על החבילות —{" "}
              <a
                href="#contact"
                className="font-semibold text-(--l-blue) underline underline-offset-4"
              >
                דברו איתנו
              </a>
              .
            </p>
          )}
          {fee !== null && (
            <p className="mt-4 text-sm leading-6 text-(--l-muted)" data-testid="setup-fee">
              בכל החבילות: דמי הקמה חד-פעמיים של{" "}
              <span className="tabular-nums">{shekels(fee)}</span> — חיבור דומיין, עיצוב, תוכן
              והגדרות גוגל.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
