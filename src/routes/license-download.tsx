import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Mail,
  Phone,
  ShieldCheck,
} from "lucide-react";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuthState } from "@/hooks/useAuthState";
import {
  DOWNLOAD_TOKEN_FORMAT,
  LICENSE_PRODUCT_LABEL,
  formatBytes,
  formatDateTimeHe,
  isLicenseProduct,
} from "@/lib/licenses";

type Search = { e?: string | undefined };

export const Route = createFileRoute("/license-download")({
  ssr: false,
  head: () => ({
    meta: [{ title: "הורדת תוכנת ההתקנה" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  validateSearch: (search: Record<string, unknown>): Search =>
    typeof search["e"] === "string" ? { e: search["e"].slice(0, 20) } : {},
  component: LicenseDownloadPage,
});

type Check = {
  state: string;
  product: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  remaining: number | null;
  maxDownloads: number | null;
  expiresAt: string | null;
  store: {
    name: string;
    phone: string | null;
    email: string | null;
    logoUrl: string | null;
  } | null;
};

const STORAGE_KEY = "nuriel-license-download";

const MESSAGES: Record<string, { title: string; body: string }> = {
  exhausted: {
    title: "נוצלו כל ההורדות של הקישור",
    body: "הקישור מאפשר עד 3 הורדות, וכולן נוצלו. לקבלת קישור חדש — פנו אלינו ונשלח לכם מיד.",
  },
  expired: {
    title: "תוקף הקישור הסתיים",
    body: "קישור ההורדה תקף ל-7 ימים. לקבלת קישור חדש — פנו אלינו ונשלח לכם מיד.",
  },
  revoked: {
    title: "הקישור הוחלף",
    body: "נשלח אליכם קישור חדש יותר. השתמשו בקישור מהמייל האחרון, או פנו אלינו.",
  },
  not_found: {
    title: "הקישור אינו תקין",
    body: 'ודאו שפתחתם את הקישור המלא מהמייל (הכפתור "להורדת תוכנת ההתקנה").',
  },
  rate_limited: {
    title: "יותר מדי ניסיונות",
    body: "נסו שוב בעוד כמה דקות.",
  },
  error: {
    title: "תקלה זמנית",
    body: "לא הצלחנו להכין את ההורדה כרגע. נסו שוב בעוד רגע.",
  },
};

/**
 * הורדת תוכנת ההתקנה מהקישור שבמייל הרישיון. ה-Token נמצא אחרי # בכתובת — הדפדפן לא שולח
 * אותו לשרת בפתיחת העמוד (לא ביומני השרת, וסורקי קישורים במיילים לא "מנצלים" הורדות).
 * העמוד קורא אותו, מסיר אותו משורת הכתובת, בודק את הקישור, וההורדה עצמה — POST בלחיצה.
 * כל ההגבלות (7 ימים, 3 הורדות, ביטול, חנות) נאכפות בשרת.
 */
function LicenseDownloadPage() {
  const { e: errorFromServer } = Route.useSearch();
  const { session, role } = useAuthState();
  const [token, setToken] = useState<string | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [loading, setLoading] = useState(true);
  const [started, setStarted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const runCheck = useCallback(async (value: string) => {
    try {
      const response = await fetch("/api/license-download/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: value }),
      });
      setCheck((await response.json()) as Check);
    } catch {
      setCheck({ state: "error" } as Check);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let value = window.location.hash.replace(/^#/, "");
    try {
      if (DOWNLOAD_TOKEN_FORMAT.test(value)) sessionStorage.setItem(STORAGE_KEY, value);
      else value = sessionStorage.getItem(STORAGE_KEY) ?? "";
    } catch {
      /* בלי sessionStorage — ממשיכים עם מה שבכתובת */
    }
    // ה-Token לא נשאר בשורת הכתובת (שיתוף / צילום מסך)
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    if (!DOWNLOAD_TOKEN_FORMAT.test(value)) {
      setCheck({ state: "not_found" } as Check);
      setLoading(false);
      return;
    }
    setToken(value);
    void runCheck(value);
  }, [runCheck]);

  const onDownload = () => {
    setStarted(true);
    // הדפדפן מוריד את הקובץ ונשאר בעמוד; אחרי כמה שניות — מספר ההורדות המעודכן
    window.setTimeout(() => {
      if (token) void runCheck(token);
    }, 4000);
  };

  const state =
    errorFromServer && errorFromServer !== "valid" && !started ? errorFromServer : check?.state;
  const product =
    check?.product && isLicenseProduct(check.product) ? LICENSE_PRODUCT_LABEL[check.product] : null;
  const message = state && state !== "valid" ? (MESSAGES[state] ?? MESSAGES["not_found"]!) : null;

  return (
    <div className="flex min-h-screen flex-col bg-muted/30" dir="rtl">
      <SiteHeader
        role={role}
        email={session?.user.email ?? null}
        onSignOut={async () => {
          await supabase.auth.signOut({ scope: "local" });
        }}
      />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        <Card className="overflow-hidden border-0 shadow-lg">
          <div className="bg-gradient-to-l from-[#0B1F4D] to-[#1F5FD6] px-6 py-6 text-white">
            <div className="flex items-center gap-3">
              <ShieldCheck className="size-7 shrink-0" aria-hidden />
              <div>
                <h1 className="text-xl font-bold">הורדת תוכנת ההתקנה</h1>
                <p className="text-sm text-white/90">
                  {product ? `רישיון דיגיטלי · ${product}` : "קישור אישי ומאובטח"}
                </p>
              </div>
            </div>
          </div>
          <CardContent className="space-y-5 p-6" aria-live="polite">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" aria-hidden /> בודקים את הקישור…
              </div>
            ) : message ? (
              <div
                className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-900"
                role="alert"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
                  <div>
                    <p className="font-bold">{message.title}</p>
                    <p className="mt-1 text-sm leading-relaxed">{message.body}</p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div className="col-span-2 rounded-lg bg-muted/60 p-3">
                    <dt className="text-muted-foreground">הקובץ</dt>
                    <dd className="mt-0.5 font-semibold" dir="ltr">
                      {check?.fileName}
                      {check?.sizeBytes ? (
                        <span className="ms-2 text-xs font-normal text-muted-foreground">
                          ({formatBytes(check.sizeBytes)})
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-muted/60 p-3">
                    <dt className="text-muted-foreground">הורדות שנותרו</dt>
                    <dd className="mt-0.5 font-semibold">
                      {check?.remaining} מתוך {check?.maxDownloads}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-muted/60 p-3">
                    <dt className="text-muted-foreground">בתוקף עד</dt>
                    <dd className="mt-0.5 font-semibold">{formatDateTimeHe(check?.expiresAt)}</dd>
                  </div>
                </dl>

                <form
                  ref={formRef}
                  method="POST"
                  action="/api/license-download/file"
                  onSubmit={onDownload}
                >
                  <input type="hidden" name="token" value={token ?? ""} />
                  <Button type="submit" size="lg" className="h-14 w-full gap-2 text-lg font-bold">
                    <Download className="size-5" aria-hidden /> להורדת תוכנת ההתקנה
                  </Button>
                </form>
                {started ? (
                  <p className="flex items-center gap-2 text-sm text-emerald-700">
                    <CheckCircle2 className="size-4" aria-hidden /> ההורדה התחילה. הקובץ יופיע
                    בתיקיית ההורדות.
                  </p>
                ) : null}
                <p className="text-sm leading-relaxed text-muted-foreground">
                  התוכנה מיועדת למחשב Windows. מדריך ההתקנה (PDF) ומפתח הרישיון נמצאים במייל
                  שקיבלתם.
                </p>
              </>
            )}

            {check?.store && (check.store.phone || check.store.email) ? (
              <div className="border-t pt-4 text-sm">
                <p className="font-semibold">צריכים עזרה? {check.store.name}</p>
                <div className="mt-2 flex flex-wrap gap-4 text-muted-foreground">
                  {check.store.phone ? (
                    <a
                      className="flex items-center gap-1.5 hover:text-foreground"
                      href={`tel:${check.store.phone.replace(/[^\d+]/g, "")}`}
                    >
                      <Phone className="size-4" aria-hidden />
                      <span dir="ltr">{check.store.phone}</span>
                    </a>
                  ) : null}
                  {check.store.email ? (
                    <a
                      className="flex items-center gap-1.5 hover:text-foreground"
                      href={`mailto:${check.store.email}`}
                    >
                      <Mail className="size-4" aria-hidden />
                      <span dir="ltr">{check.store.email}</span>
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </main>
      <AppFooter />
    </div>
  );
}
