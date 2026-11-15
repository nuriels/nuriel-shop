import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { refreshSiteSettings } from "@/hooks/useSiteSettings";
import type { SiteSettings } from "@/lib/site";
import { BUSINESS_TYPE_OPTIONS, vatPriceNotice, type StoreBusinessType } from "@/lib/vat";
import { cn } from "@/lib/utils";

const INCLUDE_OPTIONS: { value: boolean; label: string; hint: string }[] = [
  {
    value: true,
    label: "כן — המחירים כוללים מע״מ",
    hint: "המחיר שבאתר הוא הסופי. לא מתווסף מע״מ בקופה.",
  },
  {
    value: false,
    label: "לא — המחירים לפני מע״מ",
    hint: "בסיכום ההזמנה ובקופה יתווסף מע״מ, ויוצגו בנפרד: לפני מע״מ, מע״מ וסה״כ.",
  },
];

/**
 * מיגרציה 191: סוג העוסק של החנות והאם המחירים כוללים מע"מ — הגדרה עצמאית של כל חנות. נשמר רק
 * בידי בעל העסק (store_save_vat_settings), בכפתור משלו. השיעור עצמו מרכזי (18% היום) ולא נערך כאן.
 */
export function VatSettingsCard({
  settings,
  canManage,
  billingSaysExempt,
}: {
  settings: SiteSettings;
  /** בעל העסק (או מנהל-על) */
  canManage: boolean;
  /** בפרטי החיוב מול הפלטפורמה מוגדר "עוסק פטור" — רמז בלבד */
  billingSaysExempt: boolean;
}) {
  const router = useRouter();
  const [type, setType] = useState<StoreBusinessType>(settings.business_type);
  const [included, setIncluded] = useState<boolean>(settings.prices_include_vat);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setType(settings.business_type);
    setIncluded(settings.prices_include_vat);
  }, [settings.business_type, settings.prices_include_vat]);

  const exempt = type === "exempt";
  const changed =
    type !== settings.business_type || (!exempt && included !== settings.prices_include_vat);
  const centralRate = settings.business_type === "exempt" ? null : settings.vat_rate;
  const notice = vatPriceNotice({
    businessType: type,
    pricesIncludeVat: exempt ? true : included,
    vatRate: exempt ? 0 : (centralRate ?? 18),
  });

  const save = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("store_save_vat_settings", {
        _business_type: type,
        _prices_include_vat: exempt ? null : included,
      });
      if (error) throw new Error(error.message);
      await refreshSiteSettings();
      await router.invalidate();
      toast.success("הגדרות המע״מ נשמרו");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שמירת הגדרות המע״מ נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="shadow-card" data-testid="vat-settings">
      <CardHeader>
        <CardTitle className="text-base">מע״מ וסוג עוסק</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!settings.vat_settings_confirmed && (
          <p
            className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950"
            role="note"
            data-vat-unconfirmed
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              <strong>יש לאשר את סוג העוסק ואת הגדרת המע״מ של החנות.</strong> ההגדרה קובעת אם ייגבה
              מע״מ מהלקוחות. כרגע מוגדר:{" "}
              {settings.business_type === "exempt" ? "עוסק פטור" : "עוסק מורשה"}
              {settings.business_type === "exempt"
                ? ""
                : settings.prices_include_vat
                  ? ", המחירים כוללים מע״מ"
                  : ", המחירים לפני מע״מ"}
              . {canManage ? "בדקו ולחצו על השמירה." : "בעל העסק יכול לאשר את זה כאן."}
            </span>
          </p>
        )}

        <fieldset className="space-y-2" data-business-type disabled={!canManage || busy}>
          <legend className="text-sm font-medium">סוג העוסק</legend>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="סוג העוסק">
            {BUSINESS_TYPE_OPTIONS.map((option) => {
              const selected = type === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!canManage || busy}
                  onClick={() => setType(option.value)}
                  className={cn(
                    "rounded-lg border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70",
                    selected
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:bg-secondary/60",
                  )}
                >
                  <span className="block text-sm font-semibold text-foreground">
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    {option.hint}
                  </span>
                </button>
              );
            })}
          </div>
          {billingSaysExempt && !exempt && (
            <p
              className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs leading-5 text-amber-950"
              role="note"
            >
              בפרטי החיוב שלך מוגדר &quot;עוסק פטור&quot;. אם זה נכון גם לחנות — בחרו כאן &quot;עוסק
              פטור / זעיר&quot;, כדי שלא ייגבה מע״מ מהלקוחות.
            </p>
          )}
        </fieldset>

        {exempt ? (
          <p
            className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm leading-6 text-foreground"
            data-vat-locked
          >
            <strong>עוסק פטור — המע״מ נעול על 0%.</strong> המחירים בקטלוג הם המחיר הסופי ללקוח: בלי
            &quot;+ מע״מ&quot; ליד המחיר, בלי שורת מע״מ בסל ובקופה, ובמסמכי ההזמנה יופיע &quot;עוסק
            פטור — ללא מע״מ&quot;. שום הגדרה לא מוסיפה מע״מ.
          </p>
        ) : (
          <fieldset className="space-y-2" disabled={!canManage || busy} data-prices-include-vat>
            <legend className="text-sm font-medium">האם המחירים באתר כוללים מע״מ?</legend>
            <div
              className="grid gap-2 sm:grid-cols-2"
              role="radiogroup"
              aria-label="האם המחירים באתר כוללים מע״מ?"
            >
              {INCLUDE_OPTIONS.map((option) => {
                const selected = included === option.value;
                return (
                  <button
                    key={String(option.value)}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={!canManage || busy}
                    onClick={() => setIncluded(option.value)}
                    className={cn(
                      "rounded-lg border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70",
                      selected
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:bg-secondary/60",
                    )}
                  >
                    <span className="block text-sm font-semibold text-foreground">
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                      {option.hint}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              שיעור המע״מ: <span className="numeric font-medium">{centralRate ?? 18}%</span> — נקבע
              מרכזית בפלטפורמה לפי החוק, ומחושב בשרת בכל הזמנה. כל הזמנה שומרת את השיעור של היום שבו
              נוצרה.
            </p>
            {!included && (
              <p
                className="rounded-md border border-border bg-secondary/40 p-2 text-xs leading-5 text-foreground"
                role="note"
              >
                לתשומת לבכם: במכירה לצרכן פרטי, החוק מחייב בדרך כלל להציג את המחיר המלא כולל מע״מ.
                מחירים לפני מע״מ מתאימים בעיקר למכירה לעסקים. במקרה של ספק — כדאי לבדוק עם רואה
                החשבון.
              </p>
            )}
          </fieldset>
        )}

        <div className="rounded-lg border border-border p-3 text-sm" data-vat-preview>
          <span className="text-muted-foreground">מה הלקוחות יראו: </span>
          <span className="font-medium text-foreground">{notice}</span>
        </div>

        {canManage ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              השינוי חל על הזמנות חדשות בלבד. הזמנות קיימות שומרות את מצב המע״מ שלהן.
            </p>
            <Button
              type="button"
              onClick={save}
              disabled={busy || (!changed && settings.vat_settings_confirmed)}
              data-testid="vat-settings-save"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {changed || settings.vat_settings_confirmed ? "שמירת הגדרות המע״מ" : "אישור ההגדרה"}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            רק בעל העסק יכול לשנות את סוג העוסק ואת הגדרות המע״מ.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
