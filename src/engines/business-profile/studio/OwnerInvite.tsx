// מסך ההזמנה של בעלת האתר (מיגרציה 198): https://<האתר>/studio/invite#t=<טוקן>. הטוקן נקרא מה-fragment ויוצא
// מהכתובת מיד (לא נשאר בהיסטוריה). בדיקה בשרת → "ברוכה הבאה" → אימייל + סיסמה + אימות סיסמה → החשבון נפתח,
// והיא עוברת בקוד כניסה חד-פעמי לממשק הניהול של האתר הזה. אין בחירת אתר ואין בחירת הרשאות — הכול מההזמנה.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button, Card, CardContent, Input, Label } from "@/platform/ui";
import {
  INVITE_PASSWORD_MIN,
  INVITE_STATUS_MESSAGE,
  inviteCheck,
  inviteFormProblem,
  inviteRedeem,
} from "../api/owner-invite.functions";
import type { InviteCheck } from "../types";

type Phase =
  | { kind: "loading" }
  | { kind: "problem"; message: string }
  | { kind: "form"; check: InviteCheck }
  | { kind: "done"; email: string };

function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "משהו השתבש — נסו שוב";
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      id="main-content"
      dir="rtl"
      className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10"
    >
      <Card className="w-full max-w-md">
        <CardContent className="space-y-5 py-8">{children}</CardContent>
      </Card>
    </main>
  );
}

export function OwnerInvite() {
  const check = useServerFn(inviteCheck);
  const redeem = useServerFn(inviteRedeem);
  const id = useId();
  const token = useRef<string>("");
  const started = useRef(false);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.hash.slice(1));
    token.current = params.get("t") ?? "";
    // הטוקן יוצא מהכתובת מיד — לא בהיסטוריה, לא בשורת הכתובת
    window.history.replaceState(null, "", window.location.pathname);
    if (!token.current) {
      setPhase({ kind: "problem", message: INVITE_STATUS_MESSAGE.invalid });
      return;
    }
    check({ data: { token: token.current } })
      .then((r) =>
        r.status === "valid"
          ? setPhase({ kind: "form", check: r })
          : setPhase({ kind: "problem", message: INVITE_STATUS_MESSAGE[r.status] }),
      )
      .catch((e) => setPhase({ kind: "problem", message: errorText(e) }));
  }, [check]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = inviteFormProblem({ email, password, confirm });
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const r = await redeem({ data: { token: token.current, email, password, confirm } });
      setPhase({ kind: "done", email: r.email });
      // הכניסה הרגילה לממשק הניהול: קוד חד-פעמי לאתר הזה (2 דקות)
      window.location.replace(`/admin-handoff#code=${encodeURIComponent(r.handoffCode)}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  if (phase.kind === "loading")
    return (
      <Shell>
        <p className="text-center text-sm text-muted-foreground" role="status">
          בודקים את הקישור…
        </p>
      </Shell>
    );

  if (phase.kind === "problem")
    return (
      <Shell>
        <h1 className="text-center text-xl font-bold">אי אפשר להשתמש בקישור</h1>
        <p className="text-center text-sm text-muted-foreground" role="alert">
          {phase.message}
        </p>
        <Button asChild variant="outline" className="w-full">
          <a href="/studio">לכניסה לממשק הניהול</a>
        </Button>
      </Shell>
    );

  if (phase.kind === "done")
    return (
      <Shell>
        <h1 className="text-center text-xl font-bold">החשבון נפתח</h1>
        <p className="text-center text-sm text-muted-foreground" role="status">
          עוברים לממשק הניהול…
        </p>
      </Shell>
    );

  const siteName = phase.check.siteName;
  return (
    <Shell>
      <header className="space-y-2 text-center">
        {siteName && <p className="text-sm font-medium text-muted-foreground">{siteName}</p>}
        <h1 className="text-2xl font-bold">ברוכה הבאה, האתר שלך מוכן לניהול</h1>
        <p className="text-sm text-muted-foreground">
          נשאר רק לפתוח חשבון: אימייל וסיסמה. איתם נכנסים לממשק הניהול של האתר.
        </p>
      </header>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-email`}>אימייל</Label>
          <Input
            id={`${id}-email`}
            type="email"
            dir="ltr"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-password`}>סיסמה</Label>
          <Input
            id={`${id}-password`}
            type="password"
            dir="ltr"
            autoComplete="new-password"
            required
            minLength={INVITE_PASSWORD_MIN}
            aria-describedby={`${id}-password-hint`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p id={`${id}-password-hint`} className="text-xs text-muted-foreground">
            לפחות {INVITE_PASSWORD_MIN} תווים.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-confirm`}>אימות סיסמה</Label>
          <Input
            id={`${id}-confirm`}
            type="password"
            dir="ltr"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "פותחים את החשבון…" : "פתיחת החשבון וכניסה לניהול"}
        </Button>
        <p className="text-xs text-muted-foreground">
          החשבון משויך לאתר הזה בלבד, כבעלי האתר. אחרי הכניסה נבקש לאמת את כתובת המייל.
        </p>
      </form>
    </Shell>
  );
}
