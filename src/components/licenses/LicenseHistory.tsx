import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Link2,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  EMAIL_STATUS_HINT,
  EMAIL_STATUS_LABEL,
  LICENSE_FILE_KIND_LABEL,
  LICENSE_PRODUCT_LABEL,
  LINK_MAX_DOWNLOADS,
  LINK_VALID_DAYS,
  PROVIDER_EVENT_LABEL,
  formatDateTimeHe,
  type EmailStatus,
  type LicenseProduct,
} from "@/lib/licenses";
import {
  getLicenseDelivery,
  listLicenseDeliveries,
  refreshLicenseStatus,
  refreshRecentLicenseStatuses,
  regenerateLicenseLink,
  resendLicenseEmail,
  revealLicenseKey,
  revokeLicenseLink,
  type LicenseAuditItem,
  type LicenseDeliveryDetails,
  type LicenseDeliveryListItem,
} from "@/lib/licenses.functions";
import { EmailStatusBadge, LinkStateBadge } from "./LicenseStatus";
import { copyText, errorText } from "./license-client";

type ListResult = { items: LicenseDeliveryListItem[]; total: number; pageSize: number };

const productShort = (p: LicenseProduct) => (p === "office" ? "Office" : "Windows");
const downloadsText = (item: LicenseDeliveryListItem) =>
  item.link ? `${item.link.downloads} / ${item.link.maxDownloads}` : "—";

/** היסטוריית השליחות: בלי מפתחות מלאים; פרטים, קישורים ויומן — בחלון הפרטים */
export function LicenseHistory({ refreshKey }: { refreshKey: number }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [product, setProduct] = useState<"all" | LicenseProduct>("all");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(query.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const result = await listLicenseDeliveries({
        data: { page, query: debounced, ...(product === "all" ? {} : { product }) },
      });
      if (request !== requestRef.current) return; // תשובה ישנה (חיפוש שהשתנה בינתיים)
      setData(result);
      setError(null);
    } catch (e) {
      if (request === requestRef.current) setError(errorText(e, "טעינת ההיסטוריה נכשלה"));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [page, debounced, product]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const checkStatuses = async () => {
    setChecking(true);
    try {
      const { checked } = await refreshRecentLicenseStatuses();
      toast.success(
        checked > 0 ? `עודכן הסטטוס של ${checked} שליחות` : "אין שליחות שממתינות לאישור מסירה",
      );
      await load();
    } catch (e) {
      toast.error(errorText(e, "בדיקת הסטטוסים נכשלה"));
    } finally {
      setChecking(false);
    }
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="lic-search">חיפוש</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="lic-search"
              className="pr-9"
              placeholder="שם, אימייל, טלפון או מספר הזמנה"
              value={query}
              maxLength={60}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5 sm:w-44">
          <Label htmlFor="lic-filter-product">מוצר</Label>
          <Select
            value={product}
            onValueChange={(v) => {
              setProduct(v === "office" || v === "windows" ? v : "all");
              setPage(0);
            }}
          >
            <SelectTrigger id="lic-filter-product" dir="rtl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent dir="rtl">
              <SelectItem value="all">כל המוצרים</SelectItem>
              <SelectItem value="office">Office</SelectItem>
              <SelectItem value="windows">Windows</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          className="gap-1.5"
          disabled={checking}
          onClick={() => void checkStatuses()}
        >
          <RefreshCw className={cn("size-4", checking && "animate-spin")} aria-hidden /> בדיקת סטטוס
          מסירה
        </Button>
      </div>

      {error ? (
        <p
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {!data && loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> טוען היסטוריה…
        </div>
      ) : data && data.items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {debounced || product !== "all" ? "לא נמצאו שליחות מתאימות" : "עדיין לא נשלחו רישיונות"}
        </p>
      ) : data ? (
        <>
          {/* מחשב: טבלה צפופה; עמודת "פרטים" נשארת גלויה גם כשהטבלה נגללת לרוחב */}
          <div
            className={cn(
              "hidden overflow-x-auto rounded-lg border border-border lg:block",
              loading && "opacity-60",
            )}
          >
            <Table className="text-[13px] [&_td]:px-1.5 [&_th]:px-1.5">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">לקוח</TableHead>
                  <TableHead className="text-right">אימייל</TableHead>
                  <TableHead className="text-right">טלפון</TableHead>
                  <TableHead className="text-right">מוצר</TableHead>
                  <TableHead className="text-right">הזמנה</TableHead>
                  <TableHead className="text-right">תאריך שליחה</TableHead>
                  <TableHead className="text-right">סטטוס מייל</TableHead>
                  <TableHead className="text-right">קישור</TableHead>
                  <TableHead className="text-right">הורדות</TableHead>
                  <TableHead className="sticky left-0 bg-card text-right">
                    <span className="sr-only">פעולות</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((item) => {
                  const [date, time] = formatDateTimeHe(item.sentAt ?? item.createdAt).split(", ");
                  return (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer"
                      onClick={() => setOpenId(item.id)}
                    >
                      <TableCell className="font-medium">
                        <span className="block max-w-32 truncate" title={item.customerName}>
                          {item.customerName}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className="block max-w-40 truncate text-right"
                          dir="ltr"
                          title={item.customerEmail}
                        >
                          {item.customerEmail}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap" dir="ltr">
                        <span className="block text-right">{item.customerPhone}</span>
                      </TableCell>
                      <TableCell dir="ltr">
                        <span className="block text-right">{productShort(item.product)}</span>
                      </TableCell>
                      <TableCell>
                        <span
                          className="block max-w-20 truncate text-right"
                          dir="ltr"
                          title={item.orderNumber ?? undefined}
                        >
                          {item.orderNumber ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs leading-5">
                        <span className="block">{date}</span>
                        {time ? <span className="block text-muted-foreground">{time}</span> : null}
                      </TableCell>
                      <TableCell>
                        <EmailStatusBadge status={item.emailStatus} event={item.providerEvent} />
                      </TableCell>
                      <TableCell>
                        <LinkStateBadge state={item.link?.state ?? null} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums" dir="ltr">
                        <span className="block text-right">{downloadsText(item)}</span>
                      </TableCell>
                      <TableCell className="sticky left-0 bg-card px-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenId(item.id);
                          }}
                        >
                          פרטים
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* נייד: כרטיסים */}
          <ul className={cn("space-y-3 lg:hidden", loading && "opacity-60")}>
            {data.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="w-full rounded-xl border border-border bg-card p-3 text-right shadow-sm transition-colors hover:bg-muted/40"
                  onClick={() => setOpenId(item.id)}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="block min-w-0">
                      <span className="block truncate font-semibold text-foreground">
                        {item.customerName}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground" dir="ltr">
                        {item.customerEmail}
                      </span>
                      <span className="block text-xs text-muted-foreground" dir="ltr">
                        {item.customerPhone}
                      </span>
                    </span>
                    <span
                      className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-semibold"
                      dir="ltr"
                    >
                      {productShort(item.product)}
                    </span>
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-1.5">
                    <EmailStatusBadge status={item.emailStatus} event={item.providerEvent} />
                    <LinkStateBadge state={item.link?.state ?? null} />
                    <span className="text-xs text-muted-foreground">
                      הורדות: {downloadsText(item)}
                    </span>
                  </span>
                  <span className="mt-1.5 block text-xs text-muted-foreground">
                    {formatDateTimeHe(item.sentAt ?? item.createdAt)}
                    {item.orderNumber ? ` · הזמנה ${item.orderNumber}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              {data.total} שליחות · עמוד {page + 1} מתוך {pages}
            </span>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page === 0 || loading}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronRight className="size-4" aria-hidden /> הקודם
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page + 1 >= pages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                הבא <ChevronLeft className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        </>
      ) : null}

      {openId ? (
        <LicenseDeliveryDialog
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------
// חלון הפרטים
// ------------------------------------------------------------

const AUDIT_LABEL: Record<string, string> = {
  send: "שליחת הרישיון",
  send_failed: "שליחה שנכשלה",
  resend: "שליחה חוזרת",
  reveal_key: "צפייה במפתח המלא",
  link_created: "נוצר קישור הורדה",
  link_revoked: "קישור בוטל",
  download: "הורדת תוכנת ההתקנה",
  download_denied: "ניסיון הורדה שנחסם",
  status_refreshed: "עדכון סטטוס מייל",
};
const DENIED_LABEL: Record<string, string> = {
  expired: "פג תוקף",
  exhausted: "נוצלו כל ההורדות",
  revoked: "הקישור בוטל",
  not_found: "קישור לא נמצא",
};

function statusLabel(value: unknown): string | null {
  return typeof value === "string" && value in EMAIL_STATUS_LABEL
    ? EMAIL_STATUS_LABEL[value as EmailStatus]
    : null;
}

function auditDetail(item: LicenseAuditItem): string | null {
  const d = item.details;
  switch (item.action) {
    case "send":
    case "send_failed":
    case "resend": {
      const status = statusLabel(d["status"]);
      return status ? `סטטוס: ${status}` : null;
    }
    case "download":
      return typeof d["download"] === "number"
        ? `הורדה ${d["download"]} מתוך ${d["max"] ?? "—"}`
        : null;
    case "download_denied":
      return typeof d["state"] === "string" ? (DENIED_LABEL[d["state"]] ?? d["state"]) : null;
    case "status_refreshed": {
      const from = statusLabel(d["from"]);
      const to = statusLabel(d["to"]);
      return from && to ? `${from} ← ${to}` : null;
    }
    case "link_created":
      return typeof d["days"] === "number"
        ? `${d["days"]} ימים, עד ${d["max"] ?? "—"} הורדות`
        : null;
    default:
      return null;
  }
}

type Confirm =
  { kind: "resend" } | { kind: "regenerate"; email: boolean } | { kind: "revoke"; linkId: string };

/** כמה זמן המפתח המלא נשאר גלוי אחרי "הצגה" */
const REVEAL_MS = 30_000;

function LicenseDeliveryDialog({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [details, setDetails] = useState<LicenseDeliveryDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [newLink, setNewLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [emailNewLink, setEmailNewLink] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetails(await getLicenseDelivery({ data: { id } }));
      setLoadError(null);
    } catch (e) {
      setLoadError(errorText(e, "טעינת הפרטים נכשלה"));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // המפתח המלא מוסתר שוב אוטומטית
  useEffect(() => {
    if (!revealed) return;
    const timer = window.setTimeout(() => setRevealed(null), REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [revealed]);

  const run = async (name: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(name);
    try {
      await action();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const reveal = () =>
    run("reveal", async () => {
      if (revealed) {
        setRevealed(null);
        return;
      }
      const { key } = await revealLicenseKey({ data: { deliveryId: id } });
      setRevealed(key);
      await load(); // הצפייה נרשמה ביומן
    });

  const copyKey = async () => {
    if (!revealed) return;
    if (await copyText(revealed)) toast.success("המפתח הועתק");
    else toast.error("ההעתקה נכשלה — אפשר לסמן ולהעתיק ידנית");
  };

  const refreshStatus = () =>
    run("status", async () => {
      const r = await refreshLicenseStatus({ data: { deliveryId: id } });
      toast.success(`סטטוס המייל: ${EMAIL_STATUS_LABEL[r.status]}`);
      await load();
      onChanged();
    });

  const doConfirmed = (c: Confirm) =>
    run(c.kind, async () => {
      if (c.kind === "revoke") {
        await revokeLicenseLink({ data: { linkId: c.linkId } });
        toast.success("הקישור בוטל — לא ניתן יותר להוריד ממנו");
      } else if (c.kind === "regenerate") {
        const r = await regenerateLicenseLink({ data: { deliveryId: id, emailCustomer: c.email } });
        setNewLink({ url: r.url, expiresAt: r.expiresAt });
        if (c.email && r.emailStatus) {
          if (r.emailStatus === "failed") toast.error("הקישור נוצר, אבל המייל ללקוח לא נשלח");
          else toast.success(`נוצר קישור חדש ונשלח ללקוח (${EMAIL_STATUS_LABEL[r.emailStatus]})`);
        } else {
          toast.success("נוצר קישור הורדה חדש; הקישור הקודם בוטל");
        }
      } else {
        const r = await resendLicenseEmail({ data: { deliveryId: id } });
        if (r.status === "failed") toast.error(`המייל לא נשלח${r.error ? `: ${r.error}` : ""}`);
        else if (r.status === "unknown")
          toast.warning("לא התקבלה תשובה ודאית מספק המייל — כדאי לרענן סטטוס");
        else toast.success("המייל נשלח שוב והתקבל לשליחה אצל ספק המייל");
      }
      await load();
      onChanged();
    });

  const d = details;
  const activeLinks = d?.links.filter((l) => l.state === "active") ?? [];

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent dir="rtl" className="max-h-[92vh] max-w-3xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="pr-8 text-right sm:text-right">
          <DialogTitle>
            {d ? `רישיון ${productShort(d.product)} — ${d.customerName}` : "פרטי השליחה"}
          </DialogTitle>
          <DialogDescription>פרטי השליחה, קישורי ההורדה ויומן הפעולות</DialogDescription>
        </DialogHeader>

        {loadError ? (
          <p
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            role="alert"
          >
            {loadError}
          </p>
        ) : !d ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> טוען…
          </div>
        ) : (
          <div className="space-y-5">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <Info label="לקוח">{d.customerName}</Info>
              <Info label="אימייל" ltr>
                {d.customerEmail}
              </Info>
              <Info label="טלפון" ltr>
                {d.customerPhone}
              </Info>
              <Info label="ח.פ. / עוסק" ltr>
                {d.businessId ?? "—"}
              </Info>
              <Info label="מוצר" ltr>
                {LICENSE_PRODUCT_LABEL[d.product]}
              </Info>
              <Info label="מספר הזמנה" ltr>
                {d.orderNumber ?? "—"}
              </Info>
              <Info label="נשלח">
                {formatDateTimeHe(d.sentAt ?? d.createdAt)}
                {d.sentByName ? ` · ע״י ${d.sentByName}` : ""}
                {d.sendCount > 1 ? ` · ${d.sendCount} שליחות` : ""}
              </Info>
              <Info label="קבצים">
                {d.files.length === 0
                  ? "—"
                  : d.files.map((f) => (
                      <span key={`${f.kind}-${f.fileName}`} className="block">
                        <span className="text-muted-foreground">
                          {LICENSE_FILE_KIND_LABEL[f.kind]}:{" "}
                        </span>
                        <bdi dir="ltr">{f.fileName}</bdi>
                      </span>
                    ))}
              </Info>
            </dl>

            <section className="space-y-2 rounded-xl border border-border p-3">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <ShieldAlert className="size-4" aria-hidden /> מפתח הרישיון
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <span dir="ltr" className="rounded-md bg-muted px-2 py-1 font-mono text-sm">
                  {revealed ?? d.keyMasked}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={busy !== null}
                  onClick={() => void reveal()}
                >
                  {busy === "reveal" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : revealed ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                  {revealed ? "הסתרה" : "הצגת המפתח המלא"}
                </Button>
                {revealed ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => void copyKey()}
                  >
                    <Copy className="size-4" aria-hidden /> העתקה
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                כל הצגה של המפתח המלא נרשמת ביומן (מי וּמתי). המפתח מוסתר שוב אוטומטית אחרי 30
                שניות.
              </p>
            </section>

            <section className="space-y-2 rounded-xl border border-border p-3">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <Mail className="size-4" aria-hidden /> המייל
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <EmailStatusBadge status={d.emailStatus} event={d.providerEvent} />
                {d.providerEvent ? (
                  <span className="text-xs text-muted-foreground">
                    אירוע אחרון מהספק: {PROVIDER_EVENT_LABEL[d.providerEvent] ?? d.providerEvent}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {EMAIL_STATUS_HINT[d.emailStatus]}
                {d.statusCheckedAt ? ` · נבדק לאחרונה ${formatDateTimeHe(d.statusCheckedAt)}` : ""}
              </p>
              {d.emailError ? (
                <p className="text-xs text-red-800 dark:text-red-300">{d.emailError}</p>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={busy !== null}
                  onClick={() => void refreshStatus()}
                >
                  <RefreshCw
                    className={cn("size-4", busy === "status" && "animate-spin")}
                    aria-hidden
                  />{" "}
                  רענון סטטוס
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={busy !== null}
                  onClick={() => setConfirm({ kind: "resend" })}
                >
                  {busy === "resend" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Mail className="size-4" aria-hidden />
                  )}
                  שליחה חוזרת של המייל
                </Button>
              </div>
            </section>

            <section className="space-y-3 rounded-xl border border-border p-3">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <Link2 className="size-4" aria-hidden /> קישורי הורדה
              </h3>
              {d.links.length === 0 ? (
                <p className="text-sm text-muted-foreground">לא נוצר קישור הורדה לשליחה הזו.</p>
              ) : (
                <ul className="space-y-2">
                  {d.links.map((l) => (
                    <li
                      key={l.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <LinkStateBadge state={l.state} />
                          <span className="tabular-nums">
                            הורדות: {l.downloads} / {l.maxDownloads}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          נוצר {formatDateTimeHe(l.createdAt)} ·{" "}
                          {l.state === "expired" ? "פג" : "בתוקף עד"}{" "}
                          {formatDateTimeHe(l.expiresAt)}
                          {l.lastDownloadAt
                            ? ` · הורדה אחרונה ${formatDateTimeHe(l.lastDownloadAt)}`
                            : ""}
                          {l.state === "revoked" && l.revokedReason === "replaced"
                            ? " · הוחלף בקישור חדש"
                            : ""}
                        </p>
                      </div>
                      {l.state === "active" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={busy !== null}
                          onClick={() => setConfirm({ kind: "revoke", linkId: l.id })}
                        >
                          ביטול הקישור
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {newLink ? (
                <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50/70 p-3 dark:border-sky-900 dark:bg-sky-950/30">
                  <p className="text-sm font-semibold">הקישור החדש (מוצג פעם אחת בלבד)</p>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      dir="ltr"
                      className="font-mono text-xs"
                      value={newLink.url}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 gap-1.5"
                      onClick={async () => {
                        if (await copyText(newLink.url)) toast.success("הקישור הועתק");
                        else toast.error("ההעתקה נכשלה — אפשר לסמן ולהעתיק ידנית");
                      }}
                    >
                      <Copy className="size-4" aria-hidden /> העתקה
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    בתוקף עד {formatDateTimeHe(newLink.expiresAt)}. במסד נשמר רק טביעה של הקישור —
                    אחרי סגירת החלון לא ניתן להציג אותו שוב (אפשר ליצור קישור חדש).
                  </p>
                </div>
              ) : null}

              <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={busy !== null}
                  onClick={() => setConfirm({ kind: "regenerate", email: emailNewLink })}
                >
                  {busy === "regenerate" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Link2 className="size-4" aria-hidden />
                  )}
                  יצירת קישור הורדה חדש
                </Button>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={emailNewLink}
                    onCheckedChange={(v) => setEmailNewLink(v === true)}
                  />
                  לשלוח ללקוח מייל עם הקישור החדש
                </label>
              </div>
              {activeLinks.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  קישור חדש מבטל את הקישור הפעיל הנוכחי.
                </p>
              ) : null}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">יומן פעולות</h3>
              {d.audit.length === 0 ? (
                <p className="text-sm text-muted-foreground">אין פעולות.</p>
              ) : (
                <ol className="space-y-1.5 text-sm">
                  {d.audit.map((a, i) => {
                    const detail = auditDetail(a);
                    return (
                      <li
                        key={`${a.at}-${i}`}
                        className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-border/60 pb-1.5 last:border-0"
                      >
                        <span
                          className={cn(
                            "font-medium",
                            a.action === "reveal_key" && "text-amber-800 dark:text-amber-300",
                          )}
                        >
                          {AUDIT_LABEL[a.action] ?? a.action}
                        </span>
                        {detail ? (
                          <span className="text-xs text-muted-foreground">({detail})</span>
                        ) : null}
                        <span className="text-xs text-muted-foreground">
                          {formatDateTimeHe(a.at)} ·{" "}
                          {a.actorName ??
                            (a.action.startsWith("download") ? "הלקוח (קישור)" : "מערכת")}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>
        )}

        <AlertDialog
          open={confirm !== null}
          onOpenChange={(open) => (open ? undefined : setConfirm(null))}
        >
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader className="text-right sm:text-right">
              <AlertDialogTitle>
                {confirm?.kind === "revoke"
                  ? "לבטל את קישור ההורדה?"
                  : confirm?.kind === "regenerate"
                    ? "ליצור קישור הורדה חדש?"
                    : "לשלוח שוב את מייל הרישיון?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirm?.kind === "revoke"
                  ? "הלקוח לא יוכל להוריד יותר מהקישור הזה. אפשר ליצור קישור חדש בכל עת."
                  : confirm?.kind === "regenerate"
                    ? `הקישור הפעיל (אם יש) יבוטל. הקישור החדש תקף ${LINK_VALID_DAYS} ימים ועד ${LINK_MAX_DOWNLOADS} הורדות${confirm.email ? ", וישלח ללקוח במייל חדש עם המפתח והמדריך." : "."}`
                    : "יישלח מייל חדש ללקוח עם המפתח, המדריך וקישור הורדה חדש (הקישור הקודם יבוטל)."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 sm:justify-start sm:gap-2">
              <AlertDialogAction
                onClick={() => {
                  const c = confirm;
                  setConfirm(null);
                  if (c) void doConfirmed(c);
                }}
              >
                {confirm?.kind === "revoke"
                  ? "ביטול הקישור"
                  : confirm?.kind === "regenerate"
                    ? "יצירת קישור"
                    : "שליחה"}
              </AlertDialogAction>
              <AlertDialogCancel>חזרה</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function Info({
  label,
  children,
  ltr = false,
}: {
  label: string;
  children: React.ReactNode;
  ltr?: boolean;
}) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-foreground" dir={ltr ? "ltr" : undefined}>
        {ltr ? <span className="block text-right">{children}</span> : children}
      </dd>
    </div>
  );
}
