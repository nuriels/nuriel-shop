// מסך "מיילים" (/manage/emails) — Stage 2k: כל המיילים שהמערכת שלחה בשם העסק (לאורחים
// ולעסק): נכשלו · טופלו · ממתינים · נשלחו, נמען ממוסך, קישור להזמנה; "לשלוח שוב" למייל שנכשל.
// השליחה עצמה — תהליך הרקע בשרת (כל 30 שניות ומיד אחרי כל פעולה).
// מיגרציה 206: ההתראה על מייל שנכשל — "סימון כנקרא" (המספר בפעמון ובתפריט יורד), "סימון כטופל"
// (ההתראה יוצאת מ"נכשלו" ומ"דורש טיפול" ועוברת ל"טופלו"), "החזרה להתראות". המייל עצמו נשמר כמו שהוא.
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { Check, CheckCheck, Eye, RotateCcw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, CardContent, cn } from "@/platform/ui";
import {
  hospitalityEmailAlertsMark,
  hospitalityEmailAlertsMarkAll,
  hospitalityEmails,
  hospitalityRequeueEmail,
} from "../../api/emails.functions";
import type { EmailAlertAction, EmailFilter, EmailRow } from "../../types/emails";
import { EMAIL_EVENT, EMAIL_STATUS, dateTimeText } from "../bookings/model";
import { ConfirmButton, LoadError, PageSkeleton } from "../catalog/parts";
import { errorText } from "../catalog/refresh";
import { dashboardKeys } from "../dashboard/model";
import { manageKeys } from "../lib/query-keys";
import { useManagement } from "../shell/management-context";
import {
  ALERT_ACTION_DONE,
  ALERT_ACTION_LABEL,
  ALERT_STATE_LABEL,
  EMAIL_FILTERS,
  alertActions,
  alertState,
  parseEmailsSearch,
  type AlertState,
} from "./model";

const FILTERS = EMAIL_FILTERS;

const STATE_TONE: Record<AlertState, string> = {
  new: "bg-rose-100 text-rose-900",
  seen: "bg-amber-100 text-amber-950",
  handled: "bg-emerald-100 text-emerald-900",
  cancelled: "bg-slate-100 text-slate-800",
};

const ACTION_ICON = { seen: Eye, handled: Check, reopen: Undo2 } as const;

const EMPTY_TEXT: Partial<Record<EmailFilter, string>> = {
  failed: "אין התראות על מיילים שנכשלו — הכול טופל.",
  handled: "עוד אין מיילים שסומנו כטופלו.",
};

export function EmailsPage() {
  const ctx = useManagement();
  const qc = useQueryClient();
  // ?filter=failed — מלוח הבקרה ("מיילים שלא נשלחו")
  const linked = parseEmailsSearch(useSearch({ strict: false }) as Record<string, unknown>).filter;
  const [filter, setFilter] = useState<EmailFilter>(linked ?? "all");
  // איזו פעולה רצה עכשיו (מזהה המייל, או "all") — הכפתורים שלה נעולים עד הסוף
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (linked) setFilter(linked);
  }, [linked]);
  const key = [...manageKeys.all, "emails", filter] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () => hospitalityEmails({ data: { filter } }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  if (!ctx.permissions["bookings"]) return <p className="p-4">אין לכם הרשאה לראות את המיילים.</p>;
  if (query.isError && !query.data) return <LoadError error={query.error} />;
  if (!query.data) return <PageSkeleton label="טוען מיילים…" />;
  const data = query.data;
  // אחרי כל פעולה: הרשימה, וגם הפעמון / התפריט / "דורש טיפול" (אותה שאילתה) — מיד, לא בעוד דקה
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: [...manageKeys.all, "emails"] });
    void qc.invalidateQueries({ queryKey: dashboardKeys.tasks });
  };
  const run = async (id: string, work: () => Promise<string>) => {
    setBusy(id);
    try {
      toast.success(await work());
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };
  const retry = (id: string) =>
    run(id, async () => {
      await hospitalityRequeueEmail({ data: { id } });
      return "המייל חזר לתור ונשלח שוב";
    });
  const mark = (id: string, action: EmailAlertAction) =>
    run(id, async () => {
      await hospitalityEmailAlertsMark({ data: { ids: [id], action } });
      return ALERT_ACTION_DONE[action];
    });
  const markAll = (action: "seen" | "handled") =>
    run("all", async () => {
      const r = await hospitalityEmailAlertsMarkAll({ data: { action } });
      if (r.updated === 0) return "אין התראות לסמן";
      return action === "seen"
        ? `${r.updated === 1 ? "התראה אחת סומנה" : `${r.updated} התראות סומנו`} כנקראו`
        : `${r.updated === 1 ? "התראה אחת סומנה" : `${r.updated} התראות סומנו`} כטופלו — אפשר להחזיר כל אחת מ"טופלו"`;
    });
  const anyNew = data.items.some((m) => alertState(m) === "new");
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">מיילים</h1>
        <p className="text-muted-foreground">
          המיילים שהמערכת שולחת בשמכם לאורחים ולכם — אישורים, דחיות, ביטולים ותזכורות.
        </p>
      </header>
      <div role="tablist" aria-label="סינון מיילים" className="flex gap-1 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "flex min-h-11 shrink-0 items-center gap-2 rounded-md border px-3 text-sm",
              filter === f.key
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background",
            )}
          >
            {f.label}
            {f.key !== "all" && (
              <span
                className={cn(
                  "rounded-full px-2 text-xs",
                  filter === f.key ? "bg-primary-foreground/20" : "bg-muted",
                  f.key === "failed" &&
                    data.counts.failed > 0 &&
                    filter !== f.key &&
                    "bg-rose-200 text-rose-950",
                )}
              >
                {data.counts[f.key] ?? 0}
              </span>
            )}
          </button>
        ))}
      </div>
      {filter === "failed" && data.items.length > 0 && (
        <div
          className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          data-testid="email-alerts-bar"
        >
          <p className="text-muted-foreground">
            "נקרא" מוריד את המספר מהפעמון ומהתפריט. "טופל" מסיר את ההתראה. המייל עצמו נשמר
            בהיסטוריה.
          </p>
          <div className="flex shrink-0 flex-wrap gap-2">
            {anyNew && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 gap-2"
                disabled={busy !== null}
                onClick={() => void markAll("seen")}
              >
                <Eye className="size-4" aria-hidden="true" />
                סימון הכול כנקרא
              </Button>
            )}
            <ConfirmButton
              label="סימון הכול כטופל"
              icon={<CheckCheck className="size-4" aria-hidden="true" />}
              title="לסמן את כל ההתראות כטופלו?"
              description={
                <>
                  <p>
                    כל המיילים שנכשלו יעברו ל"טופלו", וההתראה עליהם תוסר מהפעמון, מהתפריט ומ"דורש
                    טיפול".
                  </p>
                  <p>
                    המיילים לא יישלחו שוב ולא יימחקו. אפשר לשלוח שוב או להחזיר כל אחד מהם מ"טופלו".
                  </p>
                </>
              }
              confirmLabel="סימון הכול כטופל"
              disabled={busy !== null}
              onConfirm={() => markAll("handled")}
            />
          </div>
        </div>
      )}
      {data.items.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-muted-foreground">
          {EMPTY_TEXT[filter] ?? "אין מיילים להצגה."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="emails-list">
          {data.items.map((m) => (
            <EmailItem
              key={m.id}
              email={m}
              busy={busy !== null}
              onRetry={() => void retry(m.id)}
              onMark={(action) => void mark(m.id, action)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function EmailItem({
  email: m,
  busy,
  onRetry,
  onMark,
}: {
  email: EmailRow;
  busy: boolean;
  onRetry: () => void;
  onMark: (action: EmailAlertAction) => void;
}) {
  const state = alertState(m);
  const acts = alertActions(state);
  const name = EMAIL_EVENT[m.event] ?? m.event;
  return (
    <li data-email-alert={state ?? undefined}>
      <Card>
        <CardContent className="flex flex-col gap-1 p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{name}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              {state && state !== "cancelled" && (
                <span className={cn("rounded px-2 py-0.5 text-xs", STATE_TONE[state])}>
                  {ALERT_STATE_LABEL[state]}
                  {state === "handled" && m.alert?.handled_at
                    ? ` · ${dateTimeText(m.alert.handled_at)}`
                    : ""}
                </span>
              )}
              <span
                className={cn(
                  "rounded px-2 py-0.5 text-xs",
                  m.status === "sent" && "bg-emerald-100 text-emerald-900",
                  (m.status === "queued" || m.status === "sending") &&
                    "bg-amber-100 text-amber-950",
                  state === "cancelled"
                    ? STATE_TONE.cancelled
                    : (m.status === "failed" || m.status === "dead") && "bg-rose-100 text-rose-900",
                )}
              >
                {state === "cancelled"
                  ? ALERT_STATE_LABEL.cancelled
                  : (EMAIL_STATUS[m.status] ?? m.status)}
              </span>
            </span>
          </div>
          <p className="text-muted-foreground">
            <span dir="ltr">{m.recipient}</span> · {dateTimeText(m.sent_at ?? m.created_at)}
            {m.attempts > 1 ? ` · ${m.attempts} ניסיונות` : ""}
          </p>
          {state === "cancelled" && (
            <p className="text-muted-foreground">
              המערכת ביטלה את המייל בכוונה — פרטי הלקוח נמחקו או שכתובת המייל תוקנה, ולכן הוא לא
              יישלח שוב. אין צורך לטפל בו.
            </p>
          )}
          {m.booking_id && m.booking_number && (
            <Link
              to="/manage/bookings/$bookingId"
              params={{ bookingId: m.booking_id }}
              className="w-fit font-medium text-primary hover:underline"
            >
              הזמנה #{m.booking_number}
            </Link>
          )}
          {(acts.resend || acts.marks.length > 0) && (
            <div className="mt-1 flex flex-wrap gap-2">
              {acts.resend && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 w-fit gap-2"
                  disabled={busy}
                  aria-label={`לשלוח שוב — ${name}`}
                  onClick={onRetry}
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  לשלוח שוב
                </Button>
              )}
              {acts.marks.map((action) => {
                const Icon = ACTION_ICON[action];
                return (
                  <Button
                    key={action}
                    type="button"
                    variant="ghost"
                    className="min-h-11 w-fit gap-2"
                    disabled={busy}
                    aria-label={`${ALERT_ACTION_LABEL[action]} — ${name}`}
                    data-alert-action={action}
                    onClick={() => onMark(action)}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {ALERT_ACTION_LABEL[action]}
                  </Button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  );
}
