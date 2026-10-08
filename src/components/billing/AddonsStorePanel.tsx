import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarClock,
  Check,
  CircleCheck,
  Clock,
  Crown,
  ExternalLink,
  FileDown,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  Puzzle,
  RefreshCw,
  Scale,
  ShoppingBag,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { getAddonsStore, purchaseAddon, quoteAddon } from "@/lib/addons.functions";
import {
  ZAP_ADDON_NOTE,
  ZAP_ADDON_NOTE_SOON,
  ZAP_COMING_SOON,
  addonButtonState,
  addonPriceLabel,
  type AddonOffer,
  type AddonsStore,
} from "@/lib/addons";
import { ZAP_JOIN_URL, zapFeedUrl } from "@/lib/marketing";
import { CopyValueButton } from "@/components/CopyValueButton";
import { PLAN_LABELS, formatDate, formatShekels, type AddonName } from "@/lib/subscription";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * "שדרוגים ותוספים" בפאנל הניהול (חלק 15).
 *
 * כרטיס לכל תוסף: בחבילת פרימיום (ובתקופת הניסיון) — כפתור ירוק "כלול
 * בחבילה שלך"; בחבילה הבסיסית — "רכש תוסף", שפותח חלון עם המחיר היחסי עד
 * סוף תקופת המנוי ואישור רכישה. הפיצ'ר נפתח מיד אחרי הרכישה.
 * זאפ — כרטיס בולט נפרד: 250 ₪ חד-פעמי לכולם (גם בפרימיום).
 *
 * התשלום — ידני (חלק 28): הרכישה נרשמת ב"המנוי שלי" כממתינה לתשלום, הצוות
 * מתאם את הגבייה (העברה בנקאית וכו') ומנהל הפלטפורמה מתעד את התשלום.
 */

const ICONS: Record<AddonName, LucideIcon> = {
  google_sso: KeyRound,
  custom_domain: Globe,
  digital_products: FileDown,
  zapier: Scale,
};

/** צבע האייקון בכל כרטיס */
const TONES: Record<AddonName, string> = {
  google_sso: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  custom_domain: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  digital_products: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  zapier: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
};

/** חלק 33: רכישת תוספים — רק בעל החנות (מנהל חנות רואה, לא קונה) */
export function AddonsStorePanel({ canPurchase = true }: { canPurchase?: boolean }) {
  const load = useServerFn(getAddonsStore);
  const [data, setData] = useState<AddonsStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuyingOffer] = useState<AddonOffer | null>(null);
  const setBuying = (offer: AddonOffer | null) => {
    if (offer && !canPurchase) {
      toast.error("רק בעל החנות יכול לרכוש תוספים או לשנות את החבילה");
      return;
    }
    setBuyingOffer(offer);
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await load());
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "טעינת התוספים נכשלה");
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sub = data?.subscription ?? null;
  const monthly = (data?.addons ?? []).filter((offer) => offer.addon !== "zapier");
  const zap = (data?.addons ?? []).find((offer) => offer.addon === "zapier") ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <Puzzle className="size-6 text-accent" aria-hidden="true" />
            שדרוגים ותוספים
          </h2>
          <p className="text-sm text-muted-foreground">
            פותחים רק את מה שצריך — בלי לעבור חבילה. התוסף נפתח מיד אחרי הרכישה.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          רענון
        </Button>
      </div>

      {!canPurchase && (
        <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          צפייה בלבד: רכישת תוספים ושינוי החבילה — רק בעל החנות.
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {sub && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border bg-card px-4 py-3 text-sm shadow-sm">
          <span className="inline-flex items-center gap-1.5 font-semibold">
            {sub.plan === "premium" ? (
              <Crown className="size-4 text-accent" aria-hidden="true" />
            ) : (
              <ShoppingBag className="size-4 text-primary" aria-hidden="true" />
            )}
            החבילה שלך: {PLAN_LABELS[sub.plan]}
          </span>
          {sub.plan === "basic" && sub.currentPeriodEnd && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <CalendarClock className="size-4" aria-hidden="true" />
              כל התוספים מתחדשים יחד עם המנוי ב-{formatDate(sub.currentPeriodEnd)} — משלמים רק על
              הזמן שנותר עד אז
            </span>
          )}
          {sub.plan === "premium" && (
            <span className="text-muted-foreground">
              כל התוספים החודשיים כבר כלולים בחבילה שלך.
            </span>
          )}
          {sub.plan === "trial" && (
            <span className="text-muted-foreground">
              בתקופת הניסיון הכל פתוח. בחבילה הבסיסית אפשר להוסיף כל תוסף בנפרד.
            </span>
          )}
        </div>
      )}

      {data === null && !error ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-72 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {monthly.map((offer) => (
            <AddonCard key={offer.addon} offer={offer} onBuy={() => setBuying(offer)} />
          ))}
        </div>
      )}

      {zap && <ZapCard offer={zap} onBuy={() => setBuying(zap)} />}

      <PurchaseDialog
        offer={buying}
        onClose={() => setBuying(null)}
        onPurchased={() => {
          setBuying(null);
          void refresh();
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------
// כרטיס תוסף חודשי
// ------------------------------------------------------------

function AddonCard({ offer, onBuy }: { offer: AddonOffer; onBuy: () => void }) {
  const Icon = ICONS[offer.addon];
  const state = addonButtonState(offer);
  return (
    <div className="flex flex-col rounded-2xl border bg-card p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl",
            TONES[offer.addon],
          )}
        >
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold leading-6">{offer.title}</h3>
          {offer.includedInPremium && (
            <p className="text-xs text-muted-foreground">כלול בחבילת פרימיום</p>
          )}
        </div>
      </div>

      <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">{offer.description}</p>

      <div className="mt-4 flex items-end gap-1">
        <span className="font-display text-3xl font-black leading-none">
          {offer.price.toLocaleString("he-IL", { maximumFractionDigits: 2 })}
        </span>
        <span className="mb-0.5 font-bold">₪</span>
        <span className="mb-0.5 text-sm text-muted-foreground">
          {offer.billing === "monthly" ? "/ לחודש" : "חד-פעמי"}
        </span>
      </div>

      <div className="mt-4">
        <AddonButton offer={offer} state={state} onBuy={onBuy} />
      </div>
    </div>
  );
}

function AddonButton({
  offer,
  state,
  onBuy,
}: {
  offer: AddonOffer;
  state: ReturnType<typeof addonButtonState>;
  onBuy: () => void;
}) {
  if (state === "included") {
    return (
      <div
        role="status"
        className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-bold text-white shadow-sm"
      >
        <CircleCheck className="size-4" aria-hidden="true" />
        {offer.reason === "כלול בתקופת הניסיון" ? "כלול בתקופת הניסיון" : "כלול בחבילה שלך"}
      </div>
    );
  }
  if (state === "owned") {
    return (
      <div
        role="status"
        className="flex min-h-11 w-full flex-col items-center justify-center rounded-md border-2 border-emerald-500 bg-emerald-50 px-4 py-1.5 text-sm font-bold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
      >
        <span className="inline-flex items-center gap-2">
          <Check className="size-4" aria-hidden="true" />
          התוסף פעיל
        </span>
        <span className="text-xs font-medium">
          {offer.expiresAt ? `בתוקף עד ${formatDate(offer.expiresAt)}` : "ללא תפוגה"}
        </span>
      </div>
    );
  }
  if (state === "buy") {
    return (
      <Button type="button" size="lg" className="w-full font-bold" onClick={onBuy}>
        <ShoppingBag className="size-4" aria-hidden="true" />
        רכש תוסף
      </Button>
    );
  }
  if (state === "coming_soon") {
    return (
      <Button type="button" size="lg" className="w-full" disabled>
        <Clock className="size-4" aria-hidden="true" />
        בקרוב
      </Button>
    );
  }
  return (
    <div className="space-y-1.5">
      <Button type="button" size="lg" variant="secondary" className="w-full" disabled>
        <Lock className="size-4" aria-hidden="true" />
        רכש תוסף
      </Button>
      {offer.reason && <p className="text-center text-xs text-muted-foreground">{offer.reason}</p>}
    </div>
  );
}

// ------------------------------------------------------------
// זאפ — כרטיס בולט
// ------------------------------------------------------------

/** הטקסט עם הקישור לזאפ לחיץ */
function linkify(text: string): ReactNode[] {
  return text.split(/(https:\/\/\S+?)(?=[.,]?(?:\s|$))/).map((part, index) =>
    /^https:\/\//.test(part) ? (
      <a
        key={index}
        href={part}
        target="_blank"
        rel="noreferrer"
        dir="ltr"
        className="font-semibold text-orange-700 underline underline-offset-2 hover:text-orange-800 dark:text-orange-300"
      >
        {part}
      </a>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

function ZapCard({ offer, onBuy }: { offer: AddonOffer; onBuy: () => void }) {
  const state = addonButtonState(offer);
  const comingSoon = state === "coming_soon";
  const owned = state === "owned";
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const feedUrl = zapFeedUrl(origin);
  return (
    <section
      aria-labelledby="zap-addon-title"
      className="relative overflow-hidden rounded-3xl border-2 border-orange-300 bg-gradient-to-l from-orange-50 via-background to-amber-50 p-5 shadow-md dark:border-orange-800 dark:from-orange-950/40 dark:to-amber-950/30 sm:p-7"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-16 -top-16 size-48 rounded-full bg-orange-200/40 blur-2xl dark:bg-orange-800/20"
      />
      <div className="relative grid gap-5 md:grid-cols-[minmax(0,1fr)_16rem] md:items-center">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={cn(
                "flex size-12 shrink-0 items-center justify-center rounded-2xl",
                TONES.zapier,
              )}
            >
              <Scale className="size-6" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 id="zap-addon-title" className="text-xl font-black">
                {offer.title}
              </h3>
              <p className="text-sm text-muted-foreground">
                השוואת מחירים · תשלום חד-פעמי (דמי הקמה) — לכל החבילות, גם בפרימיום
              </p>
            </div>
          </div>
          <p className="text-sm leading-6">{offer.description}</p>

          {owned ? (
            // אחרי הרכישה: ההרשמה לזאפ והקישור לקובץ ה-XML
            <ol className="space-y-3 rounded-xl border border-orange-200 bg-background/80 p-4 text-sm dark:border-orange-900">
              <li className="space-y-2">
                <p className="font-semibold">1. הירשמו לזאפ כחנות</p>
                <Button asChild size="sm" className="bg-orange-600 text-white hover:bg-orange-700">
                  <a href={ZAP_JOIN_URL} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                    להרשמה לזאפ
                  </a>
                </Button>
              </li>
              <li className="space-y-2">
                <p className="font-semibold">2. מסרו לתמיכה של זאפ את קובץ המוצרים (XML)</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <code
                    dir="ltr"
                    className="min-w-0 flex-1 truncate rounded-lg border bg-secondary/60 px-3 py-2"
                  >
                    {feedUrl}
                  </code>
                  <CopyValueButton
                    value={feedUrl}
                    label="העתק קישור למסירה לתמיכה של זאפ"
                    copiedText="הקישור הועתק"
                  />
                </div>
              </li>
              <li>
                <p className="text-xs text-muted-foreground">
                  אילו מוצרים יופיעו וזמן האספקה — ב"שיווק ואינטגרציות" ובעריכת כל מוצר ("הצג
                  בזאפ").
                </p>
              </li>
            </ol>
          ) : (
            <p className="rounded-xl border border-orange-200 bg-background/80 px-4 py-3 text-sm leading-7 text-muted-foreground dark:border-orange-900">
              {comingSoon ? linkify(ZAP_ADDON_NOTE_SOON) : ZAP_ADDON_NOTE}
            </p>
          )}
        </div>

        <div className="flex flex-col items-stretch gap-3 rounded-2xl border bg-card/90 p-4 text-center shadow-sm">
          {comingSoon ? (
            <span className="inline-flex items-center justify-center gap-1.5 rounded-full bg-orange-600 px-3 py-1.5 text-sm font-bold text-white shadow">
              <Sparkles className="size-4" aria-hidden="true" />
              {ZAP_COMING_SOON}
            </span>
          ) : (
            <div className="flex items-end justify-center gap-1">
              <span className="font-display text-4xl font-black leading-none">
                {offer.price.toLocaleString("he-IL")}
              </span>
              <span className="mb-0.5 font-bold">₪</span>
              <span className="mb-0.5 text-sm text-muted-foreground">חד-פעמי</span>
            </div>
          )}
          {owned ? (
            <div
              role="status"
              className="flex h-11 items-center justify-center gap-2 rounded-md border-2 border-emerald-500 bg-emerald-50 text-sm font-bold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
            >
              <Check className="size-4" aria-hidden="true" />
              התוסף פעיל
            </div>
          ) : (
            <Button
              type="button"
              size="lg"
              disabled={state !== "buy"}
              onClick={onBuy}
              className={cn(
                "w-full font-bold",
                state === "buy"
                  ? "bg-orange-600 text-white hover:bg-orange-700"
                  : "cursor-not-allowed bg-muted text-muted-foreground",
              )}
            >
              {comingSoon ? <Lock className="size-4" /> : <ShoppingBag className="size-4" />}
              רכש תוסף
            </Button>
          )}
          {state === "blocked" && offer.reason && (
            <p className="text-xs text-muted-foreground">{offer.reason}</p>
          )}
          {!owned && !comingSoon && (
            <p className="text-xs text-muted-foreground">
              הקישור להרשמה לזאפ וקובץ המוצרים יופיעו כאן מיד אחרי הרכישה.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------
// חלון הרכישה — מחיר יחסי מחושב בשרת + אישור
// ------------------------------------------------------------

function PurchaseDialog({
  offer,
  onClose,
  onPurchased,
}: {
  offer: AddonOffer | null;
  onClose: () => void;
  onPurchased: () => void;
}) {
  const router = useRouter();
  const quote = useServerFn(quoteAddon);
  const buy = useServerFn(purchaseAddon);
  const [fresh, setFresh] = useState<AddonOffer | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // בכל פתיחה — הצעת מחיר עדכנית מהשרת (הימים שנותרו משתנים כל יום)
  const addon = offer?.addon ?? null;
  const loadQuote = useCallback(async () => {
    if (!addon) return;
    setQuoting(true);
    setError(null);
    try {
      setFresh(await quote({ data: { addon } }));
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "חישוב המחיר נכשל");
    } finally {
      setQuoting(false);
    }
  }, [addon, quote]);

  useEffect(() => {
    setFresh(null);
    if (addon) void loadQuote();
  }, [addon, loadQuote]);

  // הרכישה נרשמת "ממתין לתשלום" ב"המנוי שלי"; הצוות מתאם את הגבייה (חלק 28)
  const confirm = async () => {
    if (!fresh || fresh.amount === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await buy({ data: { addon: fresh.addon, expectedAmount: fresh.amount } });
      toast.success(`התוסף "${result.title}" הופעל!`, {
        description: "הפיצ'ר פתוח עכשיו בחנות. החיוב נוסף לחשבון המנוי.",
      });
      await router.invalidate();
      onPurchased();
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : "הרכישה נכשלה";
      if (message.includes("המחיר התעדכן")) await loadQuote();
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const shown = fresh ?? offer;
  const monthly = shown?.billing === "monthly";

  return (
    <Dialog open={offer !== null} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto text-right sm:max-w-md">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2">
            <Puzzle className="size-5 text-accent" aria-hidden="true" />
            רכישת תוסף
          </DialogTitle>
          <DialogDescription>{shown?.title}</DialogDescription>
        </DialogHeader>

        {quoting && !fresh ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            מחשבים את המחיר…
          </div>
        ) : fresh && fresh.canBuy && fresh.amount !== null ? (
          <div className="space-y-4">
            <dl className="space-y-2 rounded-xl border bg-secondary/40 p-4 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">מחיר מחירון</dt>
                <dd className="font-semibold">{addonPriceLabel(fresh)}</dd>
              </div>
              {monthly && fresh.periodEnd && (
                <>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">חידוש המנוי שלך</dt>
                    <dd className="font-semibold">{formatDate(fresh.periodEnd)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">ימים שנותרו בתקופה</dt>
                    <dd className="numeric font-semibold">
                      {fresh.daysRemaining?.toLocaleString("he-IL")}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3 border-t pt-2 text-xs text-muted-foreground">
                    <dt>החישוב</dt>
                    <dd dir="ltr" className="numeric">
                      {fresh.price} ₪ × 12 ÷ 365 × {fresh.daysRemaining}
                    </dd>
                  </div>
                </>
              )}
            </dl>

            <div className="rounded-2xl bg-primary px-4 py-4 text-center text-primary-foreground">
              <p className="text-sm opacity-80">
                {monthly ? "לתשלום עכשיו (יחסי עד חידוש המנוי)" : "לתשלום (חד-פעמי)"}
              </p>
              <p className="font-display text-4xl font-black">{formatShekels(fresh.amount)}</p>
            </div>

            <ul className="space-y-1.5 text-xs leading-5 text-muted-foreground">
              <li className="flex gap-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                הפיצ'ר נפתח מיד אחרי האישור.
              </li>
              {monthly && (
                <li className="flex gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                  בחידוש המנוי התוסף מתחדש יחד איתו ({addonPriceLabel(fresh)}) — תאריך חידוש אחד לכל
                  החשבון.
                </li>
              )}
              <li className="flex gap-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                החיוב נוסף ל&quot;המנוי שלי&quot; כממתין לתשלום, והצוות שלנו יתאם איתכם את הגבייה
                (העברה בנקאית או בתיאום).
              </li>
            </ul>

            {error && (
              <p
                role="alert"
                className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="sm:flex-1"
                onClick={onClose}
                disabled={busy}
              >
                ביטול
              </Button>
              <Button
                type="button"
                size="lg"
                className="font-bold sm:flex-[2]"
                onClick={() => void confirm()}
                disabled={busy || quoting}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShoppingBag className="size-4" />
                )}
                {`אישור רכישה · ${formatShekels(fresh.amount)}`}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p role="alert" className="rounded-lg bg-secondary px-4 py-3 text-sm">
              {error ?? fresh?.reason ?? "לא ניתן לרכוש את התוסף כרגע"}
            </p>
            <Button type="button" variant="outline" className="w-full" onClick={onClose}>
              סגירה
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
