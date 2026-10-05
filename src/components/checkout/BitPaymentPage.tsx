import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  CircleAlert,
  Clock,
  Copy,
  FileText,
  Hourglass,
  ImageUp,
  Link2,
  Loader2,
  PhoneCall,
  Send,
  Smartphone,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthState } from "@/hooks/useAuthState";
import { formatIls } from "@/lib/catalog";
import { trackPurchase } from "@/lib/marketing";
import { formatPhone } from "@/lib/order-details";
import { formatBytes } from "@/lib/site-forms";
import { getBitPayment, submitBitPayment } from "@/lib/bit-payments.functions";
import {
  BIT_PAYMENT_WINDOW_HOURS,
  BIT_REFERENCE_LIMITS,
  RECEIPT_ACCEPT,
  RECEIPT_HINT,
  bitPageStage,
  bitProofProblem,
  clearPendingBitOrder,
  formatBitPhone,
  isOrderId,
  receiptProblem,
  writePendingBitOrder,
  type BitPaymentInfo,
} from "@/lib/bit-payments";
import { cn } from "@/lib/utils";

const israelTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("he-IL", {
        timeZone: "Asia/Jerusalem",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "";

/** העתקה ללוח — עם הודעה קצרה */
function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("h-9 gap-1.5 bg-card", className)}
      aria-label={`העתקת ${label}`}
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            toast.success(`${label} הועתק`);
            setTimeout(() => setCopied(false), 1800);
          })
          .catch(() => toast.error("ההעתקה נכשלה — אפשר לסמן ולהעתיק ידנית"));
      }}
    >
      {copied ? (
        <CheckCircle2 className="size-4 text-green-600" aria-hidden="true" />
      ) : (
        <Copy className="size-4" aria-hidden="true" />
      )}
      {copied ? "הועתק" : "העתקה"}
    </Button>
  );
}

/**
 * עמוד התשלום בביט (חלק 17ב). ההזמנה כבר שמורה במסד ("ממתינה לתשלום"), וכל
 * המצב נטען מהשרת לפי המזהה שבכתובת — גם אחרי שהדפדפן נסגר / התרענן במעבר
 * לאפליקציית ביט. כשהלקוח חוזר ללשונית — המצב נטען מחדש.
 *
 *  לשלם     → מספר ההזמנה, הסכום, מספר הביט של החנות (העתקה), ושליחת מספר
 *             אסמכתא או צילום מסך של ההעברה.
 *  נשלח     → "ממתינה לאישור תשלום" (בעל החנות מאשר במסך ההזמנות).
 *  שולם     → התשלום אושר.
 *  בוטל     → לא שולמה בזמן / התשלום נדחה.
 */
export function BitPaymentPage({ orderId }: { orderId: string }) {
  const { session, role } = useAuthState();
  const loadFn = useServerFn(getBitPayment);
  const submitFn = useServerFn(submitBitPayment);

  const [info, setInfo] = useState<BitPaymentInfo | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const tracked = useRef(false);

  const load = useCallback(
    async (quiet = false) => {
      if (!isOrderId(orderId)) {
        setState("missing");
        clearPendingBitOrder(orderId);
        return;
      }
      if (!quiet) setState((current) => (current === "ready" ? current : "loading"));
      try {
        const next = await loadFn({ data: { orderId } });
        if (!next) {
          setState("missing");
          clearPendingBitOrder(orderId);
          return;
        }
        setInfo(next);
        setState("ready");
        setLoadError(null);
        // ממתינה לתשלום — הסימון בדפדפן מחזיר לכאן מהקופה; אחרת — לא צריך יותר
        if (bitPageStage(next) === "pay") {
          writePendingBitOrder({ orderId: next.orderId, orderNumber: next.orderNumber });
        } else {
          clearPendingBitOrder(next.orderId);
        }
      } catch (error) {
        if (!quiet) {
          setLoadError(error instanceof Error ? error.message : "טעינת ההזמנה נכשלה");
          setState("error");
        }
      }
    },
    [orderId, loadFn],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // חזרה מאפליקציית ביט ללשונית — טוענים מחדש (בלי מסך טעינה)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [load]);

  const stage = info ? bitPageStage(info) : null;

  // ממתינה לאישור בעל החנות — בודקים מדי פעם אם כבר אושר
  useEffect(() => {
    if (stage !== "submitted") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [stage, load]);

  // תצוגה מקדימה של צילום המסך שנבחר
  useEffect(() => {
    if (!file || !file.type.startsWith("image/") || file.type === "image/heic") {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const pickFile = (next: File | null) => {
    setSubmitError(null);
    if (!next) {
      setFile(null);
      return;
    }
    const problem = receiptProblem(next);
    if (problem) {
      toast.error(problem);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setFile(next);
  };

  const proofProblem = bitProofProblem(reference, file !== null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    setSubmitError(null);
    if (proofProblem) {
      document.getElementById("bit-reference")?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.set("orderId", orderId);
      form.set("reference", reference.trim());
      if (file) form.set("receipt", file, file.name);
      const result = await submitFn({ data: form });
      if (result.info) setInfo(result.info);
      clearPendingBitOrder(orderId);
      if (!result.already && result.info && !tracked.current) {
        // Pixel / GA: הרכישה — כשהלקוח מדווח על התשלום
        tracked.current = true;
        trackPurchase(result.info.orderNumber, result.info.amount);
      }
      toast.success(
        result.already ? "פרטי התשלום כבר התקבלו קודם" : "תודה! פרטי התשלום נשלחו לבעל החנות",
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "השליחה נכשלה — נסו שוב";
      setSubmitError(message);
      toast.error(message, { duration: 8000 });
      void load(true);
    } finally {
      setSubmitting(false);
    }
  };

  const header = <SiteHeader role={role} email={session?.user.email ?? null} onSignOut={signOut} />;
  const ordersLink =
    role?.role === "customer" ? (
      <Button asChild variant="outline">
        <Link to="/orders">להזמנות שלי</Link>
      </Button>
    ) : null;

  let body: React.ReactNode;
  if (state === "loading") {
    body = (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Loader2 className="size-9 animate-spin text-muted-foreground" aria-hidden="true" />
          <p className="text-muted-foreground">טוענים את פרטי ההזמנה…</p>
        </CardContent>
      </Card>
    );
  } else if (state === "error") {
    body = (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <CircleAlert className="size-9 text-destructive" aria-hidden="true" />
          <p className="font-medium text-foreground">{loadError ?? "טעינת ההזמנה נכשלה"}</p>
          <p className="text-sm text-muted-foreground">ההזמנה שמורה — אפשר לנסות שוב.</p>
          <Button onClick={() => void load()}>ניסיון נוסף</Button>
        </CardContent>
      </Card>
    );
  } else if (state === "missing" || !info) {
    body = (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <XCircle className="size-9 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-xl font-bold">ההזמנה לא נמצאה</h1>
          <p className="text-sm text-muted-foreground">
            הקישור לא תקין, או שזו לא הזמנה בתשלום בביט.
          </p>
          <Button asChild>
            <Link to="/">לדף הבית</Link>
          </Button>
        </CardContent>
      </Card>
    );
  } else if (stage === "paid") {
    body = (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            <CheckCircle2 className="size-9" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-bold">התשלום אושר — תודה!</h1>
          <p className="text-muted-foreground">
            ההזמנה{" "}
            <span dir="ltr" className="numeric font-semibold text-foreground">
              {info.orderNumber}
            </span>{" "}
            שולמה ({formatIls(info.amount)}) ונמצאת בטיפול. נעדכן כשהיא תצא אליכם.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {ordersLink}
            <Button asChild>
              <Link to="/">המשך קנייה</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  } else if (stage === "submitted") {
    body = (
      <Card id="bit-submitted">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            <Hourglass className="size-9" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-bold">תודה! קיבלנו את פרטי התשלום</h1>
          <p className="leading-7 text-muted-foreground">
            ההזמנה{" "}
            <span dir="ltr" className="numeric font-semibold text-foreground">
              {info.orderNumber}
            </span>{" "}
            <strong className="text-foreground">ממתינה לאישור תשלום</strong> — בעל החנות יבדוק את
            ההעברה בביט ויאשר. אישור הזמנה נשלח אליכם למייל.
          </p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {info.hasReference && <li>✓ מספר אסמכתא התקבל</li>}
            {info.hasReceipt && <li>✓ צילום המסך התקבל</li>}
            {info.reportedAt && <li>נשלח: {israelTime(info.reportedAt)}</li>}
          </ul>
          <div className="flex flex-wrap justify-center gap-2">
            {ordersLink}
            <Button asChild>
              <Link to="/">המשך קנייה</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  } else if (stage === "closed") {
    const rejected = info.paymentStatus === "rejected";
    body = (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <XCircle className="size-9" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-bold">{rejected ? "התשלום לא אושר" : "ההזמנה בוטלה"}</h1>
          <p className="leading-7 text-muted-foreground">
            {rejected
              ? "בעל החנות לא מצא את ההעברה בביט, וההזמנה בוטלה."
              : `ההזמנה לא שולמה תוך ${BIT_PAYMENT_WINDOW_HOURS} שעות ובוטלה, והמוצרים חזרו למלאי.`}{" "}
            {info.storePhone ? (
              <>
                אם כבר העברתם — צרו קשר עם החנות:{" "}
                <a
                  href={`tel:${info.storePhone}`}
                  dir="ltr"
                  className="font-semibold text-primary hover:underline"
                >
                  {formatPhone(info.storePhone)}
                </a>
              </>
            ) : (
              "אם כבר העברתם — צרו קשר עם החנות."
            )}
          </p>
          <Button asChild>
            <Link to="/">להזמנה חדשה</Link>
          </Button>
        </CardContent>
      </Card>
    );
  } else {
    // ---------- לשלם ----------
    const phoneDisplay = info.bitPhone ? formatBitPhone(info.bitPhone) : null;
    const amountText = info.amount.toFixed(2).replace(/\.00$/, "");
    const showReferenceError = attempted && proofProblem !== null;
    body = (
      <div className="space-y-5">
        <div className="space-y-1 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
            <Smartphone className="size-7" aria-hidden="true" />
          </span>
          <h1 className="font-display text-2xl text-foreground sm:text-3xl">תשלום בביט</h1>
          <p className="text-sm text-muted-foreground">
            ההזמנה נשמרה — נשאר רק להעביר בביט ולשלוח אישור. אפשר לסגור את הדף ולחזור אליו בכל רגע.
          </p>
        </div>

        {/* ---------- סיכום: מספר הזמנה, סכום, מספר ביט ---------- */}
        <Card id="bit-summary" className="shadow-card">
          <CardContent className="space-y-4 pt-6">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-secondary/60 p-3">
                <dt className="text-xs text-muted-foreground">מספר הזמנה</dt>
                <dd className="mt-1 flex items-center justify-between gap-2">
                  <span dir="ltr" className="numeric text-lg font-bold text-foreground">
                    {info.orderNumber}
                  </span>
                  <CopyButton value={info.orderNumber} label="מספר ההזמנה" />
                </dd>
              </div>
              <div className="rounded-xl border border-border bg-secondary/60 p-3">
                <dt className="text-xs text-muted-foreground">סכום לתשלום</dt>
                <dd className="mt-1 flex items-center justify-between gap-2">
                  <span className="numeric text-lg font-bold text-foreground">
                    {formatIls(info.amount)}
                  </span>
                  <CopyButton value={amountText} label="הסכום" />
                </dd>
              </div>
            </dl>
            <div
              id="bit-phone"
              className="rounded-xl border-2 border-primary/40 bg-primary/5 p-4 text-center"
            >
              <p className="text-sm text-muted-foreground">
                מעבירים בביט אל {info.storeName ? <strong>{info.storeName}</strong> : "החנות"} —
                למספר:
              </p>
              {phoneDisplay ? (
                <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
                  <span
                    dir="ltr"
                    className="numeric text-3xl font-bold tracking-wide text-foreground"
                  >
                    {phoneDisplay}
                  </span>
                  <CopyButton value={info.bitPhone ?? ""} label="מספר הטלפון" />
                </div>
              ) : (
                <p className="mt-2 text-sm font-medium text-destructive">
                  מספר הביט של החנות לא זמין כרגע — צרו קשר עם החנות
                  {info.storePhone ? ` (${formatPhone(info.storePhone)})` : ""}.
                </p>
              )}
            </div>
            <ol className="space-y-2 text-sm leading-6">
              {[
                'פתחו את אפליקציית ביט בטלפון ובחרו "העברת כסף".',
                `הזינו את המספר ${phoneDisplay ?? "של החנות"} ואת הסכום ${formatIls(info.amount)}. בשדה ההערה כתבו את מספר ההזמנה ${info.orderNumber}.`,
                "אחרי ההעברה — חזרו לכאן ושלחו את מספר האסמכתא או צילום מסך של אישור ההעברה.",
              ].map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            {info.dueAt && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                ההזמנה שמורה עבורכם (כולל המלאי) עד {israelTime(info.dueAt)}. אם לא יתקבל תשלום עד
                אז — היא תבוטל אוטומטית.
              </p>
            )}
          </CardContent>
        </Card>

        {/* ---------- אימות: אסמכתא או צילום מסך ---------- */}
        <Card className="shadow-card">
          <CardContent className="pt-6">
            <form id="bit-proof-form" noValidate onSubmit={submit} className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-foreground">אישור ההעברה</h2>
                <p className="text-sm text-muted-foreground">
                  מספיק אחד מהשניים: מספר אסמכתא <strong>או</strong> צילום מסך.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bit-reference">מספר אסמכתא</Label>
                <Input
                  id="bit-reference"
                  dir="ltr"
                  inputMode="text"
                  autoComplete="off"
                  maxLength={BIT_REFERENCE_LIMITS.max}
                  className="text-right"
                  placeholder="למשל 1234567890"
                  aria-invalid={showReferenceError ? true : undefined}
                  aria-describedby="bit-reference-hint"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                />
                <p id="bit-reference-hint" className="text-xs text-muted-foreground">
                  מופיע במסך האישור באפליקציית ביט אחרי ההעברה.
                </p>
              </div>

              <div
                className="flex items-center gap-3 text-xs text-muted-foreground"
                aria-hidden="true"
              >
                <span className="h-px flex-1 bg-border" />
                או
                <span className="h-px flex-1 bg-border" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bit-receipt">צילום מסך של ההעברה</Label>
                <input
                  ref={fileInput}
                  id="bit-receipt"
                  type="file"
                  accept={RECEIPT_ACCEPT}
                  className="sr-only"
                  onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
                />
                {file ? (
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/50 p-2.5">
                    {preview ? (
                      <img
                        src={preview}
                        alt="צילום המסך שנבחר"
                        className="size-14 shrink-0 rounded-md border border-border object-cover"
                      />
                    ) : (
                      <span className="flex size-14 shrink-0 items-center justify-center rounded-md border border-border bg-card">
                        <FileText className="size-6 text-muted-foreground" aria-hidden="true" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium" dir="auto">
                        {file.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {formatBytes(file.size)}
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        setFile(null);
                        if (fileInput.current) fileInput.current.value = "";
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      הסרה
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 px-4 py-6 text-sm font-bold text-primary transition-colors hover:border-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ImageUp className="size-6" aria-hidden="true" />
                    בחירת צילום מסך
                    <span className="text-xs font-normal text-muted-foreground">
                      {RECEIPT_HINT}
                    </span>
                  </button>
                )}
              </div>

              {showReferenceError && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {proofProblem}
                </p>
              )}
              {submitError && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {submitError}
                </p>
              )}

              <Button
                type="submit"
                size="lg"
                className="h-12 w-full text-base"
                disabled={submitting}
              >
                {submitting ? (
                  <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="size-5" aria-hidden="true" />
                )}
                {submitting ? "שולחים…" : "שליחת אישור התשלום"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* ---------- עזרה / יציאה ---------- */}
        <div className="space-y-3 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          <p className="flex flex-wrap items-center gap-2">
            <Link2 className="size-4 shrink-0" aria-hidden="true" />
            רוצים להשלים מטלפון אחר? שמרו את הקישור לעמוד הזה:
            <CopyButton
              value={typeof window === "undefined" ? "" : window.location.href}
              label="הקישור"
            />
          </p>
          {info.storePhone && (
            <p className="flex flex-wrap items-center gap-2">
              <PhoneCall className="size-4 shrink-0" aria-hidden="true" />
              מעדיפים לשלם בדרך אחרת? צרו קשר:{" "}
              <a
                href={`tel:${info.storePhone}`}
                dir="ltr"
                className="font-semibold text-primary hover:underline"
              >
                {formatPhone(info.storePhone)}
              </a>
            </p>
          )}
          <p>
            <Link
              to="/"
              onClick={() => clearPendingBitOrder(info.orderId)}
              className="font-medium text-primary hover:underline"
            >
              חזרה לחנות
            </Link>{" "}
            — ההזמנה תישאר שמורה עד {israelTime(info.dueAt)}, ותבוטל אוטומטית אם לא תשולם.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {header}
      <main className="mx-auto w-full max-w-2xl flex-1 px-3 py-6 sm:px-4 sm:py-10">{body}</main>
      <AppFooter />
    </div>
  );
}
