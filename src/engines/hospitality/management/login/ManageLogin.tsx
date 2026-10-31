// כניסה לאזור הניהול: קוד במייל או סיסמה — אותן פונקציות קיימות של הפלטפורמה.
// בלי Google (ממצא ה-OAuth פתוח — docs/security/oauth-pkce-analysis.md).
// אחרי הכניסה, ההרשאה נבדקת במסד; חשבון בלי הרשאה רואה "אין גישה".
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
import { manageKeys } from "../lib/query-keys";

const errorText = (error: unknown) =>
  error instanceof Error && error.message ? error.message : "הכניסה נכשלה. נסו שוב.";

export function ManageLogin() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const enter = async (tokens: { accessToken: string; refreshToken: string }) => {
    await applyServerSession(tokens.accessToken, tokens.refreshToken);
    await queryClient.invalidateQueries({ queryKey: manageKeys.all });
    toast.success("נכנסתם לניהול העסק");
    await navigate({ to: "/manage", replace: true });
  };

  return (
    <main
      id="main-content"
      className="flex min-h-dvh items-start justify-center bg-background px-4 py-10 md:items-center"
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1 className="text-2xl font-semibold">כניסה לניהול העסק</h1>
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
