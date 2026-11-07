// כניסה לאזור הניהול: קוד במייל או סיסמה — אותן פונקציות קיימות של הפלטפורמה.
// בלי Google (ממצא ה-OAuth פתוח — docs/security/oauth-pkce-analysis.md).
// אחרי הכניסה, ההרשאה נבדקת במסד; חשבון בלי הרשאה רואה "אין גישה".
// שלב F4: מסך מותג (צד כהה במחשב, כותרת קטנה בטלפון) — אותם שדות, לשוניות וטקסטים.
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { applyServerSession } from "@/platform/auth/browser-session";
import { loginWithIdentifier, requestLoginCode, verifyLoginCode } from "@/platform/auth/login";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/platform/ui";
import { hospitalityManagementContext } from "../../api/management.functions";
import { manageKeys } from "../lib/query-keys";

const errorText = (error: unknown) =>
  error instanceof Error && error.message ? error.message : "הכניסה נכשלה. נסו שוב.";

export function ManageLogin() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const enter = async (tokens: { accessToken: string; refreshToken: string }) => {
    await applyServerSession(tokens.accessToken, tokens.refreshToken);
    // A3: התשובה "לא מחובר" מהביקור הקודם ב-/manage נשארת במטמון (invalidate לא מוחק אותה), והמעטפת
    // הציגה אותה מיד והחזירה לכאן — "נכנסתם" ונשארים במסך הכניסה. לכן: מוחקים את המטמון של אזור
    // הניהול, בודקים בשרת עם החיבור החדש, ורק אז עוברים.
    queryClient.removeQueries({ queryKey: manageKeys.all });
    const access = await queryClient.fetchQuery({
      queryKey: manageKeys.context,
      queryFn: () => hospitalityManagementContext(),
      staleTime: 0,
    });
    if (access.state === "signed_out") {
      // הקוד / הסיסמה אומתו, אבל השרת לא מזהה את החיבור — לא עוברים (אחרת לולאה) ומסבירים
      throw new Error(
        "הפרטים אומתו, אבל החיבור לא נשמר בדפדפן. רעננו את הדף ונסו שוב. אם זה חוזר — נסו דפדפן אחר או אפשרו שמירת נתוני אתרים.",
      );
    }
    toast.success("נכנסתם לניהול העסק");
    await navigate({ to: "/manage", replace: true });
  };

  return (
    <main
      id="main-content"
      className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]"
    >
      {/* שלב F4: צד המותג (מחשב) — "Deep Lagoon & Champagne" */}
      <div className="relative hidden overflow-hidden bg-[var(--hm-lagoon-900)] text-[var(--hm-sidebar-text)] lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -start-40 -top-40 size-[34rem] rounded-full bg-[radial-gradient(closest-side,rgb(216_184_122/0.22),transparent)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-48 -end-32 size-[30rem] rounded-full bg-[radial-gradient(closest-side,rgb(31_111_107/0.45),transparent)]"
        />
        <p className="relative flex items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex size-10 items-center justify-center rounded-xl bg-[var(--hm-champagne-500)] font-display text-xl font-bold text-[var(--hm-lagoon-900)]"
          >
            N
          </span>
          <span className="leading-tight">
            <span className="block font-bold text-white" dir="ltr">
              Nuriel Hospitality
            </span>
            <span className="block text-sm text-[var(--hm-sidebar-muted)]">מבית נוריאל מחשבים</span>
          </span>
        </p>
        <div className="relative max-w-md">
          <p className="font-display text-[2.6rem] leading-tight text-white">
            כל מקום האירוח שלכם — במקום אחד.
          </p>
          <ul className="mt-8 flex flex-col gap-3 text-[15px]">
            {[
              "הזמנות, יומן ותפוסה — כולל Airbnb ו-Booking",
              "אתר הזמנות משלכם, בעברית ובנגישות מלאה",
              "תמונה ברורה של העסק בכל בוקר",
            ].map((line) => (
              <li key={line} className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full bg-[var(--hm-champagne-500)]"
                />
                {line}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-[var(--hm-sidebar-muted)]">
          החיבור מאובטח. אחרי הכניסה ההרשאות נבדקות בשרת.
        </p>
      </div>

      <div className="flex items-start justify-center px-4 py-10 md:items-center">
        <div className="w-full max-w-md">
          <p className="mb-6 flex items-center justify-center gap-2.5 lg:hidden">
            <span
              aria-hidden="true"
              className="inline-flex size-9 items-center justify-center rounded-xl bg-[var(--hm-lagoon-900)] font-display text-lg font-bold text-[var(--hm-champagne-500)]"
            >
              N
            </span>
            <span className="font-bold text-[var(--hm-lagoon-900)]" dir="ltr">
              Nuriel Hospitality
            </span>
          </p>
          <Card className="w-full rounded-2xl shadow-[var(--hm-shadow-lift)]">
            <CardHeader>
              <CardTitle>
                <h1 className="text-[1.6rem] font-bold text-[var(--hm-lagoon-900)]">
                  כניסה לניהול העסק
                </h1>
              </CardTitle>
              <CardDescription>לבעלי העסק ולמנהלים שקיבלו הרשאה.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="code" dir="rtl">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="code" className="min-h-10">
                    קוד למייל
                  </TabsTrigger>
                  <TabsTrigger value="password" className="min-h-10">
                    סיסמה
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="code" className="pt-4">
                  <CodeLogin onTokens={enter} />
                </TabsContent>
                <TabsContent value="password" className="pt-4">
                  <PasswordLogin onTokens={enter} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

type Tokens = { accessToken: string; refreshToken: string };

function CodeLogin({ onTokens }: { onTokens: (t: Tokens) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await requestLoginCode({ data: { email } });
      setSentTo(result.maskedEmail);
      setCode("");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onTokens(await verifyLoginCode({ data: { email, code } }));
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  if (!sentTo) {
    return (
      <form onSubmit={send} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="manage-email">אימייל</Label>
          <Input
            id="manage-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-h-11 text-start"
          />
        </div>
        <Button type="submit" disabled={busy || email.trim() === ""} className="min-h-11">
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          שליחת קוד
        </Button>
      </form>
    );
  }
  return (
    <form onSubmit={verify} className="flex flex-col gap-4" noValidate>
      <p className="text-sm" role="status">
        שלחנו קוד בן 6 ספרות אל <span dir="ltr">{sentTo}</span>.
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="manage-code">הקוד מהמייל</Label>
        <Input
          id="manage-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          dir="ltr"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className="min-h-11 text-center text-lg tracking-[0.4em]"
        />
      </div>
      <Button type="submit" disabled={busy || code.length !== 6} className="min-h-11">
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        כניסה
      </Button>
      <Button type="button" variant="ghost" className="min-h-11" onClick={() => setSentTo(null)}>
        שינוי כתובת או שליחה מחדש
      </Button>
    </form>
  );
}

function PasswordLogin({ onTokens }: { onTokens: (t: Tokens) => Promise<void> }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onTokens(await loginWithIdentifier({ data: { identifier, password } }));
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="manage-identifier">אימייל או שם משתמש</Label>
        <Input
          id="manage-identifier"
          autoComplete="username"
          dir="ltr"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          className="min-h-11 text-start"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="manage-password">סיסמה</Label>
        <Input
          id="manage-password"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="min-h-11 text-start"
        />
      </div>
      <Button
        type="submit"
        disabled={busy || identifier.trim() === "" || password === ""}
        className="min-h-11"
      >
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        כניסה
      </Button>
    </form>
  );
}
