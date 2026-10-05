import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, History, Loader2, MinusCircle, RefreshCw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listNotificationLogs, type NotificationLogEntry } from "@/lib/notifications.functions";
import { cn } from "@/lib/utils";

type Filter = "all" | NotificationLogEntry["status"];

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "הכול" },
  { value: "sent", label: "נשלחו" },
  { value: "failed", label: "נכשלו" },
  { value: "skipped", label: "לא נשלחו" },
];

const TEMPLATE_LABEL: Record<NotificationLogEntry["template"], string> = {
  order_confirmation: "אישור הזמנה ללקוח",
  order_staff: "התראה לצוות על הזמנה",
  order_shipped: "ההזמנה יצאה למשלוח",
  test: "מייל בדיקה",
};

const STATUS_STYLE: Record<
  NotificationLogEntry["status"],
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  sent: {
    label: "נשלח",
    className:
      "border-green-500 bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-200",
    icon: CheckCircle2,
  },
  failed: {
    label: "נכשל",
    className: "border-destructive/50 bg-destructive/10 text-destructive",
    icon: XCircle,
  },
  skipped: {
    label: "לא נשלח",
    className: "border-border bg-muted text-muted-foreground",
    icon: MinusCircle,
  },
};

const PROVIDER_LABEL: Record<NonNullable<NotificationLogEntry["provider"]>, string> = {
  tenant: "דרך החשבון שלכם",
  platform: "דרך הפלטפורמה",
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });

/**
 * יומן ההתראות (חלק 17): כל ניסיון שליחה — אישור הזמנה, התראה לצוות, "יצאה
 * למשלוח" ומייל בדיקה — עם הסטטוס, דרך איזה מפתח, והשגיאה אם נכשל.
 * refreshKey — רענון מבחוץ (למשל אחרי מייל בדיקה).
 */
export function NotificationLogCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const load = useServerFn(listNotificationLogs);
  const [filter, setFilter] = useState<Filter>("all");
  const [entries, setEntries] = useState<NotificationLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setEntries(
        await load({ data: { limit: 50, ...(filter === "all" ? {} : { status: filter }) } }),
      );
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "טעינת היומן נכשלה");
    } finally {
      setBusy(false);
    }
  }, [load, filter]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  return (
    <Card id="notification-log" className="shadow-card">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4" aria-hidden="true" />
          יומן התראות
        </CardTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={filter === option.value ? "default" : "outline"}
              className="h-8"
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </Button>
          ))}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="רענון היומן"
            disabled={busy}
            onClick={() => void refresh()}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-xs text-muted-foreground">
          50 ההתראות האחרונות. כל ניסיון נרשם — גם כשהשליחה דרך החשבון שלכם נכשלה והמייל יצא בגיבוי
          דרך הפלטפורמה.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {entries === null && !error ? (
          <p className="text-muted-foreground">טוען...</p>
        ) : entries && entries.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-muted-foreground">
            {filter === "all"
              ? "עדיין אין התראות. אישורי ההזמנה יופיעו כאן אחרי ההזמנה הבאה."
              : "אין התראות בסינון הזה."}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {(entries ?? []).map((entry) => {
              const status = STATUS_STYLE[entry.status];
              const StatusIcon = status.icon;
              return (
                <li
                  key={entry.id}
                  data-status={entry.status}
                  className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3"
                >
                  <Badge variant="outline" className={cn("w-fit shrink-0 gap-1", status.className)}>
                    <StatusIcon className="size-3.5" aria-hidden="true" />
                    {status.label}
                  </Badge>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-medium text-foreground">
                        {TEMPLATE_LABEL[entry.template]}
                      </span>
                      {entry.orderNumber && entry.orderId && (
                        <Link
                          to="/admin"
                          search={{ tab: "orders", order: entry.orderId }}
                          dir="ltr"
                          className="text-xs font-semibold text-primary hover:underline"
                        >
                          {entry.orderNumber}
                        </Link>
                      )}
                      {entry.provider && (
                        <span className="text-xs text-muted-foreground">
                          · {PROVIDER_LABEL[entry.provider]}
                        </span>
                      )}
                    </p>
                    {entry.recipient && (
                      <p dir="ltr" className="truncate text-left text-xs text-muted-foreground">
                        {entry.recipient}
                      </p>
                    )}
                    {entry.error && (
                      <p
                        dir="auto"
                        className={cn(
                          "break-words text-xs",
                          entry.status === "failed" ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {entry.error}
                      </p>
                    )}
                  </div>
                  <time
                    dateTime={entry.sentAt}
                    className="shrink-0 text-xs text-muted-foreground sm:text-left"
                  >
                    {formatDate(entry.sentAt)}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
