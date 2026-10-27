import { useEffect, useRef, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { Check, Copy, Gift, Loader2, Mail, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  emailCouponToMe,
  getCouponShowcase,
  type CouponShowcase,
} from "@/lib/coupon-showcase.functions";
import { marketingConsentText } from "@/lib/marketing-consent";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  NO_MARKETING_PATHS,
  promoSeenKey,
  trackPageView,
  type StorePromo,
  type StoreTracking,
} from "@/lib/marketing";

/** פופ-אפ: לא בקופה (לא מפריעים באמצע תשלום) ולא בעמודי הצוות / החשבון */
// הקופה ודף תוצאת התשלום (חלק 16) — בלי פופ-אפ מבצעים
const NO_POPUP_PATHS = /^\/(checkout|payment|cancellations|contact)(\/|$)/;
const POPUP_DELAY_MS = 1200;

function readSeen(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function markSeen(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // דפדפן פרטי / אחסון חסום — הפופ-אפ פשוט יופיע שוב בכניסה הבאה
  }
}

/**
 * שכבת השיווק של החנות (חלק 14), מעל כל העמודים:
 *  - פופ-אפ מבצעים בכניסה לאתר — פעם אחת לכל נוסח (נוסח חדש מוצג שוב),
 *    עם קוד קופון והעתקה בלחיצה.
 *  - מעבר עמוד בתוך האתר (בלי טעינה מחדש) → PageView ל-Facebook Pixel.
 *    (הקוד עצמו נטען ב-<head> מה-root; GA4 מזהה מעברי עמוד לבד.)
 */
export function MarketingLayer({
  promo,
  tracking,
  sabbath,
}: {
  promo: StorePromo;
  tracking: StoreTracking | null;
  sabbath: boolean;
}) {
  const location = useLocation();
  const path = location.pathname;
  const firstPath = useRef<string | null>(null);

  // PageView רק על מעברים — הטעינה הראשונה נספרת כבר בקוד שב-<head>
  useEffect(() => {
    if (!tracking?.pixelId) return;
    if (firstPath.current === null) {
      firstPath.current = path;
      return;
    }
    if (!NO_MARKETING_PATHS.test(path)) trackPageView();
  }, [path, tracking?.pixelId]);

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // הקופון בפועל: מוצג רק אם הוא עובד עכשיו (פעיל, בתוקף, לא נוצל) — בדיקה בשרת
  const [showcase, setShowcase] = useState<CouponShowcase | null>(null);
  const [mailEmail, setMailEmail] = useState("");
  const [mailConsent, setMailConsent] = useState(false);
  const [mailBusy, setMailBusy] = useState(false);
  const [mailDone, setMailDone] = useState<string | null>(null);
  const { settings } = useSiteSettings();
  const seenKey = promo ? promoSeenKey(promo.text, promo.coupon) : null;
  const eligible =
    promo !== null && !sabbath && !NO_MARKETING_PATHS.test(path) && !NO_POPUP_PATHS.test(path);

  useEffect(() => {
    if (!eligible || !seenKey || readSeen(seenKey)) return;
    const timer = window.setTimeout(() => setOpen(true), POPUP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [eligible, seenKey]);

  const promoCoupon = promo?.coupon ?? null;
  useEffect(() => {
    if (!open || !promoCoupon) return;
    let cancelled = false;
    void getCouponShowcase({ data: { code: promoCoupon } })
      .then((result) => !cancelled && setShowcase(result))
      .catch(() => !cancelled && setShowcase(null));
    // לקוח מחובר — ממלאים את האימייל של החשבון
    void supabase.auth.getUser().then(({ data }) => {
      const email = data.user?.email;
      if (!cancelled && email) setMailEmail((current) => current || email);
    });
    return () => {
      cancelled = true;
    };
  }, [open, promoCoupon]);

  if (!promo) return null;
  const coupon = showcase && showcase.code === promoCoupon ? showcase : null;

  const sendByMail = async () => {
    if (!coupon) return;
    setMailBusy(true);
    try {
      const result = await emailCouponToMe({
        data: { code: coupon.code, email: mailEmail, consent: mailConsent },
      });
      if (result.ok) setMailDone(result.message);
      else toast.error(result.message);
    } catch {
      toast.error("השליחה נכשלה — נסו שוב בעוד רגע");
    } finally {
      setMailBusy(false);
    }
  };

  const close = () => {
    setOpen(false);
    if (seenKey) markSeen(seenKey);
  };

  const copyCode = async () => {
    if (!coupon) return;
    try {
      await navigator.clipboard.writeText(coupon.code);
      setCopied(true);
      toast.success(`הקוד ${coupon.code} הועתק — הדביקו אותו בקופה`);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.info(`הקוד: ${coupon.code}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogContent dir="rtl" className="max-w-md overflow-hidden p-0 text-right">
        <div className="relative bg-gradient-to-bl from-primary to-primary/80 px-6 pb-8 pt-9 text-center text-primary-foreground">
          <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg ring-4 ring-primary-foreground/20">
            <Gift className="size-8" aria-hidden="true" />
          </span>
          <DialogTitle className="mt-4 font-display text-2xl font-black leading-tight">
            יש לנו הפתעה בשבילכם!
          </DialogTitle>
        </div>
        <div className="space-y-5 px-6 pb-6 pt-5">
          <DialogDescription asChild>
            <p className="whitespace-pre-line break-words text-center text-base leading-7 text-foreground">
              {promo.text}
            </p>
          </DialogDescription>
          {coupon && (
            <div className="space-y-3" data-promo-coupon>
              <p className="text-center text-sm font-bold text-foreground">
                קוד קופון להזמנה ראשונה באתר
              </p>
              <button
                type="button"
                onClick={() => void copyCode()}
                className="group mx-auto flex w-full max-w-xs items-center justify-between gap-3 rounded-xl border-2 border-dashed border-accent bg-accent/10 px-4 py-3 transition hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`העתקת קוד הקופון ${coupon.code}`}
              >
                <span className="text-xs font-semibold text-muted-foreground">{coupon.label}</span>
                <span
                  dir="ltr"
                  className="font-mono text-xl font-black tracking-widest text-foreground"
                >
                  {coupon.code}
                </span>
                <span className="flex items-center gap-1 text-xs font-bold text-primary">
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied ? "הועתק" : "העתקה"}
                </span>
              </button>
              {coupon.conditions && (
                <p className="text-center text-xs text-muted-foreground">{coupon.conditions}</p>
              )}

              {mailDone ? (
                <p
                  role="status"
                  className="rounded-lg bg-green-50 p-2.5 text-center text-sm font-medium text-green-800"
                  data-promo-mail-done
                >
                  {mailDone}
                </p>
              ) : (
                <form
                  className="space-y-2 rounded-lg border border-border p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void sendByMail();
                  }}
                  data-promo-mail-form
                >
                  <Input
                    type="email"
                    dir="ltr"
                    inputMode="email"
                    autoComplete="email"
                    required
                    value={mailEmail}
                    onChange={(event) => setMailEmail(event.target.value)}
                    placeholder="האימייל שלכם"
                    aria-label="אימייל לקבלת הקופון"
                    className="text-right"
                  />
                  <label className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                    <Checkbox
                      checked={mailConsent}
                      onCheckedChange={(value) => setMailConsent(value === true)}
                      className="mt-0.5"
                      aria-label="אישור קבלת דיוור"
                    />
                    <span>
                      {marketingConsentText(
                        settings?.business_name?.trim() || settings?.site_title || "",
                        "account",
                      )}
                    </span>
                  </label>
                  <Button
                    type="submit"
                    variant="outline"
                    className="w-full"
                    disabled={mailBusy || !mailConsent || mailEmail.trim() === ""}
                  >
                    {mailBusy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Mail className="size-4" />
                    )}
                    שלחו לי במייל
                  </Button>
                </form>
              )}
            </div>
          )}
          <Button type="button" size="lg" className="w-full text-base font-bold" onClick={close}>
            <ShoppingBag className="size-5" />
            להתחלת הקנייה
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
