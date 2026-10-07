import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Crown, Globe, Loader2, Save, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSubscription } from "@/hooks/useSubscription";
import {
  getCustomDomain,
  saveCustomDomain,
  type CustomDomainState,
} from "@/lib/custom-domain.functions";
import { CUSTOM_DOMAIN_STATUS_LABEL, domainInputFormatProblem } from "@/lib/custom-domain";

/**
 * "דומיין אישי" בלשונית "הגדרות אתר" (חלק 30) — שדה מקוצר לאותו מנגנון של
 * לשונית "דומיין פרטי" (חלק 9): שמירה ב-saveCustomDomain, והאימות, ההוראות
 * המלאות ותעודת ה-SSL — שם. כמו הלשונית, פתוח בחבילת פרימיום או עם התוסף.
 */
export function CustomDomainSettingsCard({ onOpenDomainTab }: { onOpenDomainTab: () => void }) {
  const { can } = useSubscription();
  const unlocked = can("customDomain");
  const load = useServerFn(getCustomDomain);
  const save = useServerFn(saveCustomDomain);
  const [state, setState] = useState<CustomDomainState | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    load({ data: { light: true } })
      .then((next) => {
        if (!alive) return;
        setState(next);
        setValue(next.domain ?? "");
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [load]);

  const target = state?.cnameTarget ?? "shops.nuri1.fit";
  const dirty = value.trim().toLowerCase() !== (state?.domain ?? "");

  const submit = async () => {
    const formatProblem = domainInputFormatProblem(value);
    if (formatProblem) {
      setProblem(formatProblem);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const next = await save({ data: { domain: value } });
      setState(next);
      setValue(next.domain ?? "");
      toast.success(
        next.domain
          ? `הדומיין ${next.domain} נשמר — עכשיו מפנים אליו רשומת CNAME ובודקים בלשונית "דומיין פרטי"`
          : "הדומיין האישי הוסר",
      );
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "שמירת הדומיין נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const copyTarget = async () => {
    try {
      await navigator.clipboard.writeText(target);
      toast.success("הכתובת הועתקה");
    } catch {
      toast.error("ההעתקה נכשלה — סמנו והעתיקו ידנית");
    }
  };

  return (
    <Card data-testid="custom-domain-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Globe className="size-5 text-primary" aria-hidden="true" />
          דומיין אישי
          <Badge variant="outline" className="font-normal">
            מתקדם
          </Badge>
        </CardTitle>
        <CardDescription>
          כתובת משלכם לחנות (למשל <span dir="ltr">www.my-shop.co.il</span>) במקום{" "}
          <span dir="ltr">{state?.storeHost ?? "הסאב-דומיין של החנות"}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!unlocked ? (
          <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
            <Crown className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            דומיין אישי זמין בחבילת פרימיום, או כתוסף לחבילה הבסיסית (&quot;שדרוגים ותוספים&quot;).
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="settings-custom-domain">הדומיין שלכם</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="settings-custom-domain"
                  dir="ltr"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="www.my-shop.co.il"
                  value={value}
                  disabled={state === null || busy}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setProblem(null);
                  }}
                />
                <Button
                  onClick={() => void submit()}
                  disabled={state === null || busy || !dirty}
                  className="shrink-0"
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="size-4" aria-hidden="true" />
                  )}
                  {value.trim() === "" && state?.domain ? "הסרת הדומיין" : "שמירה"}
                </Button>
              </div>
              {state?.domain && state.status && (
                <p className="text-xs text-muted-foreground">
                  מצב: <strong>{CUSTOM_DOMAIN_STATUS_LABEL[state.status]}</strong>
                  {state.status === "error" && state.error ? ` — ${state.error}` : ""}
                </p>
              )}
              {problem && (
                <p role="alert" className="text-sm text-destructive">
                  {problem}
                </p>
              )}
            </div>
          </>
        )}

        <div className="space-y-1.5 rounded-lg bg-secondary/60 px-3 py-2.5 text-sm">
          <p>כדי שהדומיין יעבוד, עליך להפנות רשומת CNAME אל הכתובת של הפלטפורמה:</p>
          <div className="flex flex-wrap items-center gap-2">
            <code dir="ltr" className="rounded bg-card px-2 py-1 font-mono text-sm">
              {target}
            </code>
            <Button type="button" variant="ghost" size="sm" onClick={() => void copyTarget()}>
              <Copy className="size-4" aria-hidden="true" />
              העתקה
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            את הרשומה מוסיפים באתר שבו קניתם את הדומיין. אחרי השמירה — &quot;אימות וחיבור&quot;
            בלשונית &quot;דומיין פרטי&quot;, ותעודת אבטחה (SSL) מונפקת אוטומטית.
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={onOpenDomainTab}>
          <Settings2 className="size-4" aria-hidden="true" />
          הוראות מלאות ואימות הדומיין
        </Button>
      </CardContent>
    </Card>
  );
}
