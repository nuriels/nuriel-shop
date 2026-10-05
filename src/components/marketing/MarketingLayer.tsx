import { useEffect, useRef, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { Check, Copy, Gift, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
const NO_POPUP_PATHS = /^\/(checkout|payment)(\/|$)/;
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
  const seenKey = promo ? promoSeenKey(promo.text, promo.coupon) : null;
  const eligible =
    promo !== null && !sabbath && !NO_MARKETING_PATHS.test(path) && !NO_POPUP_PATHS.test(path);

  useEffect(() => {
    if (!eligible || !seenKey || readSeen(seenKey)) return;
    const timer = window.setTimeout(() => setOpen(true), POPUP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [eligible, seenKey]);

  if (!promo) return null;

  const close = () => {
    setOpen(false);
    if (seenKey) markSeen(seenKey);
  };

  const copyCode = async () => {
    if (!promo.coupon) return;
    try {
      await navigator.clipboard.writeText(promo.coupon);
      setCopied(true);
      toast.success(`הקוד ${promo.coupon} הועתק — הדביקו אותו בקופה`);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.info(`הקוד: ${promo.coupon}`);
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
          {promo.coupon && (
            <button
              type="button"
              onClick={() => void copyCode()}
              className="group mx-auto flex w-full max-w-xs items-center justify-between gap-3 rounded-xl border-2 border-dashed border-accent bg-accent/10 px-4 py-3 transition hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`העתקת קוד הקופון ${promo.coupon}`}
            >
              <span className="text-xs font-semibold text-muted-foreground">קוד קופון</span>
              <span
                dir="ltr"
                className="font-mono text-xl font-black tracking-widest text-foreground"
              >
                {promo.coupon}
              </span>
              <span className="flex items-center gap-1 text-xs font-bold text-primary">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "הועתק" : "העתקה"}
              </span>
            </button>
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
