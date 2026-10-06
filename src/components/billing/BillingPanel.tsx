import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  Check,
  Crown,
  Gem,
  Hourglass,
  LifeBuoy,
  Loader2,
  Package,
  Puzzle,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { getStoreBilling, type StoreBilling } from "@/lib/billing.functions";
import { ADDON_DEFAULTS } from "@/lib/addons";
import { BUSINESS_TYPE_LABELS, type BillingProfile } from "@/lib/billing-profile";
import { BillingProfileDialog } from "@/components/billing/BillingProfileDialog";
import {
  BILLING_KIND_LABELS,
  BILLING_METHOD_LABELS,
  PAYMENT_METHOD_LABELS,
  PLAN_LABELS,
  TRIAL_DAYS,
  endingSoon,
  formatDate,
  formatShekels,
  remainingLabel,
  type PlanType,
} from "@/lib/subscription";
import { usePlanCatalog } from "@/hooks/usePlanCatalog";
import type { PlanCard as PlanCardInfo } from "@/lib/plan-catalog";
import { PLAN_USERS_TEXT } from "@/lib/admin-seats";
import { AdminSeatsSummary } from "@/components/billing/AdminSeatsSummary";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type PaidPlan = Exclude<PlanType, "trial">;

/**
 * "המנוי שלי" בפאנל הניהול (חלק 13): מצב המנוי (חבילה, ימים שנותרו, שימוש
 * במוצרים), טבלאות המחירים של שתי החבילות, והיסטוריית התשלומים.
 * אין סליקה באתר — "לבחירת חבילה" פותח פנייה לצוות (נושא מוכן מראש), והתשלום
 * מתועד ע"י הנהלת הפלטפורמה.
 */
export function BillingPanel({
  onChoosePlan,
  onContactSupport,
}: {
  onChoosePlan: (plan: PaidPlan) => void;
  onContactSupport: () => void;
}) {
  const load = useServerFn(getStoreBilling);
  const [data, setData] = useState<StoreBilling | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await load());
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "טעינת המנוי נכשלה");
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sub = data?.subscription ?? null;
  const setProfile = (profile: BillingProfile) =>
    setData((current) => (current ? { ...current, billingProfile: profile } : current));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <Gem className="size-6 text-accent" aria-hidden="true" />
            המנוי שלי
          </h2>
          <p className="text-sm text-muted-foreground">
            החבילה של החנות, התוקף שלה והיסטוריית התשלומים.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          רענון
        </Button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {sub ? (
        <>
          <CurrentPlanCard
            billing={data!}
            onChoosePlan={onChoosePlan}
            onContactSupport={onContactSupport}
          />
          <AdminSeatsSummary />
        </>
      ) : (
        !error && (
          <div className="h-40 animate-pulse rounded-2xl bg-muted" aria-label="טוען את המנוי" />
        )
      )}

      <PricingTables
        current={sub?.active && sub.plan !== "trial" ? sub.plan : null}
        onChoose={onChoosePlan}
      />

      {data?.billingProfile && (
        <BillingProfileCard profile={data.billingProfile} onEdit={() => setProfileOpen(true)} />
      )}

      {data && data.addons.length > 0 && <MyAddons billing={data} />}

      {data && data.history.length > 0 && <BillingHistory billing={data} />}

      <BillingProfileDialog
        open={profileOpen}
        initial={data?.billingProfile ?? null}
        submitLabel="שמירה"
        onClose={() => setProfileOpen(false)}
        onSaved={(profile) => {
          setProfile(profile);
          setProfileOpen(false);
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------
// פרטי העסק לחיוב (חלק 16)
// ------------------------------------------------------------

function BillingProfileCard({
  profile,
  onEdit,
}: {
  profile: BillingProfile | null;
  onEdit: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="size-5 text-muted-foreground" aria-hidden="true" />
            פרטי העסק לחיוב
          </CardTitle>
          <CardDescription>מופיעים בחיובי המנוי והתוספים.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onEdit}>
          {profile ? "עריכה" : "השלמת הפרטים"}
        </Button>
      </CardHeader>
      <CardContent>
        {profile ? (
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">סוג עוסק:</dt>
              <dd className="font-medium">{BUSINESS_TYPE_LABELS[profile.businessType]}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">שם:</dt>
              <dd className="font-medium">{profile.companyName}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">מספר:</dt>
              <dd dir="ltr" className="font-medium">
                {profile.taxId}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">כתובת:</dt>
              <dd className="font-medium">{profile.address}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            עוד לא הוזנו — נבקש אותם לפני התשלום הראשון.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------
// מצב המנוי
// ------------------------------------------------------------

function CurrentPlanCard({
  billing,
  onChoosePlan,
  onContactSupport,
}: {
  billing: StoreBilling;
  onChoosePlan: (plan: PaidPlan) => void;
  onContactSupport: () => void;
}) {
  const sub = billing.subscription;
  const expired = !sub.active;
  const trial = sub.plan === "trial";
  const soon = endingSoon(sub);
  const max = sub.features.maxProducts;
  const usage = max ? Math.min(100, Math.round((billing.productCount / max) * 100)) : null;
  const trialProgress =
    trial && sub.daysLeft !== null
      ? Math.max(0, Math.min(100, Math.round(((TRIAL_DAYS - sub.daysLeft) / TRIAL_DAYS) * 100)))
      : null;

  return (
    <div className="space-y-4">
      {(expired || soon || trial) && (
        <div
          className={cn(
            "flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm",
            expired
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100",
          )}
        >
          {expired ? (
            <AlertTriangle className="size-5 shrink-0" aria-hidden="true" />
          ) : (
            <Hourglass className="size-5 shrink-0" aria-hidden="true" />
          )}
          <p className="min-w-0 flex-1 font-medium">
            {expired
              ? "המנוי של החנות הסתיים — האתר סגור ללקוחות ופאנל הניהול נעול. בחרו חבילה כדי לחזור לפעילות מיד."
              : trial
                ? `אתם בתקופת ניסיון חינם (${remainingLabel(sub)}). כדי להמשיך למכור בלי הפסקה — בחרו חבילה.`
                : `המנוי מסתיים בקרוב (${remainingLabel(sub)}). כדאי לחדש כבר עכשיו.`}
          </p>
          <Button
            size="sm"
            className="bg-amber-600 text-white hover:bg-amber-700"
            onClick={() => onChoosePlan(sub.plan === "basic" ? "basic" : "premium")}
          >
            <Crown className="size-4" />
            {trial || expired ? "לבחירת חבילה" : "לחידוש המנוי"}
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="grid gap-0 md:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4 bg-gradient-to-l from-primary to-primary/85 p-6 text-primary-foreground">
            <p className="text-sm text-primary-foreground/75">החבילה שלך</p>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-display text-3xl font-black">{PLAN_LABELS[sub.plan]}</span>
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-bold",
                  expired
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-primary-foreground/15 text-primary-foreground",
                )}
              >
                {expired ? "פג תוקף" : sub.status === "trialing" ? "בתקופת ניסיון" : "פעיל"}
              </span>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="flex items-start gap-2">
                <CalendarClock className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
                <div>
                  <dt className="text-primary-foreground/70">
                    {trial ? "סוף תקופת הניסיון" : "בתוקף עד"}
                  </dt>
                  <dd className="font-semibold">
                    {sub.endsAt ? formatDate(sub.endsAt) : "ללא תפוגה"}
                  </dd>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Hourglass className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
                <div>
                  <dt className="text-primary-foreground/70">זמן שנותר</dt>
                  <dd className="font-semibold">{remainingLabel(sub)}</dd>
                </div>
              </div>
            </dl>
            {trialProgress !== null && !expired && (
              <div className="space-y-1">
                <div className="h-2 overflow-hidden rounded-full bg-primary-foreground/20">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${trialProgress}%` }}
                  />
                </div>
                <p className="text-xs text-primary-foreground/70">
                  {TRIAL_DAYS} ימי ניסיון — כל הפיצ'רים של פרימיום פתוחים
                </p>
              </div>
            )}
          </div>

          <div className="space-y-4 p-6">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
                <Package className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted-foreground">מוצרים בחנות</p>
                <p className="text-xl font-bold">
                  {billing.productCount.toLocaleString("he-IL")}
                  <span className="text-sm font-medium text-muted-foreground">
                    {max ? ` / ${max.toLocaleString("he-IL")}` : " · ללא הגבלה"}
                  </span>
                </p>
                {usage !== null && (
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        usage >= 100
                          ? "bg-destructive"
                          : usage >= 85
                            ? "bg-amber-500"
                            : "bg-primary",
                      )}
                      style={{ width: `${usage}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
            <ul className="space-y-1.5 text-sm">
              {(
                [
                  ["customDomain", "דומיין אישי"],
                  ["variants", "וריאציות (צבעים / מידות)"],
                  ["digital", "מוצרים דיגיטליים"],
                  ["googleLogin", "התחברות לקוחות עם Google"],
                  ["vipSupport", "צ'אט תמיכה VIP"],
                ] as const
              ).map(([key, label]) => {
                const on = sub.features[key];
                return (
                  <li key={key} className="flex items-center gap-2">
                    {on ? (
                      <Check className="size-4 text-emerald-600" aria-hidden="true" />
                    ) : (
                      <span className="size-4 text-center text-muted-foreground" aria-hidden="true">
                        —
                      </span>
                    )}
                    <span className={on ? "text-foreground" : "text-muted-foreground line-through"}>
                      {label}
                    </span>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={onContactSupport}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              <LifeBuoy className="size-4" aria-hidden="true" />
              שאלה על המנוי? דברו איתנו
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------
// טבלאות המחירים
// ------------------------------------------------------------

function PricingTables({
  current,
  onChoose,
}: {
  current: PaidPlan | null;
  onChoose: (plan: PaidPlan) => void;
}) {
  // החבילות והמחירים — מהעורך של מנהל הפלטפורמה (חלק 14)
  const { catalog } = usePlanCatalog();
  return (
    <section className="space-y-5" aria-labelledby="pricing-title">
      <div className="text-center">
        <h3 id="pricing-title" className="font-display text-2xl font-bold sm:text-3xl">
          בחרו את החבילה שמתאימה לכם
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          השוו בין החבילות ובחרו את מה שמתאים לחנות שלכם.
        </p>
      </div>

      {/* הדגשה: אופן התשלום */}
      {catalog.paymentNote && (
        <div className="mx-auto flex max-w-3xl items-center justify-center gap-3 rounded-2xl border-2 border-accent bg-accent/10 px-5 py-4 text-center">
          <ShieldCheck className="size-6 shrink-0 text-accent" aria-hidden="true" />
          <p className="text-base font-bold text-foreground sm:text-lg">{catalog.paymentNote}</p>
        </div>
      )}

      <div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-2">
        <PlanCard
          plan="basic"
          info={catalog.plans.basic}
          current={current === "basic"}
          onChoose={onChoose}
        />
        <PlanCard
          plan="premium"
          info={catalog.plans.premium}
          current={current === "premium"}
          onChoose={onChoose}
          featured
        />
      </div>

      {catalog.vatNote && (
        <p className="text-center text-xs text-muted-foreground">{catalog.vatNote}</p>
      )}
    </section>
  );
}

function PlanCard({
  plan,
  info,
  current,
  featured = false,
  onChoose,
}: {
  plan: PaidPlan;
  info: PlanCardInfo;
  current: boolean;
  featured?: boolean;
  onChoose: (plan: PaidPlan) => void;
}) {
  const monthly = info.monthlyPrice;
  return (
    <div
      className={cn(
        "relative flex flex-col rounded-3xl border p-6 shadow-sm transition sm:p-8",
        featured
          ? "border-primary bg-primary text-primary-foreground shadow-xl md:-translate-y-2"
          : "border-border bg-card",
      )}
    >
      {info.badge && (
        <span
          className={cn(
            "absolute -top-3.5 right-1/2 inline-flex translate-x-1/2 items-center gap-1.5 rounded-full px-4 py-1 text-xs font-bold shadow",
            featured ? "bg-accent text-accent-foreground" : "bg-primary text-primary-foreground",
          )}
        >
          <Sparkles className="size-3.5" aria-hidden="true" />
          {info.badge}
        </span>
      )}
      <div className="flex items-center gap-2">
        {featured ? (
          <Crown className="size-6 text-accent" aria-hidden="true" />
        ) : (
          <Package className="size-6 text-primary" aria-hidden="true" />
        )}
        <h4 className="text-xl font-bold">{info.title}</h4>
        {current && (
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-bold",
              featured ? "bg-primary-foreground/15" : "bg-secondary text-secondary-foreground",
            )}
          >
            החבילה שלך
          </span>
        )}
      </div>
      <p
        className={cn(
          "mt-1 text-sm",
          featured ? "text-primary-foreground/75" : "text-muted-foreground",
        )}
      >
        {info.tagline}
      </p>

      <div className="mt-5 flex items-end gap-1">
        <span className="font-display text-5xl font-black leading-none">
          {monthly.toLocaleString("he-IL")}
        </span>
        <span className="mb-1 text-lg font-bold">₪</span>
        <span
          className={cn(
            "mb-1 text-sm",
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
        {formatShekels(monthly * 12)} לשנה — מראש או ב-12 תשלומים של {formatShekels(monthly)}
      </p>

      <ul className="mt-6 flex-1 space-y-2.5">
        {/* חלק 24: כמה משתמשים (מנהלים) בחבילה */}
        <li data-plan-users="" className="flex items-start gap-2.5 text-sm font-semibold">
          <span
            className={cn(
              "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
              featured ? "bg-accent text-accent-foreground" : "bg-primary/10 text-primary",
            )}
          >
            <Users className="size-3.5" aria-hidden="true" />
          </span>
          {PLAN_USERS_TEXT[plan]}
        </li>
        {info.features.map((feature, index) => {
          const highlight = plan === "premium" && index === 0;
          return (
            <li key={feature} className="flex items-start gap-2.5 text-sm">
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                  featured ? "bg-accent text-accent-foreground" : "bg-primary/10 text-primary",
                )}
              >
                <Check className="size-3.5" aria-hidden="true" />
              </span>
              <span className={highlight ? "font-bold" : undefined}>{feature}</span>
            </li>
          );
        })}
      </ul>

      <Button
        type="button"
        size="lg"
        disabled={current}
        onClick={() => onChoose(plan)}
        className={cn(
          "mt-7 w-full text-base font-bold",
          featured
            ? "bg-accent text-accent-foreground hover:bg-accent/90"
            : "bg-primary text-primary-foreground hover:bg-primary/90",
        )}
      >
        {current
          ? "החבילה הנוכחית שלך"
          : `אני רוצה את ה${plan === "premium" ? "פרימיום" : "בסיסית"}`}
      </Button>
    </div>
  );
}

// ------------------------------------------------------------
// התוספים שלי (חלק 15)
// ------------------------------------------------------------

function MyAddons({ billing }: { billing: StoreBilling }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Puzzle className="size-5 text-muted-foreground" aria-hidden="true" />
          התוספים שלי
        </CardTitle>
        <CardDescription>
          תוספים חודשיים מתחדשים יחד עם המנוי. לרכישת תוספים — "שדרוגים ותוספים" בתפריט.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {billing.addons.map((addon) => (
            <li
              key={addon.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
            >
              <span className="font-medium">{addon.title}</span>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  addon.active
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {addon.active
                  ? addon.expiresAt
                    ? `פעיל עד ${formatDate(addon.expiresAt)}`
                    : "פעיל"
                  : addon.endedReason === "canceled"
                    ? "בוטל"
                    : "הסתיים"}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------
// היסטוריית תשלומים
// ------------------------------------------------------------

function BillingHistory({ billing }: { billing: StoreBilling }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Receipt className="size-5 text-muted-foreground" aria-hidden="true" />
          היסטוריית תשלומים
        </CardTitle>
        <CardDescription>תשלומים שתועדו, הארכות, שינויי חבילה ורכישות תוספים.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>תאריך</TableHead>
              <TableHead>פעולה</TableHead>
              <TableHead>חבילה</TableHead>
              <TableHead>תקופה</TableHead>
              <TableHead>סכום</TableHead>
              <TableHead>אופן תשלום</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {billing.history.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap">{formatDate(entry.createdAt)}</TableCell>
                <TableCell>
                  {BILLING_KIND_LABELS[entry.kind]}
                  {entry.kind === "trial_extension" && entry.days ? ` (${entry.days} ימים)` : ""}
                  {entry.addonName && (
                    <span className="block text-xs text-muted-foreground">
                      {ADDON_DEFAULTS[entry.addonName].title}
                    </span>
                  )}
                  {entry.reference && (
                    <span className="block text-xs text-muted-foreground">
                      אסמכתא: {entry.reference}
                    </span>
                  )}
                </TableCell>
                <TableCell>{PLAN_LABELS[entry.plan]}</TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  {entry.periodStart && entry.periodEnd
                    ? `${formatDate(entry.periodStart)} – ${formatDate(entry.periodEnd)}`
                    : "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap font-semibold">
                  {entry.kind === "payment" || entry.kind === "addon"
                    ? formatShekels(entry.amount)
                    : "—"}
                  {entry.paymentStatus === "due" && (
                    <span className="mt-0.5 block w-fit rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                      ממתין לתשלום
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {entry.method ? BILLING_METHOD_LABELS[entry.method] : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
