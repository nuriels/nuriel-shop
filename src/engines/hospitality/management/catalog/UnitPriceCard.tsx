// עמוד היחידה — "מחיר, תנאים וזמינות": המחיר ללילה, מינימום לילות ומדיניות הביטול של היחידה
// (נשמרים דרך אותה פונקציה של מסך המחירים — אותן בדיקות במסד, עם גרסה), המחיר בסוף השבוע (מכללי
// המחיר), וקיצורים ליומן היחידה ולחסימת תאריכים. בלי שדות חדשים במסד.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarDays, Lock, Loader2, Tag } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button, Input, Label } from "@/platform/ui";
import { hospitalityPricing, hospitalitySetUnitPrices } from "../../api/pricing.functions";
import type { CatalogUnit } from "../../types/catalog";
import { formatMoney } from "../lib/format";
import { NumberField } from "../lib/fields";
import { manageKeys } from "../lib/query-keys";
import { useManagement } from "../shell/management-context";
import { errorText } from "./refresh";
import { weekendPrice } from "./unit-cards";

const PRICE = /^\d{1,7}(\.\d{1,2})?$/;

export function UnitPriceCard({ unit }: { unit: CatalogUnit }) {
  const ctx = useManagement();
  const canPricing = ctx.permissions["pricing"] === true;
  const canCalendar = ctx.permissions["bookings"] === true;
  const qc = useQueryClient();
  const key = [...manageKeys.all, "pricing"] as const;
  const pricing = useQuery({
    queryKey: key,
    queryFn: () => hospitalityPricing(),
    enabled: canPricing,
    refetchOnWindowFocus: false,
  });
  const pu = pricing.data?.units.find((u) => u.id === unit.id);
  const [base, setBase] = useState("");
  const [minNights, setMinNights] = useState("");
  const [policy, setPolicy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!pu) return;
    setBase(pu.base_price > 0 ? String(Number(pu.base_price)) : "");
    setMinNights(String(pu.min_nights));
    setPolicy(pu.policy_id ?? "");
  }, [pu?.id, pu?.revision]); // eslint-disable-line react-hooks/exhaustive-deps -- רק כשהגרסה משתנה

  if (!canPricing && !canCalendar) return null;
  const policies = (pricing.data?.policies ?? []).filter((x) => !x.is_archived);
  const dirty =
    !!pu &&
    (base !== (pu.base_price > 0 ? String(Number(pu.base_price)) : "") ||
      minNights !== String(pu.min_nights) ||
      policy !== (pu.policy_id ?? ""));
  const baseError =
    base.trim() === "" ? "כתבו מחיר ללילה" : PRICE.test(base.trim()) ? undefined : "מחיר לא תקין";
  const nightsN = Number(minNights);
  const nightsError =
    Number.isInteger(nightsN) && nightsN >= 1 && nightsN <= 60 ? undefined : "בין 1 ל-60 לילות";
  const weekend =
    pu && PRICE.test(base.trim())
      ? weekendPrice(unit, Number(base), pricing.data?.rules ?? [])
      : null;
  const currency = pricing.data?.currency ?? "ILS";

  const save = async () => {
    if (!pu || baseError || nightsError) {
      setError(baseError ?? nightsError ?? null);
      return;
    }
    const changes: Record<string, unknown> = {};
    if (Number(base) !== Number(pu.base_price)) changes["base_price"] = Number(base);
    if (nightsN !== pu.min_nights) changes["min_nights"] = nightsN;
    if (policy !== (pu.policy_id ?? "")) changes["policy_id"] = policy || null;
    if (!Object.keys(changes).length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await hospitalitySetUnitPrices({
        data: { id: unit.id, changes, revision: pu.revision },
      });
      if (r.status === "conflict") {
        setError(`${r.message} — הנתונים העדכניים נטענו, בדקו ושמרו שוב.`);
        qc.setQueryData(key, r.view);
      } else {
        toast.success("המחיר והתנאים נשמרו");
        void qc.invalidateQueries({ queryKey: key });
        void qc.invalidateQueries({ queryKey: manageKeys.catalog });
        void qc.invalidateQueries({ queryKey: manageKeys.context });
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      id="pricing"
      aria-labelledby="unit-price-title"
      className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-[var(--hm-shadow-card)] sm:p-6"
    >
      <div>
        <h2 id="unit-price-title" className="text-lg font-semibold">
          מחיר, תנאים וזמינות
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          המחיר שהאתר מחשב לאורחים. עונות, חגים וסופי שבוע — בכללי המחיר.
        </p>
      </div>

      {canPricing &&
        (pricing.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorText(pricing.error)}
          </p>
        ) : !pu ? (
          <p role="status" className="text-sm text-muted-foreground">
            טוען מחירים…
          </p>
        ) : (
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!busy) void save();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="unit-base-price">מחיר ללילה (₪)</Label>
                <Input
                  id="unit-base-price"
                  inputMode="decimal"
                  dir="ltr"
                  value={base}
                  onChange={(e) => setBase(e.target.value.replace(/[^\d.]/g, "").slice(0, 10))}
                  aria-invalid={dirty && baseError ? true : undefined}
                  aria-describedby="unit-base-price-hint"
                  className="min-h-11 w-40 text-start"
                />
                <p id="unit-base-price-hint" className="text-xs text-muted-foreground">
                  {weekend !== null && weekend !== Number(base)
                    ? `בסוף השבוע: ${formatMoney(weekend, currency)} (לפי כלל "סוף שבוע")`
                    : "אותו מחיר כל השבוע (אין כלל לסוף השבוע)"}
                </p>
              </div>
              <NumberField
                idPrefix="unit-price"
                name="min_nights"
                label="מינימום לילות"
                value={minNights}
                min={1}
                max={60}
                onChange={setMinNights}
                error={dirty ? nightsError : undefined}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="unit-policy">מדיניות ביטול ותנאים</Label>
              <select
                id="unit-policy"
                value={policy}
                onChange={(e) => setPolicy(e.target.value)}
                className="min-h-11 w-full max-w-md rounded-md border border-input bg-background px-3 text-base"
              >
                <option value="">ברירת המחדל של העסק</option>
                {policies.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                    {x.is_default ? " (ברירת מחדל)" : ""}
                  </option>
                ))}
              </select>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" className="min-h-11 gap-2" disabled={busy || !dirty}>
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                שמירת המחיר והתנאים
              </Button>
              <Link
                to="/manage/pricing"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-[var(--hm-lagoon-500)] hover:bg-[var(--hm-lagoon-50)]"
              >
                <Tag className="size-4" aria-hidden="true" />
                כללי מחיר: עונות, חגים וסופי שבוע
              </Link>
            </div>
          </form>
        ))}

      {canCalendar && (
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Link
            to="/manage/calendar"
            search={{ unit: unit.id }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md border px-4 text-sm font-medium hover:border-[var(--hm-lagoon-500)]"
          >
            <CalendarDays className="size-4" aria-hidden="true" />
            זמינות — היומן של היחידה
          </Link>
          <Link
            to="/manage/calendar"
            search={{ unit: unit.id, block: "1" }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md border px-4 text-sm font-medium hover:border-[var(--hm-lagoon-500)]"
          >
            <Lock className="size-4" aria-hidden="true" />
            חסימת תאריכים ביחידה
          </Link>
        </div>
      )}
    </section>
  );
}
