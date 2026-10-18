import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { Cookie } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useLiftA11yButton } from "@/hooks/useLiftA11yButton";
import { NO_MARKETING_PATHS, trackingHeadScripts, type StoreTracking } from "@/lib/marketing";

/**
 * חלק 40: הסכמה לעוגיות מדידה ופרסום (Google Analytics / Meta Pixel).
 *
 * הסקריפטים נטענים רק אחרי "אישור" — לא בטעינת העמוד. "דחייה" שקולה לאישור
 * (אותו גודל ואותו עיצוב — בלי "דפוסים אפלים"), והאתר עובד מלא גם בלי.
 * הבחירה נשמרת בדפדפן לכל חנות בנפרד (localStorage לפי הדומיין), ואפשר
 * לשנות אותה בכל עת: "הגדרות עוגיות" בתחתית האתר.
 * הבאנר מופיע רק בחנות שהגדירה Pixel או Analytics.
 */

const CONSENT_KEY = "tracking-consent:v1";
export const OPEN_COOKIE_SETTINGS_EVENT = "open-cookie-settings";

type Choice = "granted" | "denied";

function readChoice(): Choice | null {
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

function writeChoice(choice: Choice): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, choice);
  } catch {
    // דפדפן פרטי / אחסון חסום — הבחירה תחול רק על הביקור הנוכחי
  }
}

type TrackingWindow = Window & { __trackingInjected?: boolean };

/** טעינת קוד המעקב הרשמי (פעם אחת בלבד) */
function injectTracking(tracking: StoreTracking): void {
  const w = window as TrackingWindow;
  if (w.__trackingInjected) return;
  w.__trackingInjected = true;
  for (const script of trackingHeadScripts(tracking)) {
    const el = document.createElement("script");
    if (script.src) el.src = script.src;
    if (script.async) el.async = true;
    if (script.children) el.textContent = script.children;
    el.dataset["tracking"] = "1";
    document.head.appendChild(el);
  }
}

/** מחיקת עוגיות המעקב שכבר נשמרו (אחרי משיכת הסכמה) */
function clearTrackingCookies(): void {
  const host = window.location.hostname;
  const domains = ["", host, `.${host}`, `.${host.split(".").slice(-2).join(".")}`];
  for (const raw of document.cookie.split(";")) {
    const name = raw.split("=")[0]?.trim() ?? "";
    if (!/^(_ga|_gid|_gat|_gcl|_fbp|_fbc)/.test(name)) continue;
    for (const domain of domains) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain ? `; domain=${domain}` : ""}`;
    }
  }
}

export function TrackingConsent({ tracking }: { tracking: StoreTracking | null }) {
  const path = useLocation().pathname;
  const hasTracking = Boolean(tracking && (tracking.pixelId || tracking.gaId));
  const [choice, setChoice] = useState<Choice | null | undefined>(undefined);
  const [reopened, setReopened] = useState(false);
  const hasTrackingRef = useRef(hasTracking);
  hasTrackingRef.current = hasTracking;

  useEffect(() => {
    setChoice(readChoice());
    const reopen = () => {
      if (!hasTrackingRef.current) {
        toast.info(
          "האתר לא משתמש בעוגיות מדידה או פרסום — רק בעוגיות הכרחיות לפעולת האתר (סל, התחברות).",
        );
        return;
      }
      setReopened(true);
    };
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, reopen);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, reopen);
  }, []);

  // אישור (עכשיו או בביקור קודם) → טעינת הקוד; לא באזורי הניהול והחשבון
  useEffect(() => {
    if (choice === "granted" && tracking && hasTracking && !NO_MARKETING_PATHS.test(path)) {
      injectTracking(tracking);
    }
  }, [choice, tracking, hasTracking, path]);

  if (!hasTracking || choice === undefined) return null;
  const visible = reopened || (choice === null && !NO_MARKETING_PATHS.test(path));
  if (!visible) return null;

  const decide = (next: Choice) => {
    const wasGranted = choice === "granted" || (window as TrackingWindow).__trackingInjected;
    writeChoice(next);
    setChoice(next);
    setReopened(false);
    if (next === "denied" && wasGranted) {
      // קוד שכבר נטען לא "נפרק" — מוחקים את העוגיות וטוענים את העמוד מחדש בלעדיו
      clearTrackingCookies();
      window.location.reload();
    }
  };

  return <ConsentBanner current={choice} onDecide={decide} />;
}

function ConsentBanner({
  current,
  onDecide,
}: {
  current: Choice | null;
  onDecide: (choice: Choice) => void;
}) {
  // כפתור הנגישות עולה מעל הבאנר
  useLiftA11yButton("8.5rem", "(max-width: 100000px)");
  return (
    <section
      aria-label="הסכמה לעוגיות"
      data-testid="cookie-banner"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/98 px-4 py-3 shadow-[0_-6px_20px_rgba(0,0,0,0.12)] backdrop-blur"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-sm text-foreground">
          <Cookie className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          <span>
            נשמח להשתמש בעוגיות של Google Analytics ו-Meta (פייסבוק) כדי למדוד שימוש באתר ולהציג
            פרסומות מותאמות. האתר עובד מלא גם בלי.{" "}
            <Link to="/privacy" className="text-primary underline">
              מדיניות הפרטיות
            </Link>
            {current && (
              <span className="text-muted-foreground">
                {" "}
                · הבחירה הנוכחית: {current === "granted" ? "אושר" : "נדחה"}
              </span>
            )}
          </span>
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            className="min-w-24"
            onClick={() => onDecide("granted")}
            data-testid="cookie-accept"
          >
            אישור
          </Button>
          <Button
            variant="outline"
            className="min-w-24"
            onClick={() => onDecide("denied")}
            data-testid="cookie-decline"
          >
            דחייה
          </Button>
        </div>
      </div>
    </section>
  );
}
