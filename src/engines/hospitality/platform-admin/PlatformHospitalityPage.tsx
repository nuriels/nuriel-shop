// "ניהול Hospitality" בפאנל הפלטפורמה (P1, /platform/hospitality, בכתובת הפאנל בלבד):
// פתיחת עסק אירוח (שם, כתובת, אימייל הבעלים, חבילה) → האתר, המסד ואזור הניהול מוכנים,
// והבעלים נכנס ל-/manage בקוד שנשלח למייל ומקים את העסק לבד. וגם: רשימת אתרי האירוח,
// שיוך בעלים, חבילה, הדלקה / כיבוי של אתר, ומצב המנוע בפלטפורמה.
// מסך של המנוע — מגיע לפאנל רק דרך קישור (בלי import מקוד החנויות); ההרשאה במסד.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BedDouble, Copy, ExternalLink, Gem, LifeBuoy, Plus, Store, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
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
  hospitalityPlatformOpenSite,
  hospitalityPlatformSetFlag,
  hospitalityPlatformSetOwner,
  hospitalityPlatformSetPlan,
  hospitalityPlatformView,
} from "../api/platform-admin.functions";
import type {
  HospitalitySiteRow,
  OpenSiteResult,
  PlanOption,
  PlatformHospitalityView,
  SiteFlagKey,
} from "../types/platform-admin";
import { emailError, slugError, suggestSlug } from "../validation/platform-admin";
import { FormSheet } from "../management/catalog/CatalogSheets";
import { errorText } from "../management/catalog/refresh";

const KEY = ["hospitality-platform"] as const;

export function PlatformHospitalityPage() {
  const query = useQuery({
    queryKey: KEY,
    queryFn: () => hospitalityPlatformView(),
    retry: false,
    refetchOnWindowFocus: false,
  });
  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <PanelHeader />
      <main className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">ניהול Hospitality</h1>
          <p className="text-muted-foreground">
            פתיחת עסקי אירוח (צימרים, וילות, מלונות) ומעקב אחריהם. בעל העסק מקים את הכול בעצמו באזור
            הניהול של האתר שלו.
          </p>
        </header>
        {query.isPending ? (
          <p role="status">טוען…</p>
        ) : query.isError ? (
          <AccessProblem message={errorText(query.error)} />
        ) : (
          <Content view={query.data} />
        )}
      </main>
    </div>
  );
}

/** הכותרת של הפאנל — אותם קישורים כמו בשאר הלשוניות (בלי לייבא את קוד הפאנל) */
function PanelHeader() {
  const links = [
    { to: "/platform", label: "חנויות", icon: Store },
    { to: "/platform/support", label: "תמיכה", icon: LifeBuoy },
    { to: "/platform/plans", label: "חבילות ומחירים", icon: Gem },
    { to: "/platform/upgrades", label: "בקשות שדרוג ותוספים", icon: UserPlus },
  ] as const;
  return (
    <div className="border-b bg-card">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
        <p className="text-lg font-bold">ניהול הפלטפורמה</p>
        <nav
          aria-label="ניווט בפאנל"
          className="flex flex-wrap items-center gap-1 rounded-lg bg-secondary p-1"
        >
          {links.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground hover:text-foreground"
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </Link>
          ))}
          <span
            aria-current="page"
            className="flex min-h-9 items-center gap-1.5 rounded-md bg-background px-3 text-sm font-medium shadow-sm"
          >
            <BedDouble className="size-4" aria-hidden="true" />
            ניהול Hospitality
          </span>
        </nav>
      </div>
    </div>
  );
}

function AccessProblem({ message }: { message: string }) {
  const login = /התחברות/.test(message);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <p>{login ? "יש להתחבר עם חשבון של מנהל הפלטפורמה." : message}</p>
        {login && (
          <Link to="/login" className="font-medium text-primary hover:underline">
            להתחברות
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

function Content({ view }: { view: PlatformHospitalityView }) {
  const [owner, setOwner] = useState<HospitalitySiteRow | null>(null);
  const [plan, setPlan] = useState<HospitalitySiteRow | null>(null);
  return (
    <>
      <EngineSwitches view={view} />
      <OpenSiteCard view={view} />
      <section className="flex flex-col gap-3" aria-labelledby="sites-title">
        <h2 id="sites-title" className="text-xl font-semibold">
          אתרי אירוח ({view.sites.length})
        </h2>
        {view.sites.length === 0 ? (
          <p className="text-muted-foreground">עדיין לא נפתח אף עסק אירוח.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {view.sites.map((s) => (
              <SiteCard key={s.id} site={s} onOwner={() => setOwner(s)} onPlan={() => setPlan(s)} />
            ))}
          </ul>
        )}
      </section>
      {owner && <OwnerSheet site={owner} onClose={() => setOwner(null)} />}
      {plan && <PlanSheet site={plan} plans={view.flags.plans} onClose={() => setPlan(null)} />}
    </>
  );
}

function useRefresh() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: KEY });
}

/** המנוע בפלטפורמה כולה: בלי שני הדגלים האלה אף אתר אירוח לא פעיל, גם אם הודלק לאתר */
function EngineSwitches({ view }: { view: PlatformHospitalityView }) {
  const refresh = useRefresh();
  const [busy, setBusy] = useState(false);
  const set = async (key: SiteFlagKey, enabled: boolean) => {
    setBusy(true);
    try {
      await hospitalityPlatformSetFlag({ data: { siteId: null, key, enabled } });
      toast.success(enabled ? "הופעל בפלטפורמה" : "כובה בפלטפורמה");
      refresh();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const ready = view.flags.backend && view.flags.management;
  return (
    <Card data-section="engine">
      <CardHeader>
        <CardTitle className="text-lg">
          <h2>המנוע בפלטפורמה</h2>
        </CardTitle>
        <CardDescription>
          {ready
            ? "פעיל: אתרי אירוח שהופעלו פתוחים לבעלים שלהם."
            : "כבוי: אף אתר אירוח לא נפתח לבעלים עד שמדליקים כאן את שני המתגים."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-6">
        <label className="flex min-h-11 items-center gap-3">
          <Switch
            checked={view.flags.backend}
            disabled={busy}
            onCheckedChange={(v) => void set("backend", v)}
            aria-label="מסד הנתונים של Hospitality"
          />
          מסד הנתונים של Hospitality
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <Switch
            checked={view.flags.management}
            disabled={busy}
            onCheckedChange={(v) => void set("management", v)}
            aria-label="אזורי הניהול של העסקים"
          />
          אזורי הניהול של העסקים
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <Switch
            checked={view.flags.frontend}
            disabled={busy}
            onCheckedChange={(v) => void set("frontend", v)}
            aria-label="האתרים הציבוריים של העסקים"
          />
          האתרים הציבוריים של העסקים
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <Switch
            checked={view.flags.booking}
            disabled={busy}
            onCheckedChange={(v) => void set("booking", v)}
            aria-label="בקשות הזמנה מהאתרים"
          />
          בקשות הזמנה מהאתרים
        </label>
        <p className="basis-full text-sm text-muted-foreground">
          האתר הציבורי ובקשות ההזמנה נפתחים לעסק רק כשהמתג כאן דלוק וגם המתג של העסק (בכרטיס שלו).
        </p>
      </CardContent>
    </Card>
  );
}

function OpenSiteCard({ view }: { view: PlatformHospitalityView }) {
  const refresh = useRefresh();
  const empty = { name: "", slug: "", ownerEmail: "", ownerName: "", plan: "trial", periodEnd: "" };
  const [f, setF] = useState(empty);
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OpenSiteResult | null>(null);
  const plan = view.flags.plans.find((p) => p.code === f.plan);
  const errors = {
    name: f.name.trim() ? null : "יש להזין את שם העסק",
    slug: slugError(f.slug.trim()),
    ownerEmail: emailError(f.ownerEmail.trim().toLowerCase()),
  };
  const invalid = Object.values(errors).some(Boolean);
  const submit = async () => {
    setSubmitted(true);
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      const r = await hospitalityPlatformOpenSite({
        data: { ...f, periodEnd: f.plan === "trial" ? "" : f.periodEnd },
      });
      setResult(r);
      setF(empty);
      setSlugTouched(false);
      setSubmitted(false);
      refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card data-section="open-site">
      <CardHeader>
        <CardTitle className="text-lg">
          <h2>פתיחת עסק אירוח</h2>
        </CardTitle>
        <CardDescription>
          נפתח אתר עם מסד ואזור ניהול. האתר הציבורי והזמנות האורחים נשארים כבויים עד שהעסק מוכן.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {result && <OpenedNotice result={result} onClose={() => setResult(null)} />}
        <form
          className="grid gap-4 md:grid-cols-2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void submit();
          }}
        >
          <Field id="os-name" label="שם העסק" error={submitted ? errors.name : null}>
            <Input
              id="os-name"
              value={f.name}
              maxLength={120}
              placeholder="למשל: צימרי הגליל"
              onChange={(e) =>
                setF((x) => ({
                  ...x,
                  name: e.target.value,
                  slug: slugTouched ? x.slug : suggestSlug(e.target.value),
                }))
              }
              className="min-h-11"
            />
          </Field>
          <Field
            id="os-slug"
            label="כתובת האתר"
            hint={
              view.base_domain
                ? `${f.slug.trim() || "…"}.${view.base_domain} — אותיות באנגלית, ספרות ומקף`
                : "אותיות באנגלית, ספרות ומקף"
            }
            error={submitted ? errors.slug : null}
          >
            <Input
              id="os-slug"
              dir="ltr"
              value={f.slug}
              maxLength={40}
              placeholder="galil-zimmers"
              onChange={(e) => {
                setSlugTouched(true);
                setF((x) => ({ ...x, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") }));
              }}
              className="min-h-11"
            />
          </Field>
          <Field
            id="os-email"
            label="האימייל של בעל העסק"
            hint="בעל העסק נכנס לאזור הניהול עם האימייל הזה — בקוד חד-פעמי שנשלח אליו"
            error={submitted ? errors.ownerEmail : null}
          >
            <Input
              id="os-email"
              type="email"
              dir="ltr"
              autoComplete="off"
              value={f.ownerEmail}
              onChange={(e) => setF((x) => ({ ...x, ownerEmail: e.target.value }))}
              className="min-h-11"
            />
          </Field>
          <Field id="os-owner" label="שם בעל העסק (לא חובה)">
            <Input
              id="os-owner"
              value={f.ownerName}
              maxLength={80}
              onChange={(e) => setF((x) => ({ ...x, ownerName: e.target.value }))}
              className="min-h-11"
            />
          </Field>
          <Field id="os-plan" label="חבילה" hint={planHint(plan)}>
            <select
              id="os-plan"
              className="min-h-11 rounded-md border border-input bg-background px-3"
              value={f.plan}
              onChange={(e) => setF((x) => ({ ...x, plan: e.target.value }))}
            >
              {view.flags.plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          {f.plan !== "trial" && (
            <Field id="os-until" label="המנוי בתוקף עד (לא חובה)" hint="ריק — בלי תאריך סיום">
              <Input
                id="os-until"
                type="date"
                dir="ltr"
                value={f.periodEnd}
                onChange={(e) => setF((x) => ({ ...x, periodEnd: e.target.value }))}
                className="min-h-11"
              />
            </Field>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive md:col-span-2">
              {error}
            </p>
          )}
          <div className="md:col-span-2">
            <Button type="submit" className="min-h-11 gap-2" disabled={busy}>
              <Plus className="size-4" aria-hidden="true" />
              {busy ? "פותחים…" : "פתיחת העסק"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

const planHint = (p: PlanOption | undefined) =>
  !p
    ? undefined
    : `${p.max_units === null ? "ללא הגבלת יחידות" : `עד ${p.max_units} יחידות`}${
        p.trial_days ? ` · ${p.trial_days} ימי ניסיון` : ""
      }`;

function OpenedNotice({ result, onClose }: { result: OpenSiteResult; onClose: () => void }) {
  const ownerOk = result.owner.status !== "failed";
  const message = `שלום, האתר של "${result.name}" במערכת נוריאל מוכן.\nכניסה לאזור הניהול: ${
    result.manage_url ?? `(כתובת האתר: ${result.slug})`
  }\nהכניסה עם האימייל שלך — יישלח אליך קוד חד-פעמי. משם מקימים את העסק: פרטים, יחידות, תמונות, מחירים ומדיניות ביטול.`;
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-2 rounded-md border p-4",
        ownerOk ? "border-emerald-600 bg-emerald-50" : "border-amber-600 bg-amber-50",
      )}
      data-testid="opened-notice"
    >
      <p className="font-semibold">העסק "{result.name}" נפתח.</p>
      {ownerOk ? (
        <p className="text-sm">
          בעל העסק שויך
          {result.owner.status === "added" && result.owner.account_created
            ? " (נפתח לו חשבון חדש, בלי סיסמה)"
            : ""}
          . שלחו לו את ההודעה הזו:
        </p>
      ) : (
        <p className="text-sm">
          שיוך בעל העסק נכשל: {result.owner.status === "failed" ? result.owner.message : ""}. אפשר
          לנסות שוב מכרטיס האתר ברשימה ("שיוך בעלים").
        </p>
      )}
      {ownerOk && (
        <>
          <pre className="whitespace-pre-wrap rounded bg-background p-3 font-sans text-sm">
            {message}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 gap-2"
              onClick={() =>
                void navigator.clipboard
                  .writeText(message)
                  .then(() => toast.success("ההודעה הועתקה"))
                  .catch(() => toast.error("ההעתקה נכשלה — אפשר לסמן ולהעתיק ידנית"))
              }
            >
              <Copy className="size-4" aria-hidden="true" />
              העתקת ההודעה
            </Button>
            {result.manage_url && (
              <a
                href={result.manage_url}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-11 items-center gap-2 px-2 font-medium text-primary hover:underline"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                אזור הניהול של האתר
              </a>
            )}
          </div>
        </>
      )}
      <Button type="button" variant="ghost" className="min-h-11 self-start" onClick={onClose}>
        סגירה
      </Button>
    </div>
  );
}

function Field(props: {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      {props.children}
      {props.hint && <p className="text-xs text-muted-foreground">{props.hint}</p>}
      {props.error && <p className="text-sm text-destructive">{props.error}</p>}
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = {
  trialing: "בניסיון",
  active: "פעיל",
  past_due: "באיחור תשלום",
  canceled: "בוטל",
  expired: "פג תוקף",
};
const dateText = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" }) : null;

function SiteCard(props: { site: HospitalitySiteRow; onOwner: () => void; onPlan: () => void }) {
  const s = props.site;
  const refresh = useRefresh();
  const [busy, setBusy] = useState(false);
  const setSite = async (key: "frontend" | "booking", enabled: boolean) => {
    setBusy(true);
    try {
      await hospitalityPlatformSetFlag({ data: { siteId: s.id, key, enabled } });
      if (enabled && !s.site_flags.backend)
        await hospitalityPlatformSetFlag({ data: { siteId: s.id, key: "backend", enabled: true } });
      toast.success(
        key === "frontend"
          ? enabled
            ? `האתר של ${s.name} פתוח לגולשים`
            : `האתר של ${s.name} נסגר`
          : enabled
            ? `${s.name} מקבל בקשות הזמנה מהאתר`
            : `בקשות ההזמנה מהאתר של ${s.name} נסגרו`,
      );
      refresh();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      await hospitalityPlatformSetFlag({ data: { siteId: s.id, key: "management", enabled } });
      // המסד של האתר נדרש לאזור הניהול — נדלק איתו (וכיבוי הניהול משאיר את הנתונים)
      if (enabled && !s.site_flags.backend)
        await hospitalityPlatformSetFlag({ data: { siteId: s.id, key: "backend", enabled: true } });
      toast.success(enabled ? `אזור הניהול של ${s.name} פתוח` : `אזור הניהול של ${s.name} נסגר`);
      refresh();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li>
      <Card data-site={s.slug} className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
            <h3>{s.name}</h3>
            {s.status === "suspended" && <Badge variant="destructive">מושעה</Badge>}
            {!s.subscription_active && <Badge variant="secondary">המנוי לא פעיל</Badge>}
          </CardTitle>
          <CardDescription dir="ltr" className="text-end">
            {s.url ? (
              <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">
                {s.url.replace(/^https?:\/\//, "")}
              </a>
            ) : (
              s.slug
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">בעל העסק</dt>
            <dd dir={s.owner_email ? "ltr" : undefined} className={cn(s.owner_email && "text-end")}>
              {s.owner_email ?? <span className="text-amber-800">לא שויך</span>}
            </dd>
            <dt className="text-muted-foreground">חבילה</dt>
            <dd>
              {s.plan_name ?? s.plan} ·{" "}
              {STATUS_TEXT[s.subscription_status] ?? s.subscription_status}
              {s.subscription_status === "trialing" && s.trial_ends_at
                ? ` עד ${dateText(s.trial_ends_at)}`
                : ""}
            </dd>
            <dt className="text-muted-foreground">יחידות פעילות</dt>
            <dd>
              {s.units_active}
              {s.units_limit !== null ? ` מתוך ${s.units_limit}` : ""} · {s.properties} מתחמים
            </dd>
            <dt className="text-muted-foreground">הזמנות</dt>
            <dd>
              {s.bookings_pending} ממתינות · {s.bookings_upcoming} קרובות
            </dd>
            <dt className="text-muted-foreground">צוות</dt>
            <dd>{s.managers ? `${s.managers} מנהלים` : "רק הבעלים"}</dd>
          </dl>
          <label className="flex min-h-11 items-center gap-3">
            <Switch
              checked={s.site_flags.management && s.site_flags.backend}
              disabled={busy}
              onCheckedChange={(v) => void toggle(v)}
              aria-label={`אזור הניהול של ${s.name}`}
            />
            אזור הניהול פתוח לבעלים
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <Switch
              checked={s.site_flags.frontend}
              disabled={busy}
              onCheckedChange={(v) => void setSite("frontend", v)}
              aria-label={`האתר הציבורי של ${s.name}`}
            />
            האתר הציבורי פתוח לגולשים
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <Switch
              checked={s.site_flags.booking}
              disabled={busy || !s.site_flags.frontend}
              onCheckedChange={(v) => void setSite("booking", v)}
              aria-label={`בקשות הזמנה מהאתר של ${s.name}`}
            />
            מקבל בקשות הזמנה מהאתר
          </label>
          {s.site_flags.frontend && !s.frontend_enabled && (
            <p className="text-xs text-amber-800">
              האתר יופעל כשהאתרים הציבוריים יודלקו בפלטפורמה (למעלה).
            </p>
          )}
          {s.site_flags.booking && !s.subscription_active && (
            <p className="text-xs text-amber-800">
              המנוי לא פעיל — בקשות הזמנה לא יתקבלו עד שיחודש.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {!s.owner_email && (
              <Button type="button" className="min-h-11" onClick={props.onOwner}>
                שיוך בעלים
              </Button>
            )}
            <Button type="button" variant="outline" className="min-h-11" onClick={props.onPlan}>
              שינוי חבילה
            </Button>
            {s.site_url && s.frontend_enabled && (
              <a
                href={s.site_url}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-11 items-center gap-2 px-2 font-medium text-primary hover:underline"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                האתר
              </a>
            )}
            {s.manage_url && (
              <a
                href={s.manage_url}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-11 items-center gap-2 px-2 font-medium text-primary hover:underline"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                אזור הניהול
              </a>
            )}
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

function OwnerSheet({ site, onClose }: { site: HospitalitySiteRow; onClose: () => void }) {
  const refresh = useRefresh();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const error = emailError(email.trim().toLowerCase());
  return (
    <FormSheet
      open
      title={`שיוך בעלים — ${site.name}`}
      description="אם אין עדיין חשבון לאימייל, נפתח חשבון חדש בלי סיסמה; הכניסה בקוד שנשלח למייל."
      dirty={email !== "" || name !== ""}
      busy={busy}
      submitLabel="שיוך"
      serverError={serverError}
      notice={null}
      hasErrors={Boolean(error)}
      submitted={submitted}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (error) return;
        setBusy(true);
        setServerError(null);
        void hospitalityPlatformSetOwner({ data: { siteId: site.id, email, name } })
          .then(() => {
            toast.success("בעל העסק שויך");
            refresh();
            onClose();
          })
          .catch((e: unknown) => setServerError(errorText(e)))
          .finally(() => setBusy(false));
      }}
    >
      <Field id="ow-email" label="האימייל של בעל העסק" error={submitted ? error : null}>
        <Input
          id="ow-email"
          type="email"
          dir="ltr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="min-h-11"
        />
      </Field>
      <Field id="ow-name" label="שם (לא חובה)">
        <Input
          id="ow-name"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          className="min-h-11"
        />
      </Field>
    </FormSheet>
  );
}

function PlanSheet(props: { site: HospitalitySiteRow; plans: PlanOption[]; onClose: () => void }) {
  const refresh = useRefresh();
  const { site } = props;
  const [plan, setPlan] = useState(site.plan);
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const error = plan === "trial" && !until ? "לניסיון צריך תאריך סיום" : null;
  const chosen = props.plans.find((p) => p.code === plan);
  return (
    <FormSheet
      open
      title={`חבילה — ${site.name}`}
      description="הורדה לחבילה קטנה מהשימוש הנוכחי מותרת: היחידות הקיימות נשארות, אבל אי אפשר להוסיף עד שמתפנה מקום."
      dirty={plan !== site.plan || until !== ""}
      busy={busy}
      submitLabel="שמירה"
      serverError={serverError}
      notice={null}
      hasErrors={Boolean(error)}
      submitted={submitted}
      onClose={props.onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (error) return;
        setBusy(true);
        setServerError(null);
        void hospitalityPlatformSetPlan({
          data: { siteId: site.id, plan, until, extraUnits: site.extra_units },
        })
          .then(() => {
            toast.success("החבילה עודכנה");
            refresh();
            props.onClose();
          })
          .catch((e: unknown) => setServerError(errorText(e)))
          .finally(() => setBusy(false));
      }}
    >
      <Field id="pl-plan" label="חבילה" hint={planHint(chosen)}>
        <select
          id="pl-plan"
          className="min-h-11 rounded-md border border-input bg-background px-3"
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
        >
          {props.plans.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        id="pl-until"
        label={plan === "trial" ? "הניסיון עד" : "המנוי בתוקף עד (לא חובה)"}
        error={submitted ? error : null}
      >
        <Input
          id="pl-until"
          type="date"
          dir="ltr"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          className="min-h-11"
        />
      </Field>
    </FormSheet>
  );
}
