import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ArrowRight,
  BedDouble,
  Check,
  CheckCircle2,
  ExternalLink,
  ImagePlus,
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
  getPortalZimmerOffer,
  openPortalZimmer,
  uploadPortalStoreLogo,
} from "@/lib/portal.functions";
import {
  BUSINESS_ADDRESS_MAX,
  BUSINESS_NAME_MAX,
  businessDetailsProblems,
  cleanBusinessDetails,
  cleanSlugInput,
  PORTAL_BUSINESS_TYPES,
  PORTAL_LOGO_MAX_BYTES,
  shekels,
  slugFormatProblem,
  STORE_NAME_MAX,
  storeNameProblem,
  suggestSlug,
  suggestZimmerSlug,
  type PortalAccount,
  type PortalBusinessDetails,
  type PortalBusinessField,
  type PortalStore,
  type PortalZimmerOpened,
  type PortalZimmerPlan,
  ZIMMER_AREA_MAX,
  ZIMMER_MESSAGE_MAX,
  stepAfterLogin,
  type PortalIntent,
  cleanZimmerRequest,
  zimmerRequestProblems,
  type ZimmerRequestField,
} from "@/lib/portal";
import { compressLogoImage } from "@/lib/image";
import { TRIAL_DAYS } from "@/lib/subscription";

/**
 * תהליך הכניסה בשער הפלטפורמה (חלק 12), בחלון אחד:
 *   אימייל → קוד בן 6 ספרות → החנויות שלכם (לחיצה = כניסה לניהול)
 *                            ↘ אתר חדש: מה מקימים? (שלב E2)
 *                              • אתר לצימר (מיגרציה 40) → שם, כתובת, טלפון, חבילה → העסק נפתח
 *                                (ימי ניסיון) → מכינים את הכתובת (SSL) → ישר לאזור הניהול
 *                                (מדריך ההקמה). במקביל הבקשה נשמרת ונוריאל חוזרים לבעל העסק.
 *                              • חנות אונליין → "צור את החנות שלך" (שם + כתובת)
 *                              → פרטי העסק (שלב E1: שם רשמי, ח.פ / ע.מ, סוג עוסק, מע"מ,
 *                                טלפון לשירות לקוחות; כתובת ולוגו — לא חובה)
 *                              → מכינים את הכתובת (SSL) → ישר לניהול החנות.
 * האימות נשמר בלשונית (sessionStorage) כאסימון חתום מהשרת — רענון העמוד
 * לא מחייב קוד חדש; הוא פג אחרי שעה.
 */

type Step =
  | "email"
  | "code"
  | "loading"
  | "stores"
  | "product"
  | "zimmer"
  | "zimmer-opening"
  | "create"
  | "business"
  | "preparing";

/** מה שנבחר בשלב "צור את החנות שלך" — הפתיחה עצמה רק אחרי פרטי העסק */
type StoreDraft = { name: string; slug: string };

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
  intent = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** nuri1.fit — לתצוגת הכתובת של החנות החדשה */
  baseDomain: string;
  /**
   * דף הנחיתה: מה בחרו לפני שנפתח החלון — "store" (חנות אינטרנטית, 14 ימי ניסיון) או
   * "zimmer" (Nuriel Hospitality, 30 ימי ניסיון). אחרי האימות ממשיכים ישר למסלול שנבחר
   * (במקום "מה מקימים?"); null — כניסה רגילה, בלי בחירה מראש.
   */
  intent?: PortalIntent;
}) {
  const [step, setStep] = useState<Step>("email");
  // האימייל נשמר כאן (לא בשלב עצמו) — סגירה ופתיחה של החלון לא מוחקות אותו
  const [email, setEmail] = useState("");
  const [session, setSession] = useState<PortalSession | null>(null);
  const [account, setAccount] = useState<PortalAccount | null>(null);
  const [newStore, setNewStore] = useState<PortalStore | null>(null);
  const [draft, setDraft] = useState<StoreDraft | null>(null);
  // שלב E2: החבילות לצימרים (null = עוד נטען; ריק = רק חנות אונליין)
  const [zimmerPlans, setZimmerPlans] = useState<PortalZimmerPlan[] | null>(null);
  // מיגרציה 40: כמה ימי ניסיון (null = לא ידוע — הטקסטים בלי מספר) ועסק האירוח שנפתח הרגע
  const [trialDays, setTrialDays] = useState<number | null>(null);
  const [newZimmer, setNewZimmer] = useState<PortalZimmerOpened | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // בדרך לאתר החנות (קוד כניסה נוצר, הדפדפן עובר) — לא סוגרים את החלון
  const [leaving, setLeaving] = useState(false);
  // מרנדר מחדש את השלבים (חזרה עם "אחורה" מאתר החנות)
  const [resetKey, setResetKey] = useState(0);
  const loadAccountFn = useServerFn(getPortalAccount);
  // resume יציב (useCallback) — הבחירה מדף הנחיתה ומספר החבילות נקראים מ-ref
  const intentRef = useRef<PortalIntent>(intent);
  const zimmerCountRef = useRef(0);
  useEffect(() => {
    intentRef.current = intent;
    zimmerCountRef.current = zimmerPlans?.length ?? 0;
  }, [intent, zimmerPlans]);

  /** אימות שמור בלשונית → החנויות (או פתיחת חנות), עם רשימה עדכנית מהשרת */
  const resume = useCallback(
    (saved: PortalSession) => {
      setSession(saved);
      setEmail(saved.email);
      setStep("loading");
      loadAccountFn({ data: { token: saved.token } })
        .then((result) => {
          setAccount(result.account);
          setStep(stepAfterLogin(result.account, intentRef.current, zimmerCountRef.current));
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

  // החבילות לצימרים וימי הניסיון — פעם אחת, בפתיחה הראשונה של החלון
  const offerFn = useServerFn(getPortalZimmerOffer);
  useEffect(() => {
    if (!open || zimmerPlans !== null) return;
    offerFn()
      .then((offer) => {
        setZimmerPlans(offer.plans);
        setTrialDays(offer.trialDays);
      })
      .catch(() => setZimmerPlans([]));
  }, [open, zimmerPlans, offerFn]);

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
      setNewZimmer(null);
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
    setStep(stepAfterLogin(nextAccount, intent, zimmerPlans?.length ?? 0));
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

  const busyStep = step === "preparing" || step === "zimmer-opening" || leaving;

  const titles: Record<Step, { title: string; description: string }> = {
    email:
      intent === "store"
        ? {
            title: `חנות אינטרנטית — ${TRIAL_DAYS} ימי ניסיון בחינם`,
            description:
              "מתחילים בכניסה: עם חשבון Google, או עם קוד חד-פעמי למייל. בלי סיסמאות ובלי כרטיס אשראי.",
          }
        : intent === "zimmer"
          ? {
              title: `Nuriel Hospitality — ${trialDays ? `${trialDays} ימי ניסיון` : "תקופת ניסיון"} בחינם`,
              description:
                "מתחילים בכניסה: עם חשבון Google, או עם קוד חד-פעמי למייל. בלי סיסמאות ובלי תשלום עכשיו.",
            }
          : {
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
    product: {
      title: "מה מקימים?",
      description: "חנות אונליין או אתר לצימר — פותחים לבד, תוך דקה.",
    },
    zimmer: {
      title: "אתר לצימר",
      description: `${
        trialDays ? `${trialDays} ימי ניסיון. ` : ""
      }פותחים עכשיו וממשיכים להקים באזור הניהול — ונחזור אליכם לליווי.`,
    },
    "zimmer-opening": {
      title: "העסק נפתח!",
      description: "עוד רגע אתם באזור הניהול — ממשיכים שם להקים את האתר.",
    },
    create: {
      title: "צור את החנות שלך",
      description: "שם לחנות וכתובת באנגלית. בשלב הבא — פרטי העסק, ואז החנות באוויר.",
    },
    business: {
      title: "פרטי העסק",
      description: "מופיעים בתקנון, במדיניות הפרטיות ובמסמכים — כדי שלא תצטרכו לחפש אחר כך.",
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
              {step === "zimmer" || step === "zimmer-opening" ? (
                <BedDouble className="size-5 text-accent" aria-hidden="true" />
              ) : step === "create" || step === "business" || step === "product" ? (
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
              onCreate={() => setStep("product")}
              onLeaving={setLeaving}
            />
          )}

          {step === "product" && session && account && (
            <ProductStep
              plans={zimmerPlans}
              trialDays={trialDays}
              canCreateStore={account.canCreate}
              onStore={() => setStep("create")}
              onZimmer={() => setStep("zimmer")}
              onBack={account.stores.length > 0 ? () => setStep("stores") : null}
            />
          )}

          {step === "zimmer" && session && zimmerPlans && zimmerPlans.length > 0 && (
            <ZimmerStep
              session={session}
              plans={zimmerPlans}
              baseDomain={baseDomain}
              trialDays={trialDays}
              onBack={() => setStep("product")}
              onOpened={(opened) => {
                setNewZimmer(opened);
                setStep("zimmer-opening");
              }}
            />
          )}

          {step === "zimmer-opening" && session && newZimmer && (
            <PreparingStep
              session={session}
              store={newZimmer.store}
              entering={leaving}
              onLeaving={setLeaving}
              texts={zimmerPreparingTexts(newZimmer.trialEndsAt)}
            />
          )}

          {step === "create" && session && account && (
            <CreateStep
              session={session}
              baseDomain={baseDomain}
              initial={draft}
              canGoBack={account.stores.length > 0 || (zimmerPlans?.length ?? 0) > 0}
              backLabel={(zimmerPlans?.length ?? 0) > 0 ? "חזרה לבחירה" : "לחנויות שלי"}
              onBack={() => setStep((zimmerPlans?.length ?? 0) > 0 ? "product" : "stores")}
              onSignOut={signOut}
              onNext={(next) => {
                setDraft(next);
                setStep("business");
              }}
            />
          )}

          {step === "business" && session && draft && (
            <BusinessStep
              session={session}
              draft={draft}
              baseDomain={baseDomain}
              onBack={() => setStep("create")}
              onCreated={(store) => {
                setNewStore(store);
                setDraft(null);
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
      : step === "stores" ||
          step === "product" ||
          step === "zimmer" ||
          step === "create" ||
          step === "business"
        ? 1
        : 2;
  const labels = ["אימות מייל", "האתר שלך", "פאנל הניהול"];
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
            {account.maxStores !== null && account.stores.length >= account.maxStores
              ? `הגעתם למספר החנויות המרבי לחשבון אחד (${account.maxStores}). לחנויות נוספות פנו לתמיכה.`
              : "אי אפשר לפתוח חנות נוספת עם כתובת המייל הזו."}
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

// ============================================================
// שלב E2: מה מקימים — חנות אונליין או אתר לצימר (מיגרציה 40: שניהם נפתחים לבד)
// ============================================================

function ProductStep({
  plans,
  trialDays,
  canCreateStore,
  onStore,
  onZimmer,
  onBack,
}: {
  plans: PortalZimmerPlan[] | null;
  trialDays: number | null;
  canCreateStore: boolean;
  onStore: () => void;
  onZimmer: () => void;
  onBack: (() => void) | null;
}) {
  // אין חבילות לצימרים (המנוע לא מותקן) — ישר לחנות, כמו קודם
  useEffect(() => {
    if (plans !== null && plans.length === 0) onStore();
  }, [plans, onStore]);
  if (plans === null || plans.length === 0) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-7 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }
  const from = Math.min(...plans.map((p) => p.price_monthly ?? Number.POSITIVE_INFINITY));
  const choice =
    "flex w-full items-start gap-3 rounded-xl border border-input p-4 text-start transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
  return (
    <div className="space-y-3">
      <button type="button" className={choice} onClick={onStore} disabled={!canCreateStore}>
        <Store className="mt-0.5 size-6 shrink-0 text-primary" aria-hidden="true" />
        <span>
          <span className="block font-semibold">חנות אונליין</span>
          <span className="block text-sm text-muted-foreground">
            מוצרים, עגלה, תשלום ומשלוחים. פותחים לבד — תוך דקה.
          </span>
        </span>
      </button>
      <button type="button" className={choice} onClick={onZimmer}>
        <BedDouble className="mt-0.5 size-6 shrink-0 text-primary" aria-hidden="true" />
        <span>
          <span className="block font-semibold">אתר לצימר / מקום אירוח</span>
          <span className="block text-sm text-muted-foreground">
            הזמנות, לוח זמינות, גלריה ותמיכה. פותחים עכשיו
            {trialDays ? ` — ${trialDays} ימי ניסיון` : ""}, ונחזור אליכם לליווי.
          </span>
          {Number.isFinite(from) && (
            <span className="mt-1 block text-sm font-medium text-primary">
              החל מ-{shekels(from)} לחודש
            </span>
          )}
        </span>
      </button>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowRight className="size-3.5" aria-hidden="true" />
          לאתרים שלי
        </button>
      )}
    </div>
  );
}

const ZIMMER_FIELDS: ZimmerRequestField[] = ["business_name", "phone", "units", "area", "message"];

/** מיגרציה 40: הכתובת פנויה? — בדיקה בשרת חצי שנייה אחרי ההקלדה האחרונה (כמו בפתיחת חנות) */
function useSlugAvailability(token: string, slug: string): SlugCheck {
  const checkSlug = useServerFn(checkPortalSlug);
  const [check, setCheck] = useState<SlugCheck>({ state: "idle" });
  const latest = useRef(0);
  useEffect(() => {
    const formatProblem = slugFormatProblem(slug);
    if (slug === "") {
      latest.current += 1;
      setCheck({ state: "idle" });
      return;
    }
    if (formatProblem) {
      latest.current += 1;
      setCheck({ state: "bad", message: formatProblem, suggestion: null });
      return;
    }
    setCheck({ state: "checking" });
    const ticket = ++latest.current;
    const timer = setTimeout(() => {
      checkSlug({ data: { token, slug } })
        .then((result) => {
          if (ticket !== latest.current) return;
          setCheck(
            result.available
              ? { state: "ok" }
              : {
                  state: "bad",
                  // ההודעה של המסד מדברת על "חנות" — כאן זה אתר
                  message: (result.message ?? "הכתובת לא זמינה").replace(
                    'ע"י חנות אחרת',
                    'ע"י אתר אחר',
                  ),
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
  }, [slug, token, checkSlug]);
  return check;
}

/** "5.12.2026" — שעון ישראל */
function dateText(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).format(date);
}

/**
 * מיגרציה 40: אתר לצימר — בעל המקום פותח את העסק בעצמו (ימי ניסיון) וממשיך ישר לאזור הניהול;
 * במקביל הפרטים נשמרים כבקשה ונוריאל חוזרים אליו. הכתובת נבדקת כמו בפתיחת חנות.
 */
function ZimmerStep({
  session,
  plans,
  baseDomain,
  trialDays,
  onBack,
  onOpened,
}: {
  session: PortalSession;
  plans: PortalZimmerPlan[];
  baseDomain: string;
  trialDays: number | null;
  onBack: () => void;
  onOpened: (opened: PortalZimmerOpened) => void;
}) {
  const openFn = useServerFn(openPortalZimmer);
  const [form, setForm] = useState({
    business_name: "",
    phone: "",
    units: "",
    plan_code: plans[0]?.code ?? "",
    area: "",
    message: "",
  });
  const [slug, setSlug] = useState("");
  // הכתובת נגזרת מהשם עד שעורכים אותה ידנית
  const [slugEdited, setSlugEdited] = useState(false);
  const check = useSlugAvailability(session.token, slug);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const request = cleanZimmerRequest(form);
  const problems = zimmerRequestProblems(request);
  const problemOf = (field: ZimmerRequestField) => (touched ? problems[field] : undefined);
  const set = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  };
  const onNameChange = (value: string) => {
    set("business_name", value);
    if (!slugEdited) setSlug(value.trim() ? suggestZimmerSlug(value) : "");
  };
  const setupFees = [...new Set(plans.map((p) => p.setup_fee).filter((f) => f !== null))];
  const slugMissing = touched && slug === "";

  const send = async () => {
    setTouched(true);
    const first = ZIMMER_FIELDS.find((field) => problems[field]);
    if (first) {
      document.getElementById(`portal-zim-${first}`)?.focus();
      return;
    }
    if (check.state !== "ok") {
      document.getElementById("portal-zim-slug")?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const opened = await openFn({ data: { token: session.token, slug, request } });
      onOpened(opened);
    } catch (thrown) {
      setError(errorText(thrown, "פתיחת העסק נכשלה. נסו שוב."));
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      className="space-y-5"
      noValidate
    >
      <div className="space-y-2">
        <Label htmlFor="portal-zim-business_name">שם המקום / העסק</Label>
        <Input
          id="portal-zim-business_name"
          autoFocus
          maxLength={BUSINESS_NAME_MAX}
          value={form.business_name}
          onChange={(event) => onNameChange(event.target.value)}
          autoComplete="organization"
          placeholder="למשל: צימרי הכרם"
          className="h-11"
          aria-invalid={problemOf("business_name") !== undefined}
        />
        {problemOf("business_name") && (
          <p className="text-xs font-medium text-destructive">{problemOf("business_name")}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="portal-zim-slug">כתובת האתר (באנגלית)</Label>
        <div
          dir="ltr"
          className="flex h-11 items-center overflow-hidden rounded-md border border-input bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring"
        >
          <span className="shrink-0 border-r border-input bg-muted px-3 text-sm text-muted-foreground">
            https://
          </span>
          <input
            id="portal-zim-slug"
            dir="ltr"
            value={slug}
            onChange={(event) => {
              setSlugEdited(true);
              setSlug(cleanSlugInput(event.target.value));
              setError(null);
            }}
            placeholder="my-zimmer"
            autoComplete="off"
            spellCheck={false}
            maxLength={63}
            className="h-full min-w-0 flex-1 bg-transparent px-2 text-base font-medium text-foreground outline-none"
            aria-describedby="portal-zim-slug-status"
            aria-invalid={slugMissing || check.state === "bad"}
          />
          <span className="shrink-0 pe-3 text-sm text-muted-foreground">.{baseDomain}</span>
        </div>
        <div id="portal-zim-slug-status" className="min-h-5 text-xs" aria-live="polite">
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
          {check.state === "idle" &&
            (slugMissing ? (
              <span className="font-medium text-destructive">יש להזין כתובת באנגלית</span>
            ) : (
              <span className="text-muted-foreground">
                נוצרת אוטומטית מהשם — אפשר לשנות. אחר כך אפשר לחבר גם דומיין משלכם.
              </span>
            ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="portal-zim-phone">טלפון</Label>
        <Input
          id="portal-zim-phone"
          type="tel"
          dir="ltr"
          inputMode="tel"
          autoComplete="tel"
          maxLength={20}
          value={form.phone}
          onChange={(event) => set("phone", event.target.value)}
          placeholder="050-1234567"
          className="h-11 text-left"
          aria-invalid={problemOf("phone") !== undefined}
        />
        {problemOf("phone") && (
          <p className="text-xs font-medium text-destructive">{problemOf("phone")}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="portal-zim-units">
            כמה יחידות <span className="font-normal text-muted-foreground">(לא חובה)</span>
          </Label>
          <Input
            id="portal-zim-units"
            type="number"
            inputMode="numeric"
            min={1}
            max={500}
            dir="ltr"
            value={form.units}
            onChange={(event) => set("units", event.target.value)}
            className="h-11"
            aria-invalid={problemOf("units") !== undefined}
          />
          {problemOf("units") && (
            <p className="text-xs font-medium text-destructive">{problemOf("units")}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="portal-zim-area">
            אזור <span className="font-normal text-muted-foreground">(לא חובה)</span>
          </Label>
          <Input
            id="portal-zim-area"
            maxLength={ZIMMER_AREA_MAX}
            value={form.area}
            onChange={(event) => set("area", event.target.value)}
            placeholder="למשל: גליל עליון"
            className="h-11"
          />
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">איזו חבילה תתאים לכם אחרי הניסיון?</legend>
        {plans.map((plan) => (
          <label
            key={plan.code}
            className="flex cursor-pointer gap-3 rounded-xl border border-input p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
          >
            <input
              type="radio"
              name="portal-zim-plan"
              value={plan.code}
              checked={form.plan_code === plan.code}
              onChange={() => set("plan_code", plan.code)}
              className="mt-1 size-4 accent-[hsl(var(--primary))]"
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-semibold">{plan.name}</span>
                {plan.price_monthly !== null && (
                  <span className="font-semibold text-primary">
                    {shekels(plan.price_monthly)} לחודש
                  </span>
                )}
              </span>
              {plan.tagline && <span className="block text-muted-foreground">{plan.tagline}</span>}
              {plan.highlights.length > 0 && (
                <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                  {plan.highlights.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              )}
            </span>
          </label>
        ))}
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-input p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
          <input
            type="radio"
            name="portal-zim-plan"
            value=""
            checked={form.plan_code === ""}
            onChange={() => set("plan_code", "")}
            className="size-4 accent-[hsl(var(--primary))]"
          />
          עוד לא יודעים — נתייעץ בשיחה
        </label>
        {setupFees.length === 1 && (
          <p className="text-xs text-muted-foreground">
            בכל החבילות: הקמה ראשונית — {shekels(setupFees[0] ?? null)} חד-פעמי (דומיין, עיצוב, תוכן
            והגדרות גוגל).
          </p>
        )}
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="portal-zim-message">
          משהו שכדאי שנדע <span className="font-normal text-muted-foreground">(לא חובה)</span>
        </Label>
        <textarea
          id="portal-zim-message"
          rows={3}
          maxLength={ZIMMER_MESSAGE_MAX}
          value={form.message}
          onChange={(event) => set("message", event.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-1.5 rounded-xl border border-accent/40 bg-accent/10 p-3 text-xs leading-5 text-foreground">
        <p className="font-medium">
          {trialDays ? `${trialDays} ימי ניסיון` : "תקופת ניסיון"} — בלי תשלום עכשיו.
        </p>
        <p>
          אחרי הפתיחה נכנסים ישר לאזור הניהול ומתחילים להקים: פרטים, יחידות, תמונות ומחירים. האתר
          נפתח לגולשים כשאתם מפרסמים אותו.
        </p>
        <p>
          נחזור אליכם בטלפון תוך יום עסקים כדי לעזור בהקמה. אישור יישלח ל-
          <bdi>{session.email}</bdi>.
        </p>
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
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Sparkles className="size-4" aria-hidden="true" />
        )}
        {busy
          ? "פותחים את העסק…"
          : trialDays
            ? `פתיחת העסק — ${trialDays} ימי ניסיון`
            : "פתיחת העסק"}
      </Button>

      <button
        type="button"
        onClick={onBack}
        disabled={busy}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <ArrowRight className="size-3.5" aria-hidden="true" />
        חזרה לבחירה
      </button>
    </form>
  );
}

/** הטקסטים של "מכינים את הכתובת" לעסק אירוח שנפתח מהשער */
function zimmerPreparingTexts(trialEndsAt: string | null): PreparingTexts {
  const until = dateText(trialEndsAt);
  return {
    created: until ? `העסק נפתח — ניסיון עד ${until}` : "העסק נפתח ואתם הבעלים שלו",
    entering: "נכנסים לאזור הניהול — מדריך ההקמה",
    enterAnyway: "להיכנס לאזור הניהול בכל זאת",
    enterFailed: "הכניסה לאזור הניהול נכשלה",
  };
}

function CreateStep({
  session,
  baseDomain,
  initial,
  canGoBack,
  backLabel,
  onBack,
  onSignOut,
  onNext,
}: {
  session: PortalSession;
  baseDomain: string;
  /** חזרה מ"פרטי העסק" — השם והכתובת שכבר נבחרו */
  initial: StoreDraft | null;
  canGoBack: boolean;
  backLabel: string;
  onBack: () => void;
  onSignOut: () => void;
  onNext: (draft: StoreDraft) => void;
}) {
  const checkSlug = useServerFn(checkPortalSlug);
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  // הכתובת נגזרת מהשם עד שעורכים אותה ידנית
  const [slugEdited, setSlugEdited] = useState(initial !== null);
  const [check, setCheck] = useState<SlugCheck>({ state: "idle" });
  const [touched, setTouched] = useState(false);
  const latest = useRef(0);

  const onNameChange = (value: string) => {
    setName(value);
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

  // הפתיחה עצמה — בשלב הבא, אחרי פרטי העסק
  const submit = () => {
    setTouched(true);
    if (nameProblem || check.state !== "ok") return;
    onNext({ name: name.trim().replace(/\s+/g, " "), slug });
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
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

      <Button
        type="submit"
        size="lg"
        className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
        disabled={check.state === "checking"}
      >
        המשך — פרטי העסק
        <ArrowLeft className="size-4" aria-hidden="true" />
      </Button>

      <div className="flex items-center justify-between text-sm">
        {canGoBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <ArrowRight className="size-3.5" aria-hidden="true" />
            {backLabel}
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
// פרטי העסק (שלב E1) — לפני הפתיחה, כדי שהתקנון, מדיניות הפרטיות והמסמכים יתמלאו מיד.
// חובה: שם רשמי, סוג עסק, ח.פ / ע.מ, טלפון לשירות לקוחות. לא חובה: כתובת, לוגו.
// ============================================================

const BUSINESS_FIELDS: PortalBusinessField[] = [
  "legal_name",
  "business_type",
  "tax_id",
  "phone",
  "address",
];

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs font-medium text-destructive">
      {message}
    </p>
  );
}

function BusinessStep({
  session,
  draft,
  baseDomain,
  onBack,
  onCreated,
}: {
  session: PortalSession;
  draft: StoreDraft;
  baseDomain: string;
  onBack: () => void;
  onCreated: (store: PortalStore) => void;
}) {
  const createStore = useServerFn(createPortalStore);
  const [details, setDetails] = useState<PortalBusinessDetails>({
    legal_name: draft.name,
    business_type: "",
    tax_id: "",
    prices_include_vat: true,
    phone: "",
    address: "",
  });
  const [logo, setLogo] = useState<{ file: File; preview: string } | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // תצוגת הלוגו — משחררים את הכתובת הזמנית כשמחליפים / יוצאים
  useEffect(() => {
    return () => {
      if (logo) URL.revokeObjectURL(logo.preview);
    };
  }, [logo]);

  const cleaned = cleanBusinessDetails(details);
  const problems = businessDetailsProblems(cleaned);
  const problemOf = (field: PortalBusinessField) => (touched ? problems[field] : undefined);
  const type = PORTAL_BUSINESS_TYPES.find((t) => t.value === details.business_type);
  const patch = (next: Partial<PortalBusinessDetails>) => {
    setDetails((current) => ({ ...current, ...next }));
    setError(null);
  };

  const pickLogo = async (file: File | undefined) => {
    setLogoError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setLogoError("יש לבחור קובץ תמונה");
      return;
    }
    try {
      // כמו הלוגו מההגדרות: עד 600px, PNG עם שקיפות
      const { file: optimized } = await compressLogoImage(file);
      if (optimized.size > PORTAL_LOGO_MAX_BYTES) {
        setLogoError("הלוגו גדול מדי — עד 2MB");
        return;
      }
      setLogo({ file: optimized, preview: URL.createObjectURL(optimized) });
    } catch {
      setLogoError("לא הצלחנו לקרוא את התמונה — נסו קובץ אחר");
    }
  };

  const submit = async () => {
    setTouched(true);
    const first = BUSINESS_FIELDS.find((field) => problems[field]);
    if (first) {
      document.getElementById(`portal-biz-${first}`)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { store } = await createStore({
        data: { token: session.token, name: draft.name, slug: draft.slug, business: cleaned },
      });
      if (logo) {
        try {
          const form = new FormData();
          form.append("token", session.token);
          form.append("tenantId", store.id);
          form.append("file", logo.file, "logo.png");
          await uploadPortalStoreLogo({ data: form });
        } catch (thrown) {
          // החנות כבר נפתחה — הלוגו לא מפיל אותה
          toast.warning(errorText(thrown, "הלוגו לא נשמר — אפשר להעלות אותו בהגדרות החנות"));
        }
      }
      toast.success("החנות נוצרה!");
      onCreated(store);
    } catch (thrown) {
      setError(errorText(thrown, "פתיחת החנות נכשלה"));
      setBusy(false);
    }
  };

  const describedBy = (field: PortalBusinessField) =>
    problemOf(field) ? `portal-biz-${field}-error` : undefined;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="space-y-5"
      noValidate
    >
      <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        החנות: <span className="font-medium text-foreground">{draft.name}</span> ·{" "}
        <bdi dir="ltr">
          {draft.slug}.{baseDomain}
        </bdi>
      </p>

      <div className="space-y-2">
        <Label htmlFor="portal-biz-legal_name">שם העסק הרשמי</Label>
        <Input
          id="portal-biz-legal_name"
          maxLength={BUSINESS_NAME_MAX}
          value={details.legal_name}
          onChange={(event) => patch({ legal_name: event.target.value })}
          autoComplete="organization"
          className="h-11"
          aria-invalid={problemOf("legal_name") !== undefined}
          aria-describedby={describedBy("legal_name") ?? "portal-biz-legal_name-hint"}
        />
        <p id="portal-biz-legal_name-hint" className="text-xs text-muted-foreground">
          כפי שמופיע ברשות המסים — למשל &quot;דנה כהן&quot; או &quot;דנה בע״מ&quot;
        </p>
        <FieldError id="portal-biz-legal_name-error" message={problemOf("legal_name")} />
      </div>

      <fieldset className="space-y-2" aria-describedby={describedBy("business_type")}>
        <legend className="mb-2 text-sm font-medium">סוג העסק</legend>
        <div className="grid grid-cols-3 gap-2">
          {PORTAL_BUSINESS_TYPES.map((option, index) => (
            <label
              key={option.value}
              className={`flex min-h-14 cursor-pointer flex-col items-center justify-center rounded-lg border px-2 py-2 text-center text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
                details.business_type === option.value
                  ? "border-primary bg-primary/5 font-semibold text-primary"
                  : "border-input hover:bg-muted"
              }`}
            >
              <input
                type="radio"
                name="portal-biz-type"
                id={index === 0 ? "portal-biz-business_type" : undefined}
                value={option.value}
                checked={details.business_type === option.value}
                onChange={() => patch({ business_type: option.value })}
                className="sr-only"
              />
              {option.label}
              <span className="text-[11px] font-normal text-muted-foreground">{option.hint}</span>
            </label>
          ))}
        </div>
        <FieldError id="portal-biz-business_type-error" message={problemOf("business_type")} />
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="portal-biz-tax_id">{type?.idLabel ?? "מספר ח.פ / ע.מ"}</Label>
        <Input
          id="portal-biz-tax_id"
          dir="ltr"
          inputMode="numeric"
          maxLength={20}
          value={details.tax_id}
          onChange={(event) => patch({ tax_id: event.target.value })}
          placeholder="514000000"
          className="h-11 text-left"
          aria-invalid={problemOf("tax_id") !== undefined}
          aria-describedby={describedBy("tax_id")}
        />
        <FieldError id="portal-biz-tax_id-error" message={problemOf("tax_id")} />
      </div>

      {details.business_type === "exempt" ? (
        <p className="rounded-lg border border-input px-3 py-2 text-sm text-muted-foreground">
          עוסק פטור — המחירים באתר בלי מע״מ, והמסמכים בהתאם.
        </p>
      ) : (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">המחירים באתר</legend>
          {[
            { value: true, label: "כוללים מע״מ", hint: "מומלץ — מכירה לצרכנים" },
            { value: false, label: "לפני מע״מ", hint: "מכירה לעסקים; המע״מ מתווסף בקופה" },
          ].map((option) => (
            <label
              key={String(option.value)}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-input px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input
                type="radio"
                name="portal-biz-vat"
                checked={details.prices_include_vat === option.value}
                onChange={() => patch({ prices_include_vat: option.value })}
                className="size-4 accent-[hsl(var(--primary))]"
              />
              <span>
                <span className="font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <div className="space-y-2">
        <Label htmlFor="portal-biz-phone">טלפון לשירות לקוחות</Label>
        <Input
          id="portal-biz-phone"
          type="tel"
          dir="ltr"
          inputMode="tel"
          autoComplete="tel"
          maxLength={20}
          value={details.phone}
          onChange={(event) => patch({ phone: event.target.value })}
          placeholder="050-1234567"
          className="h-11 text-left"
          aria-invalid={problemOf("phone") !== undefined}
          aria-describedby={describedBy("phone")}
        />
        <FieldError id="portal-biz-phone-error" message={problemOf("phone")} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="portal-biz-address">
          כתובת העסק <span className="font-normal text-muted-foreground">(לא חובה)</span>
        </Label>
        <Input
          id="portal-biz-address"
          maxLength={BUSINESS_ADDRESS_MAX}
          autoComplete="street-address"
          value={details.address}
          onChange={(event) => patch({ address: event.target.value })}
          placeholder="רחוב, מספר, עיר"
          className="h-11"
          aria-invalid={problemOf("address") !== undefined}
          aria-describedby={describedBy("address")}
        />
        <FieldError id="portal-biz-address-error" message={problemOf("address")} />
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium">
          לוגו <span className="font-normal text-muted-foreground">(לא חובה)</span>
        </span>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          aria-label="בחירת לוגו"
          tabIndex={-1}
          onChange={(event) => {
            void pickLogo(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <div className="flex items-center gap-3">
          {logo && (
            <img
              src={logo.preview}
              alt="הלוגו שנבחר"
              className="size-14 rounded-md border border-input bg-white object-contain p-1"
            />
          )}
          <Button
            type="button"
            variant="outline"
            className="min-h-11 gap-2"
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus className="size-4" aria-hidden="true" />
            {logo ? "החלפת לוגו" : "בחירת לוגו"}
          </Button>
          {logo && (
            <button
              type="button"
              className="text-sm text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setLogo(null)}
            >
              הסרה
            </button>
          )}
        </div>
        {logoError ? (
          <p role="alert" className="text-xs font-medium text-destructive">
            {logoError}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            אפשר גם אחר כך, בהגדרות החנות. PNG / JPG / WebP.
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        הפרטים ייכנסו לתקנון, למדיניות הפרטיות ולמסמכים. אפשר לשנות אותם בכל זמן בהגדרות החנות.
      </p>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
        disabled={busy}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {busy ? "פותחים את החנות…" : "צור את החנות שלי"}
      </Button>

      <button
        type="button"
        onClick={onBack}
        disabled={busy}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <ArrowRight className="size-3.5" aria-hidden="true" />
        חזרה לשם ולכתובת
      </button>
    </form>
  );
}

// ============================================================
// מקימים את החנות: מחכים לתעודת ה-SSL של הכתובת, ואז ישר לניהול
// ============================================================

/** הטקסטים של "מכינים את הכתובת" — ברירת המחדל: חנות (מיגרציה 40: גם עסק אירוח) */
type PreparingTexts = {
  created: string;
  entering: string;
  enterAnyway: string;
  enterFailed: string;
};

const STORE_PREPARING_TEXTS: PreparingTexts = {
  created: "החנות נוצרה ואתם המנהלים שלה",
  entering: "נכנסים לפאנל הניהול",
  enterAnyway: "להיכנס לחנות בכל זאת",
  enterFailed: "הכניסה לחנות נכשלה",
};

function PreparingStep({
  session,
  store,
  entering,
  onLeaving,
  texts = STORE_PREPARING_TEXTS,
}: {
  session: PortalSession;
  store: PortalStore;
  /** קוד הכניסה נוצר והדפדפן בדרך לחנות */
  entering: boolean;
  onLeaving: (leaving: boolean) => void;
  texts?: PreparingTexts;
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
      setError(errorText(thrown, texts.enterFailed));
    }
  }, [enterStore, onLeaving, store.id, texts.enterFailed]);

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
    { label: texts.created, state: "done" },
    {
      label: "מאבטחים את הכתובת (תעודת SSL)",
      state: ssl === "waiting" ? "active" : "done",
    },
    {
      label: texts.entering,
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
            {texts.enterAnyway}
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
