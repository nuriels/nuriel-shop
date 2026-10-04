import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Crown,
  Gem,
  Info,
  Loader2,
  Package,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { platformSavePricing } from "@/lib/billing.functions";
import { PLATFORM_SITE_NAME } from "@/lib/platform.functions";
import {
  DEFAULT_PLAN_CATALOG,
  PAID_PLANS,
  PLAN_LIMITS,
  planCardProblem,
  yearlyPrice,
  type PaidPlan,
  type PlanCard,
  type PlanCatalog,
} from "@/lib/plan-catalog";
import { formatShekels } from "@/lib/subscription";
import { refreshPlanCatalog, usePlanCatalog } from "@/hooks/usePlanCatalog";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * /platform/plans — עורך החבילות והמחירים של מנהל הפלטפורמה (חלק 14):
 * שם, משפט, מחיר חודשי, תווית ורשימת הפיצ'רים של כל חבילה, וההערות מתחת
 * לטבלת המחירים. מה שנשמר כאן מוצג מיד בכל החנויות ("המנוי שלי"). ההרשאות
 * עצמן (מה פתוח בכל חבילה) — קבועות בקוד ובמסד, ולא משתנות מכאן.
 */
export const Route = createFileRoute("/platform_/plans")({
  ssr: false,
  head: () => ({
    meta: [
      { title: `חבילות ומחירים · ${PLATFORM_SITE_NAME}` },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PlansPage,
});

function PlansPage() {
  return <PlatformShell active="plans">{() => <PlansEditor />}</PlatformShell>;
}

const PLAN_NAMES: Record<PaidPlan, string> = { basic: "החבילה הבסיסית", premium: "חבילת הפרימיום" };

function sameCatalog(a: PlanCatalog, b: PlanCatalog): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function PlansEditor() {
  const save = useServerFn(platformSavePricing);
  const { catalog, loaded } = usePlanCatalog();
  const [form, setForm] = useState<PlanCatalog>(catalog);
  const [busy, setBusy] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // הטופס מתמלא פעם אחת כשהקטלוג נטען
  useEffect(() => {
    if (loaded && !initialized) {
      setForm(catalog);
      setInitialized(true);
    }
  }, [loaded, initialized, catalog]);

  const dirty = initialized && !sameCatalog(form, catalog);

  const patchPlan = (plan: PaidPlan, next: Partial<PlanCard>) =>
    setForm((current) => ({
      ...current,
      plans: { ...current.plans, [plan]: { ...current.plans[plan], ...next } },
    }));

  const submit = async () => {
    for (const plan of PAID_PLANS) {
      const problem = planCardProblem(form.plans[plan]);
      if (problem) {
        toast.error(problem);
        return;
      }
    }
    if (form.paymentNote.length > PLAN_LIMITS.note || form.vatNote.length > PLAN_LIMITS.note) {
      toast.error(`ההערות מתחת למחירים: עד ${PLAN_LIMITS.note} תווים`);
      return;
    }
    setBusy(true);
    try {
      await save({
        data: {
          plans: PAID_PLANS.map((plan) => {
            const card = form.plans[plan];
            return {
              plan,
              title: card.title,
              tagline: card.tagline,
              monthlyPrice: card.monthlyPrice,
              features: card.features.map((f) => f.trim()).filter(Boolean),
              badge: card.badge,
            };
          }),
          paymentNote: form.paymentNote,
          vatNote: form.vatNote,
        },
      });
      const fresh = await refreshPlanCatalog();
      setForm(fresh);
      toast.success("החבילות נשמרו — מוצגות מעכשיו בכל החנויות");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  if (!initialized) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> טוען את החבילות…
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-b bg-background/95 px-1 py-3 backdrop-blur">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <Gem className="size-6 text-primary" aria-hidden="true" />
            חבילות ומחירים
          </h2>
          <p className="text-sm text-muted-foreground">
            מה שבעלי החנויות רואים ב"המנוי שלי": שמות, מחירים ופיצ'רים.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-xs font-medium text-amber-700">יש שינויים שלא נשמרו</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setForm(DEFAULT_PLAN_CATALOG)}
            title="הנוסח המקורי של המערכת (לא נשמר עד שלוחצים שמירה)"
          >
            <RotateCcw className="size-4" />
            נוסח מקורי
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !dirty}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            שמירה
          </Button>
        </div>
      </div>

      <p className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        כאן משנים את הטקסטים והמחירים בלבד. מה שנפתח / ננעל בכל חבילה (מגבלת 1,000 מוצרים, דומיין
        אישי, וריאציות, מוצרים דיגיטליים, Google ותמיכת VIP) קבוע במערכת. מחיר חדש חל על תשלומים
        שיתועדו מעכשיו — לא משנה מנויים קיימים.
      </p>

      <div className="grid gap-5 lg:grid-cols-2">
        {PAID_PLANS.map((plan) => (
          <PlanEditor
            key={plan}
            plan={plan}
            card={form.plans[plan]}
            onChange={(next) => patchPlan(plan, next)}
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">ההערות סביב טבלת המחירים</CardTitle>
          <CardDescription>ריק = לא מוצג.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pl-payment">אופן התשלום (מודגש מעל הכרטיסים)</Label>
            <Input
              id="pl-payment"
              value={form.paymentNote}
              maxLength={PLAN_LIMITS.note}
              onChange={(e) => setForm((c) => ({ ...c, paymentNote: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-vat">הערת מע"מ (מתחת לכרטיסים)</Label>
            <Input
              id="pl-vat"
              value={form.vatNote}
              maxLength={PLAN_LIMITS.note}
              onChange={(e) => setForm((c) => ({ ...c, vatNote: e.target.value }))}
            />
          </div>
        </CardContent>
      </Card>

      <section className="space-y-4" aria-label="תצוגה מקדימה">
        <h3 className="text-center text-lg font-bold">תצוגה מקדימה — כך זה נראה בחנויות</h3>
        {form.paymentNote && (
          <div className="mx-auto flex max-w-3xl items-center justify-center gap-3 rounded-2xl border-2 border-accent bg-accent/10 px-5 py-3 text-center">
            <ShieldCheck className="size-5 shrink-0 text-accent" aria-hidden="true" />
            <p className="font-bold">{form.paymentNote}</p>
          </div>
        )}
        <div className="mx-auto grid max-w-4xl gap-5 md:grid-cols-2">
          {PAID_PLANS.map((plan) => (
            <PlanPreview key={plan} card={form.plans[plan]} featured={plan === "premium"} />
          ))}
        </div>
        {form.vatNote && (
          <p className="text-center text-xs text-muted-foreground">{form.vatNote}</p>
        )}
      </section>
    </div>
  );
}

function PlanEditor({
  plan,
  card,
  onChange,
}: {
  plan: PaidPlan;
  card: PlanCard;
  onChange: (next: Partial<PlanCard>) => void;
}) {
  const [priceText, setPriceText] = useState(String(card.monthlyPrice));
  useEffect(() => setPriceText(String(card.monthlyPrice)), [card.monthlyPrice]);

  const setFeature = (index: number, value: string) =>
    onChange({ features: card.features.map((f, i) => (i === index ? value : f)) });
  const move = (index: number, delta: number) => {
    const next = [...card.features];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange({ features: next });
  };
  const Icon = plan === "premium" ? Crown : Package;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Icon
            className={cn("size-5", plan === "premium" ? "text-amber-600" : "text-primary")}
            aria-hidden="true"
          />
          {PLAN_NAMES[plan]}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
          <div className="space-y-1.5">
            <Label htmlFor={`pl-${plan}-title`}>שם החבילה</Label>
            <Input
              id={`pl-${plan}-title`}
              value={card.title}
              maxLength={PLAN_LIMITS.title}
              onChange={(e) => onChange({ title: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`pl-${plan}-price`}>מחיר לחודש (₪)</Label>
            <Input
              id={`pl-${plan}-price`}
              inputMode="decimal"
              dir="ltr"
              value={priceText}
              onChange={(e) => {
                setPriceText(e.target.value);
                const value = Number(e.target.value);
                if (Number.isFinite(value)) onChange({ monthlyPrice: value });
              }}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`pl-${plan}-tagline`}>משפט מתחת לשם</Label>
          <Input
            id={`pl-${plan}-tagline`}
            value={card.tagline}
            maxLength={PLAN_LIMITS.tagline}
            onChange={(e) => onChange({ tagline: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`pl-${plan}-badge`}>תווית על הכרטיס (לא חובה)</Label>
          <Input
            id={`pl-${plan}-badge`}
            value={card.badge ?? ""}
            maxLength={PLAN_LIMITS.badge}
            placeholder="למשל: הכי משתלם"
            onChange={(e) => onChange({ badge: e.target.value || null })}
          />
        </div>
        <div className="space-y-2">
          <Label>
            הפיצ'רים ברשימה ({card.features.length}/{PLAN_LIMITS.features})
          </Label>
          <ul className="space-y-1.5">
            {card.features.map((feature, index) => (
              <li key={index} className="flex items-center gap-1.5">
                <Check className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                <Input
                  value={feature}
                  maxLength={PLAN_LIMITS.feature}
                  aria-label={`פיצ'ר ${index + 1}`}
                  onChange={(e) => setFeature(index, e.target.value)}
                  className="h-9"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label="למעלה"
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  disabled={index === card.features.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label="למטה"
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-destructive hover:text-destructive"
                  onClick={() =>
                    onChange({ features: card.features.filter((_, i) => i !== index) })
                  }
                  aria-label="מחיקה"
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={card.features.length >= PLAN_LIMITS.features}
            onClick={() => onChange({ features: [...card.features, ""] })}
          >
            <Plus className="size-4" />
            הוספת פיצ'ר
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PlanPreview({ card, featured }: { card: PlanCard; featured: boolean }) {
  return (
    <div
      className={cn(
        "relative flex flex-col rounded-3xl border p-6 shadow-sm",
        featured
          ? "border-primary bg-primary text-primary-foreground shadow-xl"
          : "border-border bg-card",
      )}
    >
      {card.badge && (
        <span
          className={cn(
            "absolute -top-3.5 right-1/2 inline-flex translate-x-1/2 items-center gap-1.5 rounded-full px-4 py-1 text-xs font-bold shadow",
            featured ? "bg-accent text-accent-foreground" : "bg-primary text-primary-foreground",
          )}
        >
          <Sparkles className="size-3.5" aria-hidden="true" />
          {card.badge}
        </span>
      )}
      <h4 className="text-xl font-bold">{card.title || "—"}</h4>
      <p
        className={cn(
          "mt-1 text-sm",
          featured ? "text-primary-foreground/75" : "text-muted-foreground",
        )}
      >
        {card.tagline}
      </p>
      <div className="mt-4 flex items-end gap-1">
        <span className="font-display text-4xl font-black leading-none">
          {Number.isFinite(card.monthlyPrice) ? card.monthlyPrice.toLocaleString("he-IL") : "—"}
        </span>
        <span className="mb-0.5 text-lg font-bold">₪</span>
        <span
          className={cn(
            "mb-0.5 text-sm",
            featured ? "text-primary-foreground/75" : "text-muted-foreground",
          )}
        >
          / לחודש*
        </span>
      </div>
      <p
        className={cn(
          "mt-1 text-xs",
          featured ? "text-primary-foreground/70" : "text-muted-foreground",
        )}
      >
        {formatShekels(yearlyPrice(card))} לשנה
      </p>
      <ul className="mt-4 space-y-2">
        {card.features
          .filter((f) => f.trim())
          .map((feature, index) => (
            <li key={index} className="flex items-start gap-2 text-sm">
              <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {feature}
            </li>
          ))}
      </ul>
    </div>
  );
}
