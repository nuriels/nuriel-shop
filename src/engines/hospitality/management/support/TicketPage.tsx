// פנייה לתמיכה (/manage/support/:id) — שלב E4: הסטטוס ומה קורה עכשיו, השרשור (בלי הערות
// פנימיות — המסד לא מחזיר אותן לעסק), תגובה עם קבצים, סגירה ופתיחה מחדש. הצפייה מסמנת את
// התשובות כנקראו (המסד), ולכן התג בתפריט מתעדכן.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/platform/ui";
import {
  hospitalitySupportFileUrl,
  hospitalitySupportReply,
  hospitalitySupportSetOpen,
  hospitalitySupportTicket,
} from "../../api/support.functions";
import type { SupportTicket } from "../../types/support";
import { dateTimeText } from "../bookings/model";
import { errorText } from "../catalog/refresh";
import { useManagement } from "../shell/management-context";
import { ErrorState, NoAccess, PageHeader, SkeletonBlock, StatusPill } from "../ui/kit";
import { supportKeys } from "./keys";
import {
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_HINT,
  STATUS_LABEL,
  STATUS_TONE,
  TOPIC_LABEL,
} from "./model";
import { Composer, Thread } from "./parts";

export function TicketPage() {
  const ctx = useManagement();
  const qc = useQueryClient();
  const { ticketId } = useParams({ strict: false }) as { ticketId?: string };
  const id = ticketId ?? "";
  const allowed = ctx.permissions["settings"] === true;
  const query = useQuery({
    queryKey: supportKeys.ticket(id),
    queryFn: () => hospitalitySupportTicket({ data: { id } }),
    enabled: allowed && id !== "",
    refetchInterval: 30_000,
  });
  // הצפייה סימנה את התשובות כנקראו — הרשימה והתג בתפריט מתעדכנים
  const loadedAt = query.dataUpdatedAt;
  useEffect(() => {
    if (!loadedAt) return;
    void qc.invalidateQueries({ queryKey: supportKeys.unread });
    void qc.invalidateQueries({ queryKey: supportKeys.list });
  }, [loadedAt, qc]);

  if (!allowed) return <NoAccess text="מסך התמיכה פתוח לבעלי העסק ולמנהלים." />;
  if (query.isError && !query.data)
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <PageHeader back={{ to: "/manage/support", label: "כל הפניות" }} title="הפנייה לא נטענה" />
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
      </div>
    );
  if (!query.data)
    return (
      <div aria-busy="true" className="mx-auto flex max-w-3xl flex-col gap-4">
        <SkeletonBlock className="h-16" />
        <SkeletonBlock className="h-40" />
        <SkeletonBlock className="h-40" />
        <span className="sr-only">טוען את הפנייה…</span>
      </div>
    );
  return <Ticket t={query.data} />;
}

function Ticket({ t }: { t: SupportTicket }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: supportKeys.all });
  const closed = t.status === "closed";
  const setOpen = async (open: boolean) => {
    setBusy(true);
    try {
      await hospitalitySupportSetOpen({ data: { id: t.id, open } });
      toast.success(open ? "הפנייה נפתחה מחדש" : "הפנייה נסגרה — תודה!");
      refresh();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader
        back={{ to: "/manage/support", label: "כל הפניות" }}
        eyebrow={
          <span dir="ltr" className="font-medium">
            #{t.number}
          </span>
        }
        title={t.subject}
        actions={
          closed || t.status === "resolved" ? (
            <Button
              variant="outline"
              className="min-h-11 gap-2 rounded-xl"
              disabled={busy}
              onClick={() => void setOpen(true)}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <RotateCcw className="size-4" aria-hidden="true" />
              )}
              פתיחה מחדש
            </Button>
          ) : (
            <Button
              variant="outline"
              className="min-h-11 gap-2 rounded-xl"
              disabled={busy}
              onClick={() => void setOpen(false)}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="size-4" aria-hidden="true" />
              )}
              הבעיה נפתרה — סגירה
            </Button>
          )
        }
      />

      <section
        aria-label="מצב הפנייה"
        className="flex flex-col gap-3 rounded-2xl border bg-card p-5 shadow-[var(--hm-shadow-card)]"
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</StatusPill>
          <span className="text-sm text-muted-foreground">{STATUS_HINT[t.status]}</span>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">תחום</dt>
            <dd className="font-medium">{TOPIC_LABEL[t.topic]}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">דחיפות</dt>
            <dd>
              <StatusPill tone={PRIORITY_TONE[t.priority]} dot={false}>
                {PRIORITY_LABEL[t.priority]}
              </StatusPill>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">נפתחה</dt>
            <dd className="font-medium">{dateTimeText(t.created_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">ע״י</dt>
            <dd className="font-medium">{t.opened_by_name ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <Thread
        messages={t.messages}
        side="business"
        onOpenFile={(f) => hospitalitySupportFileUrl({ data: { id: f.id } })}
      />

      {closed ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed bg-[var(--hm-surface-2)] p-5">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            הפנייה סגורה. אם הבעיה חזרה — פותחים אותה מחדש וכותבים כאן.
          </p>
          <Button
            className="min-h-11 gap-2 rounded-xl"
            disabled={busy}
            onClick={() => void setOpen(true)}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            פתיחה מחדש
          </Button>
        </div>
      ) : (
        <Composer
          label="תגובה"
          placeholder="כתבו כאן — צוות התמיכה יקבל התראה"
          submitLabel="שליחה"
          onSend={async (body, files) => {
            const form = new FormData();
            form.set("ticketId", t.id);
            form.set("body", body);
            for (const f of files) form.append("files", f, f.name);
            const r = await hospitalitySupportReply({ data: form });
            refresh();
            if (r.failedFiles.length)
              toast.warning(`ההודעה נשלחה, אבל חלק מהקבצים לא עלו: ${r.failedFiles.join(", ")}`);
            else toast.success("נשלח");
            return true;
          }}
        />
      )}
    </div>
  );
}
