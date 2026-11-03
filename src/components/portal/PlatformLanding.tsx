import { useMemo, useState } from "react";
import { useRouteContext } from "@tanstack/react-router";
import { PortalOnboarding } from "@/components/portal/PortalOnboarding";
import type { PortalIntent } from "@/lib/portal";
import { landingFaq, type LandingData } from "@/lib/portal-landing";
import { ComputersSection } from "./landing/ComputersSection";
import { ContactSection } from "./landing/ContactSection";
import { HeroSection, LandingHeader } from "./landing/HeroSection";
import { HospitalitySection } from "./landing/HospitalitySection";
import { FaqSection, WhySection } from "./landing/InfoSections";
import { LandingFooter } from "./landing/LandingFooter";
import { WhatsAppFloat } from "./landing/parts";
import { LANDING_PALETTE } from "./landing/styles";
import { PricingSection } from "./landing/PricingSection";
import { StoreSection } from "./landing/StoreSection";

/**
 * דף הנחיתה של נוריאל מחשבים — עמוד הבית של nuriel-app2 (שער הפלטפורמה), במקום הקטלוג.
 * מרונדר בשרת (SSR) — כל התוכן כבר ב-HTML הראשוני (גוגל, Bing, כלי AI, בלי JavaScript).
 *
 * הדף מיועד לשני המוצרים: חנות אינטרנטית לעסק (14 ימי ניסיון) ואתר הזמנות לצימר — Nuriel
 * Hospitality לצימרים (30 ימי ניסיון) — כל כפתור ניסיון פותח את חלון הכניסה במסלול שלו.
 * המחירים וימי הניסיון — מהמסד בזמן הטעינה (landing); null — המסד לא החזיר: הדף בלי מספרים.
 */
export function PlatformLanding({ landing }: { siteName?: string; landing: LandingData | null }) {
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<PortalIntent>(null);
  const { hostMode } = useRouteContext({ from: "__root__" });
  const baseDomain = hostMode.baseDomain ?? "nuri1.fit";
  const faq = useMemo(() => (landing ? landingFaq(landing) : []), [landing]);

  const start = (next: PortalIntent) => {
    setIntent(next);
    setOpen(true);
  };

  return (
    <div
      dir="rtl"
      id="top"
      className="flex min-h-screen flex-col bg-white font-sans text-(--l-ink) selection:bg-(--l-gold)/40"
      style={LANDING_PALETTE}
      data-testid="platform-landing"
    >
      <LandingHeader onLogin={() => start(null)} />

      <main id="main-content" className="flex-1">
        <HeroSection
          storeTrialDays={landing?.store.trialDays ?? null}
          zimmerTrialDays={landing?.hospitality.trialDays ?? null}
          onStart={start}
        />
        <StoreSection trialDays={landing?.store.trialDays ?? null} onStart={() => start("store")} />
        <HospitalitySection
          trialDays={landing?.hospitality.trialDays ?? null}
          onStart={() => start("zimmer")}
        />
        {landing && <PricingSection data={landing} onStart={start} />}
        <WhySection />
        {/* מי אנחנו — נוריאל מחשבים (החנות והשירות): אחרי שני המוצרים, שהם עיקר הדף */}
        <ComputersSection />
        {faq.length > 0 && <FaqSection items={faq} />}
        <ContactSection />
      </main>

      <LandingFooter />
      <WhatsAppFloat />

      <PortalOnboarding
        open={open}
        onOpenChange={setOpen}
        baseDomain={baseDomain}
        intent={intent}
      />
    </div>
  );
}
