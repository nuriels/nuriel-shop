// Google Analytics 4 (מיגרציה 199) — הכרטיס של בעל העסק: שדה אחד למזהה המדידה (G-XXXXXXXXXX). נשמר
// בהגדרות של העסק הזה בלבד (public.site_tracking, לפי ה-Host — אף פעם לא לפי קלט מהדפדפן), ונבדק כאן,
// בשרת ובמסד. הטעינה באתר — המנגנון הקיים של המנוע (אחרי הסכמה לעוגיות, Consent Mode).
import { useEffect, useId, useState } from "react";
import { ChartNoAxesColumn, Loader2, Save } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@/platform/ui";
import { normalizeGa4Id, type MyTagManager } from "../gtm";
import { getMyTagManager, saveMyGa4Fn } from "../gtm.functions";

function messageOf(error: unknown): string {
  return error instanceof Error && /[֐-׿]/.test(error.message)
    ? error.message
    : "השמירה נכשלה — נסו שוב";
}

export function Ga4Card(props: {
  /** בעל העסק או מנהל הפלטפורמה — אחרים רואים הסבר בלבד */
  canManage: boolean;
  /** אחרי טעינה / שמירה — המזהה השמור (לאזהרת כפילות בכרטיס של Tag Manager) */
  onSaved?: (ga4: string | null) => void;
}) {
  const { canManage, onSaved } = props;
  const inputId = useId();
  const hintId = useId();
  const [saved, setSaved] = useState<MyTagManager | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    let live = true;
    getMyTagManager()
      .then((row) => {
        if (!live) return;
        setSaved(row);
        setValue(row.ga4_id ?? "");
        onSaved?.(row.ga4_id ?? null);
      })
      .catch((e: unknown) => live && setError(messageOf(e)));
    return () => {
      live = false;
    };
  }, [canManage, onSaved]);

  let formatProblem: string | null = null;
  let clean: string | null = null;
  try {
    clean = normalizeGa4Id(value);
  } catch (e) {
    formatProblem = messageOf(e);
  }
  const changed = saved !== null && formatProblem === null && (saved.ga4_id ?? null) !== clean;

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const row = await saveMyGa4Fn({ data: { measurementId: value } });
      setSaved(row);
      setValue(row.ga4_id ?? "");
      onSaved?.(row.ga4_id ?? null);
      setNotice(
        !row.ga4_id
          ? "המזהה הוסר. Google Analytics לא ייטען באתר."
          : row.loads_on_site
            ? `נשמר: ${row.ga4_id}. Google Analytics ייטען באתר אחרי הסכמה לעוגיות.`
            : `נשמר: ${row.ga4_id}. המדידה באתר עדיין כבויה בפלטפורמה — המזהה ייטען רק אחרי שתופעל.`,
      );
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="ga4-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ChartNoAxesColumn className="size-5" aria-hidden="true" />
          Google Analytics 4
        </CardTitle>
        <CardDescription>
          מזהה המדידה (Measurement ID) של הנכס ב-Google Analytics, למשל G-XXXXXXXXXX. האתר שולח אליו
          צפיות בעמודים, צפייה ביחידות, התחלת הזמנה, בקשת הזמנה ולחיצות על טלפון / וואטסאפ — בלי
          פרטים אישיים.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canManage ? (
          <p className="text-sm text-muted-foreground">
            רק בעל העסק יכול לחבר את האתר ל-Google Analytics.
          </p>
        ) : saved === null && !error ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> טוען…
          </p>
        ) : (
          <>
            <div className="space-y-1.5 sm:max-w-sm">
              <Label htmlFor={inputId}>מזהה המדידה (Measurement ID)</Label>
              <Input
                id={inputId}
                dir="ltr"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="G-XXXXXXXXXX"
                maxLength={20}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setNotice(null);
                }}
                aria-invalid={formatProblem !== null}
                aria-describedby={hintId}
                data-testid="ga4-measurement-id"
              />
              <p
                id={hintId}
                className={
                  formatProblem ? "text-xs text-destructive" : "text-xs text-muted-foreground"
                }
              >
                {formatProblem ??
                  "ב-Google Analytics ← Admin ← Data streams ← Web ← Measurement ID. ריק — בלי GA4."}
              </p>
            </div>

            <ul className="list-disc space-y-1 ps-5 text-xs leading-5 text-muted-foreground">
              <li>
                נטען רק אחרי שהגולש אישר עוגיות מדידה (Consent Mode). לפני כן — שום קוד של Google.
              </li>
              <li>נשמר לאתר הזה בלבד. לא נטען באזור הניהול ובתצוגה המקדימה.</li>
            </ul>

            {saved && !saved.loads_on_site ? (
              <p
                className="rounded-md border border-border bg-muted/40 p-2 text-xs leading-5"
                role="note"
                data-testid="ga4-not-loading"
              >
                המדידה באתר הזה כבויה כרגע בפלטפורמה. אפשר לשמור את המזהה; הוא ייטען רק אחרי שהמדידה
                תופעל לאתר.
              </p>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert" data-testid="ga4-error">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p className="text-sm text-green-700" role="status" data-testid="ga4-notice">
                {notice}
              </p>
            ) : null}
            <Button
              type="button"
              onClick={() => void save()}
              disabled={busy || formatProblem !== null || !changed}
              data-testid="ga4-save"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              שמירת Google Analytics
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
