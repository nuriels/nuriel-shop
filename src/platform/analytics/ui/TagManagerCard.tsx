// Google Tag Manager — הכרטיס של בעל העסק (שני המנועים). שדה אחד למזהה Container ומתג. אין כאן מקום
// לקוד: את התגים מגדירים בתוך Google Tag Manager עצמו. המזהה נבדק כאן, בשרת ובמסד.
import { useEffect, useId, useState } from "react";
import { Loader2, Save, Tags } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Switch,
} from "@/platform/ui";
import { GTM_PAGE_VIEW_EVENT, normalizeGtmId, type MyTagManager } from "../gtm";
import { getMyTagManager, saveMyTagManagerFn } from "../gtm.functions";

function messageOf(error: unknown): string {
  return error instanceof Error && /[֐-׿]/.test(error.message)
    ? error.message
    : "הפעולה נכשלה — נסו שוב";
}

export function TagManagerCard(props: {
  /** בעל העסק או מנהל הפלטפורמה (מיגרציה 199; בחנות — בעל החנות) — אחרים רואים הסבר בלבד */
  canManage: boolean;
  /** באתר מוגדר גם Google Analytics ישיר — אזהרת ספירה כפולה */
  directGa4?: boolean;
  /** צימר: ההסכמה באתר היא למדידה בלבד (פרסום חסום) */
  measurementOnly?: boolean;
}) {
  const inputId = useId();
  const hintId = useId();
  const [saved, setSaved] = useState<MyTagManager | null>(null);
  const [containerId, setContainerId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!props.canManage) return;
    let live = true;
    getMyTagManager()
      .then((row) => {
        if (!live) return;
        setSaved(row);
        setContainerId(row.container_id ?? "");
        setEnabled(row.enabled);
      })
      .catch((e: unknown) => live && setError(messageOf(e)));
    return () => {
      live = false;
    };
  }, [props.canManage]);

  let formatProblem: string | null = null;
  try {
    normalizeGtmId(containerId);
  } catch (e) {
    formatProblem = messageOf(e);
  }
  const changed =
    saved !== null &&
    ((saved.container_id ?? "") !== containerId.trim().toUpperCase() || saved.enabled !== enabled);

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const row = await saveMyTagManagerFn({ data: { containerId, enabled } });
      setSaved(row);
      setContainerId(row.container_id ?? "");
      setEnabled(row.enabled);
      setNotice(
        row.enabled
          ? "נשמר. Tag Manager ייטען באתר אחרי הסכמה לעוגיות."
          : "נשמר. Tag Manager כבוי.",
      );
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="tag-manager-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Tags className="size-5" aria-hidden="true" />
          Google Tag Manager
        </CardTitle>
        <CardDescription>
          מזינים רק את מזהה ה-Container (GTM-XXXXXXX). אין כאן מקום לקוד או ל-HTML — את התגים
          מגדירים בתוך Google Tag Manager עצמו.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!props.canManage ? (
          <p className="text-sm text-muted-foreground">
            רק בעל העסק יכול לחבר את האתר ל-Google Tag Manager.
          </p>
        ) : saved === null && !error ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> טוען…
          </p>
        ) : (
          <>
            <div className="space-y-1.5 sm:max-w-sm">
              <Label htmlFor={inputId}>מזהה Container</Label>
              <Input
                id={inputId}
                dir="ltr"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="GTM-XXXXXXX"
                maxLength={16}
                value={containerId}
                onChange={(e) => setContainerId(e.target.value)}
                aria-invalid={formatProblem !== null}
                aria-describedby={hintId}
                data-testid="gtm-container-id"
              />
              <p
                id={hintId}
                className={
                  formatProblem ? "text-xs text-destructive" : "text-xs text-muted-foreground"
                }
              >
                {formatProblem ??
                  "ב-Google Tag Manager ← Admin ← Container Settings ← Container ID"}
              </p>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 sm:max-w-sm">
              <span className="text-sm font-medium">הפעלה באתר</span>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                aria-label="הפעלת Google Tag Manager באתר"
                data-testid="gtm-enabled"
              />
            </label>

            <ul className="list-disc space-y-1 ps-5 text-xs leading-5 text-muted-foreground">
              <li>Tag Manager נטען רק אחרי שהגולש אישר עוגיות, עם Consent Mode. לפני כן — כלום.</li>
              <li>
                בכל עמוד, גם במעבר בין עמודים בלי טעינה מחדש, האתר שולח אירוע אחד בשם{" "}
                <code dir="ltr">{GTM_PAGE_VIEW_EVENT}</code>. בתוך ה-Container — הפעילו עליו את תג
                הצפייה בעמוד (Custom Event), ולא על History Change, כדי שכל עמוד ייספר פעם אחת.
              </li>
              <li>לא נטען באזורי הניהול, בחשבון הלקוח ובתצוגה המקדימה.</li>
              {props.measurementOnly ? (
                <li data-testid="gtm-measurement-only">
                  באתר הזה הגולש מאשר מדידה בלבד: אותות הפרסום של Google נשארים חסומים. אל תוסיפו
                  ל-Container תגי פרסום או תגים שאינם של Google (למשל Pixel) — הם לא כפופים
                  ל-Consent Mode, והגולש לא אישר אותם.
                </li>
              ) : null}
            </ul>

            {props.directGa4 && enabled ? (
              <p
                className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs leading-5 text-amber-950"
                role="note"
                data-testid="gtm-duplicate-warning"
              >
                באתר מוגדר גם Google Analytics ישיר — האתר טוען אותו פעם אחת ושולח אליו את הצפיות
                בעצמו. אל תוסיפו ב-Container תג GA4 (Google tag) לאותו נכס, אחרת כל צפייה תיספר
                פעמיים.
              </p>
            ) : null}
            {saved && !saved.loads_on_site ? (
              <p
                className="rounded-md border border-border bg-muted/40 p-2 text-xs leading-5"
                role="note"
                data-testid="gtm-not-loading"
              >
                המדידה באתר הזה כבויה כרגע בפלטפורמה. אפשר לשמור את המזהה; הוא ייטען רק אחרי שהמדידה
                תופעל לאתר.
              </p>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p className="text-sm text-green-700" role="status">
                {notice}
              </p>
            ) : null}
            <Button
              type="button"
              onClick={() => void save()}
              disabled={
                busy || formatProblem !== null || !changed || (enabled && containerId.trim() === "")
              }
              data-testid="gtm-save"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              שמירת Tag Manager
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
