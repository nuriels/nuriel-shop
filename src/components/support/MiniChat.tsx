import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  Check,
  CheckCheck,
  Headset,
  Loader2,
  Lock,
  LockOpen,
  RotateCcw,
  SendHorizontal,
  Store,
} from "lucide-react";
import { toast } from "sonner";
import {
  getSupportThread,
  sendSupportMessage,
  setSupportTicketStatus,
} from "@/lib/support.functions";
import {
  MESSAGE_MAX,
  PLATFORM_TICKET_STATUS_LABELS,
  TICKET_STATUS_LABELS,
  chatDayKey,
  chatDayLabel,
  chatTime,
  isVip,
  type SupportMessage,
  type SupportThread,
  type SupportTicket,
  type TicketStatus,
} from "@/lib/support";
import { PLAN_LABELS } from "@/lib/subscription";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** רענון ההודעות בזמן שהחלון פתוח ונראה */
const POLL_MS = 5_000;

type PendingMessage = SupportMessage & { pending: true; failed?: boolean };

const STATUS_TONE: Record<TicketStatus, string> = {
  open: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-100",
  answered: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-100",
  closed: "bg-muted text-muted-foreground",
};

/**
 * מיני-צ'אט של פנייה (חלק 13) — משותף למנהל החנות ולמנהל הפלטפורמה.
 * ההודעות של הקורא בצד אחד (בועה ירוקה, כמו בוואטסאפ) והצד השני בצד השני;
 * קיבוץ לפי יום, Enter שולח (Shift+Enter — שורה חדשה), רענון כל 5 שניות.
 */
export function MiniChat({
  ticketId,
  perspective,
  onTicketChange,
  onBack,
}: {
  ticketId: string;
  /** מי מסתכל — לתוויות (בפועל הצד נקבע במסד) */
  perspective: "tenant" | "admin";
  onTicketChange?: (ticket: SupportTicket) => void;
  /** בטלפון: חזרה לרשימת הפניות */
  onBack?: () => void;
}) {
  const loadThread = useServerFn(getSupportThread);
  const send = useServerFn(sendSupportMessage);
  const setStatus = useServerFn(setSupportTicketStatus);
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const onTicketChangeRef = useRef(onTicketChange);
  onTicketChangeRef.current = onTicketChange;

  const refresh = useCallback(async () => {
    try {
      const next = await loadThread({ data: { ticketId } });
      setThread(next);
      setError(null);
      onTicketChangeRef.current?.(next.ticket);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "טעינת הפנייה נכשלה");
    }
  }, [loadThread, ticketId]);

  // פנייה חדשה נבחרה — מתחילים נקי
  useEffect(() => {
    setThread(null);
    setPending([]);
    setDraft("");
    stickToBottom.current = true;
    void refresh();
  }, [refresh]);

  // רענון תקופתי כשהלשונית גלויה
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // גלילה לתחתית כשמגיעות הודעות (אם המשתמש לא גלל למעלה לקרוא)
  const messageCount = (thread?.messages.length ?? 0) + pending.length;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messageCount]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || !thread) return;
    if (text.length > MESSAGE_MAX) {
      toast.error(`ההודעה ארוכה מדי (עד ${MESSAGE_MAX.toLocaleString("he-IL")} תווים)`);
      return;
    }
    const temp: PendingMessage = {
      id: `pending-${Date.now()}`,
      ticketId,
      senderType: thread.side,
      senderName: "",
      message: text,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setPending((list) => [...list, temp]);
    setDraft("");
    stickToBottom.current = true;
    try {
      const result = await send({ data: { ticketId, message: text } });
      setPending((list) => list.filter((m) => m.id !== temp.id));
      setThread((current) =>
        current
          ? { ...current, ticket: result.ticket, messages: [...current.messages, result.message] }
          : current,
      );
      onTicketChangeRef.current?.(result.ticket);
    } catch (thrown) {
      setPending((list) => list.map((m) => (m.id === temp.id ? { ...m, failed: true } : m)));
      toast.error(thrown instanceof Error ? thrown.message : "שליחת ההודעה נכשלה");
    }
    textarea.current?.focus();
  };

  const retry = (message: PendingMessage) => {
    setPending((list) => list.filter((m) => m.id !== message.id));
    setDraft(message.message);
    textarea.current?.focus();
  };

  const toggleStatus = async () => {
    if (!thread) return;
    setStatusBusy(true);
    try {
      const ticket = await setStatus({
        data: { ticketId, status: thread.ticket.status === "closed" ? "open" : "closed" },
      });
      setThread((current) => (current ? { ...current, ticket } : current));
      onTicketChangeRef.current?.(ticket);
      toast.success(ticket.status === "closed" ? "הפנייה נסגרה" : "הפנייה נפתחה מחדש");
    } catch (thrown) {
      toast.error(thrown instanceof Error ? thrown.message : "עדכון הפנייה נכשל");
    } finally {
      setStatusBusy(false);
    }
  };

  if (!thread) {
    return (
      <div className="flex h-full min-h-[24rem] items-center justify-center rounded-2xl border bg-card">
        {error ? (
          <p className="px-6 text-center text-sm text-destructive">{error}</p>
        ) : (
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="טוען" />
        )}
      </div>
    );
  }

  const { ticket } = thread;
  const statusLabels =
    perspective === "admin" ? PLATFORM_TICKET_STATUS_LABELS : TICKET_STATUS_LABELS;
  const all: (SupportMessage | PendingMessage)[] = [...thread.messages, ...pending];
  // ההודעה האחרונה של הצד השני — הודעה שלי שלפניה כבר "נענתה" (וי כפול)
  const lastOtherAt = thread.messages.reduce(
    (latest, m) => (m.senderType !== thread.side && m.createdAt > latest ? m.createdAt : latest),
    "",
  );

  return (
    <div className="flex h-full min-h-[28rem] flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
      {/* כותרת */}
      <div className="flex items-center gap-3 border-b bg-secondary/60 px-4 py-3">
        {onBack && (
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={onBack}
            aria-label="חזרה לרשימה"
          >
            <ArrowRight className="size-5" />
          </Button>
        )}
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          {perspective === "admin" ? (
            <Store className="size-5" aria-hidden="true" />
          ) : (
            <Headset className="size-5" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-foreground">{ticket.subject}</p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {perspective === "admin" ? (
              <>
                <span className="font-medium text-foreground">{ticket.storeName}</span>
                <span dir="ltr">{ticket.storeSlug}</span>
                <span>· {PLAN_LABELS[ticket.plan]}</span>
                {isVip(ticket.plan) && (
                  <span className="rounded bg-amber-100 px-1.5 font-bold text-amber-800">VIP</span>
                )}
              </>
            ) : (
              <span>צוות התמיכה · מענה תוך 3 שעות</span>
            )}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
            STATUS_TONE[ticket.status],
          )}
        >
          {statusLabels[ticket.status]}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="hidden shrink-0 sm:inline-flex"
          disabled={statusBusy}
          onClick={() => void toggleStatus()}
        >
          {statusBusy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : ticket.status === "closed" ? (
            <LockOpen className="size-4" />
          ) : (
            <Lock className="size-4" />
          )}
          {ticket.status === "closed" ? "פתיחה מחדש" : "סגירת הפנייה"}
        </Button>
      </div>

      {/* ההודעות */}
      <div
        ref={scroller}
        onScroll={onScroll}
        className="flex-1 space-y-1.5 overflow-y-auto bg-[#efeae2] px-3 py-4 dark:bg-zinc-900 sm:px-5"
        aria-live="polite"
      >
        {all.map((message, index) => {
          const previous = all[index - 1];
          const newDay =
            !previous || chatDayKey(previous.createdAt) !== chatDayKey(message.createdAt);
          const mine = message.senderType === thread.side;
          const firstOfGroup = newDay || previous?.senderType !== message.senderType;
          const pendingMessage = "pending" in message ? message : null;
          return (
            <Fragment key={message.id}>
              {newDay && (
                <div className="flex justify-center py-2">
                  <span className="rounded-lg bg-white/90 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm dark:bg-zinc-800">
                    {chatDayLabel(message.createdAt)}
                  </span>
                </div>
              )}
              {/* בעברית: הצד השני מימין (התחלה), ההודעות שלי משמאל (סוף) — כמו בוואטסאפ */}
              <div
                className={cn(
                  "flex",
                  mine ? "justify-end" : "justify-start",
                  firstOfGroup && "pt-1.5",
                )}
              >
                <div
                  className={cn(
                    "relative max-w-[85%] rounded-xl px-3 pb-1.5 pt-2 text-sm leading-6 shadow-sm sm:max-w-[70%]",
                    mine
                      ? "bg-[#d9fdd3] text-zinc-900 dark:bg-emerald-900 dark:text-emerald-50"
                      : "bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
                    firstOfGroup && (mine ? "rounded-tl-sm" : "rounded-tr-sm"),
                    pendingMessage?.failed && "ring-2 ring-destructive",
                  )}
                >
                  {!mine && firstOfGroup && message.senderName && (
                    <p className="mb-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                      {message.senderName}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{message.message}</p>
                  <p
                    className={cn(
                      "mt-0.5 flex items-center justify-end gap-1 text-[11px]",
                      mine ? "text-emerald-900/60 dark:text-emerald-100/60" : "text-zinc-500",
                    )}
                  >
                    {pendingMessage ? (
                      pendingMessage.failed ? (
                        <button
                          type="button"
                          onClick={() => retry(pendingMessage)}
                          className="inline-flex items-center gap-1 font-semibold text-destructive"
                        >
                          <RotateCcw className="size-3" aria-hidden="true" />
                          לא נשלח — לנסות שוב
                        </button>
                      ) : (
                        <>
                          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                          שולח…
                        </>
                      )
                    ) : (
                      <>
                        {chatTime(message.createdAt)}
                        {mine &&
                          (lastOtherAt > message.createdAt ? (
                            <CheckCheck className="size-3.5 text-sky-600" aria-label="נענה" />
                          ) : (
                            <Check className="size-3.5" aria-label="נשלח" />
                          ))}
                      </>
                    )}
                  </p>
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>

      {/* כתיבה */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="border-t bg-secondary/40 p-3"
      >
        {ticket.status === "closed" && (
          <p className="mb-2 text-center text-xs text-muted-foreground">
            הפנייה סגורה — הודעה חדשה תפתח אותה מחדש.
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={textarea}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
            rows={Math.min(5, Math.max(1, draft.split("\n").length))}
            maxLength={MESSAGE_MAX}
            placeholder={perspective === "admin" ? "כתבו תשובה ללקוח…" : "כתבו הודעה לצוות התמיכה…"}
            aria-label="הודעה"
            className="max-h-40 min-h-11 flex-1 resize-none rounded-2xl border border-input bg-background px-4 py-2.5 text-sm leading-6 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            type="submit"
            size="icon"
            className="size-11 shrink-0 rounded-full bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={draft.trim() === ""}
            aria-label="שליחה"
          >
            {/* החץ פונה שמאלה — כיוון הקריאה בעברית */}
            <SendHorizontal className="size-5 -scale-x-100" />
          </Button>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Enter לשליחה · Shift+Enter לשורה חדשה</span>
          <button
            type="button"
            className="font-medium hover:text-foreground sm:hidden"
            disabled={statusBusy}
            onClick={() => void toggleStatus()}
          >
            {ticket.status === "closed" ? "פתיחה מחדש" : "סגירת הפנייה"}
          </button>
        </div>
      </form>
    </div>
  );
}
