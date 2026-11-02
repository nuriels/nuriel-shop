// חלקים משותפים לעמודי היחידה והמתחם (Stage 2c.3): קישור חזרה, הודעה (עודכן בינתיים /
// שגיאה מהשרת), פס שמירה קבוע, שאלה לפני יציאה עם שינויים, ואישור לפעולה.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useBlocker, useRouterState } from "@tanstack/react-router";
import { ChevronRight, Info, Loader2, TriangleAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  buttonVariants,
  cn,
} from "@/platform/ui";
import { backFor } from "../lib/back";
import { ErrorState } from "../ui/kit";

export function BackLink() {
  return (
    <Link
      to="/manage/units"
      className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-medium text-primary hover:underline"
    >
      <ChevronRight className="size-4" aria-hidden="true" />
      חזרה ליחידות ומתחמים
    </Link>
  );
}

/** הודעה בראש העמוד: "עודכן בינתיים" (מידע) או שגיאה מהשרת; מקבלת פוקוס כשמופיעה */
export function PageNotice({ error, children }: { error: string | null; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const show = Boolean(error || children);
  useEffect(() => {
    if (show) ref.current?.focus();
  }, [show, error, children]);
  if (!show) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={error ? "alert" : "status"}
      data-testid="page-notice"
      className={
        error
          ? "flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          : "flex gap-2 rounded-md border border-primary/30 bg-primary/5 p-4 text-sm"
      }
    >
      {error ? (
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      ) : (
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      )}
      <div className="flex flex-col gap-1">{error ? <p>{error}</p> : children}</div>
    </div>
  );
}

/** הפס הקבוע בתחתית (מעל הניווט בטלפון): מצב, ביטול, שמירה */
export function SaveBar(props: {
  dirty: boolean;
  hasErrors: boolean;
  busy: boolean;
  disabled?: boolean;
  onReset: () => void;
}) {
  return (
    <div className="sticky bottom-[4.5rem] z-30 flex items-center gap-3 rounded-lg border bg-card/95 p-3 shadow-md backdrop-blur md:bottom-4">
      <p className="flex-1 text-sm text-muted-foreground" aria-live="polite">
        {props.hasErrors ? "יש שדות לתיקון" : props.dirty ? "יש שינויים שלא נשמרו" : "אין שינויים"}
      </p>
      <Button
        type="button"
        variant="ghost"
        className="min-h-11"
        disabled={!props.dirty || props.busy || props.disabled}
        onClick={props.onReset}
      >
        ביטול
      </Button>
      <Button
        type="submit"
        className="min-h-11 gap-2"
        disabled={!props.dirty || props.hasErrors || props.busy || props.disabled}
      >
        {props.busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        שמירה
      </Button>
    </div>
  );
}

/** יציאה מהעמוד (קישור, חזרה, סגירת הלשונית) כשיש שינויים שלא נשמרו — שואלים קודם */
export function LeaveGuard({ dirty, what }: { dirty: boolean; what: string }) {
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });
  return (
    <AlertDialog open={blocker.status === "blocked"}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>לצאת בלי לשמור?</AlertDialogTitle>
          <AlertDialogDescription>
            יש שינויים ב{what} שעוד לא נשמרו. אם תצאו, הם יימחקו.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11" onClick={() => blocker.reset?.()}>
            להישאר ולשמור
          </AlertDialogCancel>
          <AlertDialogAction className="min-h-11" onClick={() => blocker.proceed?.()}>
            לצאת בלי לשמור
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * כפתור פעולה עם אישור (השבתה, ארכיון, מחיקה). הפעולה עצמה מחזירה הבטחה; עד שהיא
 * מסתיימת הכפתור נעול.
 */
export function ConfirmButton(props: {
  label: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={props.destructive ? "destructive" : "outline"}
        className="min-h-11 w-fit gap-2"
        disabled={props.disabled || busy}
        onClick={() => setOpen(true)}
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : props.icon}
        {props.label}
      </Button>
      <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{props.title}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                {props.description}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={busy}>
              ביטול
            </AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                "min-h-11",
                props.destructive && buttonVariants({ variant: "destructive" }),
              )}
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                setBusy(true);
                void props.onConfirm().finally(() => {
                  setBusy(false);
                  setOpen(false);
                });
              }}
            >
              {props.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** תגית מצב קטנה (פעילה / לא פעילה / טיוטה / בארכיון) */
export function StatusPill({
  tone,
  children,
}: {
  tone: "ok" | "muted" | "warn";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs",
        tone === "ok" && "bg-emerald-100 text-emerald-900",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "warn" && "bg-amber-100 text-amber-900",
      )}
    >
      {children}
    </span>
  );
}

export function PageSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="h-6 w-40 animate-pulse rounded bg-muted" />
      <div className="h-10 w-64 animate-pulse rounded bg-muted" />
      <div className="h-64 w-full animate-pulse rounded bg-muted" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** מסך שלא נטען: כותרת, ההודעה מהשרת, "לנסות שוב", וחזרה למקום הנכון (רשימה / לוח הבקרה) */
export function LoadError({ error }: { error: unknown }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const back = backFor(pathname);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Link
        to={back.to}
        className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <ChevronRight className="size-4" aria-hidden="true" />
        {back.label}
      </Link>
      <h1 className="text-2xl font-bold text-[var(--hm-lagoon-900)]">המסך לא נטען</h1>
      <ErrorState
        title="הטעינה נכשלה"
        message={error instanceof Error && error.message ? error.message : "נסו שוב בעוד רגע"}
        onRetry={() => window.location.reload()}
      />
    </div>
  );
}

/** מזהה שלא קיים באתר (או שנמחק) — בלי לגלות אם הוא קיים באתר אחר */
export function NotFound({ what }: { what: "היחידה" | "המתחם" }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <BackLink />
      <h1 className="text-2xl font-semibold">
        {what} לא נמצא{what === "היחידה" ? "ה" : ""}
      </h1>
      <p className="text-muted-foreground">
        אולי {what === "היחידה" ? "היא נמחקה" : "הוא נמחק"}, או שהקישור לא נכון. אפשר לחזור לרשימה
        ולבחור משם.
      </p>
    </div>
  );
}
