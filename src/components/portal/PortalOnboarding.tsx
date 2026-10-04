import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  Loader2,
  LockKeyhole,
  LogOut,
  Mail,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Store,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { GoogleSignInButton, OrDivider } from "@/components/GoogleSignInButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OtpCodeInput } from "@/components/OtpCodeInput";
import {
  checkPortalSlug,
  createPortalStore,
  enterPortalStore,
  getPortalAccount,
  getPortalStoreStatus,
  requestPortalCode,
  verifyPortalCode,
  portalFromGoogle,
} from "@/lib/portal.functions";
import {
  cleanSlugInput,
  slugFormatProblem,
  STORE_NAME_MAX,
  storeNameProblem,
  suggestSlug,
  type PortalAccount,
  type PortalStore,
} from "@/lib/portal";

/**
 * תהליך הכניסה בשער הפלטפורמה (חלק 12), בחלון אחד:
 *   אימייל → קוד בן 6 ספרות → החנויות שלכם (לחיצה = כניסה לניהול)
 *                            ↘ אין חנות: "צור את החנות שלך" (שם + כתובת)
 *                              → מכינים את הכתובת (SSL) → ישר לניהול החנות.
 * האימות נשמר בלשונית (sessionStorage) כאסימון חתום מהשרת — רענון העמוד
 * לא מחייב קוד חדש; הוא פג אחרי שעה.
 */

type Step = "email" | "code" | "loading" | "stores" | "create" | "preparing";

type PortalSession = { token: string; email: string };

/** הדגל בכתובת החזרה מ-Google — השער יודע להשלים את הכניסה */
const PORTAL_GOOGLE_FLAG = "portal_google";

const SESSION_KEY = "nuriel-portal-session";
/** כמה זמן מחכים לתעודת ה-SSL לפני שמציעים "להיכנס בכל זאת" */
const SSL_PATIENCE_MS = 150_000;
const SSL_POLL_MS = 4_000;

function loadSession(): PortalSession | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PortalSession>;
    return typeof parsed.token === "string" && typeof parsed.email === "string"
      ? { token: parsed.token, email: parsed.email }
      : null;
  } catch {
    return null;
  }
}

function saveSession(session: PortalSession | null) {
  try {
    if (session) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // בלי sessionStorage (גלישה פרטית חסומה) — האימות פשוט לא נשמר ברענון
  }
}

const errorText = (thrown: unknown, fallback: string) =>
  thrown instanceof Error && thrown.message ? thrown.message : fallback;

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function PortalOnboarding({
  open,
  onOpenChange,
  baseDomain,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** nuri1.fit — לתצוגת הכתובת של החנות החדשה */
  baseDomain: string;
}) {
  const [step, setStep] = useState<Step>("email");
  // האימייל נשמר כאן (לא בשלב עצמו) — סגירה ופתיחה של החלון לא מוחקות אותו
  const [email, setEmail] = useState("");
  const [session, setSession] = useState<PortalSession | null>(null);
  const [account, setAccount] = useState<PortalAccount | null>(null);
  const [newStore, setNewStore] = useState<PortalStore | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // בדרך לאתר החנות (קוד כניסה נוצר, הדפדפן עובר) — לא סוגרים את החלון
  const [leaving, setLeaving] = useState(false);
  // מרנדר מחדש את השלבים (חזרה עם "אחורה" מאתר החנות)
  const [resetKey, setResetKey] = useState(0);
  const loadAccountFn = useServerFn(getPortalAccount);

  /** אימות שמור בלשונית → החנויות (או פתיחת חנות), עם רשימה עדכנית מהשרת */
  const resume = useCallback(
    (saved: PortalSession) => {
      setSession(saved);
      setEmail(saved.email);
      setStep("loading");
      loadAccountFn({ data: { token: saved.token } })
        .then((result) => {
          setAccount(result.account);
          setStep(
            result.account.stores.length > 0 || !result.account.canCreate ? "stores" : "create",
          );
        })
        .catch((thrown: unknown) => {
          saveSession(null);
          setSession(null);
          setNotice(errorText(thrown, "פג תוקף הכניסה. הזינו שוב את האימייל."));
          setStep("email");
        });
    },
    [loadAccountFn],
  );

  // "התחברות עם מייל אחר"
  const signOut = useCallback(() => {
    saveSession(null);
    setSession(null);
    setAccount(null);
    setNewStore(null);
    setEmail("");
    setNotice(null);
    setStep("email");
  }, []);

  // פתיחת החלון: אימות קודם בלשונית הזו → ישר לחנויות
  useEffect(() => {
    if (!open) return;
    setNotice(null);
    if (step !== "email") return;
    const saved = loadSession();
    if (saved) resume(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- רק בפתיחת החלון
  }, [open]);

  // חזרה עם "אחורה" מאתר החנות (הדף משוחזר מהמטמון של הדפדפן): לא נשארים
  // "בדרך לחנות" — חוזרים לרשימה העדכנית (כולל חנות שנפתחה הרגע), בלי
  // להיכנס שוב אוטומטית
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setLeaving(false);
      setNewStore(null);
      setResetKey((key) => key + 1);
      const saved = loadSession();
      if (saved) resume(saved);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [resume]);

  const onVerified = (next: PortalSession, nextAccount: PortalAccount) => {
    saveSession(next);
    setSession(next);
    setEmail(next.email);
    setAccount(nextAccount);
    setStep(nextAccount.stores.length > 0 || !nextAccount.canCreate ? "stores" : "create");
  };

  // חזרה מ-Google (?portal_google=1): Google אימת את המייל — מקבלים אסימון
  // שער מהשרת (בלי שום מייל), ומתנתקים מהחיבור שנפתח באתר הזה (השער לא
  // משאיר אתכם "מחוברים" כלקוח של nuriel-app2)
  const googleFn = useServerFn(portalFromGoogle);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get(PORTAL_GOOGLE_FLAG) !== "1") return;
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const oauthError = params.get("error") ?? hash.get("error");
    window.history.replaceState(window.history.state, "", "/");
    onOpenChange(true);
    if (oauthError) {
      setNotice(
        oauthError === "access_denied"
          ? "ההתחברות עם Google בוטלה."
          : "לא הצלחנו להשלים את ההתחברות עם Google. נסו שוב, או קבלו קוד למייל.",
      );
      return;
    }
    setStep("loading");
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error("ההתחברות עם Google לא הושלמה. נסו שוב.");
        const result = await googleFn({ data: { accessToken: data.session.access_token } });
        onVerified({ token: result.token, email: result.email }, result.account);
        toast.success("התחברת עם Google");
      } catch (thrown) {
        setNotice(errorText(thrown, "ההתחברות עם Google נכשלה. נסו שוב, או קבלו קוד למייל."));
        setStep("email");
      } finally {
        await supabase.auth.signOut({ scope: "local" });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- פעם אחת, בחזרה מ-Google
  }, []);

  const busyStep = step === "preparing" || leaving;

  const titles: Record<Step, { title: string; description: string }> = {
    email: {
      title: "כניסה או פתיחת חנות",
      description: "הכי מהיר — עם חשבון Google. אפשר גם עם קוד חד-פעמי למייל. בלי סיסמאות.",
    },
    code: { title: "בדקו את המייל", description: "הזינו את הקוד בן 6 הספרות ששלחנו אליכם." },
    loading: { title: "רק רגע…", description: "טוענים את החנויות שלכם." },
    stores: {
      title: account && account.stores.length > 0 ? "החנויות שלך" : "אי אפשר לפתוח חנות",
      description:
        account && account.stores.length > 0
          ? "בחרו חנות כדי להיכנס ישר לפאנל הניהול שלה."
          : "כתובת המייל הזו כבר משויכת לחנות אחרת במערכת.",
    },
    create: {
      title: "צור את החנות שלך",
      description: "שם לחנות וכתובת באנגלית — וזהו. את כל השאר משלימים בפאנל הניהול.",
    },
    preparing: { title: "מקימים את החנות…", description: "עוד כמה שניות והחנות שלכם באוויר." },
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // באמצע הקמה / מעבר לחנות — לא סוגרים בטעות
        if (!next && busyStep) return;
        // החלון נסגר באמצע הקוד — בפתיחה הבאה מתחילים מהאימייל (שנשמר)
        if (!next && step === "code") setStep("email");
        onOpenChange(next);
      }}
    >
      <DialogContent
        dir="rtl"
        // כפתור הסגירה (X) — בצד שמאל של הכותרת הכהה (בעברית הכותרת מימין)
        className="max-h-[92vh] w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl p-0 focus:outline-none sm:max-w-md sm:rounded-2xl [&>button:last-child]:left-4 [&>button:last-child]:right-auto [&>button:last-child]:text-primary-foreground"
        onInteractOutside={(event) => {
          if (busyStep) event.preventDefault();
        }}
      >
        <div className="bg-gradient-to-l from-primary to-primary/85 px-6 pb-5 pt-7 text-primary-foreground sm:rounded-t-2xl">
          <DialogHeader className="space-y-1.5 text-right sm:text-right">
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              {step === "create" ? (
                <Sparkles className="size-5 text-accent" aria-hidden="true" />
              ) : step === "stores" ? (
                <Store className="size-5 text-accent" aria-hidden="true" />
              ) : (
                <LockKeyhole className="size-5 text-accent" aria-hidden="true" />
              )}
              {titles[step].title}
            </DialogTitle>
            <DialogDescription className="text-sm text-primary-foreground/80">
              {titles[step].description}
            </DialogDescription>
          </DialogHeader>
          <StepDots step={step} />
        </div>

        <div key={resetKey} className="px-6 pb-6 pt-5">
          {notice && (
            <p
              role="status"
              className="mb-4 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-foreground"
            >
              {notice}
            </p>
          )}

          {(step === "email" || step === "code") && (
            <CodeStep
              step={step}
              setStep={setStep}
              email={email}
              onEmailChange={setEmail}
              onVerified={onVerified}
            />
          )}

          {step === "loading" && (
            <div className="flex justify-center py-10">
              <Loader2 className="size-7 animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          )}

          {step === "stores" && session && account && (
            <StoresStep
              session={session}
              account={account}
              onSignOut={signOut}
              onCreate={() => setStep("create")}
              onLeaving={setLeaving}
            />
          )}

          {step === "create" && session && account && (
            <CreateStep
              session={session}
              baseDomain={baseDomain}
              canGoBack={account.stores.length > 0}
              onBack={() => setStep("stores")}
              onSignOut={signOut}
              onCreated={(store) => {
                setNewStore(store);
                setStep("preparing");
              }}
            />
          )}

          {step === "preparing" && session && newStore && (
            <PreparingStep
              session={session}
              store={newStore}
              entering={leaving}
              onLeaving={setLeaving}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** שלושה שלבים: אימות → חנות → ניהול */
function StepDots({ step }: { step: Step }) {
  const index =
    step === "email" || step === "code" || step === "loading"
      ? 0
      : step === "stores" || step === "create"
        ? 1
        : 2;
  const labels = ["אימות מייל", "החנות שלך", "פאנל הניהול"];
  return (
    <ol className="mt-4 flex items-center gap-2 text-[11px] font-medium" aria-label="שלבים">
      {labels.map((label, i) => (
        <li key={label} className="flex flex-1 items-center gap-2">
          <span
            className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
              i < index
                ? "bg-accent text-accent-foreground"
                : i === index
                  ? "bg-primary-foreground text-primary"
                  : "bg-primary-foreground/20 text-primary-foreground/70"
            }`}
            aria-current={i === index ? "step" : undefined}
          >
            {i < index ? <Check className="size-3" aria-hidden="true" /> : i + 1}
          </span>
          <span className={i === index ? "text-primary-foreground" : "text-primary-foreground/60"}>
            {label}
          </span>
          {i < labels.length - 1 && (
            <span className="h-px flex-1 bg-primary-foreground/25" aria-hidden="true" />
          )}
        </li>
      ))}
    </ol>
  );
}

// ============================================================
// אימייל + קוד
// ============================================================

function CodeStep({
  step,
  setStep,
  email,
  onEmailChange: setEmail,
  onVerified,
}: {
  step: "email" | "code";
  setStep: (step: Step) => void;
  email: string;
  onEmailChange: (email: string) => void;
  onVerified: (session: PortalSession, account: PortalAccount) => void;
}) {
  const requestCode = useServerFn(requestPortalCode);
  const verifyCode = useServerFn(verifyPortalCode);
  const [code, setCode] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [expiresIn, setExpiresIn] = useState(10);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState<"send" | "verify" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // מניעת אימות כפול (השלמת 6 ספרות + לחיצה על "המשך" באותו רגע)
  const verifying = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const send = async () => {
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("נא להזין כתובת אימייל תקינה");
      return;
    }
    setBusy("send");
    setError(null);
    try {
      const result = await requestCode({ data: { email: address } });
      setMaskedEmail(result.maskedEmail);
      setExpiresIn(result.expiresInMinutes);
      setCooldown(result.resendAfterSeconds);
      setCode("");
      setStep("code");
      toast.success("הקוד נשלח למייל");
    } catch (thrown) {
      setError(errorText(thrown, "שליחת הקוד נכשלה"));
    } finally {
      setBusy(null);
    }
  };

  const verify = async (value: string) => {
    if (value.length !== 6 || verifying.current) return;
    verifying.current = true;
    setBusy("verify");
    setError(null);
    try {
      const result = await verifyCode({
        data: { email: email.trim().toLowerCase(), code: value },
      });
      onVerified({ token: result.token, email: result.email }, result.account);
    } catch (thrown) {
      setError(errorText(thrown, "אימות הקוד נכשל"));
      setCode("");
    } finally {
      verifying.current = false;
      setBusy(null);
    }
  };

  if (step === "email") {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="space-y-4"
      >
        {/* כניסה עם Google — בלי לשלוח מייל (חוסך את מכסת המיילים) */}
        <div className="space-y-2.5 rounded-xl border border-border bg-secondary/40 p-3.5">
          <div>
            <p className="text-sm font-semibold text-foreground">
              יש לך כבר חנות? כניסה מהירה עם Google
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              בלי לחכות לקוד במייל — בלחיצה אחת. מתאים גם לפתיחת חנות חדשה.
            </p>
          </div>
          <GoogleSignInButton label="התחברות עם Google" returnPath={`/?${PORTAL_GOOGLE_FLAG}=1`} />
        </div>

        <OrDivider />

        <div className="space-y-2">
          <Label htmlFor="portal-email">כניסה עם קוד למייל</Label>
          <Input
            id="portal-email"
            type="email"
            dir="ltr"
            required
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            className="h-12 text-base"
          />
          <p className="text-xs leading-5 text-muted-foreground">
            נשלח קוד חד-פעמי בן 6 ספרות. יש לכם חנות? תראו אותה מיד אחרי הקוד. אין עדיין? נפתח אחת
            יחד, בחינם.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="secondary"
          className="w-full"
          size="lg"
          disabled={busy !== null}
        >
          {busy === "send" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Mail className="size-4" />
          )}
          {busy === "send" ? "שולח קוד..." : "שליחת קוד למייל"}
        </Button>
      </form>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void verify(code);
      }}
      className="space-y-4"
    >
      <div className="space-y-1 rounded-lg border border-border bg-secondary/60 p-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <ShieldCheck className="size-4 shrink-0 text-accent" aria-hidden="true" />
          שלחנו קוד בן 6 ספרות אל:
        </p>
        <p dir="ltr" className="text-right font-semibold text-foreground">
          {maskedEmail}
        </p>
        <p className="text-xs text-muted-foreground">
          הקוד תקף ל-{expiresIn} דקות. לא הגיע? כדאי לבדוק גם בתיקיית הספאם.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="portal-code" className="block text-center">
          הקוד מהמייל
        </Label>
        {/* הדבקה מהירה: רווחים / טקסט מסביב מסוננים, וכפתור "הדבקת הקוד מהלוח" */}
        <OtpCodeInput
          id="portal-code"
          value={code}
          disabled={busy === "verify"}
          onChange={(value) => {
            setCode(value);
            setError(null);
          }}
          onComplete={(value) => void verify(value)}
        />
      </div>

      {error && (
        <p role="alert" className="text-center text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <Button
        type="submit"
        className="w-full"
        size="lg"
        disabled={code.length !== 6 || busy !== null}
      >
        {busy === "verify" ? <Loader2 className="size-4 animate-spin" /> : null}
        {busy === "verify" ? "מאמת..." : "המשך"}
      </Button>

      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
          disabled={cooldown > 0 || busy !== null}
          onClick={() => void send()}
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          {cooldown > 0 ? `שליחה חוזרת בעוד ${cooldown} שניות` : "שליחת קוד חדש"}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          disabled={busy !== null}
          onClick={() => {
            setStep("email");
            setCode("");
            setError(null);
          }}
        >
          <ArrowRight className="size-3.5" aria-hidden="true" />
          שינוי כתובת
        </button>
      </div>
    </form>
  );
}

// ============================================================
// החנויות שלך
// ============================================================

/** קוד כניסה חד-פעמי לחנות → מעבר לאתר שלה (/admin-handoff → /admin) */
function useEnterStore(session: PortalSession) {
  const enter = useServerFn(enterPortalStore);
  return useCallback(
    async (storeId: string) => {
      const { url } = await enter({ data: { token: session.token, tenantId: storeId } });
      window.location.assign(url);
    },
    [enter, session.token],
  );
}

function StoresStep({
  session,
  account,
  onSignOut,
  onCreate,
  onLeaving,
}: {
  session: PortalSession;
  account: PortalAccount;
  onSignOut: () => void;
  onCreate: () => void;
  onLeaving: (leaving: boolean) => void;
}) {
  const enterStore = useEnterStore(session);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enter = async (store: PortalStore) => {
    setPending(store.id);
    setError(null);
    onLeaving(true);
    try {
      await enterStore(store.id);
    } catch (thrown) {
      setPending(null);
      onLeaving(false);
      setError(errorText(thrown, "הכניסה לחנות נכשלה"));
    }
  };

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <CheckCircle2 className="size-3.5 text-accent" aria-hidden="true" />
        מחוברים כ-
        <span dir="ltr" className="font-medium text-foreground">
          {session.email}
        </span>
      </p>

      {account.stores.length > 0 ? (
        <ul className="space-y-2.5">
          {account.stores.map((store) => {
            const disabled = store.isBlocked || pending !== null;
            return (
              <li key={store.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void enter(store)}
                  className="group flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3.5 text-right shadow-sm transition hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-md disabled:pointer-events-none disabled:opacity-60"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground">
                    {store.name.trim().charAt(0) || "ח"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold text-foreground">{store.name}</span>
                      {store.status === "suspended" && (
                        <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                          מוקפאת
                        </span>
                      )}
                      {store.isBlocked && (
                        <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                          חסום
                        </span>
                      )}
                    </span>
                    <span
                      dir="ltr"
                      className="block truncate text-right text-xs text-muted-foreground"
                    >
                      {hostOf(store.url)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
                    {pending === store.id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <>
                        <span className="hidden sm:inline">לניהול</span>
                        <ArrowLeft
                          className="size-4 transition-transform group-hover:-translate-x-0.5"
                          aria-hidden="true"
                        />
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm leading-6">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-foreground">
            {account.blockedReason ?? "אי אפשר לפתוח חנות עם כתובת המייל הזו."}
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      {account.canCreate ? (
        <Button type="button" variant="outline" className="w-full" onClick={onCreate}>
          <Sparkles className="size-4" />
          פתיחת חנות חדשה
        </Button>
      ) : (
        account.stores.length > 0 && (
          <p className="text-center text-xs text-muted-foreground">
            כל כתובת מייל מנהלת חנות אחת. לחנות נוספת — התחברו עם כתובת אחרת.
          </p>
        )
      )}

      <button
        type="button"
        onClick={onSignOut}
        className="mx-auto flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <LogOut className="size-3.5" aria-hidden="true" />
        התחברות עם מייל אחר
      </button>
    </div>
  );
}

// ============================================================
// צור את החנות שלך
// ============================================================

type SlugCheck =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok" }
  | { state: "bad"; message: string; suggestion: string | null };

function CreateStep({
  session,
  baseDomain,
  canGoBack,
  onBack,
  onSignOut,
  onCreated,
}: {
  session: PortalSession;
  baseDomain: string;
  canGoBack: boolean;
  onBack: () => void;
  onSignOut: () => void;
  onCreated: (store: PortalStore) => void;
}) {
  const checkSlug = useServerFn(checkPortalSlug);
  const createStore = useServerFn(createPortalStore);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  // הכתובת נגזרת מהשם עד שעורכים אותה ידנית
  const [slugEdited, setSlugEdited] = useState(false);
  const [check, setCheck] = useState<SlugCheck>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const latest = useRef(0);

  const onNameChange = (value: string) => {
    setName(value);
    setError(null);
    if (!slugEdited) setSlug(value.trim() ? suggestSlug(value) : "");
  };

  // בדיקת הכתובת בשרת — חצי שנייה אחרי ההקלדה האחרונה
  useEffect(() => {
    const formatProblem = slugFormatProblem(slug);
    if (slug === "") {
      setCheck({ state: "idle" });
      return;
    }
    if (formatProblem) {
      setCheck({ state: "bad", message: formatProblem, suggestion: null });
      return;
    }
    setCheck({ state: "checking" });
    const ticket = ++latest.current;
    const timer = setTimeout(() => {
      checkSlug({ data: { token: session.token, slug } })
        .then((result) => {
          if (ticket !== latest.current) return;
          setCheck(
            result.available
              ? { state: "ok" }
              : {
                  state: "bad",
                  message: result.message ?? "הכתובת לא זמינה",
                  suggestion: result.suggestion,
                },
          );
        })
        .catch((thrown: unknown) => {
          if (ticket !== latest.current) return;
          setCheck({
            state: "bad",
            message: errorText(thrown, "בדיקת הכתובת נכשלה"),
            suggestion: null,
          });
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [slug, session.token, checkSlug]);

  const nameProblem = storeNameProblem(name);

  const submit = async () => {
    setTouched(true);
    if (nameProblem || check.state !== "ok") return;
    setBusy(true);
    setError(null);
    try {
      const { store } = await createStore({
        data: { token: session.token, name: name.trim(), slug },
      });
      toast.success("החנות נוצרה!");
      onCreated(store);
    } catch (thrown) {
      setError(errorText(thrown, "פתיחת החנות נכשלה"));
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="space-y-5"
    >
      <div className="space-y-2">
        <Label htmlFor="portal-store-name">שם החנות</Label>
        <Input
          id="portal-store-name"
          autoFocus
          maxLength={STORE_NAME_MAX}
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="למשל: הקפה של דנה"
          className="h-12 text-base"
          aria-invalid={touched && nameProblem !== null}
        />
        {touched && nameProblem && (
          <p className="text-xs font-medium text-destructive">{nameProblem}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="portal-store-slug">כתובת החנות (באנגלית)</Label>
        <div
          dir="ltr"
          className="flex h-12 items-center overflow-hidden rounded-md border border-input bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring"
        >
          <span className="shrink-0 border-r border-input bg-muted px-3 text-sm text-muted-foreground">
            https://
          </span>
          <input
            id="portal-store-slug"
            dir="ltr"
            value={slug}
            onChange={(event) => {
              setSlugEdited(true);
              setSlug(cleanSlugInput(event.target.value));
              setError(null);
            }}
            placeholder="my-shop"
            autoComplete="off"
            spellCheck={false}
            maxLength={63}
            className="h-full min-w-0 flex-1 bg-transparent px-2 text-base font-medium text-foreground outline-none"
            aria-describedby="portal-slug-status"
          />
          <span className="shrink-0 pe-3 text-sm text-muted-foreground">.{baseDomain}</span>
        </div>
        <div id="portal-slug-status" className="min-h-5 text-xs" aria-live="polite">
          {check.state === "checking" && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              בודקים אם הכתובת פנויה…
            </span>
          )}
          {check.state === "ok" && (
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              הכתובת פנויה — היא תהיה שלכם
            </span>
          )}
          {check.state === "bad" && (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-destructive">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <XCircle className="size-3.5 shrink-0" aria-hidden="true" />
                {check.message}
              </span>
              {check.suggestion && (
                <button
                  type="button"
                  className="font-semibold text-primary underline-offset-2 hover:underline"
                  onClick={() => {
                    setSlugEdited(true);
                    setSlug(check.suggestion ?? "");
                  }}
                >
                  <span dir="ltr">{check.suggestion}</span> פנויה — לבחור בה?
                </button>
              )}
            </span>
          )}
          {check.state === "idle" && (
            <span className="text-muted-foreground">
              נוצרת אוטומטית מהשם — אפשר לשנות. אחר כך אפשר לחבר גם דומיין משלכם.
            </span>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
        disabled={busy || check.state === "checking"}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {busy ? "פותחים את החנות…" : "צור את החנות שלי"}
      </Button>

      <div className="flex items-center justify-between text-sm">
        {canGoBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <ArrowRight className="size-3.5" aria-hidden="true" />
            לחנויות שלי
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onSignOut}
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <LogOut className="size-3.5" aria-hidden="true" />
          {/* טקסט אחד (לא כמה פריטי flex) — שהסוגריים לא יתהפכו סביב המייל */}
          <span>
            החלפת מייל (<bdi>{session.email}</bdi>)
          </span>
        </button>
      </div>
    </form>
  );
}

// ============================================================
// מקימים את החנות: מחכים לתעודת ה-SSL של הכתובת, ואז ישר לניהול
// ============================================================

function PreparingStep({
  session,
  store,
  entering,
  onLeaving,
}: {
  session: PortalSession;
  store: PortalStore;
  /** קוד הכניסה נוצר והדפדפן בדרך לחנות */
  entering: boolean;
  onLeaving: (leaving: boolean) => void;
}) {
  const statusFn = useServerFn(getPortalStoreStatus);
  const enterStore = useEnterStore(session);
  const [ssl, setSsl] = useState<"waiting" | "ready" | "error">("waiting");
  const [sslError, setSslError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(Date.now());
  const entered = useRef(false);

  const go = useCallback(async () => {
    if (entered.current) return;
    entered.current = true;
    setError(null);
    onLeaving(true);
    try {
      await enterStore(store.id);
    } catch (thrown) {
      entered.current = false;
      onLeaving(false);
      setError(errorText(thrown, "הכניסה לחנות נכשלה"));
    }
  }, [enterStore, onLeaving, store.id]);

  // בדיקה כל כמה שניות עד שהכתובת מאובטחת
  useEffect(() => {
    if (ssl !== "waiting") return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const status = await statusFn({ data: { token: session.token, tenantId: store.id } });
        if (stop) return;
        if (status.readiness === "ready") {
          setSsl("ready");
          return;
        }
        if (status.readiness === "error") {
          setSsl("error");
          setSslError(status.sslError);
          return;
        }
      } catch {
        // תקלה רגעית — ממשיכים לבדוק
      }
      if (stop) return;
      if (Date.now() - started.current > SSL_PATIENCE_MS) setSlow(true);
      timer = setTimeout(() => void poll(), SSL_POLL_MS);
    };
    void poll();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [ssl, statusFn, session.token, store.id]);

  // מוכן → נכנסים
  useEffect(() => {
    if (ssl === "ready") void go();
  }, [ssl, go]);

  const steps: { label: string; state: "done" | "active" | "todo" }[] = [
    { label: "החנות נוצרה ואתם המנהלים שלה", state: "done" },
    {
      label: "מאבטחים את הכתובת (תעודת SSL)",
      state: ssl === "waiting" ? "active" : "done",
    },
    {
      label: "נכנסים לפאנל הניהול",
      state: entering || (ssl === "ready" && error === null) ? "active" : "todo",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-secondary/50 p-4">
        <p className="font-semibold text-foreground">{store.name}</p>
        <a
          href={store.url}
          target="_blank"
          rel="noreferrer"
          dir="ltr"
          className="mt-0.5 inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {hostOf(store.url)}
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      </div>

      <ol className="space-y-3">
        {steps.map((item) => (
          <li key={item.label} className="flex items-center gap-3 text-sm">
            <span
              className={`flex size-7 shrink-0 items-center justify-center rounded-full ${
                item.state === "done"
                  ? "bg-emerald-600 text-white"
                  : item.state === "active"
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {item.state === "done" ? (
                <Check className="size-4" aria-hidden="true" />
              ) : item.state === "active" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
              )}
            </span>
            <span
              className={
                item.state === "todo" ? "text-muted-foreground" : "font-medium text-foreground"
              }
            >
              {item.label}
            </span>
          </li>
        ))}
      </ol>

      {ssl === "waiting" && !slow && (
        <p className="text-xs leading-5 text-muted-foreground">
          כתובת חדשה מקבלת תעודת אבטחה אוטומטית — זה לוקח בדרך כלל עד דקה-שתיים. אפשר להשאיר את
          החלון פתוח, נעביר אתכם לבד.
        </p>
      )}

      {(slow || ssl === "error") && !entering && (
        <div className="space-y-3 rounded-xl border border-accent/40 bg-accent/10 p-4 text-sm">
          <p className="text-foreground">
            {ssl === "error"
              ? `הנפקת תעודת האבטחה לכתובת לא הצליחה עדיין${sslError ? ` (${sslError})` : ""}. השרת ינסה שוב אוטומטית.`
              : "הנפקת תעודת האבטחה לוקחת יותר זמן מהרגיל."}{" "}
            אפשר להיכנס כבר עכשיו — אם הדפדפן מציג אזהרת אבטחה, חכו דקה ונסו שוב.
          </p>
          <Button type="button" className="w-full" onClick={() => void go()}>
            להיכנס לחנות בכל זאת
            <ArrowLeft className="size-4" />
          </Button>
        </div>
      )}

      {error && (
        <div className="space-y-2">
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
          <Button type="button" variant="outline" className="w-full" onClick={() => void go()}>
            נסו שוב
          </Button>
        </div>
      )}
    </div>
  );
}
