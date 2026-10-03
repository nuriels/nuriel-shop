import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  MessageCircle,
  Navigation,
  Package,
  Phone,
  RefreshCw,
  ShieldAlert,
  StickyNote,
  TriangleAlert,
  Truck,
  UserRound,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  courierGetDelivery,
  courierReport,
  type CourierDelivery,
  type CourierReportResult,
} from "@/lib/delivery.functions";
import { formatAddress, formatPhone } from "@/lib/order-details";
import { whatsappNumber } from "@/lib/shipping-label";
import { cn } from "@/lib/utils";

/**
 * עמוד השליח — קישור אישי וזמני להזמנה אחת, בלי התחברות.
 * השליח רואה את פרטי הנמען, הכתובת (עם ניווט) והטלפון, ומסמן:
 *   "נמסר" → ההזמנה "נמסרה"
 *   "משלוח נכשל" → חוזרת ל"ממתינה לשליח", ניסיון +1 (והחנות מקבלת התראה)
 * אפשר לחזור לקישור עד שההזמנה נמסרה (ובתוך תוקף הקישור).
 */
export const Route = createFileRoute("/courier/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "משלוח לשליח" },
      { name: "robots", content: "noindex, nofollow" },
      // הטוקן בכתובת — לא שולחים אותו הלאה (Waze, Google Maps) ב-Referer
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: CourierPage,
});

/** סיבות נפוצות — בלחיצה, כדי שהשליח לא יצטרך להקליד בדרך */
const FAILURE_REASONS = [
  "הלקוח לא ענה לטלפון",
  "אין אף אחד בכתובת",
  "כתובת שגויה / לא נמצאה",
  "הלקוח ביקש לדחות",
  "הלקוח סירב לקבל",
];

type Active = Extract<CourierDelivery, { state: "active" }>;

function telHref(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/[^0-9+]/g, "");
  return digits.length >= 9 ? `tel:${digits}` : null;
}

function CourierPage() {
  const { token } = Route.useParams();
  const getDelivery = useServerFn(courierGetDelivery);
  const report = useServerFn(courierReport);

  const [delivery, setDelivery] = useState<CourierDelivery | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelivered, setConfirmDelivered] = useState(false);
  const [failureOpen, setFailureOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [done, setDone] = useState<CourierReportResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setDelivery(await getDelivery({ data: { token } }));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "טעינת פרטי המשלוח נכשלה");
    } finally {
      setLoading(false);
    }
  }, [getDelivery, token]);

  useEffect(() => {
    void load();
  }, [load]);

  // כפתור הנגישות עולה מעל כפתורי "נמסר" / "משלוח נכשל" הקבועים בתחתית
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--a11y-bottom", "6.5rem");
    return () => {
      root.style.removeProperty("--a11y-bottom");
    };
  }, []);

  const send = async (delivered: boolean) => {
    setSending(true);
    setReportError(null);
    try {
      const result = await report({ data: { token, delivered, note: reason } });
      setDone(result);
      setConfirmDelivered(false);
      setFailureOpen(false);
      setReason("");
      if (!delivered) await load();
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "הדיווח נכשל — נסו שוב");
    } finally {
      setSending(false);
    }
  };

  if (loading && !delivery) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
          <Loader2 className="size-8 animate-spin" aria-hidden="true" />
          טוען את פרטי המשלוח…
        </div>
      </Shell>
    );
  }

  if (loadError || !delivery) {
    return (
      <Shell>
        <StateCard
          tone="error"
          icon={ShieldAlert}
          title="לא הצלחנו לטעון את המשלוח"
          text={loadError ?? "נסו לרענן את העמוד"}
          action={
            <Button onClick={() => void load()}>
              <RefreshCw className="size-4" />
              ניסיון נוסף
            </Button>
          }
        />
      </Shell>
    );
  }

  // השליח סימן "נמסר" עכשיו — מסך תודה
  if (done?.status === "delivered" || delivery.state === "delivered") {
    return (
      <Shell>
        <StateCard
          tone="success"
          icon={CheckCircle2}
          title="ההזמנה נמסרה ✓"
          text={`הזמנה ${done?.order_number ?? (delivery.state === "delivered" ? delivery.order_number : "")} סומנה כנמסרה. תודה!`}
        />
      </Shell>
    );
  }

  if (delivery.state !== "active") {
    const states = {
      invalid: {
        title: "הקישור לא תקין",
        text: "ייתכן שהחנות הפיקה קישור חדש להזמנה הזו. בקשו מהחנות את הקישור העדכני.",
      },
      closed: {
        title: "ההזמנה כבר לא ממתינה לשליח",
        text: "החנות עדכנה את ההזמנה (למשל ביטול או שינוי). אין צורך במסירה — פנו לחנות לפרטים.",
      },
      expired: {
        title: "תוקף הקישור פג",
        text: "בקשו מהחנות קישור חדש להזמנה הזו.",
      },
    } as const;
    const info = states[delivery.state];
    return (
      <Shell>
        <StateCard
          tone="muted"
          icon={delivery.state === "expired" ? Clock : XCircle}
          title={info.title}
          text={
            "order_number" in delivery ? `${info.text} (הזמנה ${delivery.order_number})` : info.text
          }
        />
      </Shell>
    );
  }

  return (
    <Shell storeName={delivery.store_name}>
      <ActiveDelivery
        delivery={delivery}
        failedNow={done?.status === "awaiting_courier" ? done.attempts : null}
        refreshing={loading}
        onRefresh={() => void load()}
      />

      {/* פעולות — קבועות בתחתית המסך, גדולות ללחיצה באגודל */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-3 backdrop-blur">
        <div className="mx-auto grid max-w-lg grid-cols-2 gap-3">
          <Button
            size="lg"
            className="h-14 bg-green-600 text-lg font-bold text-white hover:bg-green-700"
            onClick={() => {
              setReportError(null);
              setConfirmDelivered(true);
            }}
          >
            <CheckCircle2 className="size-6" />
            נמסר
          </Button>
          <Button
            size="lg"
            variant="destructive"
            className="h-14 text-lg font-bold"
            onClick={() => {
              setReportError(null);
              setFailureOpen(true);
            }}
          >
            <XCircle className="size-6" />
            משלוח נכשל
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmDelivered} onOpenChange={setConfirmDelivered}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader className="text-right">
            <AlertDialogTitle>לאשר שההזמנה נמסרה?</AlertDialogTitle>
            <AlertDialogDescription className="text-right">
              הזמנה {delivery.order_number} ל{delivery.recipient_name ?? "לקוח"}. אחרי האישור הקישור
              נסגר.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {reportError && <p className="text-sm font-medium text-destructive">{reportError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>חזרה</AlertDialogCancel>
            <AlertDialogAction
              disabled={sending}
              className="bg-green-600 text-white hover:bg-green-700"
              onClick={(event) => {
                event.preventDefault();
                void send(true);
              }}
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : null}
              כן, נמסר
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={failureOpen} onOpenChange={setFailureOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader className="text-right">
            <DialogTitle>משלוח נכשל</DialogTitle>
            <DialogDescription className="text-right">
              ההזמנה תחזור ל"ממתינה לשליח" (ניסיון {delivery.attempts + 1}), והחנות תקבל התראה.
              הקישור נשאר פעיל לניסיון הבא.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {FAILURE_REASONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setReason(option)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition-colors",
                  reason === option
                    ? "border-destructive bg-destructive/10 font-semibold text-destructive"
                    : "border-border hover:bg-secondary",
                )}
              >
                {option}
              </button>
            ))}
          </div>
          <Textarea
            value={reason}
            maxLength={300}
            rows={3}
            placeholder="סיבה / הערה לחנות (לא חובה)"
            onChange={(event) => setReason(event.target.value)}
          />
          {reportError && <p className="text-sm font-medium text-destructive">{reportError}</p>}
          <DialogFooter className="gap-2 sm:justify-start">
            <Button variant="destructive" disabled={sending} onClick={() => void send(false)}>
              {sending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <XCircle className="size-4" />
              )}
              דיווח: משלוח נכשל
            </Button>
            <Button variant="outline" disabled={sending} onClick={() => setFailureOpen(false)}>
              חזרה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}

function ActiveDelivery({
  delivery,
  failedNow,
  refreshing,
  onRefresh,
}: {
  delivery: Active;
  failedNow: number | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const address = formatAddress(delivery.street, delivery.city, delivery.zip);
  const phone = formatPhone(delivery.recipient_phone);
  const tel = telHref(delivery.recipient_phone);
  const wa = whatsappNumber(delivery.recipient_phone);
  const storeTel = telHref(delivery.store_phone);

  return (
    <div className="space-y-4 pb-28">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">משלוח</p>
          <h1 dir="ltr" className="numeric text-right text-2xl font-bold">
            {delivery.order_number}
          </h1>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Badge className="gap-1">
            <Truck className="size-3.5" aria-hidden="true" />
            ממתינה לשליח
          </Badge>
          {delivery.attempts > 0 && (
            <Badge
              variant="outline"
              className="gap-1 border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <TriangleAlert className="size-3.5" aria-hidden="true" />
              משלוח נכשל — ניסיון {delivery.attempts}
            </Badge>
          )}
        </div>
      </div>

      {failedNow !== null && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          הדיווח נשמר (ניסיון {failedNow}). החנות קיבלה התראה — אפשר לחזור לקישור הזה בניסיון הבא.
        </p>
      )}

      <Card className="shadow-card">
        <CardContent className="space-y-4 pt-5">
          <div className="flex items-start gap-3">
            <UserRound className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">נמען</p>
              <p className="text-xl font-bold leading-tight">{delivery.recipient_name || "—"}</p>
              {delivery.customer_name && delivery.customer_name !== delivery.recipient_name && (
                <p className="text-sm text-muted-foreground">מזמין: {delivery.customer_name}</p>
              )}
            </div>
          </div>

          {phone && (
            <div className="flex items-start gap-3">
              <Phone className="mt-1.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1 space-y-2">
                {/* המספר בשורה משלו — לא נשבר במקפים */}
                <p dir="ltr" className="numeric whitespace-nowrap text-right text-2xl font-bold">
                  {phone}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {tel && (
                    <Button asChild>
                      <a href={tel}>
                        <Phone className="size-4" />
                        חיוג
                      </a>
                    </Button>
                  )}
                  {wa && (
                    <Button variant="outline" asChild>
                      <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">
                        <MessageCircle className="size-4" />
                        וואטסאפ
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="flex items-start gap-3">
            <MapPin className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-2">
              {delivery.alternate_address && (
                <Badge
                  variant="outline"
                  className="border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                >
                  כתובת משלוח שונה מכתובת המזמין
                </Badge>
              )}
              <p className="text-lg font-semibold leading-snug">{delivery.street || "—"}</p>
              <p className="text-lg font-bold">
                {[delivery.city, delivery.zip].filter(Boolean).join(" ")}
              </p>
              {address && (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" asChild>
                    <a
                      href={`https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Navigation className="size-4" />
                      Waze
                    </a>
                  </Button>
                  <Button variant="outline" asChild>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <MapPin className="size-4" />
                      Google Maps
                    </a>
                  </Button>
                </div>
              )}
            </div>
          </div>

          {delivery.note && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
              <StickyNote className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <p className="text-sm leading-6">
                <span className="font-bold">הערה מהלקוח: </span>
                {delivery.note}
              </p>
            </div>
          )}

          <div className="flex items-center gap-3 border-t border-border pt-3 text-sm text-muted-foreground">
            <Package className="size-5 shrink-0" aria-hidden="true" />
            {delivery.items} פריטים · {delivery.units} יחידות
          </div>
        </CardContent>
      </Card>

      {delivery.attempts > 0 && (delivery.last_failure_note || delivery.last_failure_at) && (
        <p className="text-sm text-muted-foreground">
          ניסיון קודם: {delivery.last_failure_note || "לא נמסר"}
          {delivery.last_failure_at &&
            ` · ${new Date(delivery.last_failure_at).toLocaleString("he-IL", {
              dateStyle: "short",
              timeStyle: "short",
            })}`}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {delivery.courier_name ? `שליח: ${delivery.courier_name} · ` : ""}
          הקישור בתוקף עד{" "}
          {new Date(delivery.expires_at).toLocaleDateString("he-IL", {
            day: "numeric",
            month: "numeric",
          })}
        </span>
        <div className="flex items-center gap-2">
          {storeTel && (
            <a href={storeTel} className="font-medium underline underline-offset-2">
              טלפון החנות
            </a>
          )}
          <Button size="sm" variant="ghost" disabled={refreshing} onClick={onRefresh}>
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
            רענון
          </Button>
        </div>
      </div>
    </div>
  );
}

function Shell({ storeName, children }: { storeName?: string | null; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-secondary/40">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-lg items-center gap-2 px-4 py-3">
          <Truck className="size-5 text-accent" aria-hidden="true" />
          <span className="font-bold">{storeName?.trim() || "משלוח"}</span>
          <span className="text-sm text-muted-foreground">· עמוד שליח</span>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-5">{children}</main>
    </div>
  );
}

function StateCard({
  tone,
  icon: Icon,
  title,
  text,
  action,
}: {
  tone: "success" | "error" | "muted";
  icon: typeof CheckCircle2;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="mt-10 shadow-soft">
      <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
        <span
          className={cn(
            "flex size-14 items-center justify-center rounded-full",
            tone === "success" && "bg-green-600/10 text-green-700",
            tone === "error" && "bg-destructive/10 text-destructive",
            tone === "muted" && "bg-secondary text-muted-foreground",
          )}
        >
          <Icon className="size-7" aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-foreground">{title}</h1>
          <p className="text-sm leading-6 text-muted-foreground">{text}</p>
        </div>
        {action}
      </CardContent>
    </Card>
  );
}
