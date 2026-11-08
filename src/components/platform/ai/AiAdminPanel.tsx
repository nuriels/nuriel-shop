/**
 * "ניהול תוסף AI" — מסך מנהל העל: החבילות של העסקים (הפעלה, חידוש, השבתה, היסטוריה), ההגדרות (מצב, דגם,
 * מפתח API מוצפן, מגבלות), בדיקת חיבור, צריכה ועלויות, חריגות, והתראות החידוש.
 * ההרשאה נבדקת בשרת בכל פעולה (ושוב במסד) — המסך הזה רק מציג. המפתח עצמו לא מגיע לכאן אף פעם.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  BellRing,
  BookOpenCheck,
  History,
  KeyRound,
  Loader2,
  Pause,
  Play,
  PlugZap,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  aiAdminActivate,
  aiAdminBusinesses,
  aiAdminHistory,
  aiAdminOverview,
  aiAdminRenew,
  aiAdminRunRenewals,
  aiAdminSaveSettings,
  aiAdminSetSuspended,
  aiAdminTestConnection,
} from "@/lib/ai-admin.functions";
import {
  formatIsraeliDate,
  formatShekels,
  israelTodayForDisplay,
  periodEndPreview,
  STATUS_LABELS,
  type AiMode,
} from "@/platform/ai/logic";
import type { AdminBusiness, AiAdminOverview, Json, JsonObject } from "@/platform/ai/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Product = "ecommerce" | "hospitality";
const PRODUCT_NAME: Record<Product, string> = {
  ecommerce: "NURIEL AI – Ecommerce",
  hospitality: "NURIEL AI – Hospitality",
};
const SITE_TYPE_LABEL: Record<Product, string> = {
  ecommerce: "חנות אונליין",
  hospitality: "מתחם אירוח",
};

const str = (value: Json | undefined): string | null => (typeof value === "string" ? value : null);
const num = (value: Json | undefined): number | null =>
  typeof value === "number"
    ? value
    : value != null && !Number.isNaN(Number(value))
      ? Number(value)
      : null;
const errorText = (error: unknown) =>
  error instanceof Error && error.message ? error.message : "הפעולה לא הושלמה";

function StatusBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-900",
    ending_soon: "bg-amber-100 text-amber-900",
    expired: "bg-red-100 text-red-900",
    suspended: "bg-slate-200 text-slate-900",
    scheduled: "bg-sky-100 text-sky-900",
    none: "bg-muted text-muted-foreground",
    mismatch: "bg-red-100 text-red-900",
  };
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        tone[status] ?? tone["none"],
      )}
      data-status={status}
    >
      {STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status}
    </span>
  );
}

function Section({
  icon,
  title,
  description,
  children,
  actions,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            {icon}
            {title}
          </CardTitle>
          {description && <CardDescription className="mt-1">{description}</CardDescription>}
        </div>
        {actions}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ דיאלוגים

type Action =
  | { kind: "activate"; business: AdminBusiness }
  | { kind: "renew"; business: AdminBusiness }
  | { kind: "suspend"; business: AdminBusiness; suspended: boolean }
  | { kind: "history"; business: AdminBusiness };

function ActionDialog({
  action,
  onClose,
  onDone,
}: {
  action: Action;
  onClose: () => void;
  onDone: () => void;
}) {
  const activate = useServerFn(aiAdminActivate);
  const renew = useServerFn(aiAdminRenew);
  const setSuspended = useServerFn(aiAdminSetSuspended);
  const loadHistory = useServerFn(aiAdminHistory);
  const business = action.business;
  const [startsOn, setStartsOn] = useState(israelTodayForDisplay());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<JsonObject | null>(null);
  const state = business.state;
  const status = str(state["status"]) ?? "none";

  useEffect(() => {
    if (action.kind !== "history") return;
    loadHistory({ data: { tenantId: business.tenantId } })
      .then(setHistory)
      .catch((error) => toast.error(errorText(error)));
  }, [action.kind, business.tenantId, loadHistory]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (action.kind === "activate") {
        await activate({
          data: { tenantId: business.tenantId, product: business.siteType, startsOn, note },
        });
        toast.success("החבילה הופעלה");
      } else if (action.kind === "renew") {
        await renew({ data: { tenantId: business.tenantId, note } });
        toast.success("החבילה חודשה לשנה נוספת");
      } else if (action.kind === "suspend") {
        await setSuspended({
          data: { tenantId: business.tenantId, suspended: action.suspended, reason: note },
        });
        toast.success(action.suspended ? "החבילה הושבתה" : "החבילה חזרה לפעילות");
      }
      onDone();
      onClose();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const currentEnd = str(state["ends_on"]);
  const renewStart = (() => {
    const today = israelTodayForDisplay();
    if (!currentEnd || currentEnd < today) return today;
    const next = new Date(`${currentEnd}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString().slice(0, 10);
  })();
  const price = num(state["price_agorot"]) ?? 15000;

  const title =
    action.kind === "activate"
      ? "הפעלת NURIEL AI"
      : action.kind === "renew"
        ? "חידוש לשנה נוספת"
        : action.kind === "suspend"
          ? action.suspended
            ? "השבתת החבילה"
            : "החזרת החבילה לפעילות"
          : "היסטוריית הפעלות";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn("max-h-[90dvh] overflow-y-auto", action.kind === "history" && "sm:max-w-3xl")}
        dir="rtl"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {business.name} · {SITE_TYPE_LABEL[business.siteType]} ·{" "}
            <span dir="ltr">{business.slug}</span>
          </DialogDescription>
        </DialogHeader>
        {action.kind === "history" ? (
          <HistoryView history={history} />
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {action.kind === "activate" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="ai-product">סוג העוזר</Label>
                  <select
                    id="ai-product"
                    value={business.siteType}
                    disabled
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    {(["ecommerce", "hospitality"] as const).map((p) => (
                      <option key={p} value={p} disabled={p !== business.siteType}>
                        {PRODUCT_NAME[p]}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    נקבע לפי סוג העסק ({SITE_TYPE_LABEL[business.siteType]}) — השרת לא מאפשר סוג
                    אחר.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ai-start">תאריך התחלה</Label>
                  <Input
                    id="ai-start"
                    type="date"
                    value={startsOn}
                    onChange={(e) => setStartsOn(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground" data-testid="ai-end-preview">
                    תאריך הסיום (אוטומטי, 12 חודשים):{" "}
                    {formatIsraeliDate(periodEndPreview(startsOn))} · לפי שעון ישראל
                  </p>
                </div>
              </>
            )}
            {action.kind === "renew" && (
              <p className="rounded-lg bg-secondary px-3 py-2 text-sm">
                תקופה חדשה: {formatIsraeliDate(renewStart)} –{" "}
                {formatIsraeliDate(periodEndPreview(renewStart))}
                {currentEnd && renewStart !== israelTodayForDisplay()
                  ? " (מיד אחרי הסיום הנוכחי — בלי ימים אבודים)"
                  : ""}
              </p>
            )}
            {action.kind !== "suspend" && (
              <p className="text-sm font-semibold">
                מחיר: {formatShekels(price)} לשנה · ללא חיוב אוטומטי
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="ai-note">
                {action.kind === "suspend"
                  ? "סיבה (לא חובה)"
                  : "הערה — למשל אסמכתת תשלום (לא חובה)"}
              </Label>
              <Input
                id="ai-note"
                value={note}
                maxLength={300}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            {action.kind === "suspend" && action.suspended && (
              <p className="text-sm text-muted-foreground">
                העוזר נעצר מיד אצל העסק. התקופה ממשיכה לרוץ, וההגדרות וההיסטוריה נשמרות.
              </p>
            )}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                ביטול
              </Button>
              <Button type="submit" disabled={busy} data-testid="ai-confirm">
                {busy && <Loader2 className="size-4 animate-spin" />}
                {action.kind === "activate"
                  ? "הפעלה"
                  : action.kind === "renew"
                    ? "חידוש"
                    : action.suspended
                      ? "השבתה"
                      : "החזרה לפעילות"}
              </Button>
            </DialogFooter>
          </form>
        )}
        {status === "none" && action.kind === "history" && (
          <p className="text-sm text-muted-foreground">לעסק עדיין אין חבילה.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

const EVENT_LABEL: Record<string, string> = {
  activated: "הפעלה",
  renewed: "חידוש",
  suspended: "השבתה",
  resumed: "החזרה לפעילות",
};
const NOTICE_LABEL: Record<string, string> = {
  d30: "30 יום לפני",
  d14: "14 יום לפני",
  d7: "7 ימים לפני",
  d1: "יום לפני",
  d0: "ביום הסיום",
};
const NOTICE_STATUS: Record<string, string> = {
  sent: "נשלחה",
  failed: "נכשלה",
  skipped: "דולגה",
  pending: "בתהליך",
};
const dateTime = (value: Json | undefined) =>
  typeof value === "string"
    ? new Date(value).toLocaleString("he-IL", {
        timeZone: "Asia/Jerusalem",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "";

function HistoryView({ history }: { history: JsonObject | null }) {
  if (!history) return <Loader2 className="mx-auto size-5 animate-spin" />;
  const list = (key: string) => (Array.isArray(history[key]) ? (history[key] as JsonObject[]) : []);
  return (
    <div className="space-y-5 text-sm" data-testid="ai-history">
      <div>
        <h3 className="mb-2 font-semibold">פעולות</h3>
        <ul className="space-y-1.5">
          {list("events").map((e, i) => (
            <li key={i} className="rounded-md border px-3 py-2">
              <span className="font-semibold">
                {EVENT_LABEL[str(e["kind"]) ?? ""] ?? str(e["kind"])}
              </span>{" "}
              · {dateTime(e["created_at"])} · <span dir="ltr">{str(e["actor_email"]) ?? ""}</span>
              {str(e["starts_on"]) && (
                <>
                  {" "}
                  · {formatIsraeliDate(str(e["starts_on"]))} –{" "}
                  {formatIsraeliDate(str(e["ends_on"]))}
                </>
              )}
              {num(e["price_agorot"]) !== null && <> · {formatShekels(num(e["price_agorot"]))}</>}
              {str(e["note"]) && <div className="text-muted-foreground">{str(e["note"])}</div>}
            </li>
          ))}
          {list("events").length === 0 && <li className="text-muted-foreground">אין פעולות</li>}
        </ul>
      </div>
      <div>
        <h3 className="mb-2 font-semibold">תקופות</h3>
        <ul className="space-y-1">
          {list("periods").map((p, i) => (
            <li key={i}>
              {str(p["kind"]) === "activation" ? "הפעלה" : "חידוש"}:{" "}
              {formatIsraeliDate(str(p["starts_on"]))} – {formatIsraeliDate(str(p["ends_on"]))} ·{" "}
              {formatShekels(num(p["price_agorot"]))}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-2 font-semibold">התראות חידוש</h3>
        <ul className="space-y-1">
          {list("notifications").map((n, i) => (
            <li key={i}>
              {NOTICE_LABEL[str(n["kind"]) ?? ""] ?? str(n["kind"])} (סיום{" "}
              {formatIsraeliDate(str(n["period_ends_on"]))}) ·{" "}
              {NOTICE_STATUS[str(n["status"]) ?? ""] ?? str(n["status"])} ·{" "}
              <span dir="ltr">{str(n["recipient_masked"]) ?? "—"}</span> ·{" "}
              {dateTime(n["created_at"])}
              {str(n["error"]) && <span className="text-destructive"> · {str(n["error"])}</span>}
            </li>
          ))}
          {list("notifications").length === 0 && (
            <li className="text-muted-foreground">עוד לא נשלחו התראות</li>
          )}
        </ul>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ רשימת העסקים

function Businesses() {
  const list = useServerFn(aiAdminBusinesses);
  const [product, setProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<AdminBusiness[] | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const load = useCallback(() => {
    list({ data: { product, search } })
      .then(setRows)
      .catch((error) => {
        toast.error(errorText(error));
        setRows([]);
      });
  }, [list, product, search]);
  useEffect(() => {
    const timer = window.setTimeout(load, 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <Section
      icon={<Sparkles className="size-5 text-primary" />}
      title="חבילות NURIEL AI לעסקים"
      description="150 ₪ לשנה לכל חנות או מתחם · לא כלול בחבילות הבסיס · החידוש רק אחרי אישור ותשלום (בלי חיוב אוטומטי)"
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-secondary p-1" role="group" aria-label="סינון לפי סוג">
          {(
            [
              [null, "הכל"],
              ["ecommerce", "Ecommerce"],
              ["hospitality", "Hospitality"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={product === value}
              onClick={() => setProduct(value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm",
                product === value ? "bg-card font-semibold shadow-sm" : "text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם העסק"
            aria-label="חיפוש לפי שם העסק"
            className="pe-3 ps-9"
          />
        </div>
      </div>
      {rows === null ? (
        <Loader2 className="mx-auto size-5 animate-spin" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">לא נמצאו עסקים.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="ai-businesses">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b text-start">
                <th className="py-2 text-start font-medium">עסק</th>
                <th className="py-2 text-start font-medium">סוג</th>
                <th className="py-2 text-start font-medium">סטטוס</th>
                <th className="py-2 text-start font-medium">תוקף</th>
                <th className="py-2 text-start font-medium">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const status = str(row.state["status"]) ?? "none";
                const days = num(row.state["days_left"]);
                return (
                  <tr
                    key={row.tenantId}
                    className="border-b align-top last:border-0"
                    data-tenant={row.slug}
                  >
                    <td className="py-2.5">
                      <div className="font-semibold">{row.name}</div>
                      <div className="text-xs text-muted-foreground" dir="ltr">
                        {row.slug}
                      </div>
                    </td>
                    <td className="py-2.5">{SITE_TYPE_LABEL[row.siteType]}</td>
                    <td className="py-2.5">
                      <StatusBadge status={status} />
                    </td>
                    <td className="py-2.5 text-xs">
                      {str(row.state["starts_on"]) ? (
                        <>
                          {formatIsraeliDate(str(row.state["starts_on"]))} –{" "}
                          {formatIsraeliDate(str(row.state["ends_on"]))}
                          {days !== null && days >= 0 && (
                            <div className="text-muted-foreground">
                              {days === 0 ? "מסתיים היום" : `${days} ימים`}
                            </div>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        {(status === "none" || status === "expired") && (
                          <Button
                            size="sm"
                            onClick={() => setAction({ kind: "activate", business: row })}
                            data-testid="ai-activate"
                          >
                            הפעלה
                          </Button>
                        )}
                        {status !== "none" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setAction({ kind: "renew", business: row })}
                            data-testid="ai-renew"
                          >
                            <RefreshCw className="size-3.5" />
                            חידוש לשנה
                          </Button>
                        )}
                        {status !== "none" && status !== "suspended" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setAction({ kind: "suspend", business: row, suspended: true })
                            }
                            data-testid="ai-suspend"
                          >
                            <Pause className="size-3.5" />
                            השבתה
                          </Button>
                        )}
                        {status === "suspended" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setAction({ kind: "suspend", business: row, suspended: false })
                            }
                            data-testid="ai-resume"
                          >
                            <Play className="size-3.5" />
                            החזרה
                          </Button>
                        )}
                        {status !== "none" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setAction({ kind: "history", business: row })}
                            data-testid="ai-history-open"
                          >
                            <History className="size-3.5" />
                            היסטוריה
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {action && <ActionDialog action={action} onClose={() => setAction(null)} onDone={load} />}
    </Section>
  );
}

// ------------------------------------------------------------------ הגדרות, מפתח, חיבור

function SettingsCard({ overview, reload }: { overview: AiAdminOverview; reload: () => void }) {
  const save = useServerFn(aiAdminSaveSettings);
  const testConnection = useServerFn(aiAdminTestConnection);
  const settings = overview.settings;
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [limits, setLimits] = useState(() => ({
    maxQuestionChars: settings?.maxQuestionChars ?? 400,
    tenantHourlyLimit: settings?.tenantHourlyLimit ?? 60,
    userMinuteLimit: settings?.userMinuteLimit ?? 6,
    monthlyBudgetUsd: settings?.monthlyBudgetUsd ?? 25,
  }));
  if (!settings)
    return (
      <p className="text-sm text-destructive">
        הגדרות העוזר לא נטענו — ייתכן שהמיגרציה עוד לא הופעלה.
      </p>
    );

  const run = async (label: string, data: Parameters<typeof save>[0]["data"], success: string) => {
    setBusy(label);
    try {
      await save({ data });
      toast.success(success);
      reload();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const modes: [AiMode, string, string][] = [
    ["off", "כבוי", "אף עסק לא משתמש בעוזר"],
    ["test", "מצב בדיקה", "רק מנהל העל, גם בעסק בלי חבילה"],
    ["on", "פעיל", "כל עסק עם חבילה בתוקף"],
  ];

  return (
    <Section
      icon={<KeyRound className="size-5 text-primary" />}
      title="הגדרות, מפתח ודגם"
      description="המפתח נשמר מוצפן (AES-256-GCM) ולא מוצג לאיש — רק 4 התווים האחרונים"
    >
      <div className="space-y-6">
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">מצב העוזר</legend>
          <div className="flex flex-wrap gap-2">
            {modes.map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                aria-pressed={settings.mode === value}
                disabled={busy !== null}
                onClick={() => void run("mode", { mode: value }, "המצב עודכן")}
                className={cn(
                  "rounded-lg border px-3 py-2 text-start text-sm",
                  settings.mode === value
                    ? "border-primary bg-primary/10 font-semibold"
                    : "hover:bg-secondary",
                )}
                data-testid={`ai-mode-${value}`}
              >
                {label}
                <span className="block text-xs font-normal text-muted-foreground">{hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor="ai-model">דגם</Label>
          <select
            id="ai-model"
            value={settings.model}
            disabled={busy !== null}
            onChange={(e) => void run("model", { model: e.target.value }, "הדגם עודכן")}
            className="h-10 w-full max-w-md rounded-md border bg-background px-3 text-sm"
          >
            {overview.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label} — {model.hint} · קלט ${model.prices.input} / פלט $
                {model.prices.output} למיליון טוקנים
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            המחירון מוגדר במקום אחד בקוד (נבדק {formatIsraeliDate(overview.pricesCheckedOn)}).
          </p>
        </div>

        <form
          className="space-y-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const key = apiKey;
            setApiKey("");
            void run("key", { apiKey: key }, "המפתח נשמר מוצפן");
          }}
        >
          <Label htmlFor="ai-key">מפתח API של Anthropic</Label>
          <p className="text-sm" data-testid="ai-key-status">
            {settings.hasKey ? (
              settings.keyReadable ? (
                <>
                  מפתח שמור: <span dir="ltr">sk-ant-…{settings.keyLast4}</span>
                  {settings.keyUpdatedAt && <> · עודכן {dateTime(settings.keyUpdatedAt)}</>}
                </>
              ) : (
                <span className="text-destructive">
                  יש מפתח שמור, אבל אי אפשר לפענח אותו (סוד השרת הוחלף) — הדביקו אותו מחדש
                </span>
              )
            ) : (
              <span className="text-muted-foreground">אין מפתח שמור</span>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-…"
              dir="ltr"
              className="max-w-md"
            />
            <Button type="submit" disabled={busy !== null || apiKey.trim() === ""}>
              שמירת מפתח
            </Button>
            {settings.hasKey && (
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void run("remove", { removeKey: true }, "המפתח נמחק")}
              >
                מחיקת המפתח
              </Button>
            )}
          </div>
        </form>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={busy !== null || !settings.hasKey}
            onClick={async () => {
              setBusy("test");
              setTestResult(null);
              try {
                const result = await testConnection();
                setTestResult(
                  result.ok
                    ? `החיבור תקין (${result.model}). ${result.routedCorrectly ? "הסיווג נכון." : "הסיווג לא בחר את המדריך הצפוי."} עלות משוערת: $${result.costUsd.toFixed(5)}`
                    : result.message,
                );
                reload();
              } catch (error) {
                setTestResult(errorText(error));
              } finally {
                setBusy(null);
              }
            }}
            data-testid="ai-test-connection"
          >
            {busy === "test" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PlugZap className="size-4" />
            )}
            בדיקת חיבור
          </Button>
          {testResult && (
            <span className="text-sm" data-testid="ai-test-result">
              {testResult}
            </span>
          )}
        </div>
        {settings.lastError && (
          <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            השגיאה האחרונה מול Anthropic ({dateTime(settings.lastErrorAt)}): {settings.lastError}
          </p>
        )}

        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run("limits", limits, "המגבלות נשמרו");
          }}
        >
          {(
            [
              ["maxQuestionChars", "אורך שאלה מרבי (תווים)"],
              ["tenantHourlyLimit", "שאלות לעסק בשעה"],
              ["userMinuteLimit", "שאלות למשתמש בדקה"],
              ["monthlyBudgetUsd", "תקציב חודשי ($) — להתראה"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`ai-${key}`}>{label}</Label>
              <Input
                id={`ai-${key}`}
                type="number"
                inputMode="numeric"
                value={limits[key]}
                onChange={(e) =>
                  setLimits((current) => ({ ...current, [key]: Number(e.target.value) }))
                }
              />
            </div>
          ))}
          <div className="sm:col-span-2 lg:col-span-4">
            <Button type="submit" variant="outline" disabled={busy !== null}>
              שמירת המגבלות
            </Button>
          </div>
        </form>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ צריכה ועלויות

function UsageCard({ overview }: { overview: AiAdminOverview }) {
  const usage = overview.usage;
  const totals = (usage?.["totals"] ?? {}) as JsonObject;
  const tenants = Array.isArray(usage?.["tenants"]) ? (usage?.["tenants"] as JsonObject[]) : [];
  const recent = Array.isArray(usage?.["recent_questions"])
    ? (usage?.["recent_questions"] as JsonObject[])
    : [];
  const stat = (label: string, value: ReactNode) => (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold" dir="ltr">
        {value}
      </div>
    </div>
  );
  const n = (key: string) => num(totals[key]) ?? 0;
  return (
    <Section
      icon={<BookOpenCheck className="size-5 text-primary" />}
      title="צריכה, עלויות וחריגות"
      description="למנהל העל בלבד · החודש לפי חודש החיוב של Anthropic (UTC) · העלות משוערת לפי המחירון"
    >
      {overview.anomalies.length > 0 && (
        <ul className="mb-4 space-y-1.5" data-testid="ai-anomalies">
          {overview.anomalies.map((a, i) => (
            <li
              key={i}
              className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {a.message}
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="ai-usage">
        {stat("שאלות החודש", n("questions"))}
        {stat("נשלחו לדגם", n("ai"))}
        {stat("נחסמו לפני הדגם", n("blocked"))}
        {stat("תקלות", n("failed"))}
        {stat("טוקני קלט", n("input_tokens").toLocaleString("en-US"))}
        {stat("טוקני פלט", n("output_tokens").toLocaleString("en-US"))}
        {stat("עלות משוערת", `$${n("cost_usd").toFixed(4)}`)}
        {stat("מתוכה בדיקות", `$${n("test_cost_usd").toFixed(4)}`)}
      </div>
      {tenants.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <h3 className="mb-2 text-sm font-semibold">לפי עסק</h3>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 text-start font-medium">עסק</th>
                <th className="py-1.5 text-start font-medium">שאלות החודש</th>
                <th className="py-1.5 text-start font-medium">24 שעות</th>
                <th className="py-1.5 text-start font-medium">עלות</th>
              </tr>
            </thead>
            <tbody>
              {tenants.slice(0, 20).map((t, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1.5">{str(t["name"]) ?? str(t["slug"])}</td>
                  <td className="py-1.5">{num(t["questions_month"])}</td>
                  <td className="py-1.5">{num(t["calls_24h"])}</td>
                  <td className="py-1.5" dir="ltr">
                    ${(num(t["cost_usd_month"]) ?? 0).toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {recent.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold">
            שאלות אחרונות בלי מדריך / שנחסמו (אחרי סינון מידע רגיש, בלי זהות)
          </h3>
          <ul className="space-y-1 text-sm">
            {recent.slice(0, 15).map((q, i) => (
              <li key={i} className="rounded-md bg-secondary px-3 py-1.5">
                <span className="text-xs text-muted-foreground">
                  {str(q["product"]) === "hospitality" ? "Hospitality" : "Ecommerce"} ·{" "}
                  {str(q["mode"]) === "blocked" ? "נחסמה" : "בלי מדריך"} ·{" "}
                </span>
                {str(q["question"])}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function RenewalsCard() {
  const runRenewals = useServerFn(aiAdminRunRenewals);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  return (
    <Section
      icon={<BellRing className="size-5 text-primary" />}
      title="התראות חידוש"
      description="30 / 14 / 7 / 1 ימים לפני הסיום וביום הסיום · נבדק אוטומטית כל שעה · כל התראה נשלחת פעם אחת, ולא אחרי חידוש"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await runRenewals();
              setResult(
                `נבדקו ${r.due} · נשלחו ${r.sent} · נכשלו ${r.failed} · דולגו ${r.skipped}`,
              );
            } catch (error) {
              setResult(errorText(error));
            } finally {
              setBusy(false);
            }
          }}
          data-testid="ai-run-renewals"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <BellRing className="size-4" />}
          בדיקת התראות עכשיו
        </Button>
        {result && (
          <span className="text-sm" data-testid="ai-renewals-result">
            {result}
          </span>
        )}
      </div>
    </Section>
  );
}

export function AiAdminPanel() {
  const loadOverview = useServerFn(aiAdminOverview);
  const [overview, setOverview] = useState<AiAdminOverview | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const reload = useCallback(() => {
    loadOverview()
      .then((next) => {
        setOverview(next);
        setFailed(null);
      })
      .catch((error) => setFailed(errorText(error)));
  }, [loadOverview]);
  useEffect(reload, [reload]);
  const packages = useMemo(() => overview?.packages ?? [], [overview]);

  return (
    <div className="space-y-6" data-testid="ai-admin">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold">
          <Sparkles className="size-6 text-primary" />
          ניהול תוסף AI
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          NURIEL AI ASSISTANT — עוזר עזרה בתשלום שנתי, נפרד לחנויות (Ecommerce) ולמתחמים
          (Hospitality).
          {packages.length > 0 && (
            <>
              {" "}
              {packages.map((p) => `${p.name}: ${formatShekels(p.priceAgorot)} לשנה`).join(" · ")}
            </>
          )}
        </p>
      </div>
      {failed && <p className="text-sm text-destructive">{failed}</p>}
      <Businesses />
      {overview && (
        <>
          <SettingsCard key={overview.settings?.mode ?? "x"} overview={overview} reload={reload} />
          <UsageCard overview={overview} />
          <RenewalsCard />
        </>
      )}
    </div>
  );
}
