// מע"מ בפאנל הפלטפורמה (מיגרציות 189 + 191): סוג העוסק של Nuriel כמוכרת (משפיע על הסכמים וחיובים חדשים
// בלבד), השיעור המרכזי (קביעה מראש לתאריך עתידי, ביטול לפני שחל), ו"תעד תשלום" הישן — העסקים שיש להם
// רישומי כסף שלא מופיעים ביומן החדש (קריאה בלבד, בלי סנכרון).
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
} from "@/platform/ui";
import {
  platformBillingLegacyOverview,
  platformBillingSaveSettings,
  platformVatRateCancel,
  platformVatRateSchedule,
  platformVatRates,
} from "../billing.functions";
import { errorMessage, formatDate, formatMoney } from "../logic";
import type { LegacyOverview, SellerBusinessType, VatRatesView } from "../types";
import { NativeSelect } from "./parts";

export function BillingVatPanel() {
  const [view, setView] = useState<VatRatesView | null>(null);
  const [legacy, setLegacy] = useState<LegacyOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<SellerBusinessType>("exempt");
  const [include, setInclude] = useState(false);
  const [override, setOverride] = useState(false);
  const [rate, setRate] = useState("");
  const [from, setFrom] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const [v, l] = await Promise.all([platformVatRates(), platformBillingLegacyOverview()]);
      setView(v);
      setLegacy(l);
      if (v.seller) {
        setType(v.seller.business_type);
        setInclude(v.seller.prices_include_vat && v.seller.business_type === "authorized");
        setOverride(v.seller.allow_vat_rate_override);
      }
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
      setNotice(done);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="billing-vat-panel">
      <CardHeader>
        <CardTitle className="text-lg">מע״מ</CardTitle>
        <CardDescription>
          המע״מ בחיוב לקוחות Nuriel נקבע לפי Nuriel כמוכרת. לכל חנות יש הגדרת מע״מ עצמאית משלה, שבעל
          החנות קובע — היא לא נגזרת מכאן.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
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
        {!view ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> טוען…
          </p>
        ) : (
          <>
            <section className="space-y-3" aria-labelledby="vat-seller-title">
              <h3 id="vat-seller-title" className="font-semibold">
                Nuriel כמוכרת
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="vat-seller-type">סוג העוסק</Label>
                  <NativeSelect
                    id="vat-seller-type"
                    value={type}
                    onChange={(v) => setType(v === "authorized" ? "authorized" : "exempt")}
                    options={[
                      { value: "exempt", label: "עוסק פטור — ללא מע״מ בהסכמים ובחיובים" },
                      { value: "authorized", label: "עוסק מורשה — מע״מ בשיעור המרכזי" },
                    ]}
                  />
                </div>
                {type === "authorized" ? (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="vat-seller-include">ברירת מחדל להסכם חדש</Label>
                    <NativeSelect
                      id="vat-seller-include"
                      value={include ? "included" : "excluded"}
                      onChange={(v) => setInclude(v === "included")}
                      options={[
                        { value: "excluded", label: "המחיר לפני מע״מ (המע״מ מתווסף)" },
                        { value: "included", label: "המחיר כולל מע״מ" },
                      ]}
                    />
                  </div>
                ) : null}
              </div>
              {type === "authorized" ? (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={override} onCheckedChange={(v) => setOverride(v === true)} />
                  לאפשר בהסכם שיעור שונה מהמרכזי (למשל 0% לשירות לתושב חוץ)
                </label>
              ) : null}
              <p className="text-xs text-muted-foreground">
                השינוי חל על הסכמים וחיובים חדשים בלבד. כל הסכם וכל רישום ביומן שומרים את מצב המע״מ
                שלהם, ושום דבר קיים לא משתנה.
              </p>
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      platformBillingSaveSettings({
                        data: {
                          sellerBusinessType: type,
                          sellerPricesIncludeVat: type === "authorized" ? include : null,
                          allowVatRateOverride: type === "authorized" && override,
                        },
                      }),
                    "סוג העוסק של Nuriel נשמר",
                  )
                }
                data-testid="billing-vat-seller-save"
              >
                שמירה
              </Button>
            </section>

            <section className="space-y-3" aria-labelledby="vat-rate-title">
              <h3 id="vat-rate-title" className="font-semibold">
                שיעור המע״מ המרכזי: <span className="numeric">{view.current}%</span>
              </h3>
              <ul className="space-y-1 text-sm" data-testid="billing-vat-rates">
                {view.rates.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <span className="numeric font-medium">{r.rate}%</span>
                    <span className="text-muted-foreground">מ-{formatDate(r.effective_from)}</span>
                    {r.scheduled ? <Badge variant="secondary">עתידי</Badge> : null}
                    {r.note ? <span className="text-muted-foreground">· {r.note}</span> : null}
                    {r.scheduled ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => platformVatRateCancel({ data: { id: r.id } }),
                            "השיעור העתידי בוטל",
                          )
                        }
                      >
                        ביטול
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="vat-new-rate">שיעור חדש (%)</Label>
                  <Input
                    id="vat-new-rate"
                    inputMode="decimal"
                    dir="ltr"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="vat-new-from">בתוקף מתאריך</Label>
                  <Input
                    id="vat-new-from"
                    type="date"
                    dir="ltr"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="vat-new-note">הערה (לא חובה)</Label>
                  <Input id="vat-new-note" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                רק לתאריך עתידי. הזמנות, הסכמים ותשלומים קיימים שומרים את השיעור שלהם.
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={busy || rate.trim() === "" || from === ""}
                onClick={() =>
                  void run(
                    () => platformVatRateSchedule({ data: { rate, effectiveFrom: from, note } }),
                    "השיעור החדש נקבע",
                  )
                }
              >
                קביעת שיעור עתידי
              </Button>
            </section>

            <section className="space-y-2" aria-labelledby="vat-legacy-title">
              <h3 id="vat-legacy-title" className="font-semibold">
                "תעד תשלום" הישן — רישומים שלא ביומן החדש
              </h3>
              {!legacy || legacy.businesses === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="billing-legacy-none">
                  אין רישומי כסף במנגנון הישן שחסרים ביומן החדש.
                </p>
              ) : (
                <div
                  className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
                  data-testid="billing-legacy-overview"
                >
                  <p>
                    {legacy.businesses} עסקים · {legacy.paid_count} תשלומים ששולמו (
                    {formatMoney(legacy.paid_amount)})
                    {legacy.due_count > 0
                      ? ` · ${legacy.due_count} חיובים ממתינים (${formatMoney(legacy.due_amount)})`
                      : ""}
                    . הם לא נספרים ביומן החדש. אין סנכרון אוטומטי — העברה רק אחרי בדיקה ואישור.
                  </p>
                  <ul className="space-y-0.5">
                    {legacy.items.slice(0, 20).map((i) => (
                      <li key={i.tenant_id}>
                        {i.label}
                        {i.deleted ? " (נמחק)" : ""}: {formatMoney(i.paid_amount)} שולם
                        {i.due_count > 0 ? `, ${formatMoney(i.due_amount)} ממתין` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
