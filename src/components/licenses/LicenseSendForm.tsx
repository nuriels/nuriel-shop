import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  History,
  KeyRound,
  Link2,
  Loader2,
  Paperclip,
  RefreshCw,
  Send,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { cn } from "@/lib/utils";
import {
  buildLicenseEmailHtml,
  licenseEmailSubject,
  type LicenseEmailBranding,
} from "@/lib/license-email";
import {
  EMAIL_STATUS_HINT,
  LICENSE_DISCLAIMER,
  LICENSE_PRODUCTS,
  LICENSE_PRODUCT_LABEL,
  LINK_MAX_DOWNLOADS,
  LINK_VALID_DAYS,
  businessIdProblem,
  cleanCustomerName,
  cleanFileName,
  cleanOrderNumber,
  customerNameProblem,
  emailProblem,
  formatBytes,
  isLicenseProduct,
  keyTail,
  maskedKey,
  normalizeBusinessId,
  normalizeEmail,
  normalizePhone,
  normalizeProductKey,
  orderNumberProblem,
  phoneProblem,
  productKeyProblem,
  productKeyWarning,
  type EmailStatus,
  type LicenseProduct,
} from "@/lib/licenses";
import {
  refreshLicenseStatus,
  sendLicense,
  type LicenseFileSummary,
  type SendLicenseResult,
} from "@/lib/licenses.functions";
import { EmailStatusBadge } from "./LicenseStatus";
import { LicenseEmailPreview } from "./LicenseEmailPreview";
import {
  ACCEPT_FOR_KIND,
  errorText,
  localFileProblem,
  newIdempotencyKey,
  uploadLicenseFile,
} from "./license-client";

type Field =
  "customerName" | "customerEmail" | "customerPhone" | "businessId" | "orderNumber" | "licenseKey";
const FIELD_ORDER: Field[] = [
  "customerName",
  "customerEmail",
  "customerPhone",
  "businessId",
  "orderNumber",
  "licenseKey",
];
const FIELD_ID: Record<Field, string> = {
  customerName: "lic-name",
  customerEmail: "lic-email",
  customerPhone: "lic-phone",
  businessId: "lic-business",
  orderNumber: "lic-order",
  licenseKey: "lic-key",
};

/** "default" = קובץ ברירת המחדל של המוצר (גם אם יוחלף בינתיים), "none" = בלי, אחרת מזהה קובץ */
type FileChoice = string;
const DEFAULT_CHOICE = "default";
const NONE_CHOICE = "none";

type FormState = Record<Field, string> & {
  product: LicenseProduct;
  guide: FileChoice;
  installer: FileChoice;
};
const emptyForm = (product: LicenseProduct): FormState => ({
  product,
  customerName: "",
  customerEmail: "",
  customerPhone: "",
  businessId: "",
  orderNumber: "",
  licenseKey: "",
  guide: DEFAULT_CHOICE,
  installer: DEFAULT_CHOICE,
});

function resolveChoice(choice: FileChoice, list: LicenseFileSummary[]): LicenseFileSummary | null {
  if (choice === NONE_CHOICE) return null;
  if (choice !== DEFAULT_CHOICE) {
    const picked = list.find((f) => f.id === choice);
    if (picked) return picked;
  }
  return list.find((f) => f.isDefault) ?? null;
}

type LastResult = {
  deliveryId: string;
  status: EmailStatus;
  event: string | null;
  error: string | null;
  linkCreated: boolean;
  replayed: boolean;
  customerName: string;
  customerEmail: string;
  product: LicenseProduct;
};
/** בדיקת סטטוס אוטומטית אחרי שליחה: אחרי 5 שניות, 15, 30 ודקה */
const POLL_DELAYS = [5000, 15000, 30000, 60000];

export function LicenseSendForm({
  files,
  branding,
  configured,
  onSent,
  onManageFiles,
  onOpenHistory,
}: {
  files: LicenseFileSummary[];
  branding: LicenseEmailBranding;
  configured: boolean;
  onSent: () => void;
  onManageFiles: () => void;
  onOpenHistory: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => emptyForm("office"));
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptProblem, setReceiptProblem] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [showKeyInPreview, setShowKeyInPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [last, setLast] = useState<LastResult | null>(null);
  const [polls, setPolls] = useState(0);
  const sendingRef = useRef(false);
  /** מפתח idempotency לכל תוכן שליחה: אותו תוכן = אותו מפתח (לחיצה כפולה / ניסיון חוזר לא שולחים פעמיים) */
  const attemptRef = useRef<{ payload: string; key: string } | null>(null);
  const uploadedReceipt = useRef<{ file: File; product: LicenseProduct; id: string } | null>(null);
  const receiptInput = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const guides = files.filter((f) => f.product === form.product && f.kind === "guide");
  const installers = files.filter((f) => f.product === form.product && f.kind === "installer");
  const guide = resolveChoice(form.guide, guides);
  const installer = resolveChoice(form.installer, installers);
  const defaultGuide = guides.find((f) => f.isDefault) ?? null;
  const defaultInstaller = installers.find((f) => f.isDefault) ?? null;

  const normalized = useMemo(
    () => ({
      customerName: cleanCustomerName(form.customerName),
      customerEmail: normalizeEmail(form.customerEmail),
      customerPhone: normalizePhone(form.customerPhone),
      businessId: normalizeBusinessId(form.businessId),
      orderNumber: cleanOrderNumber(form.orderNumber),
      licenseKey: normalizeProductKey(form.licenseKey),
    }),
    [form],
  );
  const errors: Record<Field, string | null> = useMemo(
    () => ({
      customerName: customerNameProblem(normalized.customerName),
      customerEmail: emailProblem(normalized.customerEmail),
      customerPhone: phoneProblem(normalized.customerPhone),
      businessId: businessIdProblem(normalized.businessId),
      orderNumber: orderNumberProblem(normalized.orderNumber),
      licenseKey: productKeyProblem(normalized.licenseKey),
    }),
    [normalized],
  );
  const keyWarning = errors.licenseKey ? null : productKeyWarning(normalized.licenseKey);
  const shownError = (field: Field) => (submitted || touched[field] ? errors[field] : null);

  const set = (field: Field, value: string) => setForm((f) => ({ ...f, [field]: value }));
  const touch = (field: Field) => setTouched((t) => ({ ...t, [field]: true }));

  const changeProduct = (product: LicenseProduct) =>
    setForm((f) => ({ ...f, product, guide: DEFAULT_CHOICE, installer: DEFAULT_CHOICE }));

  const pickReceipt = async (file: File | undefined) => {
    setReceiptProblem(null);
    if (!file) return;
    const problem = await localFileProblem(file, "receipt");
    if (problem) {
      setReceipt(null);
      setReceiptProblem(problem);
      if (receiptInput.current) receiptInput.current.value = "";
      return;
    }
    setReceipt(file);
  };
  const clearReceipt = () => {
    setReceipt(null);
    setReceiptProblem(null);
    if (receiptInput.current) receiptInput.current.value = "";
  };

  /** הקבלה עולה רק בשליחה עצמה (לא נשארים קבצים יתומים מטפסים שננטשו); ניסיון חוזר — בלי העלאה כפולה */
  const ensureReceipt = async (): Promise<string | null> => {
    if (!receipt) return null;
    const cached = uploadedReceipt.current;
    if (cached && cached.file === receipt && cached.product === form.product) return cached.id;
    const saved = await uploadLicenseFile({
      file: receipt,
      product: form.product,
      kind: "receipt",
      makeDefault: false,
    });
    uploadedReceipt.current = { file: receipt, product: form.product, id: saved.id };
    return saved.id;
  };

  const openPreview = () => {
    setSubmitted(true);
    const firstBad = FIELD_ORDER.find((f) => errors[f]);
    if (firstBad) {
      toast.error("יש לתקן את השדות המסומנים");
      document.getElementById(FIELD_ID[firstBad])?.focus();
      return;
    }
    if (receiptProblem) {
      toast.error(receiptProblem);
      return;
    }
    // המפתח מוצג בפורמט הקבוצות לפני התצוגה המקדימה
    setForm((f) => ({ ...f, licenseKey: normalized.licenseKey }));
    setShowKeyInPreview(false);
    setPreviewOpen(true);
  };

  const resetForm = () => {
    setForm((f) => emptyForm(f.product));
    setTouched({});
    setSubmitted(false);
    setShowKey(false);
    clearReceipt();
    uploadedReceipt.current = null;
    attemptRef.current = null;
  };

  const sendNow = async (confirmDuplicate: boolean) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const payload = {
        product: form.product,
        ...normalized,
        guideFileId: guide?.id ?? null,
        installerFileId: installer?.id ?? null,
      };
      const identity = JSON.stringify({
        ...payload,
        receipt: receipt ? [receipt.name, receipt.size, receipt.lastModified] : null,
      });
      if (attemptRef.current?.payload !== identity) {
        attemptRef.current = { payload: identity, key: newIdempotencyKey() };
      }
      const receiptFileId = await ensureReceipt();
      const result: SendLicenseResult = await sendLicense({
        data: {
          ...payload,
          idempotencyKey: attemptRef.current.key,
          receiptFileId,
          confirmDuplicate,
        },
      });
      if (result.kind === "duplicate") {
        setDuplicate(result.message);
        return;
      }
      const status = result.status;
      setLast({
        deliveryId: result.deliveryId,
        status,
        event: null,
        error: result.kind === "sent" ? result.error : null,
        linkCreated: result.kind === "sent" ? result.linkCreated : false,
        replayed: result.kind === "replayed",
        customerName: payload.customerName,
        customerEmail: payload.customerEmail,
        product: payload.product,
      });
      setPolls(0);
      if (result.kind === "replayed") {
        toast.info("השליחה הזו כבר בוצעה — לא נשלח מייל נוסף");
      } else if (status === "failed") {
        toast.error(`המייל לא נשלח${result.error ? `: ${result.error}` : ""}`);
      } else if (status === "unknown") {
        toast.warning("לא התקבלה תשובה ודאית מספק המייל — בדקו את הסטטוס בהיסטוריה");
      } else {
        toast.success("המייל התקבל לשליחה אצל ספק המייל");
      }
      setPreviewOpen(false);
      resetForm();
      onSent();
      window.setTimeout(
        () => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
        50,
      );
    } catch (error) {
      toast.error(errorText(error, "השליחה נכשלה"));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  // אחרי שליחה: בדיקה אוטומטית אם ספק המייל אישר מסירה ("נמסר" רק אחרי אישור כזה)
  const lastId = last?.deliveryId ?? null;
  const lastStatus = last?.status ?? null;
  useEffect(() => {
    if (!lastId || (lastStatus !== "accepted" && lastStatus !== "unknown")) return;
    const delay = POLL_DELAYS[polls];
    if (delay === undefined) return;
    const timer = window.setTimeout(() => {
      void refreshLicenseStatus({ data: { deliveryId: lastId } })
        .then((r) =>
          setLast((cur) =>
            cur && cur.deliveryId === lastId
              ? { ...cur, status: r.status, event: r.event ?? cur.event }
              : cur,
          ),
        )
        .catch(() => undefined)
        .finally(() => setPolls((n) => n + 1));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [lastId, lastStatus, polls]);

  const refreshLast = async () => {
    if (!last) return;
    try {
      const r = await refreshLicenseStatus({ data: { deliveryId: last.deliveryId } });
      setLast((cur) => (cur ? { ...cur, status: r.status, event: r.event ?? cur.event } : cur));
    } catch (error) {
      toast.error(errorText(error, "רענון הסטטוס נכשל"));
    }
  };

  const previewHtml = useMemo(() => {
    if (!previewOpen) return "";
    const attachments = [
      guide?.fileName ?? null,
      receipt ? cleanFileName(receipt.name, "receipt") : null,
    ].filter((x): x is string => Boolean(x));
    return buildLicenseEmailHtml(
      {
        customerName: normalized.customerName,
        product: form.product,
        licenseKey: showKeyInPreview
          ? normalized.licenseKey
          : maskedKey(keyTail(normalized.licenseKey)),
        orderNumber: normalized.orderNumber || null,
        downloadUrl: null,
        downloadPlaceholder: Boolean(installer),
        attachments,
      },
      branding,
    );
  }, [
    previewOpen,
    guide,
    receipt,
    normalized,
    form.product,
    showKeyInPreview,
    installer,
    branding,
  ]);

  const productShort = form.product === "office" ? "Office" : "Windows";

  return (
    <div className="space-y-5">
      {last ? (
        <LastSendCard
          ref={resultRef}
          last={last}
          onRefresh={refreshLast}
          onOpenHistory={onOpenHistory}
          onDismiss={() => setLast(null)}
        />
      ) : null}

      {!configured ? (
        <p
          className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          השרת עוד לא הוגדר לשמירה מוצפנת של מפתחות רישיון (LICENSE_KEYS_SECRET), ולכן אי אפשר
          לשלוח. אפשר להכין את הקבצים ולראות תצוגה מקדימה; מנהל המערכת צריך להגדיר את המפתח בשרת.
        </p>
      ) : null}

      <form
        noValidate
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          openPreview();
        }}
      >
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold text-foreground">מוצר</legend>
          <RadioGroup
            value={form.product}
            onValueChange={(v) => {
              if (isLicenseProduct(v)) changeProduct(v);
            }}
            className="grid grid-cols-2 gap-3"
            dir="rtl"
          >
            {LICENSE_PRODUCTS.map((p) => (
              <Label
                key={p}
                htmlFor={`lic-product-${p}`}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3 transition-colors sm:p-4",
                  form.product === p
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50",
                )}
              >
                <RadioGroupItem id={`lic-product-${p}`} value={p} />
                <span className="min-w-0">
                  <span className="block font-bold text-foreground" dir="ltr">
                    {p === "office" ? "Office" : "Windows"}
                  </span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    רישיון דיגיטלי · {LICENSE_PRODUCT_LABEL[p]}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-semibold text-foreground">פרטי הלקוח</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              field="customerName"
              label="שם מלא"
              value={form.customerName}
              error={shownError("customerName")}
              onChange={(v) => set("customerName", v)}
              onBlur={() => touch("customerName")}
              maxLength={120}
            />
            <TextField
              field="customerEmail"
              label="אימייל"
              type="email"
              ltr
              value={form.customerEmail}
              error={shownError("customerEmail")}
              onChange={(v) => set("customerEmail", v)}
              onBlur={() => touch("customerEmail")}
              maxLength={254}
            />
            <TextField
              field="customerPhone"
              label="טלפון"
              type="tel"
              ltr
              value={form.customerPhone}
              error={shownError("customerPhone")}
              onChange={(v) => set("customerPhone", v)}
              onBlur={() => touch("customerPhone")}
              maxLength={20}
            />
            <TextField
              field="businessId"
              label="ח.פ. / עוסק מורשה"
              optional
              ltr
              inputMode="numeric"
              value={form.businessId}
              error={shownError("businessId")}
              onChange={(v) => set("businessId", v)}
              onBlur={() => touch("businessId")}
              maxLength={12}
            />
            <TextField
              field="orderNumber"
              label="מספר הזמנה"
              optional
              ltr
              value={form.orderNumber}
              error={shownError("orderNumber")}
              onChange={(v) => set("orderNumber", v)}
              onBlur={() => touch("orderNumber")}
              maxLength={40}
            />
          </div>
        </fieldset>

        <fieldset className="space-y-1.5">
          <legend className="sr-only">מפתח הרישיון</legend>
          <Label htmlFor="lic-key" className="flex items-center gap-1.5">
            <KeyRound className="size-4" aria-hidden />
            {form.product === "office" ? "מפתח רישיון Office" : "מפתח מוצר Windows (Product Key)"}
          </Label>
          <div className="relative max-w-xl" dir="ltr">
            <Input
              id="lic-key"
              type={showKey ? "text" : "password"}
              dir="ltr"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              data-bwignore
              data-form-type="other"
              maxLength={40}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
              className="pr-11 font-mono tracking-wider"
              value={form.licenseKey}
              aria-invalid={Boolean(shownError("licenseKey"))}
              aria-describedby="lic-key-note lic-key-error"
              onChange={(e) => set("licenseKey", e.target.value)}
              onBlur={() => {
                touch("licenseKey");
                setForm((f) => ({ ...f, licenseKey: normalizeProductKey(f.licenseKey) }));
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute inset-y-0 right-0 h-full w-10"
              aria-label={showKey ? "הסתרת המפתח" : "הצגת המפתח"}
              aria-pressed={showKey}
              onClick={() => setShowKey((s) => !s)}
            >
              {showKey ? (
                <EyeOff className="size-4" aria-hidden />
              ) : (
                <Eye className="size-4" aria-hidden />
              )}
            </Button>
          </div>
          <p
            id="lic-key-error"
            className="text-sm font-medium text-destructive"
            role={shownError("licenseKey") ? "alert" : undefined}
          >
            {shownError("licenseKey") ?? ""}
          </p>
          {keyWarning ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">{keyWarning}</p>
          ) : null}
          <div id="lic-key-note" className="max-w-xl space-y-1.5">
            {form.product === "windows" ? (
              <p className="text-xs leading-5 text-muted-foreground">
                25 תווים (5 קבוצות של 5). הלקוח מזין אותו ב-Windows: הגדרות ← מערכת ← הפעלה ← שינוי
                מפתח מוצר.
              </p>
            ) : null}
            <p className="rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              {LICENSE_DISCLAIMER}
            </p>
            <p className="text-xs text-muted-foreground">
              המפתח נשמר מוצפן, לא מופיע ברשימות, ומוצג במלואו רק למורשים — וכל הצגה נרשמת ביומן.
            </p>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-semibold text-foreground">קבצים</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <FileChoiceField
              id="lic-guide"
              label="מדריך התקנה (PDF) — מצורף למייל"
              icon={<FileText className="size-4" aria-hidden />}
              value={form.guide}
              defaultFile={defaultGuide}
              files={guides}
              noneLabel="בלי מדריך"
              onChange={(v) => setForm((f) => ({ ...f, guide: v }))}
            />
            <FileChoiceField
              id="lic-installer"
              label="תוכנת התקנה (EXE) — בקישור הורדה"
              icon={<Link2 className="size-4" aria-hidden />}
              value={form.installer}
              defaultFile={defaultInstaller}
              files={installers}
              noneLabel="בלי קישור הורדה"
              onChange={(v) => setForm((f) => ({ ...f, installer: v }))}
            />
          </div>
          {installer ? (
            <p className="text-xs leading-5 text-muted-foreground">
              הקובץ לא מצורף למייל: הלקוח מקבל קישור הורדה אישי ומאובטח — תקף {LINK_VALID_DAYS} ימים
              ועד {LINK_MAX_DOWNLOADS} הורדות.
            </p>
          ) : null}
          {!defaultGuide || !defaultInstaller ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="size-3.5" aria-hidden />
              לא הוגדרו קבצי ברירת מחדל מלאים ל-{productShort}.
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={onManageFiles}
              >
                להעלאת קבצים
              </Button>
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="lic-receipt" className="flex items-center gap-1.5">
              <Paperclip className="size-4" aria-hidden /> קבלה (PDF){" "}
              <span className="text-xs font-normal text-muted-foreground">
                — לא חובה, מצורפת למייל
              </span>
            </Label>
            {receipt ? (
              <div className="flex max-w-xl items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                <span className="min-w-0 truncate" dir="ltr">
                  {receipt.name}{" "}
                  <span className="text-xs text-muted-foreground">
                    ({formatBytes(receipt.size)})
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  aria-label="הסרת הקבלה"
                  onClick={clearReceipt}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </div>
            ) : (
              <div className="flex max-w-xl items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => receiptInput.current?.click()}
                >
                  <Upload className="size-4" aria-hidden /> בחירת קובץ קבלה
                </Button>
                <span className="text-xs text-muted-foreground">עד 15MB</span>
              </div>
            )}
            <input
              ref={receiptInput}
              id="lic-receipt"
              type="file"
              accept={ACCEPT_FOR_KIND.receipt}
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => void pickReceipt(e.target.files?.[0])}
            />
            {receiptProblem ? (
              <p className="text-sm font-medium text-destructive" role="alert">
                {receiptProblem}
              </p>
            ) : null}
          </div>
        </fieldset>

        <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center">
          <Button type="submit" size="lg" className="gap-2 sm:min-w-56">
            <Eye className="size-4" aria-hidden /> תצוגה מקדימה לפני שליחה
          </Button>
          <p className="text-xs text-muted-foreground">
            שום דבר לא נשלח לפני שתאשרו בתצוגה המקדימה.
          </p>
        </div>
      </form>

      <Dialog
        open={previewOpen}
        onOpenChange={(open) => {
          if (!sending) setPreviewOpen(open);
        }}
      >
        <DialogContent dir="rtl" className="max-h-[92vh] max-w-5xl overflow-y-auto p-4 sm:p-6">
          <DialogHeader className="pr-8 text-right sm:text-right">
            <DialogTitle>תצוגה מקדימה — לפני השליחה</DialogTitle>
            <DialogDescription>
              בדקו את הפרטים ואת המייל. השליחה מתבצעת רק בלחיצה על "שליחת הרישיון ללקוח".
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
            <dl className="space-y-3 text-sm">
              <SummaryRow label="נמען">
                <span className="block font-semibold">{normalized.customerName}</span>
                <span className="block" dir="ltr">
                  {normalized.customerEmail}
                </span>
              </SummaryRow>
              <SummaryRow label="טלפון">
                <span dir="ltr">{normalized.customerPhone}</span>
              </SummaryRow>
              {normalized.businessId ? (
                <SummaryRow label="ח.פ. / עוסק">
                  <span dir="ltr">{normalized.businessId}</span>
                </SummaryRow>
              ) : null}
              {normalized.orderNumber ? (
                <SummaryRow label="מספר הזמנה">
                  <span dir="ltr">{normalized.orderNumber}</span>
                </SummaryRow>
              ) : null}
              <SummaryRow label="מוצר">
                <span dir="ltr">{LICENSE_PRODUCT_LABEL[form.product]}</span>
              </SummaryRow>
              <SummaryRow label="מפתח הרישיון">
                <span className="flex items-center gap-1">
                  <span dir="ltr" className="font-mono text-xs sm:text-sm">
                    {showKeyInPreview
                      ? normalized.licenseKey
                      : maskedKey(keyTail(normalized.licenseKey))}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    aria-label={showKeyInPreview ? "הסתרת המפתח" : "הצגת המפתח"}
                    aria-pressed={showKeyInPreview}
                    onClick={() => setShowKeyInPreview((s) => !s)}
                  >
                    {showKeyInPreview ? (
                      <EyeOff className="size-3.5" aria-hidden />
                    ) : (
                      <Eye className="size-3.5" aria-hidden />
                    )}
                  </Button>
                </span>
              </SummaryRow>
              <SummaryRow label="קבצים מצורפים">
                {guide || receipt ? (
                  <ul className="space-y-0.5" dir="ltr">
                    {guide ? (
                      <li className="text-right">
                        {guide.fileName} ({formatBytes(guide.sizeBytes)})
                      </li>
                    ) : null}
                    {receipt ? (
                      <li className="text-right">
                        {cleanFileName(receipt.name, "receipt")} ({formatBytes(receipt.size)})
                      </li>
                    ) : null}
                  </ul>
                ) : (
                  <span className="text-muted-foreground">ללא קבצים מצורפים</span>
                )}
              </SummaryRow>
              <SummaryRow label="קישור הורדה">
                {installer ? (
                  <span className="block">
                    <span className="block" dir="ltr">
                      {installer.fileName} ({formatBytes(installer.sizeBytes)})
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      קישור אישי ייווצר בשליחה — תקף {LINK_VALID_DAYS} ימים, עד {LINK_MAX_DOWNLOADS}{" "}
                      הורדות
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">ללא קישור הורדה</span>
                )}
              </SummaryRow>
            </dl>
            <LicenseEmailPreview html={previewHtml} subject={licenseEmailSubject(form.product)} />
          </div>
          {/* כפתור השליחה תמיד בהישג יד — גם בטלפון, מתחת לתצוגה המקדימה הארוכה */}
          <DialogFooter className="sticky bottom-0 -mx-4 -mb-4 gap-2 border-t border-border bg-background px-4 py-3 sm:-mx-6 sm:-mb-6 sm:justify-start sm:gap-2 sm:px-6">
            <Button
              type="button"
              size="lg"
              className="gap-2"
              disabled={sending || !configured}
              onClick={() => void sendNow(false)}
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Send className="size-4" aria-hidden />
              )}
              {sending ? "שולח…" : "שליחת הרישיון ללקוח"}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              disabled={sending}
              onClick={() => setPreviewOpen(false)}
            >
              חזרה לעריכה
            </Button>
            {!configured ? (
              <p className="self-center text-xs text-amber-800 dark:text-amber-300">
                השליחה תיפתח אחרי הגדרת LICENSE_KEYS_SECRET בשרת.
              </p>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={duplicate !== null}
        onOpenChange={(open) => (open ? undefined : setDuplicate(null))}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader className="text-right sm:text-right">
            <AlertDialogTitle>המפתח הזה כבר נשלח</AlertDialogTitle>
            <AlertDialogDescription>{duplicate}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start sm:gap-2">
            <AlertDialogAction
              onClick={() => {
                setDuplicate(null);
                void sendNow(true);
              }}
            >
              כן, לשלוח שוב
            </AlertDialogAction>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TextField({
  field,
  label,
  value,
  error,
  onChange,
  onBlur,
  type = "text",
  ltr = false,
  optional = false,
  inputMode,
  maxLength,
}: {
  field: Field;
  label: string;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
  onBlur: () => void;
  type?: "text" | "email" | "tel";
  ltr?: boolean;
  optional?: boolean;
  inputMode?: "numeric" | "text";
  maxLength?: number;
}) {
  const id = FIELD_ID[field];
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}{" "}
        {optional ? (
          <span className="text-xs font-normal text-muted-foreground">(לא חובה)</span>
        ) : null}
      </Label>
      <Input
        id={id}
        type={type}
        dir={ltr ? "ltr" : "rtl"}
        className={ltr ? "text-left" : undefined}
        autoComplete="off"
        inputMode={inputMode}
        maxLength={maxLength}
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-required={!optional}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function FileChoiceField({
  id,
  label,
  icon,
  value,
  defaultFile,
  files,
  noneLabel,
  onChange,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  value: FileChoice;
  defaultFile: LicenseFileSummary | null;
  files: LicenseFileSummary[];
  noneLabel: string;
  onChange: (value: FileChoice) => void;
}) {
  const others = files.filter((f) => !f.isDefault);
  // בחירה בקובץ שכבר לא קיים (הוסר בינתיים) — חוזרים לברירת המחדל
  const current =
    value === DEFAULT_CHOICE || value === NONE_CHOICE || others.some((f) => f.id === value)
      ? value
      : DEFAULT_CHOICE;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5">
        {icon} {label}
      </Label>
      <Select value={current} onValueChange={onChange}>
        <SelectTrigger id={id} dir="rtl">
          <SelectValue />
        </SelectTrigger>
        <SelectContent dir="rtl">
          <SelectItem value={DEFAULT_CHOICE}>
            {defaultFile ? `ברירת המחדל — ${defaultFile.fileName}` : "ברירת המחדל (לא הוגדרה)"}
          </SelectItem>
          {others.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.fileName} ({formatBytes(f.sizeBytes)})
            </SelectItem>
          ))}
          <SelectItem value={NONE_CHOICE}>{noneLabel}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-foreground">{children}</dd>
    </div>
  );
}

function LastSendCard({
  ref,
  last,
  onRefresh,
  onOpenHistory,
  onDismiss,
}: {
  ref: React.Ref<HTMLDivElement>;
  last: LastResult;
  onRefresh: () => Promise<void>;
  onOpenHistory: () => void;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const failed = last.status === "failed";
  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      className={cn(
        "rounded-xl border p-4",
        failed
          ? "border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30"
          : "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {failed ? (
            <AlertTriangle
              className="mt-0.5 size-5 shrink-0 text-red-700 dark:text-red-300"
              aria-hidden
            />
          ) : (
            <CheckCircle2
              className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-300"
              aria-hidden
            />
          )}
          <div className="min-w-0 space-y-1">
            <p className="font-semibold text-foreground">
              {last.replayed
                ? "השליחה הזו כבר בוצעה קודם — לא נשלח מייל נוסף"
                : failed
                  ? "המייל לא נשלח"
                  : `הרישיון נשלח ל${last.customerName}`}
            </p>
            <p className="truncate text-sm text-muted-foreground" dir="ltr">
              {last.customerEmail} · {LICENSE_PRODUCT_LABEL[last.product]}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <EmailStatusBadge status={last.status} event={last.event} />
              {last.linkCreated ? (
                <span className="text-xs text-muted-foreground">
                  נוצר קישור הורדה ({LINK_VALID_DAYS} ימים, עד {LINK_MAX_DOWNLOADS} הורדות)
                </span>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">{EMAIL_STATUS_HINT[last.status]}</p>
            {last.error ? (
              <p className="text-xs text-red-800 dark:text-red-300">{last.error}</p>
            ) : null}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label="סגירת ההודעה"
          onClick={onDismiss}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onRefresh();
            setBusy(false);
          }}
        >
          <RefreshCw className={cn("size-4", busy && "animate-spin")} aria-hidden /> רענון סטטוס
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={onOpenHistory}
        >
          <History className="size-4" aria-hidden /> להיסטוריה {failed ? "ולשליחה חוזרת" : ""}
        </Button>
      </div>
    </div>
  );
}
