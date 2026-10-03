import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getCustomDomain,
  saveCustomDomain,
  verifyCustomDomain,
  type CustomDomainState,
  type VerifyResult,
} from "@/lib/custom-domain.functions";
import {
  CUSTOM_DOMAIN_STATUS_LABEL,
  customDomainProblem,
  dnsRecordName,
  isApexDomain,
  normalizeDomainInput,
  registrableDomain,
  type CustomDomainStatus,
} from "@/lib/custom-domain";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<CustomDomainStatus, string> = {
  pending: "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  verified: "border-sky-400 bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
  active: "border-green-500 bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-200",
  error: "border-destructive/50 bg-destructive/10 text-destructive",
};

const STATUS_ICON: Record<CustomDomainStatus, typeof Clock> = {
  pending: Clock,
  verified: ShieldCheck,
  active: CheckCircle2,
  error: XCircle,
};

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "";

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      <code
        dir="ltr"
        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] font-semibold"
      >
        {value}
      </code>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7"
        aria-label={`העתקת ${label}`}
        onClick={() => {
          void navigator.clipboard
            .writeText(value)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => toast.error("ההעתקה נכשלה — אפשר לסמן ולהעתיק ידנית"));
        }}
      >
        {copied ? (
          <CheckCircle2 className="size-4 text-green-600" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </Button>
    </span>
  );
}

/**
 * דומיין מותאם אישית: מנהל החנות מזין דומיין שרכש, מקבל הוראות ברורות
 * (רשומת CNAME אל <slug>.nuri1.fit, או A לדומיין ראשי), ולוחץ "אימות וחיבור
 * דומיין". השרת בודק את ה-DNS; אחרי אימות, סקריפט התעודות בשרת מחבר את
 * הדומיין ל-nginx ומנפיק SSL תוך כמה דקות — והמסך מתעדכן לבד ל"פעיל".
 */
export function CustomDomainPanel() {
  const load = useServerFn(getCustomDomain);
  const save = useServerFn(saveCustomDomain);
  const verify = useServerFn(verifyCustomDomain);

  const [state, setState] = useState<CustomDomainState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"save" | "remove" | "verify" | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);

  const refresh = useCallback(
    async (light = false) => {
      try {
        const next = await load({ data: { light } });
        setState((current) =>
          light && current ? { ...next, serverIps: current.serverIps } : next,
        );
        setLoadError(null);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "טעינת הגדרות הדומיין נכשלה");
      }
    },
    [load],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // אחרי אימות: התעודה מונפקת בשרת תוך כמה דקות — מתעדכנים לבד
  useEffect(() => {
    if (state?.status !== "verified") return;
    const timer = setInterval(() => void refresh(true), 20_000);
    return () => clearInterval(timer);
  }, [state?.status, refresh]);

  if (loadError && !state) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="flex flex-col items-start gap-3 pt-6 text-sm text-destructive">
          {loadError}
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            <RefreshCw className="size-4" />
            ניסיון נוסף
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!state) return <p className="text-sm text-muted-foreground">טוען את הגדרות הדומיין...</p>;

  const normalized = normalizeDomainInput(input);
  const inputProblem =
    input.trim() === "" ? null : customDomainProblem(normalized, state.baseDomain);
  const showForm = !state.domain || editing;
  const domain = state.domain;
  const status = state.status;
  const apex = domain ? isApexDomain(domain) : false;
  const recordName = domain ? dnsRecordName(domain) : "www";
  const serverIp = state.serverIps[0] ?? null;

  const submitDomain = async (event: React.FormEvent) => {
    event.preventDefault();
    const problem = customDomainProblem(normalized, state.baseDomain);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy("save");
    try {
      setState(await save({ data: { domain: normalized } }));
      setEditing(false);
      setInput("");
      setResult(null);
      toast.success(`הדומיין ${normalized} נשמר — עכשיו מוסיפים רשומת DNS ומאמתים`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שמירת הדומיין נכשלה");
    } finally {
      setBusy(null);
    }
  };

  const removeDomain = async () => {
    if (!domain) return;
    if (!window.confirm(`להסיר את הדומיין ${domain}? החנות תמשיך לעבוד בכתובת הקבועה שלה.`)) {
      return;
    }
    setBusy("remove");
    try {
      setState(await save({ data: { domain: "" } }));
      setResult(null);
      setEditing(false);
      toast.success("הדומיין הוסר");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "הסרת הדומיין נכשלה");
    } finally {
      setBusy(null);
    }
  };

  const runVerify = async () => {
    setBusy("verify");
    setResult(null);
    try {
      const outcome = await verify({ data: {} });
      setResult(outcome);
      setState(outcome.state);
      if (outcome.ok) toast.success("ה-DNS אומת! מכינים עכשיו תעודת SSL — זה לוקח עד כמה דקות");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "האימות נכשל");
    } finally {
      setBusy(null);
    }
  };

  const StatusIcon = status ? STATUS_ICON[status] : Clock;

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-xl gradient-brand text-primary-foreground">
          <Globe className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">דומיין משלכם</h2>
          <p className="text-sm text-muted-foreground">
            חיבור דומיין שרכשתם (למשל www.his-shop.co.il) לחנות — עם תעודת SSL אוטומטית
          </p>
        </div>
      </div>

      {/* ---------- הכתובות של החנות ---------- */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">הכתובות של החנות</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {state.storeHost && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-muted-foreground">כתובת קבועה (תמיד עובדת):</span>
              <a
                href={`https://${state.storeHost}`}
                target="_blank"
                rel="noreferrer"
                dir="ltr"
                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
              >
                {state.storeHost}
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          )}
          {domain && status && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">הדומיין שלכם:</span>
                {status === "active" ? (
                  <a
                    href={`https://${domain}`}
                    target="_blank"
                    rel="noreferrer"
                    dir="ltr"
                    className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                  >
                    <Lock className="size-3.5 text-green-600" />
                    {domain}
                    <ExternalLink className="size-3.5" />
                  </a>
                ) : (
                  <span dir="ltr" className="font-semibold">
                    {domain}
                  </span>
                )}
                <Badge variant="outline" className={cn("gap-1", STATUS_STYLE[status])}>
                  <StatusIcon className="size-3.5" aria-hidden="true" />
                  {CUSTOM_DOMAIN_STATUS_LABEL[status]}
                </Badge>
              </div>
              {status === "verified" && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ה-DNS אומת. השרת מוסיף את הדומיין ומנפיק תעודת SSL — בדרך כלל תוך 1–3 דקות. המסך
                  יתעדכן לבד.
                </p>
              )}
              {status === "active" && state.sslExpiresAt && (
                <p className="text-xs text-muted-foreground">
                  תעודת SSL פעילה עד {formatDate(state.sslExpiresAt)} — מתחדשת אוטומטית.
                </p>
              )}
              {status === "error" && state.error && (
                <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span dir="auto">{state.error}</span>
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- הזנת דומיין ---------- */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">
            {domain && !editing ? "הדומיין המחובר" : "חיבור דומיין"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {showForm ? (
            <form onSubmit={submitDomain} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="custom-domain">הדומיין שלכם</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="custom-domain"
                    dir="ltr"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="www.his-shop.co.il"
                    className="text-left sm:max-w-md"
                    value={input}
                    aria-invalid={inputProblem !== null}
                    onChange={(event) => setInput(event.target.value)}
                  />
                  <Button type="submit" disabled={busy !== null || input.trim() === ""}>
                    {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : null}
                    שמירת הדומיין
                  </Button>
                  {editing && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setEditing(false);
                        setInput("");
                      }}
                    >
                      ביטול
                    </Button>
                  )}
                </div>
                {inputProblem ? (
                  <p className="text-sm font-medium text-destructive">{inputProblem}</p>
                ) : input.trim() !== "" && normalized !== input.trim().toLowerCase() ? (
                  <p className="text-xs text-muted-foreground">
                    יישמר כ: <span dir="ltr">{normalized}</span>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    רק הדומיין, בלי https:// — למשל www.his-shop.co.il. מומלץ עם www.
                  </p>
                )}
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span dir="ltr" className="text-base font-semibold">
                {domain}
              </span>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                החלפת דומיין
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={busy !== null}
                onClick={() => void removeDomain()}
              >
                {busy === "remove" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                הסרה
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- הוראות + אימות ---------- */}
      {domain && !editing && status !== "active" && (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">איך מחברים את הדומיין — שלב אחר שלב</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 text-sm leading-6">
            <ol className="space-y-4">
              <li className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  1
                </span>
                <span>
                  היכנסו לאתר החברה שדרכה רכשתם את הדומיין{" "}
                  <strong dir="ltr">{registrableDomain(domain)}</strong> (למשל Box, Namecheap,
                  GoDaddy, LiveDNS) ופתחו את <strong>ניהול ה-DNS</strong> של הדומיין (DNS Records /
                  Zone Editor).
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  2
                </span>
                <div className="min-w-0 flex-1 space-y-2">
                  <p>
                    {apex
                      ? "הוסיפו רשומת A (לדומיין ראשי בלי www אי אפשר CNAME):"
                      : "הוסיפו רשומת CNAME חדשה:"}
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[28rem] text-right text-sm">
                      <thead className="bg-muted/60 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">סוג (Type)</th>
                          <th className="px-3 py-2 font-medium">שם (Name / Host)</th>
                          <th className="px-3 py-2 font-medium">ערך / יעד (Value / Target)</th>
                          <th className="px-3 py-2 font-medium">TTL</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t border-border">
                          <td className="px-3 py-2 font-mono font-semibold" dir="ltr">
                            {apex ? "A" : "CNAME"}
                          </td>
                          <td className="px-3 py-2">
                            <CopyValue value={recordName} label="שם הרשומה" />
                          </td>
                          <td className="px-3 py-2">
                            {apex ? (
                              serverIp ? (
                                <CopyValue value={serverIp} label="כתובת השרת" />
                              ) : (
                                <span className="text-xs text-destructive">
                                  כתובת השרת לא זמינה כרגע — רעננו את הדף
                                </span>
                              )
                            ) : (
                              <CopyValue value={state.storeHost ?? ""} label="יעד הרשומה" />
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">ברירת המחדל</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <ul className="list-disc space-y-1 ps-5 text-xs text-muted-foreground">
                    {!apex && (
                      <li>
                        כדי לחבר את הדומיין שלך, הוסף רשומת CNAME המפנה אל{" "}
                        <strong dir="ltr">{state.storeHost}</strong>.
                      </li>
                    )}
                    <li>
                      אם כבר קיימת רשומה בשם <span dir="ltr">{recordName}</span> (A, AAAA או CNAME)
                      — מחקו או ערכו אותה. לכל שם — רשומה אחת בלבד.
                    </li>
                    {!apex && (
                      <li>
                        יש רשמים שמבקשים לכתוב בשדה השם את הדומיין המלא (
                        <span dir="ltr">{domain}</span>) — גם זה תקין.
                      </li>
                    )}
                    {apex && (
                      <li>
                        מומלץ: לחבר במקום זה את <span dir="ltr">www.{domain}</span> (רשומת CNAME),
                        ולהגדיר אצל הרשם הפניה (Redirect) מ-<span dir="ltr">{domain}</span> אליו.
                      </li>
                    )}
                  </ul>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  3
                </span>
                <span>
                  שמרו את הרשומה והמתינו כמה דקות — עדכון DNS לוקח לרוב 5–30 דקות (לפעמים עד כמה
                  שעות).
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  4
                </span>
                <span>
                  לחצו על <strong>"אימות וחיבור דומיין"</strong>. אחרי שהאימות עובר, השרת מנפיק
                  תעודת SSL (מנעול) אוטומטית תוך כמה דקות, והחנות זמינה ב-
                  <span dir="ltr" className="font-semibold">
                    https://{domain}
                  </span>
                  .
                </span>
              </li>
            </ol>

            <div className="space-y-3 border-t border-border pt-4">
              <Button size="lg" disabled={busy !== null} onClick={() => void runVerify()}>
                {busy === "verify" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="size-4" />
                )}
                {busy === "verify" ? "בודק את ה-DNS..." : "אימות וחיבור דומיין"}
              </Button>

              {result && (
                <div
                  role={result.ok ? "status" : "alert"}
                  className={cn(
                    "space-y-2 rounded-lg border p-3 text-sm",
                    result.ok
                      ? "border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200"
                      : "border-destructive/40 bg-destructive/5 text-destructive",
                  )}
                >
                  <p className="flex items-start gap-2 font-medium">
                    {result.ok ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    )}
                    <span dir="auto">{result.message}</span>
                  </p>
                  {(result.found.cnames.length > 0 ||
                    result.found.a.length > 0 ||
                    result.found.aaaa.length > 0) && (
                    <div className="text-xs opacity-90">
                      <p className="font-medium">מה רשום כרגע ב-DNS של {domain}:</p>
                      <ul dir="ltr" className="mt-1 space-y-0.5 text-left font-mono">
                        {result.found.cnames.map((value) => (
                          <li key={`c-${value}`}>CNAME → {value}</li>
                        ))}
                        {result.found.a.map((value) => (
                          <li key={`a-${value}`}>A → {value}</li>
                        ))}
                        {result.found.aaaa.map((value) => (
                          <li key={`aaaa-${value}`}>AAAA → {value}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {state.checkedAt && status !== "pending" && (
                <p className="text-xs text-muted-foreground">
                  בדיקה אחרונה של השרת: {formatDate(state.checkedAt)}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {domain && status === "active" && (
        <Card className="border-green-300 shadow-card dark:border-green-800">
          <CardContent className="flex flex-wrap items-center gap-3 pt-6 text-sm">
            <CheckCircle2 className="size-5 text-green-600" aria-hidden="true" />
            <span>
              הדומיין מחובר ופעיל עם SSL. קישורים במיילים ללקוחות (הזמנות, איפוס סיסמה) מפנים מעכשיו
              ל-
              <span dir="ltr" className="font-semibold">
                https://{domain}
              </span>
              .
            </span>
            <Button
              size="sm"
              variant="outline"
              className="ms-auto"
              disabled={busy !== null}
              onClick={() => void runVerify()}
            >
              {busy === "verify" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              בדיקת DNS מחדש
            </Button>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
