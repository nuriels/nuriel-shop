import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, PhoneCall, Smartphone, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { refreshSiteSettings, useSiteSettings } from "@/hooks/useSiteSettings";
import { saveOfflinePaymentSettings } from "@/lib/site";
import {
  BIT_PAYMENT_WINDOW_HOURS,
  bitPhoneProblem,
  formatBitPhone,
  normalizeBitPhone,
  offlinePaymentSettingsProblem,
  type OfflinePaymentSettings,
} from "@/lib/bit-payments";
import { cn } from "@/lib/utils";

/**
 * "אמצעי תשלום חלופיים (אופליין)" בהגדרות החנות (חלק 17ב):
 *  • תשלום טלפוני מול נציג — מופעל כברירת מחדל.
 *  • תשלום בביט — מחייב מספר נייד לקבלת התשלום. הלקוח מעביר בביט, שולח
 *    אסמכתא / צילום מסך, ובעל החנות מאשר את התשלום במסך ההזמנות.
 * נשמר בכפתור משלו (לא עם טופס הגדרות האתר). המסד בודק שוב את הכול.
 */
export function OfflinePaymentMethodsCard() {
  const { settings } = useSiteSettings();
  const [form, setForm] = useState<OfflinePaymentSettings | null>(null);
  const [saved, setSaved] = useState<OfflinePaymentSettings | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);

  // ההגדרות השמורות (פעם אחת כשנטענו) — לא דורסים הקלדה
  useEffect(() => {
    if (!settings || saved) return;
    const current: OfflinePaymentSettings = {
      phoneEnabled: settings.payment_phone_enabled ?? true,
      bitEnabled: settings.payment_bit_enabled ?? false,
      bitPhone: formatBitPhone(settings.payment_bit_phone),
    };
    setSaved(current);
    setForm(current);
  }, [settings, saved]);

  if (!form || !saved) {
    return (
      <Card className="shadow-card">
        <CardContent className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          טוען את אמצעי התשלום…
        </CardContent>
      </Card>
    );
  }

  const problem = offlinePaymentSettingsProblem(form);
  const phoneProblem = bitPhoneProblem(form.bitPhone);
  const bitPhoneMissing = form.bitEnabled && normalizeBitPhone(form.bitPhone) === "";
  const dirty =
    form.phoneEnabled !== saved.phoneEnabled ||
    form.bitEnabled !== saved.bitEnabled ||
    normalizeBitPhone(form.bitPhone) !== normalizeBitPhone(saved.bitPhone);

  const patch = (next: Partial<OfflinePaymentSettings>) =>
    setForm((current) => (current ? { ...current, ...next } : current));

  const save = async () => {
    setAttempted(true);
    if (problem) {
      toast.error(problem);
      if (bitPhoneMissing || phoneProblem) document.getElementById("pay-bit-phone")?.focus();
      return;
    }
    setBusy(true);
    try {
      const row = await saveOfflinePaymentSettings(form);
      const next: OfflinePaymentSettings = {
        phoneEnabled: row.payment_phone_enabled,
        bitEnabled: row.payment_bit_enabled,
        bitPhone: formatBitPhone(row.payment_bit_phone),
      };
      setSaved(next);
      setForm(next);
      setAttempted(false);
      await refreshSiteSettings();
      toast.success("אמצעי התשלום נשמרו — הקופה מתעדכנת מיד");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const activeCount = Number(saved.phoneEnabled) + Number(saved.bitEnabled);

  return (
    <Card id="offline-payments" className="shadow-card">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="size-4" aria-hidden="true" />
          אמצעי תשלום חלופיים (אופליין)
        </CardTitle>
        <Badge variant="outline" className="gap-1">
          <CheckCircle2 className="size-3.5 text-accent" aria-hidden="true" />
          {activeCount === 2
            ? "2 אמצעים פעילים בקופה"
            : activeCount === 1
              ? "אמצעי אחד פעיל בקופה"
              : "—"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="leading-6 text-muted-foreground">
          אילו אפשרויות תשלום הלקוחות רואים בקופה. אין כאן חיוב אוטומטי באתר — התשלום נעשה מולכם
          (בטלפון או בהעברה בביט), ואתם מאשרים אותו במסך ההזמנות.
        </p>

        {/* ---------- תשלום טלפוני ---------- */}
        <label
          htmlFor="pay-phone-enabled"
          className={cn(
            "flex cursor-pointer items-start justify-between gap-3 rounded-xl border-2 p-3 transition-colors",
            form.phoneEnabled ? "border-primary/50 bg-primary/5" : "border-border",
          )}
        >
          <span className="flex items-start gap-3">
            <PhoneCall
              className="mt-0.5 size-5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="space-y-0.5">
              <span className="block font-bold text-foreground">תשלום טלפוני מול נציג</span>
              <span className="block text-xs leading-5 text-muted-foreground">
                הלקוח שולח הזמנה בלי חיוב באתר, ונציג יוצר איתו קשר לסידור התשלום. ההזמנה מתקבלת מיד
                בסטטוס "התקבלה".
              </span>
            </span>
          </span>
          <Switch
            id="pay-phone-enabled"
            checked={form.phoneEnabled}
            onCheckedChange={(checked) => patch({ phoneEnabled: checked })}
            aria-label="תשלום טלפוני מול נציג"
          />
        </label>

        {/* ---------- ביט ---------- */}
        <div
          className={cn(
            "space-y-3 rounded-xl border-2 p-3 transition-colors",
            form.bitEnabled ? "border-primary/50 bg-primary/5" : "border-border",
          )}
        >
          <label
            htmlFor="pay-bit-enabled"
            className="flex cursor-pointer items-start justify-between gap-3"
          >
            <span className="flex items-start gap-3">
              <Smartphone
                className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="space-y-0.5">
                <span className="block font-bold text-foreground">תשלום בביט</span>
                <span className="block text-xs leading-5 text-muted-foreground">
                  ההזמנה נשמרת לפני שהלקוח עובר לאפליקציית ביט, ואחרי ההעברה הוא שולח מספר אסמכתא או
                  צילום מסך. אתם מאשרים את התשלום במסך ההזמנות — ורק אז ההזמנה יוצאת לטיפול. לא שולם
                  תוך {BIT_PAYMENT_WINDOW_HOURS} שעות? ההזמנה מתבטלת והמלאי חוזר.
                </span>
              </span>
            </span>
            <Switch
              id="pay-bit-enabled"
              checked={form.bitEnabled}
              onCheckedChange={(checked) => patch({ bitEnabled: checked })}
              aria-label="תשלום בביט"
            />
          </label>
          {form.bitEnabled && (
            <div className="space-y-1.5 ps-8">
              <Label htmlFor="pay-bit-phone">
                מספר טלפון לקבלת תשלום בביט <span className="text-destructive">*</span>
              </Label>
              <Input
                id="pay-bit-phone"
                type="tel"
                inputMode="tel"
                dir="ltr"
                autoComplete="tel"
                maxLength={20}
                placeholder="050-1234567"
                className="max-w-xs text-right"
                aria-invalid={(attempted && bitPhoneMissing) || phoneProblem !== null}
                value={form.bitPhone}
                onChange={(event) => patch({ bitPhone: event.target.value })}
                onBlur={() => {
                  if (!bitPhoneProblem(form.bitPhone))
                    patch({ bitPhone: formatBitPhone(form.bitPhone) });
                }}
              />
              {phoneProblem ? (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {phoneProblem}
                </p>
              ) : attempted && bitPhoneMissing ? (
                <p role="alert" className="text-xs font-medium text-destructive">
                  חובה להזין מספר טלפון לקבלת תשלום בביט
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  המספר הנייד שמחובר לחשבון הביט שלכם — הלקוחות יראו אותו בעמוד התשלום.
                </p>
              )}
            </div>
          )}
        </div>

        {attempted && problem && !phoneProblem && !bitPhoneMissing && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {problem}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={busy || !dirty} onClick={() => void save()}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {busy ? "שומר…" : "שמירת אמצעי התשלום"}
          </Button>
          {dirty && !busy && <span className="text-xs text-amber-700">יש שינויים שלא נשמרו</span>}
        </div>
      </CardContent>
    </Card>
  );
}
