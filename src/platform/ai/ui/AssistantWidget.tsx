/**
 * NURIEL AI ASSISTANT — חלון העוזר הצף של מנהל העסק (משותף לשני המוצרים; כל מוצר מעביר את הקטלוג שלו
 * ואת פונקציות השרת שלו). כל טקסט שמוצג כאן נכתב מראש: המדריכים מהקטלוג, וההודעות הקבועות שהשרת
 * מחזיר. הדגם רק בוחר מזהה מדריך מהרשימה הסגורה.
 *
 * ההסתרה כאן היא נוחות בלבד: ההרשאה, הזכאות (חבילה בתוקף) והמגבלות נבדקות בשרת בכל שאלה. הזמינות
 * נבדקת בפתיחה, בחזרה ללשונית, כל כמה דקות, ובכפתור "בדיקה מחדש"; תקלה ברשת מוצגת כתקלה — לא כ"כבוי"
 * (לקח מהעוזר של קובי), והשיחה לא נמחקת בגללה. השיחה נשמרת רק בזיכרון הדף — לא בדפדפן.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  BookOpen,
  Loader2,
  RefreshCw,
  SendHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/platform/ui";
import { cn } from "@/platform/ui";
import { guideById, splitGuideText, type Guide, type GuideCatalog } from "../guides/types";
import {
  CONNECTION_FAILED_MESSAGE,
  PRIVACY_HINT,
  formatIsraeliDate,
  formatShekels,
  type AskResult,
  type AssistantStatusView,
} from "../logic";

type VisibleStatus = Extract<AssistantStatusView, { visible: true }>;

type ChatItem =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; result: AskResult }
  | { id: number; role: "error"; text: string };

export type AssistantWidgetProps = {
  catalog: GuideCatalog;
  fetchStatus: () => Promise<AssistantStatusView>;
  ask: (input: { question: string; previous: string[] }) => Promise<AskResult>;
  /** מעבר למסך שבמדריך (נתיב פנימי, מתחיל ב-pathPrefix של הקטלוג) */
  navigate: (path: string) => void;
  /** המסך שבו פונים לצוות NURIEL (תמיכה) — לחידוש / הפעלה */
  supportPath: string;
  /** מיקום הכפתור הצף (מחלקות Tailwind) */
  buttonClassName?: string;
  panelClassName?: string;
};

const RECHECK_MS = 5 * 60 * 1000;

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : CONNECTION_FAILED_MESSAGE;
}

function StepText({
  text,
  onGuide,
  guides,
}: {
  text: string;
  onGuide: (id: string) => void;
  guides: ReadonlyMap<string, Guide>;
}) {
  return (
    <>
      {splitGuideText(text).map((part, index) => {
        if (part.kind === "label") {
          return (
            <strong
              key={index}
              className="rounded bg-secondary px-0.5 font-semibold text-foreground"
            >
              {part.value}
            </strong>
          );
        }
        if (part.kind === "guide") {
          const target = guides.get(part.value);
          if (!target) return null;
          return (
            <button
              key={index}
              type="button"
              onClick={() => onGuide(part.value)}
              className="font-semibold text-primary underline underline-offset-2"
            >
              {target.title}
            </button>
          );
        }
        return <span key={index}>{part.value}</span>;
      })}
    </>
  );
}

function GuideChip({ guide, onOpen }: { guide: Guide; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(guide.id)}
      className="w-full rounded-lg border bg-card px-3 py-2 text-start text-sm transition-colors hover:border-primary/50 hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      data-guide-id={guide.id}
    >
      <span className="flex items-center gap-2 font-semibold">
        <BookOpen className="size-4 shrink-0 text-primary" aria-hidden="true" />
        {guide.title}
      </span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{guide.summary}</span>
    </button>
  );
}

function GuideView({
  guide,
  guides,
  onBack,
  onGuide,
  onGo,
}: {
  guide: Guide;
  guides: ReadonlyMap<string, Guide>;
  onBack: () => void;
  onGuide: (id: string) => void;
  onGo: (path: string) => void;
}) {
  return (
    <section aria-label={guide.title} className="space-y-3" data-testid="ai-guide">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowRight className="size-4" aria-hidden="true" />
        חזרה לשיחה
      </button>
      <h3 className="text-base font-bold leading-snug">{guide.title}</h3>
      <p className="text-sm text-muted-foreground">{guide.summary}</p>
      <ol className="space-y-2.5">
        {guide.steps.map((step, index) => (
          <li key={index} className="flex gap-2 text-sm leading-relaxed">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <StepText text={step.text} guides={guides} onGuide={onGuide} />
              {step.go && (
                <div>
                  <button
                    type="button"
                    onClick={() => onGo(step.go as string)}
                    className="mt-1 text-xs font-semibold text-primary underline underline-offset-2"
                  >
                    פתיחת המסך
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      {guide.tip && (
        <p className="rounded-lg bg-secondary px-3 py-2 text-sm">
          <StepText text={guide.tip} guides={guides} onGuide={onGuide} />
        </p>
      )}
    </section>
  );
}

function Answer({
  result,
  guides,
  onOpen,
}: {
  result: AskResult;
  guides: ReadonlyMap<string, Guide>;
  onOpen: (id: string) => void;
}) {
  const chosen = result.guideIds
    .map((id) => guides.get(id))
    .filter((g): g is Guide => g !== undefined);
  const suggestions = result.suggestions
    .map((id) => guides.get(id))
    .filter((g): g is Guide => g !== undefined);
  return (
    <div className="space-y-2" data-answer-kind={result.kind}>
      {result.message && <p className="text-sm leading-relaxed">{result.message}</p>}
      {chosen.length > 0 && (
        <>
          <p className="text-sm">אלה המדריכים שמתאימים לשאלה:</p>
          {chosen.map((guide) => (
            <GuideChip key={guide.id} guide={guide} onOpen={onOpen} />
          ))}
        </>
      )}
      {suggestions.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">אולי התכוונתם:</p>
          {suggestions.map((guide) => (
            <GuideChip key={guide.id} guide={guide} onOpen={onOpen} />
          ))}
        </>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: VisibleStatus }) {
  const [label, tone] = status.testMode
    ? ["מצב בדיקה", "bg-amber-100 text-amber-900"]
    : status.available
      ? status.notice
        ? ["עומד להסתיים", "bg-amber-100 text-amber-900"]
        : ["זמין", "bg-emerald-100 text-emerald-900"]
      : ["לא זמין", "bg-muted text-muted-foreground"];
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", tone)}>{label}</span>
  );
}

export function AssistantWidget({
  catalog,
  fetchStatus,
  ask,
  navigate,
  supportPath,
  buttonClassName,
  panelClassName,
}: AssistantWidgetProps) {
  const guides = useRef(guideById(catalog)).current;
  const [status, setStatus] = useState<VisibleStatus | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [guideId, setGuideId] = useState<string | null>(null);
  const nextId = useRef(1);
  const inputId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      const next = await fetchStatus();
      setCheckFailed(false);
      setStatus(next.visible ? next : null);
    } catch {
      // תקלה ברשת / בשרת — לא "כבוי": משאירים את מה שהיה ומציעים לבדוק שוב
      setCheckFailed(true);
    } finally {
      setChecking(false);
    }
  }, [fetchStatus]);

  useEffect(() => {
    void recheck();
    const onFocus = () => {
      if (document.visibilityState === "visible") void recheck();
    };
    document.addEventListener("visibilitychange", onFocus);
    const timer = window.setInterval(() => void recheck(), RECHECK_MS);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.clearInterval(timer);
    };
  }, [recheck]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.querySelector<HTMLElement>("textarea, button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!status) return null;

  // הודעה עדינה בפאנל (ליד הכפתור): החבילה מסתיימת בקרוב / הסתיימה. נסגרת עד סוף הביקור (בדפדפן הזה
  // בלבד — נוחות; המצב עצמו תמיד מהשרת)
  const bubble = status.notice ?? (status.code === "subscription_expired" ? status.message : null);
  const bubbleKey = `nuriel-ai-notice:${catalog.product}:${status.code ?? "notice"}:${status.endsOn ?? ""}`;
  const bubbleHidden = (() => {
    if (noticeDismissed) return true;
    try {
      return window.sessionStorage.getItem(bubbleKey) === "1";
    } catch {
      return false;
    }
  })();
  const dismissBubble = () => {
    setNoticeDismissed(true);
    try {
      window.sessionStorage.setItem(bubbleKey, "1");
    } catch {
      // בלי אחסון — נסגר רק עד הטעינה הבאה
    }
  };

  const activeGuide = guideId ? guides.get(guideId) : undefined;
  const max = status.maxQuestionChars;
  const previous = items
    .filter((item): item is Extract<ChatItem, { role: "user" }> => item.role === "user")
    .map((item) => item.text)
    .slice(-3);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = question.replace(/\s+/g, " ").trim();
    if (text.length < 2 || sending) return;
    setSending(true);
    setQuestion("");
    const userItem: ChatItem = { id: nextId.current++, role: "user", text };
    setItems((list) => [...list, userItem]);
    try {
      const result = await ask({ question: text, previous });
      setItems((list) => [...list, { id: nextId.current++, role: "assistant", result }]);
      // החבילה פגה / הושבתה באמצע — מרעננים את המצב (השרת כבר עצר)
      if (result.kind === "unavailable") void recheck();
    } catch (error) {
      setItems((list) => [
        ...list,
        { id: nextId.current++, role: "error", text: errorText(error) },
      ]);
    } finally {
      setSending(false);
    }
  };

  const go = (path: string) => {
    if (!path.startsWith(catalog.pathPrefix)) return;
    navigate(path);
  };

  const unavailable: ReactNode = (
    <div className="space-y-3" data-testid="ai-unavailable" data-code={status.code ?? ""}>
      <p className="text-sm leading-relaxed">{status.message}</p>
      {(status.code === "subscription_expired" || status.code === "no_subscription") &&
        status.renewalPriceAgorot !== null && (
          <p className="text-sm font-semibold">
            מחיר החידוש: {formatShekels(status.renewalPriceAgorot)} לשנה
          </p>
        )}
      <div className="flex flex-wrap gap-2">
        {(status.code === "subscription_expired" ||
          status.code === "no_subscription" ||
          status.code === "subscription_suspended") && (
          <Button size="sm" onClick={() => go(supportPath)}>
            פנייה לצוות NURIEL לחידוש
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => void recheck()} disabled={checking}>
          {checking ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-4" aria-hidden="true" />
          )}
          בדיקה מחדש
        </Button>
      </div>
    </div>
  );

  return (
    <div className="print:hidden" data-ai-assistant={catalog.product}>
      {!open && (
        <div
          className={cn(
            "fixed z-50 flex max-w-[min(20rem,calc(100vw-2rem))] flex-col items-start gap-2",
            buttonClassName ?? "bottom-4 left-4",
          )}
        >
          {bubble && !bubbleHidden && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-950 shadow-md"
              data-testid="ai-bubble"
            >
              <span>{bubble}</span>
              <button
                type="button"
                onClick={dismissBubble}
                className="grid size-5 shrink-0 place-items-center rounded-full hover:bg-amber-100"
                aria-label="סגירת ההודעה"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={false}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            data-testid="ai-open"
          >
            <Sparkles className="size-4" aria-hidden="true" />
            NURIEL AI
            {(status.notice || !status.available) && (
              <span className="size-2 rounded-full bg-amber-400" aria-hidden="true" />
            )}
          </button>
        </div>
      )}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label={status.assistantName}
          className={cn(
            "fixed z-50 flex max-h-[min(640px,calc(100dvh-2rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-background text-foreground shadow-2xl",
            panelClassName ?? "bottom-4 left-4",
          )}
          data-testid="ai-panel"
        >
          <header className="flex items-center justify-between gap-2 border-b bg-card px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <Sparkles className="size-5 shrink-0 text-primary" aria-hidden="true" />
              <h2 className="truncate text-sm font-bold" dir="ltr">
                {status.assistantName}
              </h2>
              <StatusChip status={status} />
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
              }}
              className="grid size-8 place-items-center rounded-full hover:bg-secondary"
              aria-label="סגירת חלון העוזר"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
            {checkFailed && (
              <div
                className="flex items-center justify-between gap-2 rounded-lg bg-secondary px-3 py-2 text-sm"
                role="status"
              >
                <span>{CONNECTION_FAILED_MESSAGE}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void recheck()}
                  disabled={checking}
                >
                  בדיקה מחדש
                </Button>
              </div>
            )}
            {!status.available ? (
              unavailable
            ) : activeGuide ? (
              <GuideView
                guide={activeGuide}
                guides={guides}
                onBack={() => setGuideId(null)}
                onGuide={setGuideId}
                onGo={go}
              />
            ) : (
              <>
                {status.notice && (
                  <p
                    className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
                    data-testid="ai-notice"
                  >
                    {status.notice}
                  </p>
                )}
                {status.testMode && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-950">
                    מצב בדיקה: העוזר פתוח כרגע רק למנהל העל.
                  </p>
                )}
                {items.length === 0 && (
                  <div className="space-y-2">
                    <p className="text-sm">
                      שלום! אפשר לשאול איך עושים משהו במערכת, ואציג את המדריך המתאים.
                    </p>
                    <p className="text-xs text-muted-foreground">נפוצים:</p>
                    {catalog.popular.map((id) => {
                      const guide = guides.get(id);
                      return guide ? (
                        <GuideChip key={id} guide={guide} onOpen={setGuideId} />
                      ) : null;
                    })}
                  </div>
                )}
                {items.map((item) =>
                  item.role === "user" ? (
                    <p
                      key={item.id}
                      className="ms-8 rounded-2xl rounded-ee-sm bg-primary/10 px-3 py-2 text-sm"
                    >
                      {item.text}
                    </p>
                  ) : item.role === "assistant" ? (
                    <div key={item.id} className="me-4">
                      <Answer result={item.result} guides={guides} onOpen={setGuideId} />
                    </div>
                  ) : (
                    <p
                      key={item.id}
                      className="me-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                      role="alert"
                    >
                      {item.text}
                    </p>
                  ),
                )}
                {sending && (
                  <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    מחפש מדריך מתאים…
                  </p>
                )}
              </>
            )}
          </div>

          {status.available && !activeGuide && (
            <form onSubmit={submit} className="space-y-1.5 border-t bg-card px-3 py-2.5">
              <label htmlFor={inputId} className="sr-only">
                השאלה שלך
              </label>
              <div className="flex items-end gap-2">
                <textarea
                  id={inputId}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value.slice(0, max))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  rows={2}
                  maxLength={max}
                  placeholder="למשל: איך מוסיפים…"
                  className="min-h-[2.75rem] flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-primary"
                  data-testid="ai-question"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={sending || question.trim().length < 2}
                  aria-label="שליחת השאלה"
                >
                  {sending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <SendHorizontal className="size-4 rtl:-scale-x-100" aria-hidden="true" />
                  )}
                </Button>
              </div>
              <div className="flex justify-between gap-2 text-[11px] text-muted-foreground">
                <span>{PRIVACY_HINT}</span>
                <span dir="ltr">
                  {question.length}/{max}
                </span>
              </div>
            </form>
          )}
          {status.endsOn && status.available && (
            <p className="border-t bg-card px-4 py-1.5 text-[11px] text-muted-foreground">
              החבילה בתוקף עד {formatIsraeliDate(status.endsOn)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
