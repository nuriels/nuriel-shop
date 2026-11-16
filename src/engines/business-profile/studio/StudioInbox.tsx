// "פניות מלקוחות" (מיגרציה 196): כל הפניות מהטפסים באתר — רשימה עם סינון לפי מצב, פרטי פנייה (שם,
// טלפון, אימייל, הודעה, סוג, תאריך ושעה), חיוג / מייל בלחיצה, מצב טיפול (חדשה / בטיפול / טופלה),
// הערות פנימיות, מצב ההתראה במייל וניסיון חוזר, היסטוריה ומחיקה. וגם ההגדרות: המייל להתראות ותקופת השמירה.
// הכול באתר של הבקשה בלבד — המסד בודק את ההרשאה (inquiries.manage: בעל העסק) בכל פעולה.
import { useEffect, useId, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
} from "@/platform/ui";
import {
  studioInquiries,
  studioInquiriesDeleteTest,
  studioInquiry,
  studioInquiryAddNote,
  studioInquiryDelete,
  studioInquiryDeleteNote,
  studioInquiryRetryNotify,
  studioInquirySetStatus,
  studioInquirySettings,
  studioInquirySettingsSave,
} from "../api/inquiries.functions";
import {
  KIND_LABELS,
  NOTIFY_LABELS,
  STATUS_LABELS,
  type InquiryKind,
  type InquiryStatus,
} from "../inquiries/logic";
import type { InquiryDetail, InquiryRow } from "../inquiries/types";
import { useStudio } from "./StudioLayout";
import { formatDate } from "./status";

export const INBOX_QUERY = ["bp", "inquiries"] as const;
type Filter = "all" | InquiryStatus;
const FILTERS: [Filter, string][] = [
  ["all", "הכול"],
  ["new", "חדשות"],
  ["in_progress", "בטיפול"],
  ["done", "טופלו"],
];
const STATUS_VARIANT: Record<InquiryStatus, "default" | "secondary" | "outline"> = {
  new: "default",
  in_progress: "secondary",
  done: "outline",
};
const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export function StudioInbox() {
  const { context } = useStudio();
  if (!context.permissions.includes("inquiries.manage")) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <h1 className="text-xl font-bold">פניות מלקוחות</h1>
          <p className="mt-2 text-muted-foreground">
            הפניות מהאתר כוללות פרטים אישיים של לקוחות, ולכן רק בעל העסק רואה אותן.
          </p>
        </CardContent>
      </Card>
    );
  }
  return <Inbox />;
}

function Inbox() {
  const search = useSearch({ strict: false }) as { id?: string };
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const [includeTest, setIncludeTest] = useState(true);
  const list = useServerFn(studioInquiries);
  const q = useQuery({
    queryKey: [...INBOX_QUERY, filter, includeTest],
    queryFn: () => list({ data: { status: filter === "all" ? null : filter, includeTest } }),
    refetchInterval: 60_000,
  });
  const selected = typeof search.id === "string" ? search.id : null;
  const select = (id: string | null) =>
    void navigate({ to: "/studio/inbox", search: id ? { id } : {}, replace: false });
  const counts = q.data?.counts;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">פניות מלקוחות</h1>
        <p className="mt-1 text-muted-foreground">
          כל מי שמילא טופס באתר. הפניות נשמרות כאן גם כשהמייל לא נשלח.
        </p>
      </div>
      {q.data?.notify_block && (
        <p
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          ההתראות במייל לא פעילות: {q.data.notify_block}.{" "}
          <a href="#inbox-settings" className="font-semibold underline">
            להגדרות ההתראות
          </a>
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <section aria-labelledby="inbox-list-title" className={selected ? "hidden lg:block" : ""}>
          <h2 id="inbox-list-title" className="sr-only">
            רשימת הפניות
          </h2>
          <div
            className="mb-3 flex flex-wrap items-center gap-2"
            role="group"
            aria-label="סינון לפי מצב"
          >
            {FILTERS.map(([key, label]) => {
              const n = counts ? (key === "all" ? counts.all : counts[key]) : null;
              return (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  variant={filter === key ? "default" : "outline"}
                  aria-pressed={filter === key}
                  onClick={() => setFilter(key)}
                >
                  {label}
                  {n !== null && <span className="ms-1 tabular-nums">({n})</span>}
                </Button>
              );
            })}
          </div>
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={includeTest}
              onChange={(e) => setIncludeTest(e.target.checked)}
            />
            להציג גם פניות בדיקה (מהתצוגה המקדימה)
          </label>
          {q.isPending ? (
            <p className="text-sm text-muted-foreground" role="status">
              טוען פניות…
            </p>
          ) : q.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {errorText(q.error, "הפניות לא נטענו")}
            </p>
          ) : !q.data.items.length ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                {filter === "all"
                  ? "עוד אין פניות. פנייה חדשה תופיע כאן מיד."
                  : "אין פניות במצב הזה."}
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-2" aria-label="פניות">
              {q.data.items.map((item) => (
                <li key={item.id}>
                  <InquiryCard
                    item={item}
                    active={item.id === selected}
                    onOpen={() => select(item.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="inbox-detail-title" className={selected ? "" : "hidden lg:block"}>
          {selected ? (
            <InquiryPanel id={selected} onClose={() => select(null)} />
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                <h2 id="inbox-detail-title" className="sr-only">
                  פרטי פנייה
                </h2>
                בחרו פנייה מהרשימה כדי לראות את כל הפרטים.
              </CardContent>
            </Card>
          )}
        </section>
      </div>
      <SettingsCard testCount={counts?.test ?? 0} />
    </div>
  );
}

function InquiryCard({
  item,
  active,
  onOpen,
}: {
  item: InquiryRow;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? "true" : undefined}
      className={`w-full rounded-lg border bg-background p-3 text-start transition hover:border-foreground/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
        active ? "border-foreground ring-1 ring-foreground" : ""
      }`}
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{item.full_name}</span>
        <Badge variant={STATUS_VARIANT[item.status]}>{STATUS_LABELS[item.status]}</Badge>
        {item.is_test && <Badge variant="outline">בדיקה</Badge>}
        {item.notify_status === "failed" && <Badge variant="destructive">המייל לא נשלח</Badge>}
      </span>
      <span className="mt-1 block text-xs text-muted-foreground">
        {KIND_LABELS[item.kind as InquiryKind] ?? item.kind} · {formatDate(item.created_at)}
      </span>
      {item.message && (
        <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground">
          {item.message}
        </span>
      )}
    </button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2 py-1.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

const HISTORY_LABEL: Record<string, string> = {
  "inquiry.status": "שינוי מצב",
  "inquiry.note_added": "נוספה הערה",
  "inquiry.note_deleted": "נמחקה הערה",
  "inquiry.notify_retry": "בקשה לשליחה חוזרת של ההתראה",
};

function InquiryPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const load = useServerFn(studioInquiry);
  const setStatus = useServerFn(studioInquirySetStatus);
  const addNote = useServerFn(studioInquiryAddNote);
  const deleteNote = useServerFn(studioInquiryDeleteNote);
  const retry = useServerFn(studioInquiryRetryNotify);
  const remove = useServerFn(studioInquiryDelete);
  const key = [...INBOX_QUERY, "detail", id];
  const q = useQuery({ queryKey: key, queryFn: () => load({ data: { id } }), retry: false });
  const [note, setNote] = useState("");
  const noteId = useId();
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: INBOX_QUERY });
  };
  const statusM = useMutation({
    mutationFn: (status: InquiryStatus) => setStatus({ data: { id, status } }),
    onSuccess: async (r) => {
      toast.success(`המצב עודכן: ${STATUS_LABELS[r.status]}`);
      await refresh();
    },
    onError: (e) => toast.error(errorText(e, "העדכון נכשל")),
  });
  const noteM = useMutation({
    mutationFn: () => addNote({ data: { id, body: note } }),
    onSuccess: async () => {
      setNote("");
      toast.success("ההערה נשמרה");
      await refresh();
    },
    onError: (e) => toast.error(errorText(e, "ההערה לא נשמרה")),
  });
  const deleteNoteM = useMutation({
    mutationFn: (noteId: string) => deleteNote({ data: { noteId } }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorText(e, "ההערה לא נמחקה")),
  });
  const retryM = useMutation({
    mutationFn: () => retry({ data: { id } }),
    onSuccess: async (r) => {
      if (r.outcome === "sent") toast.success("ההתראה נשלחה במייל");
      else toast.error("השליחה נכשלה שוב — הפרטים למטה. הפנייה עצמה שמורה.");
      await refresh();
    },
    onError: async (e) => {
      toast.error(errorText(e, "השליחה נכשלה"));
      await refresh();
    },
  });
  const removeM = useMutation({
    mutationFn: () => remove({ data: { id } }),
    onSuccess: async () => {
      toast.success("הפנייה נמחקה");
      onClose();
      await refresh();
    },
    onError: (e) => toast.error(errorText(e, "המחיקה נכשלה")),
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  // אחרי בחירה בנייד — הפוקוס עובר לכותרת הפרטים (קורא מסך יודע שהתוכן התחלף)
  useEffect(() => {
    if (q.data) document.getElementById("inbox-detail-title")?.focus();
  }, [q.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isPending)
    return (
      <p className="text-sm text-muted-foreground" role="status">
        טוען את הפנייה…
      </p>
    );
  if (q.isError)
    return (
      <Card>
        <CardContent className="space-y-3 py-8 text-center">
          <h2 id="inbox-detail-title" className="font-semibold">
            הפנייה לא נמצאה
          </h2>
          <p className="text-sm text-muted-foreground">{errorText(q.error, "")}</p>
          <Button variant="outline" onClick={onClose}>
            חזרה לרשימה
          </Button>
        </CardContent>
      </Card>
    );
  const d: InquiryDetail = q.data;
  const canRetry = d.notify_status !== "sent" && d.notify_status !== "sending";

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-xl">
            <h2 id="inbox-detail-title" tabIndex={-1} className="outline-none">
              {d.full_name}
            </h2>
          </CardTitle>
          <Button variant="ghost" size="sm" className="lg:hidden" onClick={onClose}>
            חזרה לרשימה
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_VARIANT[d.status]}>{STATUS_LABELS[d.status]}</Badge>
          {d.is_test && <Badge variant="outline">פניית בדיקה (מהתצוגה המקדימה)</Badge>}
          <span className="text-xs text-muted-foreground">
            מספר פנייה <bdi dir="ltr">{d.reference}</bdi>
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap gap-2">
          {d.phone && (
            <Button asChild>
              <a href={`tel:${d.phone}`}>
                התקשרות <bdi dir="ltr">{d.phone}</bdi>
              </a>
            </Button>
          )}
          {d.email && (
            <Button asChild variant="outline">
              <a href={`mailto:${d.email}`}>
                מייל ל-<bdi dir="ltr">{d.email}</bdi>
              </a>
            </Button>
          )}
        </div>
        <dl className="divide-y">
          <Row label="שם">{d.full_name}</Row>
          <Row label="טלפון">{d.phone ? <bdi dir="ltr">{d.phone}</bdi> : "—"}</Row>
          <Row label="אימייל">{d.email ? <bdi dir="ltr">{d.email}</bdi> : "—"}</Row>
          <Row label="סוג הפנייה">
            {KIND_LABELS[d.kind as InquiryKind] ?? d.kind}
            {d.form_title ? ` — ${d.form_title}` : ""}
          </Row>
          <Row label="התקבלה">{formatDate(d.created_at)}</Row>
          <Row label="ההודעה">
            {d.message ? <span className="whitespace-pre-wrap">{d.message}</span> : "—"}
          </Row>
        </dl>

        <fieldset className="space-y-2">
          <legend className="font-semibold">מצב הטיפול</legend>
          <div className="flex flex-wrap gap-4">
            {(Object.keys(STATUS_LABELS) as InquiryStatus[]).map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`status-${d.id}`}
                  value={s}
                  className="size-4"
                  checked={d.status === s}
                  disabled={statusM.isPending}
                  onChange={() => statusM.mutate(s)}
                />
                {STATUS_LABELS[s]}
              </label>
            ))}
          </div>
        </fieldset>

        <section aria-labelledby={`${noteId}-title`} className="space-y-3">
          <h3 id={`${noteId}-title`} className="font-semibold">
            הערות פנימיות{" "}
            <span className="text-sm font-normal text-muted-foreground">(רק בממשק הניהול)</span>
          </h3>
          {d.notes.length > 0 && (
            <ul className="space-y-2">
              {d.notes.map((n) => (
                <li key={n.id} className="rounded-md bg-muted/50 p-3 text-sm">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {formatDate(n.created_at)}
                      {n.author ? ` · ${n.author}` : ""}
                    </span>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      disabled={deleteNoteM.isPending}
                      onClick={() => deleteNoteM.mutate(n.id)}
                    >
                      מחיקת ההערה
                    </Button>
                  </p>
                </li>
              ))}
            </ul>
          )}
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (note.trim()) noteM.mutate();
            }}
          >
            <Label htmlFor={`${noteId}-note`}>הערה חדשה</Label>
            <Textarea
              id={`${noteId}-note`}
              value={note}
              maxLength={2000}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={!note.trim() || noteM.isPending}>
              {noteM.isPending ? "שומר…" : "הוספת הערה"}
            </Button>
          </form>
        </section>

        <section aria-labelledby={`${noteId}-notify`} className="space-y-2 rounded-md border p-3">
          <h3 id={`${noteId}-notify`} className="font-semibold">
            התראה במייל
          </h3>
          <p className="text-sm" data-testid="inquiry-notify-status">
            {NOTIFY_LABELS[d.notify_status]}
            {d.notify_status === "sent" && d.notify_sent_at
              ? ` · ${formatDate(d.notify_sent_at)}`
              : ""}
            {d.notify_attempts > 0 ? ` · ניסיונות: ${d.notify_attempts}` : ""}
          </p>
          {d.notify_error && d.notify_status !== "sent" && (
            <p className="text-sm text-muted-foreground">סיבה: {d.notify_error}</p>
          )}
          {d.notify_status === "failed" && d.notify_next_at && (
            <p className="text-sm text-muted-foreground">
              ניסיון אוטומטי נוסף: {formatDate(d.notify_next_at)}
            </p>
          )}
          {canRetry && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={retryM.isPending}
              onClick={() => retryM.mutate()}
            >
              {retryM.isPending ? "שולח…" : "שליחה חוזרת של ההתראה"}
            </Button>
          )}
        </section>

        {d.history.length > 0 && (
          <section aria-labelledby={`${noteId}-history`} className="space-y-2">
            <h3 id={`${noteId}-history`} className="font-semibold">
              היסטוריית הטיפול
            </h3>
            <ol className="space-y-1 text-sm text-muted-foreground">
              {d.history.map((h, i) => (
                <li key={`${h.at}-${i}`}>
                  {formatDate(h.at)} — {HISTORY_LABEL[h.action] ?? h.action}
                  {h.action === "inquiry.status" && h.to
                    ? `: ${STATUS_LABELS[h.from as InquiryStatus] ?? h.from} ← ${STATUS_LABELS[h.to as InquiryStatus] ?? h.to}`
                    : ""}
                  {h.by ? ` (${h.by})` : ""}
                </li>
              ))}
            </ol>
          </section>
        )}

        <div className="border-t pt-4">
          <Button
            type="button"
            variant="ghost"
            className="text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            מחיקת הפנייה
          </Button>
        </div>
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>למחוק את הפנייה של {d.full_name}?</AlertDialogTitle>
              <AlertDialogDescription>
                הפנייה וההערות שלה יימחקו לצמיתות. אי אפשר לשחזר אותן.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ביטול</AlertDialogCancel>
              <AlertDialogAction onClick={() => removeM.mutate()}>מחיקה</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

const RETENTION_OPTIONS: [number, string][] = [
  [90, "3 חודשים"],
  [180, "חצי שנה"],
  [365, "שנה (מומלץ)"],
  [730, "שנתיים"],
  [1095, "3 שנים"],
];

function SettingsCard({ testCount }: { testCount: number }) {
  const qc = useQueryClient();
  const load = useServerFn(studioInquirySettings);
  const save = useServerFn(studioInquirySettingsSave);
  const deleteTest = useServerFn(studioInquiriesDeleteTest);
  const q = useQuery({ queryKey: [...INBOX_QUERY, "settings"], queryFn: () => load() });
  const [email, setEmail] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [days, setDays] = useState(365);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!q.data) return;
    setEmail(q.data.notify_email ?? "");
    setEnabled(q.data.notify_enabled);
    setDays(q.data.retention_days);
  }, [q.data]);
  const saveM = useMutation({
    mutationFn: () =>
      save({ data: { notifyEmail: email, notifyEnabled: enabled, retentionDays: days } }),
    onSuccess: async () => {
      setError(null);
      toast.success("ההגדרות נשמרו");
      await qc.invalidateQueries({ queryKey: INBOX_QUERY });
    },
    onError: (e) => setError(errorText(e, "ההגדרות לא נשמרו")),
  });
  const testM = useMutation({
    mutationFn: () => deleteTest(),
    onSuccess: async (r) => {
      toast.success(r.deleted ? `נמחקו ${r.deleted} פניות בדיקה` : "אין פניות בדיקה");
      await qc.invalidateQueries({ queryKey: INBOX_QUERY });
    },
    onError: (e) => toast.error(errorText(e, "המחיקה נכשלה")),
  });
  const ids = useId();
  return (
    <Card id="inbox-settings">
      <CardHeader>
        <CardTitle className="text-lg">
          <h2>הגדרות הפניות</h2>
        </CardTitle>
        <CardDescription>
          לאן נשלחת ההתראה על פנייה חדשה, וכמה זמן שומרים פניות. המייל להתראות לא מוצג באתר.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="max-w-xl space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            saveM.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${ids}-email`}>המייל להתראות על פניות</Label>
            <Input
              id={`${ids}-email`}
              type="email"
              dir="ltr"
              autoComplete="email"
              value={email}
              aria-invalid={error ? "true" : undefined}
              aria-describedby={`${ids}-email-hint${error ? ` ${ids}-error` : ""}`}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p id={`${ids}-email-hint`} className="text-xs text-muted-foreground">
              כל פנייה חדשה תישלח לכתובת הזו, עם קישור לאזור הפניות.
            </p>
            {q.data?.account_email && q.data.account_email !== email && (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => setEmail(q.data!.account_email ?? "")}
              >
                להשתמש במייל של החשבון (<bdi dir="ltr">{q.data.account_email}</bdi>)
              </Button>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            לשלוח לי מייל על כל פנייה חדשה
          </label>
          <div className="space-y-1.5">
            <Label htmlFor={`${ids}-days`}>כמה זמן לשמור פניות</Label>
            <select
              id={`${ids}-days`}
              className="block h-9 rounded-md border bg-background px-3 text-sm"
              value={days}
              aria-describedby={`${ids}-days-hint`}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {RETENTION_OPTIONS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
              {!RETENTION_OPTIONS.some(([v]) => v === days) && (
                <option value={days}>{days} ימים</option>
              )}
            </select>
            <p id={`${ids}-days-hint`} className="text-xs text-muted-foreground">
              פניות ישנות יותר נמחקות אוטומטית. פניות בדיקה נמחקות אחרי 30 יום.
            </p>
          </div>
          {error && (
            <p id={`${ids}-error`} role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={saveM.isPending || q.isPending}>
            {saveM.isPending ? "שומר…" : "שמירת ההגדרות"}
          </Button>
        </form>
        {testCount > 0 && (
          <div className="mt-6 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={testM.isPending}
              onClick={() => testM.mutate()}
            >
              מחיקת כל פניות הבדיקה ({testCount})
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
