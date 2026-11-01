// מסך "מיילים" (/manage/emails) — Stage 2k: כל המיילים שהמערכת שלחה בשם העסק (לאורחים
// ולעסק): נכשלו · ממתינים · נשלחו, נמען ממוסך, קישור להזמנה; "לשלוח שוב" למייל שנכשל.
// השליחה עצמה — תהליך הרקע בשרת (כל 30 שניות ומיד אחרי כל פעולה).
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, CardContent, cn } from "@/platform/ui";
import { hospitalityEmails, hospitalityRequeueEmail } from "../../api/emails.functions";
import type { EmailFilter } from "../../types/emails";
import { EMAIL_EVENT, EMAIL_STATUS, dateTimeText } from "../bookings/model";
import { LoadError, PageSkeleton } from "../catalog/parts";
import { errorText } from "../catalog/refresh";
import { manageKeys } from "../lib/query-keys";
import { useManagement } from "../shell/management-context";
import { EMAIL_FILTERS, parseEmailsSearch } from "./model";

const FILTERS = EMAIL_FILTERS;

export function EmailsPage() {
  const ctx = useManagement();
  const qc = useQueryClient();
  // ?filter=failed — מלוח הבקרה ("מיילים שלא נשלחו")
  const linked = parseEmailsSearch(useSearch({ strict: false }) as Record<string, unknown>).filter;
  const [filter, setFilter] = useState<EmailFilter>(linked ?? "all");
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
  const retry = async (id: string) => {
    try {
      await hospitalityRequeueEmail({ data: { id } });
      toast.success("המייל חזר לתור ונשלח שוב");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      void qc.invalidateQueries({ queryKey: [...manageKeys.all, "emails"] });
    }
  };
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
                {data.counts[f.key]}
              </span>
            )}
          </button>
        ))}
      </div>
      {data.items.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-muted-foreground">אין מיילים להצגה.</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="emails-list">
          {data.items.map((m) => (
            <li key={m.id}>
              <Card>
                <CardContent className="flex flex-col gap-1 p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{EMAIL_EVENT[m.event] ?? m.event}</span>
                    <span
                      className={cn(
                        "rounded px-2 py-0.5 text-xs",
                        m.status === "sent" && "bg-emerald-100 text-emerald-900",
                        (m.status === "queued" || m.status === "sending") &&
                          "bg-amber-100 text-amber-950",
                        (m.status === "failed" || m.status === "dead") &&
                          "bg-rose-100 text-rose-900",
                      )}
                    >
                      {EMAIL_STATUS[m.status] ?? m.status}
                    </span>
                  </div>
                  <p className="text-muted-foreground">
                    <span dir="ltr">{m.recipient}</span> · {dateTimeText(m.sent_at ?? m.created_at)}
                    {m.attempts > 1 ? ` · ${m.attempts} ניסיונות` : ""}
                  </p>
                  {m.booking_id && m.booking_number && (
                    <Link
                      to="/manage/bookings/$bookingId"
                      params={{ bookingId: m.booking_id }}
                      className="w-fit font-medium text-primary hover:underline"
                    >
                      הזמנה #{m.booking_number}
                    </Link>
                  )}
                  {(m.status === "failed" || m.status === "dead") && (
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-1 min-h-11 w-fit gap-2"
                      onClick={() => void retry(m.id)}
                    >
                      <RotateCcw className="size-4" aria-hidden="true" />
                      לשלוח שוב
                    </Button>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
