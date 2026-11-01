// מסכי מצב של אזור הניהול: טעינה, אין הרשאה, תקלה; ובתוך המעטפת (F2b) — מסך שנשבר, ומסך שלא נמצא
import { Link, useRouter } from "@tanstack/react-router";
import { Compass, Loader2, RefreshCw, ShieldAlert, TriangleAlert } from "lucide-react";
import { Button, Card, CardContent } from "@/platform/ui";

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main
      id="main-content"
      className="flex min-h-dvh items-center justify-center bg-background px-4 py-10"
    >
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          {children}
        </CardContent>
      </Card>
    </main>
  );
}

export function LoadingScreen() {
  return (
    <main
      id="main-content"
      className="flex min-h-dvh items-center justify-center bg-background"
      aria-busy="true"
    >
      <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">טוען את אזור הניהול…</span>
    </main>
  );
}

export function ForbiddenScreen({
  message,
  onSignOut,
}: {
  message: string;
  onSignOut: () => void;
}) {
  return (
    <Centered>
      <ShieldAlert className="size-10 text-destructive" aria-hidden="true" />
      <h1 className="text-xl font-semibold">אין גישה לניהול העסק הזה</h1>
      <p className="text-muted-foreground">{message}</p>
      <p className="text-sm text-muted-foreground">
        אם אתם הבעלים או מנהלים של העסק, התחברו עם החשבון שקיבל הרשאה.
      </p>
      <Button onClick={onSignOut} className="min-h-11 w-full">
        התחברות עם חשבון אחר
      </Button>
    </Centered>
  );
}

export function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Centered>
      <h1 className="text-xl font-semibold">משהו השתבש</h1>
      <p className="text-muted-foreground">{message}</p>
      <Button onClick={onRetry} className="min-h-11 w-full gap-2">
        <RefreshCw className="size-4" aria-hidden="true" />
        לנסות שוב
      </Button>
    </Centered>
  );
}

// ---------- בתוך המעטפת (שלב F2b) ----------

/** מסך שנשבר — בתוך המעטפת: הניווט נשאר, אפשר לנסות שוב או לחזור ללוח הבקרה */
export function ManageRouteError({ error, reset }: { error: unknown; reset: () => void }) {
  const router = useRouter();
  if (typeof console !== "undefined") console.error(error);
  return (
    <div
      role="alert"
      className="mx-auto mt-6 flex max-w-lg flex-col items-center gap-3 rounded-2xl border bg-card px-6 py-10 text-center shadow-[var(--hm-shadow-card)]"
    >
      <span
        aria-hidden="true"
        className="inline-flex size-12 items-center justify-center rounded-2xl bg-[var(--hm-danger-bg)] text-[var(--hm-danger)]"
      >
        <TriangleAlert className="size-6" strokeWidth={1.8} />
      </span>
      <h1 className="text-xl font-bold">המסך הזה לא נטען</h1>
      <p className="text-sm text-muted-foreground">
        משהו השתבש בהצגת המסך. שום נתון לא נמחק — אפשר לנסות שוב, ואם זה חוזר, לפנות אלינו.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Button
          className="min-h-11 gap-2"
          onClick={() => {
            reset();
            void router.invalidate();
          }}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          לנסות שוב
        </Button>
        <Link
          to="/manage"
          className="inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted"
        >
          ללוח הבקרה
        </Link>
      </div>
    </div>
  );
}

/** כתובת לא מוכרת בתוך /manage — בעברית ובתוך המעטפת */
export function ManageNotFound() {
  return (
    <div className="mx-auto mt-6 flex max-w-lg flex-col items-center gap-3 rounded-2xl border bg-card px-6 py-10 text-center shadow-[var(--hm-shadow-card)]">
      <span
        aria-hidden="true"
        className="inline-flex size-12 items-center justify-center rounded-2xl bg-[var(--hm-lagoon-100)] text-[var(--hm-lagoon-700)]"
      >
        <Compass className="size-6" strokeWidth={1.8} />
      </span>
      <h1 className="text-xl font-bold">המסך לא נמצא</h1>
      <p className="text-sm text-muted-foreground">
        ייתכן שהקישור ישן או שהמסך הועבר. אפשר לחזור ללוח הבקרה או לחפש מסך (Ctrl+K).
      </p>
      <Link
        to="/manage"
        className="mt-2 inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground"
      >
        ללוח הבקרה
      </Link>
    </div>
  );
}
