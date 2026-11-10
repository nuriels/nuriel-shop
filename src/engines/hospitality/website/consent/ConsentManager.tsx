// Google SEO שלב 4: הסכמה ל-Cookies באתר האירוח — הבאנר, חלון ההגדרות והחלת הבחירה.
//   • כשאין באתר שום דבר שדורש הסכמה (המדידה לא זמינה — היום בכל האתרים): אין באנר ואין קוד של Google;
//     הקישור "הגדרות Cookies" בפוטר פותח חלון שמסביר שהאתר משתמש רק בשמירה הכרחית.
//   • כשהמדידה זמינה (המתג + מזהה GA4): באנר עד שהגולש בוחר — "אישור" ו"סירוב" באותו משקל, "הגדרות"
//     לחלון. לפני אישור לא נטען שום קוד של Google (ga.ts). הבחירה נשמרת בדפדפן ונרשמת בשרת (אנונימית).
//   • נגישות: הבאנר הוא אזור עם שם (לא חלון שתופס את הפוקוס), מופיע בתחילת העמוד לקורא המסך ולמקלדת
//     (אחרי "דילוג לתוכן"), ונראה בתחתית המסך — מעל שורת הפעולות בטלפון. החלון — מגירת הצד של האתר
//     (מלכודת פוקוס, Esc, הפוקוס חוזר).
//   • בתצוגה המקדימה של העורך — כלום (לא באנר ולא מדידה).
import { Link, useLocation } from "@tanstack/react-router";
import { Cookie } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/platform/ui";
import { hospitalitySiteConsent } from "../../api/website.functions";
import { useCopy } from "../copy";
import { hasActionBar } from "../lib/action-bar";
import { useSite } from "../lib/site-context";
import { themeStyle } from "../theme/themes";
import {
  SidePanel,
  SidePanelClose,
  SidePanelContent,
  SidePanelDescription,
  SidePanelTitle,
} from "../components/SidePanel";
import {
  CONSENT_POLICY_VERSION,
  analyticsGranted,
  consentAction,
  needsDecision,
  type ConsentState,
} from "./consent";
import { denyAnalytics, grantAnalytics } from "./ga";
import { consentStore, useConsent, useConsentAnnouncement, useConsentPanel } from "./store";

/** שומר בחירה: בדפדפן מיד, ובשרת ברקע (רשומה אנונימית — כישלון לא מפריע לגולש) */
function choose(previous: ConsentState | null, analytics: boolean, via: "banner" | "panel") {
  const action = consentAction(previous, analytics, via);
  const next = consentStore.choose(analytics);
  void hospitalitySiteConsent({
    data: { consentId: next.id, analytics, action, policyVersion: CONSENT_POLICY_VERSION },
  }).catch(() => undefined);
  return next;
}

export function ConsentManager() {
  const { site, preview } = useSite();
  const consent = useConsent();
  const available = !preview && Boolean(site.analytics?.ga4);
  const ga4 = site.analytics?.ga4 ?? null;
  const granted = analyticsGranted(consent, available);
  const wasGranted = useRef(false);

  // החלת הבחירה: אישור — טוענים / מעדכנים; ביטול אחרי אישור — חוסמים ומוחקים את ה-Cookies של המדידה
  useEffect(() => {
    if (granted && ga4) {
      grantAnalytics(ga4);
      wasGranted.current = true;
    } else if (wasGranted.current) {
      denyAnalytics();
      wasGranted.current = false;
    }
  }, [granted, ga4]);

  if (preview) return null;
  return (
    <>
      {needsDecision(consent, available) && <ConsentBanner />}
      <CookiePanel available={available} />
      {/* הודעת "הבחירה נשמרה" — רק כשיש באתר מה לבחור (אחרת אין בחירה, ואין אזור הודעות נוסף בעמוד) */}
      {available && <ConsentAnnouncement />}
    </>
  );
}

function ConsentAnnouncement() {
  const text = useConsentAnnouncement();
  return (
    <p role="status" className="sr-only" data-testid="consent-status">
      {text}
    </p>
  );
}

function ConsentBanner() {
  const t = useCopy();
  const { pathname } = useLocation();
  const consent = useConsent();
  const textId = useId();
  return (
    <section
      aria-label={t.consent.bannerLabel}
      aria-describedby={textId}
      data-testid="consent-banner"
      className={cn(
        "fixed inset-x-3 z-40 mx-auto max-w-3xl rounded-lg border border-border bg-background p-4 text-foreground shadow-2xl sm:inset-x-6 sm:p-5 print:hidden",
        // מעל שורת הפעולות הקבועה בטלפון (כמו כפתור הנגישות), כך שלא תסתיר את החיוג וההזמנה
        hasActionBar(pathname)
          ? "bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-6"
          : "bottom-3 sm:bottom-6",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <p id={textId} className="flex-1 text-sm leading-relaxed">
          <Cookie className="me-1.5 inline size-4 align-[-2px]" aria-hidden="true" />
          {t.consent.bannerText}
        </p>
        <div className="flex flex-wrap gap-2">
          {/* אישור וסירוב באותו גודל ובאותו משקל — בלי לדחוף לבחירה אחת */}
          <button
            type="button"
            onClick={() => {
              choose(consent, true, "banner");
              consentStore.announce(t.consent.saved);
            }}
            className="inline-flex min-h-11 min-w-24 items-center justify-center rounded-md border border-primary bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            data-testid="consent-accept"
          >
            {t.consent.accept}
          </button>
          <button
            type="button"
            onClick={() => {
              choose(consent, false, "banner");
              consentStore.announce(t.consent.saved);
            }}
            className="inline-flex min-h-11 min-w-24 items-center justify-center rounded-md border border-primary bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            data-testid="consent-reject"
          >
            {t.consent.reject}
          </button>
          <button
            type="button"
            onClick={() => consentStore.setPanelOpen(true)}
            className="inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-medium underline underline-offset-4 hover:no-underline"
            data-testid="consent-settings"
          >
            {t.consent.settings}
          </button>
        </div>
      </div>
    </section>
  );
}

function CookiePanel({ available }: { available: boolean }) {
  const t = useCopy();
  const { theme, design } = useSite();
  const open = useConsentPanel();
  const consent = useConsent();
  const [analytics, setAnalytics] = useState(false);
  const toggleId = useId();

  // בכל פתיחה — הבחירה השמורה (בלי בחירה: כבוי)
  useEffect(() => {
    if (open) setAnalytics(consent?.analytics ?? false);
  }, [open, consent]);

  return (
    <SidePanel open={open} onOpenChange={(o) => consentStore.setPanelOpen(o)}>
      <SidePanelContent
        closeLabel={t.consent.close}
        dir={t.dir}
        lang={t.locale}
        style={themeStyle(theme, design.colors[theme.id], design.fonts?.[theme.id])}
        data-testid="consent-panel"
      >
        <div className="border-b border-border px-6 pt-5 pb-4 pe-16">
          <SidePanelTitle className="font-display text-2xl font-medium">
            {t.consent.panelTitle}
          </SidePanelTitle>
          <SidePanelDescription className="mt-1 text-sm text-muted-foreground">
            {available ? t.consent.panelIntro : t.consent.onlyNecessary}
          </SidePanelDescription>
        </div>
        <div className="flex-1 space-y-4 px-4 py-5 text-sm">
          <section className="rounded-md border border-border px-3 py-3">
            <h3 className="mb-1 text-base font-medium">{t.consent.necessaryTitle}</h3>
            <p className="text-muted-foreground">{t.consent.necessaryText}</p>
          </section>
          {available && (
            <section className="rounded-md border border-border px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 id={`${toggleId}-title`} className="mb-1 text-base font-medium">
                    {t.consent.analyticsTitle}
                  </h3>
                  <p id={`${toggleId}-text`} className="text-muted-foreground">
                    {t.consent.analyticsText}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={analytics}
                  aria-labelledby={`${toggleId}-title`}
                  aria-describedby={`${toggleId}-text`}
                  onClick={() => setAnalytics((a) => !a)}
                  className={cn(
                    "inline-flex min-h-11 min-w-16 shrink-0 items-center justify-center rounded-full border px-3 text-sm font-medium",
                    analytics
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:bg-muted",
                  )}
                  data-testid="consent-analytics"
                >
                  {analytics ? t.consent.on : t.consent.off}
                </button>
              </div>
            </section>
          )}
          <p className="text-muted-foreground">{t.consent.videos}</p>
          {available && (
            <button
              type="button"
              onClick={() => {
                choose(consent, analytics, "panel");
                consentStore.setPanelOpen(false);
                consentStore.announce(t.consent.saved);
              }}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-base font-medium text-primary-foreground hover:opacity-90"
              data-testid="consent-save"
            >
              {t.consent.save}
            </button>
          )}
          <div className="border-t border-border pt-4">
            <SidePanelClose asChild>
              <Link
                to="/stay/privacy"
                className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
              >
                {t.consent.privacy}
              </Link>
            </SidePanelClose>
          </div>
        </div>
      </SidePanelContent>
    </SidePanel>
  );
}

/** הקישור בפוטר — פותח את חלון ההגדרות (בכל אתר, גם כשאין מה לאשר) */
export function CookieSettingsButton({ className }: { className?: string }) {
  const t = useCopy();
  return (
    <button
      type="button"
      onClick={() => consentStore.setPanelOpen(true)}
      className={className}
      data-testid="footer-cookies"
    >
      {t.footer.cookies}
    </button>
  );
}
