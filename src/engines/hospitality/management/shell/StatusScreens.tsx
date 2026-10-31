// מסכי מצב של אזור הניהול: טעינה, אין הרשאה, תקלה
import { Loader2, RefreshCw, ShieldAlert } from "lucide-react";
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
