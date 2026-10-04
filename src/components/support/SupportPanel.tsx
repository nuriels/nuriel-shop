import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Clock,
  Crown,
  Headset,
  LifeBuoy,
  Loader2,
  MessageSquarePlus,
  MessagesSquare,
  SendHorizontal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { listMyTickets, openSupportTicket } from "@/lib/support.functions";
import {
  MESSAGE_MAX,
  SUBJECT_MAX,
  SUPPORT_HOURS_TEXT,
  TICKET_STATUS_LABELS,
  chatTime,
  type SupportTicket,
} from "@/lib/support";
import { useSubscription } from "@/hooks/useSubscription";
import { MiniChat } from "@/components/support/MiniChat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type SupportCompose = { subject: string; message?: string };

/**
 * "תמיכה ועזרה" בפאנל הניהול של החנות (חלק 13): שעות הפעילות וזמן המענה,
 * רשימת הפניות של החנות ומיני-צ'אט מול צוות התמיכה של הפלטפורמה.
 * compose — פנייה מוכנה מראש (למשל "בקשה למעבר לחבילת פרימיום" מ"המנוי שלי").
 */
export function SupportPanel({
  ticketId,
  onTicketChange,
  compose,
  onComposeHandled,
}: {
  /** הפנייה הפתוחה (מהכתובת: ?ticket=) */
  ticketId: string | null;
  onTicketChange: (ticketId: string | null) => void;
  compose: SupportCompose | null;
  onComposeHandled: () => void;
}) {
  const load = useServerFn(listMyTickets);
  const { subscription } = useSubscription();
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState<SupportCompose | null>(null);

  const refresh = useCallback(async () => {
    try {
      setTickets(await load());
      setError(null);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "טעינת הפניות נכשלה");
    }
  }, [load]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // פנייה מוכנה מראש — פותחים את הטופס
  useEffect(() => {
    if (!compose) return;
    setComposing(compose);
    onTicketChange(null);
    onComposeHandled();
  }, [compose, onComposeHandled, onTicketChange]);

  const vip = subscription ? subscription.plan !== "basic" : true;
  const showChat = ticketId !== null && composing === null;

  const updateTicket = useCallback((ticket: SupportTicket) => {
    setTickets((list) =>
      list ? list.map((t) => (t.id === ticket.id ? { ...ticket, unread: 0 } : t)) : list,
    );
  }, []);

  return (
    <div className="space-y-5">
      {/* כותרת + שעות פעילות */}
      <div className="overflow-hidden rounded-2xl border bg-gradient-to-l from-primary to-primary/85 text-primary-foreground shadow-sm">
        <div className="flex flex-wrap items-center gap-4 px-5 py-5 sm:px-6">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow">
            <LifeBuoy className="size-6" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="flex flex-wrap items-center gap-2 text-2xl font-bold">
              תמיכה ועזרה
              {vip && (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-xs font-bold text-accent-foreground">
                  <Crown className="size-3.5" aria-hidden="true" />
                  VIP
                </span>
              )}
            </h2>
            <p className="mt-1 flex items-center gap-2 text-sm font-medium text-primary-foreground/90">
              <Clock className="size-4 shrink-0 text-accent" aria-hidden="true" />
              {SUPPORT_HOURS_TEXT}
            </p>
          </div>
          <Button
            type="button"
            onClick={() => {
              setComposing({ subject: "" });
              onTicketChange(null);
            }}
            className="w-full bg-accent text-accent-foreground hover:bg-accent/90 sm:w-auto"
          >
            <MessageSquarePlus className="size-4" />
            פנייה חדשה
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* grid-cols-1 + min-w-0: טקסט ארוך (truncate) לא מרחיב את העמוד בטלפון */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[18rem_minmax(0,1fr)] md:items-start">
        {/* רשימת הפניות (בטלפון — מוסתרת כשצ'אט פתוח) */}
        <aside className={cn("min-w-0 space-y-2", (showChat || composing) && "hidden md:block")}>
          <p className="px-1 text-xs font-semibold text-muted-foreground">הפניות שלי</p>
          {tickets === null ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : tickets.length === 0 ? (
            <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
              <MessagesSquare
                className="mx-auto mb-2 size-8 text-muted-foreground/60"
                aria-hidden="true"
              />
              עוד אין פניות. שאלה, תקלה או בקשה? פתחו פנייה ונחזור אליכם.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {tickets.map((ticket) => {
                const active = ticket.id === ticketId && !composing;
                return (
                  <li key={ticket.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setComposing(null);
                        onTicketChange(ticket.id);
                      }}
                      className={cn(
                        "w-full rounded-xl border px-3 py-2.5 text-right transition",
                        active
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-border bg-card hover:border-primary/40",
                        ticket.status === "closed" && !active && "opacity-70",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                          {ticket.subject}
                        </span>
                        {ticket.unread > 0 && (
                          <span className="rounded-full bg-emerald-600 px-1.5 text-xs font-bold text-white">
                            {ticket.unread}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {ticket.preview}
                      </span>
                      <span className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span
                          className={cn(
                            "font-medium",
                            ticket.status === "answered" && "text-emerald-700",
                            ticket.status === "open" && "text-amber-700",
                          )}
                        >
                          {TICKET_STATUS_LABELS[ticket.status]}
                        </span>
                        <span>{chatTime(ticket.lastMessageAt)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className={cn("min-w-0", !showChat && !composing && "hidden md:block")}>
          {composing ? (
            <NewTicketForm
              initial={composing}
              onCancel={() => setComposing(null)}
              onCreated={(ticket) => {
                setComposing(null);
                setTickets((list) => [ticket, ...(list ?? [])]);
                onTicketChange(ticket.id);
              }}
            />
          ) : showChat ? (
            <div className="h-[min(70vh,40rem)]">
              <MiniChat
                ticketId={ticketId}
                perspective="tenant"
                onTicketChange={updateTicket}
                onBack={() => onTicketChange(null)}
              />
            </div>
          ) : (
            <div className="flex h-[min(70vh,40rem)] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed bg-card p-8 text-center">
              <span className="flex size-16 items-center justify-center rounded-full bg-secondary">
                <Headset className="size-8 text-primary" aria-hidden="true" />
              </span>
              <p className="text-lg font-semibold">אנחנו כאן בשבילכם</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                בחרו פנייה מהרשימה כדי לראות את השיחה, או פתחו פנייה חדשה — נענה תוך 3 שעות בשעות
                הפעילות.
              </p>
              <Button type="button" variant="outline" onClick={() => setComposing({ subject: "" })}>
                <MessageSquarePlus className="size-4" />
                פנייה חדשה
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function NewTicketForm({
  initial,
  onCancel,
  onCreated,
}: {
  initial: SupportCompose;
  onCancel: () => void;
  onCreated: (ticket: SupportTicket) => void;
}) {
  const open = useServerFn(openSupportTicket);
  const [subject, setSubject] = useState(initial.subject);
  const [message, setMessage] = useState(initial.message ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { ticket } = await open({ data: { subject, message } });
      toast.success("הפנייה נשלחה — נחזור אליכם בהקדם");
      onCreated(ticket);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "שליחת הפנייה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">פנייה חדשה</h3>
          <p className="text-sm text-muted-foreground">
            ספרו לנו במה אפשר לעזור — כמה שיותר פרטים, כך נענה מהר יותר.
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onCancel} aria-label="ביטול">
          <X className="size-5" />
        </Button>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ticket-subject">נושא</Label>
        <Input
          id="ticket-subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          maxLength={SUBJECT_MAX}
          placeholder="למשל: הזמנות לא מגיעות למייל"
          required
          autoFocus={initial.subject === ""}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ticket-message">ההודעה</Label>
        <Textarea
          id="ticket-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={MESSAGE_MAX}
          rows={6}
          placeholder="תארו את הבקשה או את התקלה…"
          required
          autoFocus={initial.subject !== ""}
        />
        <p className="text-left text-xs text-muted-foreground" dir="ltr">
          {message.length.toLocaleString("he-IL")} / {MESSAGE_MAX.toLocaleString("he-IL")}
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3.5" aria-hidden="true" />
          {SUPPORT_HOURS_TEXT}
        </p>
        <Button
          type="submit"
          disabled={busy}
          className="bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <SendHorizontal className="size-4 -scale-x-100" />
          )}
          שליחת הפנייה
        </Button>
      </div>
    </form>
  );
}
