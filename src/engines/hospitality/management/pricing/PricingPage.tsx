// מסך "מחירים" (/manage/pricing) — Stage 2f: מחיר בסיס לכל יחידה (תוספת למבוגר / לילד, מינימום
// לילות, מדיניות ביטול), כללי מחיר (סוף שבוע, עונות, חגים — כולל מינימום לילות ומדיניות
// לחג), ותצוגת מחיר לכל תאריכים — מחושבת בשרת בלבד (ה-quote של מנוע ההזמנות).
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
  cn,
} from "@/platform/ui";
import {
  hospitalityDeleteRule,
  hospitalityPriceQuote,
  hospitalityPricing,
  hospitalitySaveRule,
  hospitalitySetUnitPrices,
} from "../../api/pricing.functions";
import type {
  PriceMode,
  PriceQuote,
  PricedUnit,
  PricingView,
  RateRule,
  RuleKind,
} from "../../types/pricing";
import {
  ruleError,
  unitPriceError,
  UNIT_PRICE_LABELS,
  type UnitPriceKey,
} from "../../validation/pricing";
import { FormSheet } from "../catalog/CatalogSheets";
import { ConfirmButton, LoadError, PageSkeleton } from "../catalog/parts";
import { errorText } from "../catalog/refresh";
import { manageKeys } from "../lib/query-keys";
import { pricingKey } from "./model";
import { useManagement } from "../shell/management-context";
import {
  DAY_LABELS,
  RULE_KIND_LABELS,
  datesText,
  daysText,
  money,
  priceText,
  scopeText,
} from "./model";

export function PricingPage() {
  const ctx = useManagement();
  const query = useQuery({
    queryKey: pricingKey,
    queryFn: () => hospitalityPricing(),
    refetchOnWindowFocus: false,
  });
  if (!ctx.permissions["pricing"])
    return <p className="p-4">אין לכם הרשאה לנהל מחירים באתר הזה.</p>;
  if (query.isError) return <LoadError error={query.error} />;
  if (!query.data) return <PageSkeleton label="טוען את המחירים…" />;
  const v = query.data;
  const units = v.units.filter((u) => u.is_active);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">מחירים</h1>
        <p className="text-muted-foreground">
          מחיר בסיס לכל יחידה, ומעליו כללים: סוף שבוע, עונות וחגים. המחיר לאורח מחושב תמיד בשרת.{" "}
          <Link to="/manage/policies" className="font-medium text-primary hover:underline">
            מדיניות ביטול ←
          </Link>
        </p>
      </header>
      {units.length === 0 && (
        <p className="rounded-md border p-3 text-sm">
          עוד אין יחידות פעילות.{" "}
          <Link to="/manage/units" className="font-medium text-primary hover:underline">
            להוספת יחידה
          </Link>
        </p>
      )}
      <Card data-section="base-prices">
        <CardHeader>
          <CardTitle className="text-lg">
            <h2>מחיר בסיס ליחידה</h2>
          </CardTitle>
          <CardDescription>
            המחיר ללילה כשאין כלל אחר, ותוספת לכל אורח מעבר לכלולים במחיר.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {units.map((u) => (
            <UnitPriceRow key={`${u.id}-${u.revision}`} unit={u} view={v} />
          ))}
        </CardContent>
      </Card>
      <RulesCard view={v} />
      <PreviewCard view={v} />
    </div>
  );
}

const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

function UnitPriceRow({ unit, view }: { unit: PricedUnit; view: PricingView }) {
  const queryClient = useQueryClient();
  const init = {
    base_price: String(unit.base_price),
    extra_adult_price: String(unit.extra_adult_price),
    extra_child_price: String(unit.extra_child_price),
    min_nights: String(unit.min_nights),
    policy_id: unit.policy_id ?? "",
  };
  const [form, setForm] = useState(init);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const values: Record<UnitPriceKey, unknown> = {
    base_price: num(form.base_price),
    extra_adult_price: num(form.extra_adult_price),
    extra_child_price: num(form.extra_child_price),
    min_nights: num(form.min_nights),
    price_floor: unit.price_floor,
    price_ceiling: unit.price_ceiling,
    policy_id: form.policy_id === "" ? null : form.policy_id,
  };
  const keys = [
    "base_price",
    "extra_adult_price",
    "extra_child_price",
    "min_nights",
    "policy_id",
  ] as const;
  const errors = Object.fromEntries(
    keys.map((k) => [k, unitPriceError(k, values[k])]).filter(([, e]) => e),
  );
  const changes = Object.fromEntries(
    keys.filter((k) => form[k] !== init[k]).map((k) => [k, values[k]]),
  );
  const dirty = Object.keys(changes).length > 0;
  const id = `price-${unit.id}`;
  const save = async () => {
    if (!dirty || Object.keys(errors).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await hospitalitySetUnitPrices({
        data: { id: unit.id, changes, revision: unit.revision },
      });
      if (r.status === "conflict") {
        queryClient.setQueryData(pricingKey, r.view);
        setError(
          "היחידה עודכנה בינתיים על ידי משתמש אחר — מוצגים המחירים העדכניים. בדקו ונסו שוב.",
        );
        return;
      }
      toast.success(`המחירים של ${unit.name} נשמרו`);
      void queryClient.invalidateQueries({ queryKey: pricingKey });
      void queryClient.invalidateQueries({ queryKey: manageKeys.context });
      void queryClient.invalidateQueries({ queryKey: manageKeys.catalog });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const field = (
    k: "base_price" | "extra_adult_price" | "extra_child_price" | "min_nights",
    hint?: string,
  ) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`${id}-${k}`} className="text-xs">
        {UNIT_PRICE_LABELS[k]}
      </Label>
      <Input
        id={`${id}-${k}`}
        inputMode="decimal"
        dir="ltr"
        value={form[k]}
        onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
        aria-invalid={errors[k] ? true : undefined}
        className={cn("min-h-11 text-center", errors[k] && "border-destructive")}
      />
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
  return (
    <form
      data-unit-price={unit.name}
      className="flex flex-col gap-2 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{unit.name}</span>
        <span className="text-xs text-muted-foreground">
          {unit.property_name} · {unit.base_occupancy} כלולים במחיר, עד {unit.capacity} אורחים
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {field("base_price")}
        {field("extra_adult_price", "לכל מבוגר נוסף")}
        {field("extra_child_price", "לכל ילד נוסף")}
        {field("min_nights")}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-policy`} className="text-xs">
          מדיניות ביטול ליחידה
        </Label>
        <select
          id={`${id}-policy`}
          value={form.policy_id}
          onChange={(e) => setForm((f) => ({ ...f, policy_id: e.target.value }))}
          className="min-h-11 rounded-md border border-input bg-background px-3 text-base"
        >
          <option value="">ברירת המחדל של העסק</option>
          {view.policies
            .filter((p) => !p.is_archived)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </div>
      {Object.values(errors).map((e) => (
        <p key={String(e)} className="text-sm text-destructive">
          {String(e)}
        </p>
      ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {dirty && (
        <div className="flex gap-2">
          <Button
            type="submit"
            className="min-h-11"
            disabled={busy || Object.keys(errors).length > 0}
          >
            שמירת המחירים
          </Button>
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => setForm(init)}>
            ביטול
          </Button>
        </div>
      )}
      {unit.base_price === 0 && !dirty && (
        <p className="text-sm text-amber-800">אין עדיין מחיר — אורחים לא יוכלו להזמין.</p>
      )}
    </form>
  );
}

function RulesCard({ view }: { view: PricingView }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RateRule | "new" | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: pricingKey });
  const toggle = async (r: RateRule) => {
    try {
      await hospitalitySaveRule({ data: { id: r.id, data: { is_active: !r.is_active } } });
      toast.success(r.is_active ? "הכלל הושבת" : "הכלל הופעל");
      refresh();
    } catch (e) {
      toast.error(errorText(e));
    }
  };
  return (
    <Card data-section="rules">
      <CardHeader>
        <CardTitle className="text-lg">
          <h2>כללי מחיר</h2>
        </CardTitle>
        <CardDescription>
          חג גובר על עונה, עונה על סוף שבוע, וסוף שבוע על מחיר הבסיס. כלל של יחידה גובר על כלל של כל
          המתחם.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {view.rules.length === 0 && (
          <p className="text-sm text-muted-foreground">עוד אין כללים — כל הלילות במחיר הבסיס.</p>
        )}
        <ul className="flex flex-col gap-2">
          {view.rules.map((r) => (
            <li
              key={r.id}
              data-rule={r.name}
              className={cn(
                "flex flex-col gap-1 rounded-md border p-3",
                !r.is_active && "opacity-70",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  {r.name}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    · {RULE_KIND_LABELS[r.kind]}
                  </span>
                </span>
                <span className="text-sm">{priceText(r, view.currency)}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {scopeText(r, view.units, view.properties)}
                {datesText(r) ? ` · ${datesText(r)}` : ""}
                {r.days_mask !== 127 ? ` · ${daysText(r.days_mask)}` : ""}
                {r.min_nights ? ` · לפחות ${r.min_nights} לילות` : ""}
                {r.policy_id
                  ? ` · מדיניות: ${view.policies.find((p) => p.id === r.policy_id)?.name ?? ""}`
                  : ""}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <Switch
                    checked={r.is_active}
                    onCheckedChange={() => void toggle(r)}
                    aria-label={`הכלל ${r.name} פעיל`}
                  />
                  {r.is_active ? "פעיל" : "מושבת"}
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 gap-1"
                  onClick={() => setEditing(r)}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                  עריכה
                </Button>
                <ConfirmButton
                  label="מחיקה"
                  destructive
                  icon={<Trash2 className="size-4" aria-hidden="true" />}
                  title={`למחוק את הכלל ${r.name}?`}
                  description={<p>הזמנות קיימות לא משתנות — המחיר שלהן כבר נשמר.</p>}
                  confirmLabel="מחיקה"
                  onConfirm={async () => {
                    try {
                      await hospitalityDeleteRule({ data: { id: r.id } });
                      toast.success("הכלל נמחק");
                      refresh();
                    } catch (e) {
                      toast.error(errorText(e));
                    }
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-fit gap-2"
          onClick={() => setEditing("new")}
        >
          <Plus className="size-4" aria-hidden="true" />
          הוספת כלל מחיר
        </Button>
      </CardContent>
      {editing && (
        <RuleSheet
          view={view}
          rule={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </Card>
  );
}

function RuleSheet(props: {
  view: PricingView;
  rule: RateRule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const r = props.rule;
  const init = {
    name: r?.name ?? "",
    kind: (r?.kind ?? "weekend") as RuleKind,
    scope: r?.unit_id ? `u:${r.unit_id}` : r?.property_id ? `p:${r.property_id}` : "",
    date_from: r?.date_from ?? "",
    date_to: r?.date_to ?? "",
    days_mask: r?.days_mask ?? 127,
    price_mode: (r?.price_mode ?? "fixed") as PriceMode,
    value: r ? String(r.value) : "",
    min_nights: r?.min_nights ? String(r.min_nights) : "",
    priority: String(r?.priority ?? 0),
    policy_id: r?.policy_id ?? "",
  };
  const [f, setF] = useState(init);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const dated = f.kind === "season" || f.kind === "holiday";
  const data: Record<string, unknown> = {
    name: f.name.trim(),
    kind: f.kind,
    scope: f.scope.startsWith("u:")
      ? { unit_id: f.scope.slice(2) }
      : f.scope.startsWith("p:")
        ? { property_id: f.scope.slice(2) }
        : {},
    date_from: dated || f.date_from ? f.date_from || null : null,
    date_to: dated || f.date_to ? f.date_to || null : null,
    days_mask: f.days_mask,
    price_mode: f.price_mode,
    value: num(f.value),
    min_nights: num(f.min_nights),
    priority: Number(f.priority) || 0,
    policy_id: dated && f.policy_id ? f.policy_id : null,
  };
  const error = ruleError(data);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    setSubmitted(true);
    if (error) return;
    setBusy(true);
    setServerError(null);
    try {
      await hospitalitySaveRule({ data: { id: r?.id ?? null, data } });
      toast.success(r ? "הכלל נשמר" : "הכלל נוסף");
      props.onSaved();
      props.onClose();
    } catch (e) {
      setServerError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const sel = "min-h-11 w-full rounded-md border border-input bg-background px-3 text-base";
  return (
    <FormSheet
      open
      title={r ? `עריכת ${r.name}` : "כלל מחיר חדש"}
      description="לסוף שבוע, לעונה או לחג. אפשר לקבוע מחיר ללילה, או שינוי באחוזים / בסכום ממחיר הבסיס."
      dirty={JSON.stringify(f) !== JSON.stringify(init)}
      busy={busy}
      submitLabel={r ? "שמירה" : "הוספה"}
      serverError={serverError}
      notice={null}
      hasErrors={Boolean(error)}
      submitted={submitted}
      onSubmit={() => void submit()}
      onClose={props.onClose}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rule-name">שם הכלל</Label>
        <Input
          id="rule-name"
          value={f.name}
          maxLength={80}
          placeholder="למשל: קיץ 2027, פסח"
          onChange={(e) => set("name", e.target.value)}
          className="min-h-11"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rule-kind">סוג</Label>
        <select
          id="rule-kind"
          className={sel}
          value={f.kind}
          onChange={(e) => set("kind", e.target.value as RuleKind)}
        >
          {(Object.keys(RULE_KIND_LABELS) as RuleKind[]).map((k) => (
            <option key={k} value={k}>
              {RULE_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rule-scope">על מה הכלל חל</Label>
        <select
          id="rule-scope"
          className={sel}
          value={f.scope}
          onChange={(e) => set("scope", e.target.value)}
        >
          <option value="">כל היחידות</option>
          {props.view.properties.map((p) => (
            <option key={p.id} value={`p:${p.id}`}>
              כל {p.name}
            </option>
          ))}
          {props.view.units.map((u) => (
            <option key={u.id} value={`u:${u.id}`}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
      {(dated || f.date_from || f.date_to) && (
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-from">מתאריך (הלילה הראשון)</Label>
            <Input
              id="rule-from"
              type="date"
              dir="ltr"
              value={f.date_from}
              onChange={(e) => set("date_from", e.target.value)}
              className="min-h-11"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rule-to">עד תאריך (היציאה)</Label>
            <Input
              id="rule-to"
              type="date"
              dir="ltr"
              value={f.date_to}
              onChange={(e) => set("date_to", e.target.value)}
              className="min-h-11"
            />
          </div>
        </div>
      )}
      {f.kind !== "weekend" && f.kind !== "weekday" ? null : (
        <p className="text-xs text-muted-foreground">
          לילות סוף השבוע של העסק: {props.view.weekend_nights.map((d) => DAY_LABELS[d]).join(", ")}{" "}
          (בהגדרות העסק).
        </p>
      )}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium">ימים בשבוע</legend>
        <div className="flex flex-wrap gap-1">
          {DAY_LABELS.map((d, i) => {
            const on = (f.days_mask & (1 << i)) !== 0;
            return (
              <label
                key={d}
                className={cn(
                  "flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border px-2 text-sm has-[:focus-visible]:ring-2",
                  on && "border-primary bg-primary text-primary-foreground",
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  aria-label={`יום ${d}`}
                  onChange={() => set("days_mask", f.days_mask ^ (1 << i))}
                />
                {d}
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-mode">אופן המחיר</Label>
          <select
            id="rule-mode"
            className={sel}
            value={f.price_mode}
            onChange={(e) => set("price_mode", e.target.value as PriceMode)}
          >
            <option value="fixed">מחיר ללילה</option>
            <option value="percent">שינוי באחוזים</option>
            <option value="amount">שינוי בסכום</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-value">
            {f.price_mode === "percent" ? "אחוז (למשל 20 או ‎-10)" : "סכום"}
          </Label>
          <Input
            id="rule-value"
            inputMode="decimal"
            dir="ltr"
            value={f.value}
            onChange={(e) => set("value", e.target.value)}
            className="min-h-11 text-center"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-min">מינימום לילות (לא חובה)</Label>
          <Input
            id="rule-min"
            inputMode="numeric"
            dir="ltr"
            value={f.min_nights}
            onChange={(e) => set("min_nights", e.target.value)}
            className="min-h-11 text-center"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-priority">עדיפות (כשכללים חופפים)</Label>
          <Input
            id="rule-priority"
            inputMode="numeric"
            dir="ltr"
            value={f.priority}
            onChange={(e) => set("priority", e.target.value)}
            className="min-h-11 text-center"
          />
        </div>
      </div>
      {dated && props.view.can_policies && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rule-policy">מדיניות ביטול מיוחדת לתאריכים האלה (לא חובה)</Label>
          <select
            id="rule-policy"
            className={sel}
            value={f.policy_id}
            onChange={(e) => set("policy_id", e.target.value)}
          >
            <option value="">כמו בשאר הזמן</option>
            {props.view.policies
              .filter((p) => !p.is_archived)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>
      )}
      {submitted && error && <p className="text-sm text-destructive">{error}</p>}
    </FormSheet>
  );
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

function PreviewCard({ view }: { view: PricingView }) {
  const units = view.units.filter((u) => u.is_active);
  const today = new Date();
  const [f, setF] = useState({
    unitId: units[0]?.id ?? "",
    checkIn: iso(new Date(today.getTime() + 14 * 86400000)),
    checkOut: iso(new Date(today.getTime() + 16 * 86400000)),
    adults: "2",
    children: "0",
  });
  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (units.length === 0) return null;
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setQuote(
        await hospitalityPriceQuote({
          data: {
            unitId: f.unitId,
            checkIn: f.checkIn,
            checkOut: f.checkOut,
            adults: Number(f.adults) || 0,
            children: Number(f.children) || 0,
          },
        }),
      );
    } catch (e) {
      setQuote(null);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const sel = "min-h-11 w-full rounded-md border border-input bg-background px-3 text-base";
  return (
    <Card data-section="preview">
      <CardHeader>
        <CardTitle className="text-lg">
          <h2>תצוגת מחיר</h2>
        </CardTitle>
        <CardDescription>
          כמה אורח ישלם — מחושב בשרת, בדיוק כמו בהזמנה (גם כשההזמנות באתר עוד סגורות).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form
          className="grid grid-cols-2 gap-2 sm:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
            <Label htmlFor="pv-unit" className="text-xs">
              יחידה
            </Label>
            <select
              id="pv-unit"
              className={sel}
              value={f.unitId}
              onChange={(e) => setF((x) => ({ ...x, unitId: e.target.value }))}
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pv-in" className="text-xs">
              כניסה
            </Label>
            <Input
              id="pv-in"
              type="date"
              dir="ltr"
              value={f.checkIn}
              onChange={(e) => setF((x) => ({ ...x, checkIn: e.target.value }))}
              className="min-h-11"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pv-out" className="text-xs">
              יציאה
            </Label>
            <Input
              id="pv-out"
              type="date"
              dir="ltr"
              value={f.checkOut}
              onChange={(e) => setF((x) => ({ ...x, checkOut: e.target.value }))}
              className="min-h-11"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pv-adults" className="text-xs">
              מבוגרים
            </Label>
            <Input
              id="pv-adults"
              inputMode="numeric"
              dir="ltr"
              value={f.adults}
              onChange={(e) => setF((x) => ({ ...x, adults: e.target.value }))}
              className="min-h-11 text-center"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pv-children" className="text-xs">
              ילדים
            </Label>
            <Input
              id="pv-children"
              inputMode="numeric"
              dir="ltr"
              value={f.children}
              onChange={(e) => setF((x) => ({ ...x, children: e.target.value }))}
              className="min-h-11 text-center"
            />
          </div>
          <Button
            type="submit"
            className="col-span-2 min-h-11 gap-2 sm:col-span-5 sm:w-fit"
            disabled={busy}
          >
            <Calculator className="size-4" aria-hidden="true" />
            חישוב מחיר
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {quote && (
          <div className="flex flex-col gap-2" data-testid="price-summary">
            <table className="w-full text-sm">
              <caption className="sr-only">מחיר לכל לילה</caption>
              <thead>
                <tr className="text-muted-foreground [&>th]:pe-3">
                  <th className="text-start font-normal">לילה</th>
                  <th className="text-start font-normal">מחיר</th>
                  <th className="text-start font-normal">תוספת אורחים</th>
                  <th className="text-start font-normal">לפי</th>
                </tr>
              </thead>
              <tbody>
                {quote.nights.map((n) => (
                  <tr key={n.night} className="border-t [&>td]:py-1 [&>td]:pe-3">
                    <td className="whitespace-nowrap">{n.night.split("-").reverse().join(".")}</td>
                    <td>{money(n.base_rate, quote.currency)}</td>
                    <td>{n.extras > 0 ? money(n.extras, quote.currency) : "—"}</td>
                    <td>
                      {n.rule_applied === "base"
                        ? "מחיר בסיס"
                        : (RULE_KIND_LABELS[n.rule_applied as RuleKind] ?? n.rule_applied)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-lg font-semibold" data-testid="price-total">
              סה״כ ל-{quote.nights_count} לילות: {money(quote.total, quote.currency)}
            </p>
            {quote.discount > 0 && (
              <p className="text-sm">הנחה: {money(quote.discount, quote.currency)}</p>
            )}
            {quote.nights_count < quote.min_nights && (
              <p className="text-sm text-amber-800">
                בתאריכים האלה אורחים יכולים להזמין לפחות {quote.min_nights} לילות.
              </p>
            )}
            {!quote.available && (
              <p className="text-sm text-amber-800">היחידה תפוסה או חסומה בחלק מהתאריכים.</p>
            )}
            <p className="text-sm text-muted-foreground">
              מדיניות הביטול להזמנה כזו: {quote.policy.name}.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
