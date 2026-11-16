// "הגדרות האתר" (מיגרציה 197): כתובת האתר — תת-דומיין של Nuriel (בדיקה אם פנוי, שינוי עם הפניה מהכתובת
// הישנה) או דומיין אישי (הוראות DNS, הוכחת בעלות, בדיקת חיבור ו-SSL, הכתובת הראשית ו-www); ותצוגה משוערת של
// תוצאת גוגל. רק לבעל העסק (ולמנהל הפלטפורמה) — המסד בודק בכל פעולה. אנחנו לא משנים DNS: הרשומות נוספות
// אצל רשם הדומיין של בעל העסק.
import { useId, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@/platform/ui";
import {
  studioAddress,
  studioCustomDomainCheck,
  studioCustomDomainSave,
  studioSlugChange,
  studioSlugCheck,
} from "../api/address.functions";
import { studioDraft } from "../api/studio.functions";
import { pageBySlug } from "../document/normalize";
import { seoSummary } from "../site/page-head";
import type { AddressState, DomainCheckResult } from "../types";
import { previewMediaMap, useMediaLibrary } from "./editor/media";
import { GooglePreview } from "./GooglePreview";
import { useStudio } from "./StudioLayout";
import { formatDate } from "./status";

const ADDRESS = ["bp", "address"] as const;
const errorText = (e: unknown) => (e instanceof Error ? e.message : "הפעולה נכשלה");

export const DOMAIN_STATUS_LABEL: Record<
  NonNullable<AddressState["custom_domain_status"]>,
  string
> = {
  pending: "ממתין לבדיקת חיבור",
  verified: "אומת — ממתין לתעודת SSL (כמה דקות)",
  active: "פעיל עם SSL",
  error: "החיבור לא הושלם",
};

export function StudioSettings() {
  const { context } = useStudio();
  const load = useServerFn(studioAddress);
  const q = useQuery({
    queryKey: ADDRESS,
    queryFn: () => load(),
    enabled: context.permissions.includes("settings.owner"),
  });
  if (!context.permissions.includes("settings.owner"))
    return <p className="text-sm text-muted-foreground">הגדרות האתר זמינות לבעל העסק בלבד.</p>;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">הגדרות האתר</h1>
        <p className="mt-1 text-muted-foreground">
          הכתובת של האתר והדומיין. האתר הציבורי והניהול נפרדים: הניהול תמיד בכתובת של Nuriel ודורש
          כניסה לחשבון.
        </p>
      </div>
      {q.isPending ? (
        <p className="text-sm text-muted-foreground">טוען…</p>
      ) : q.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorText(q.error)}
        </p>
      ) : (
        <>
          <AddressCard state={q.data} />
          <CustomDomainCard state={q.data} />
          <GoogleCard state={q.data} />
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[12rem_1fr] sm:items-baseline">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="m-0 text-sm font-medium">{children}</dd>
    </div>
  );
}

function Url({ href }: { href: string | null }) {
  if (!href) return <span className="text-muted-foreground">—</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      dir="ltr"
      className="underline underline-offset-4"
    >
      {href.replace(/^https?:\/\//, "")}
    </a>
  );
}

/** הכתובת של ממשק הניהול אחרי שינוי: אותה צורה כמו עכשיו (פרוטוקול, פורט), התווית הראשונה מתחלפת */
function studioUrlFor(slug: string): string {
  const { protocol, hostname, port } = window.location;
  const rest = hostname.split(".").slice(1).join(".");
  return `${protocol}//${slug}.${rest}${port ? `:${port}` : ""}/studio/settings`;
}

function AddressCard({ state }: { state: AddressState }) {
  const qc = useQueryClient();
  const check = useServerFn(studioSlugCheck);
  const change = useServerFn(studioSlugChange);
  const id = useId();
  const [value, setValue] = useState("");
  const [result, setResult] = useState<{
    slug: string;
    available: boolean;
    message: string;
  } | null>(null);
  const [changedTo, setChangedTo] = useState<string | null>(null);
  const left = Math.max(0, 3 - state.changes_30d);
  const checkM = useMutation({
    mutationFn: () => check({ data: { slug: value } }),
    onSuccess: (r) => setResult(r),
    onError: (e) => setResult({ slug: value, available: false, message: errorText(e) }),
  });
  const changeM = useMutation({
    mutationFn: () => change({ data: { slug: value, current: state.slug } }),
    onSuccess: async (r) => {
      setChangedTo(r.slug);
      setResult(null);
      setValue("");
      qc.setQueryData(ADDRESS, r);
      toast.success("כתובת האתר שונתה");
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const ready = result && result.available && result.slug === value.trim().toLowerCase();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">כתובת האתר</CardTitle>
        <CardDescription>
          תת-דומיין של Nuriel. שינוי הכתובת לא מוחק את האתר ולא יוצר אתר חדש — רק הכתובת משתנה,
          והכתובת הקודמת מפנה (301) לחדשה במשך שנה, כדי שקישורים ישנים ימשיכו לעבוד.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="space-y-2">
          <Row label="הכתובת בפלטפורמה">
            <Url href={state.slugOrigin} />
          </Row>
          {state.publicOrigin && state.publicOrigin !== state.slugOrigin && (
            <Row label="הכתובת הראשית (דומיין אישי)">
              <Url href={state.publicOrigin} />
            </Row>
          )}
          {state.old_slugs.length > 0 && (
            <Row label="כתובות קודמות (מפנות לכאן)">
              <ul className="m-0 list-none space-y-1 p-0">
                {state.old_slugs.map((o) => (
                  <li key={o.name}>
                    <span dir="ltr">
                      {o.name}.{state.baseDomain}
                    </span>{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      עד {formatDate(o.expires_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </Row>
          )}
        </dl>

        {changedTo && (
          <div
            role="status"
            className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950"
          >
            <p className="font-semibold">
              הכתובת שונתה. הכתובת החדשה: {changedTo}.{state.baseDomain}
            </p>
            <p className="mt-1">
              ממשק הניהול עובר לכתובת החדשה, ושם צריך להתחבר שוב (החיבור שמור לכל כתובת בנפרד).
            </p>
            <a className="mt-2 inline-block font-medium underline" href={studioUrlFor(changedTo)}>
              מעבר לממשק הניהול בכתובת החדשה
            </a>
          </div>
        )}

        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) checkM.mutate();
          }}
        >
          <Label htmlFor={`${id}-slug`}>כתובת חדשה</Label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1" dir="ltr">
              <Input
                id={`${id}-slug`}
                value={value}
                maxLength={63}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={`${id}-hint ${id}-result`}
                onChange={(e) => {
                  setValue(e.target.value.toLowerCase().replace(/\s/g, ""));
                  setResult(null);
                }}
                className="w-56"
              />
              <span className="text-sm text-muted-foreground">.{state.baseDomain}</span>
            </div>
            <Button type="submit" variant="outline" disabled={!value.trim() || checkM.isPending}>
              {checkM.isPending ? "בודק…" : "בדיקה אם פנויה"}
            </Button>
            <ConfirmChange
              disabled={!ready || changeM.isPending || left === 0}
              from={`${state.slug}.${state.baseDomain}`}
              to={`${value.trim().toLowerCase()}.${state.baseDomain}`}
              onConfirm={() => changeM.mutate()}
            />
          </div>
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            אותיות באנגלית, ספרות ומקף (3–63 תווים). נשארו {left} שינויים ב-30 הימים הקרובים.
          </p>
          <p
            id={`${id}-result`}
            role="status"
            className={`text-sm ${result ? (result.available ? "text-emerald-700" : "text-destructive") : ""}`}
          >
            {result ? result.message : ""}
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

function ConfirmChange({
  disabled,
  from,
  to,
  onConfirm,
}: {
  disabled: boolean;
  from: string;
  to: string;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button type="button" disabled={disabled} onClick={() => setOpen(true)}>
        שמירת הכתובת החדשה
      </Button>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>לשנות את כתובת האתר?</AlertDialogTitle>
          <AlertDialogDescription>
            <span dir="ltr">{from}</span> ← <span dir="ltr">{to}</span>. הכתובת הישנה תפנה לחדשה
            במשך שנה. ממשק הניהול יעבור לכתובת החדשה ותצטרכו להתחבר שם שוב.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ביטול</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            שינוי הכתובת
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-label={`העתקה: ${label}`}
      onClick={() =>
        void navigator.clipboard?.writeText(text).then(
          () => toast.success("הועתק"),
          () => toast.error("ההעתקה נכשלה — סמנו והעתיקו ידנית"),
        )
      }
    >
      העתקה
    </Button>
  );
}

function CustomDomainCard({ state }: { state: AddressState }) {
  const qc = useQueryClient();
  const save = useServerFn(studioCustomDomainSave);
  const runCheck = useServerFn(studioCustomDomainCheck);
  const id = useId();
  const [mode, setMode] = useState<"nuriel" | "custom">(state.custom_domain ? "custom" : "nuriel");
  const [domain, setDomain] = useState(state.custom_domain ?? "");
  const [alternate, setAlternate] = useState(state.alternate_redirect);
  const [checked, setChecked] = useState<DomainCheckResult | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const saveM = useMutation({
    mutationFn: (d: { domain: string; alternateRedirect: boolean }) => save({ data: d }),
    onSuccess: (r) => {
      qc.setQueryData(ADDRESS, r);
      setChecked(null);
      if (!r.custom_domain) {
        setMode("nuriel");
        setDomain("");
        toast.success("הדומיין האישי הוסר — האתר בכתובת של Nuriel");
      } else
        toast.success("הדומיין נשמר. עכשיו הוסיפו את הרשומות אצל רשם הדומיין ולחצו על בדיקת חיבור");
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const checkM = useMutation({
    mutationFn: () => runCheck(),
    onSuccess: (r) => {
      setChecked(r);
      qc.setQueryData(ADDRESS, r.state);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const status = state.custom_domain_status;
  const sslActive = status === "active";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">דומיין אישי</CardTitle>
        <CardDescription>
          אפשר להשאיר את הכתובת של Nuriel, או לחבר דומיין שרכשתם (למשל www.efratadir.com). את
          הרשומות מוסיפים אצל רשם הדומיין — אנחנו לא משנים DNS ולא מנתקים דומיין קיים.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">הכתובת הראשית של האתר</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${id}-mode`}
              checked={mode === "nuriel"}
              onChange={() => (state.custom_domain ? setConfirmRemove(true) : setMode("nuriel"))}
            />
            דומיין של Nuriel —{" "}
            <span dir="ltr">
              {state.slug}.{state.baseDomain}
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${id}-mode`}
              checked={mode === "custom"}
              onChange={() => setMode("custom")}
            />
            דומיין אישי
          </label>
        </fieldset>

        {mode === "custom" && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveM.mutate({ domain, alternateRedirect: alternate });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-domain`}>הדומיין (הכתובת הראשית שתופיע בגוגל)</Label>
              <Input
                id={`${id}-domain`}
                dir="ltr"
                value={domain}
                placeholder="www.example.co.il"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setDomain(e.target.value)}
                className="max-w-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={alternate}
                onChange={(e) => setAlternate(e.target.checked)}
              />
              להפנות גם את הצורה השנייה (עם / בלי www) אל הכתובת הראשית
            </label>
            <Button type="submit" disabled={saveM.isPending || !domain.trim()}>
              {saveM.isPending ? "שומר…" : "שמירת הדומיין"}
            </Button>
          </form>
        )}

        {state.custom_domain && (
          <section aria-labelledby={`${id}-dns`} className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id={`${id}-dns`} className="text-base font-semibold">
                <span dir="ltr">{state.custom_domain}</span>
              </h3>
              <Badge
                variant={sslActive ? "default" : status === "error" ? "destructive" : "secondary"}
              >
                {status ? DOMAIN_STATUS_LABEL[status] : "—"}
              </Badge>
            </div>
            <dl className="space-y-1.5">
              <Row label="הכתובת הראשית (קנונית)">
                <span dir="ltr">https://{state.custom_domain}</span>
              </Row>
              {state.alternateHost && (
                <Row label="הצורה השנייה">
                  <span dir="ltr">{state.alternateHost}</span>{" "}
                  <span className="font-normal text-muted-foreground">
                    {state.alternate_redirect
                      ? state.alternate
                        ? "— מפנה לכתובת הראשית"
                        : "— תפנה לכתובת הראשית אחרי שתצביע לשרת"
                      : "— לא מופנית"}
                  </span>
                </Row>
              )}
              <Row label="בעלות על הדומיין">
                {state.ownership_verified_at && state.ownership_domain === state.custom_domain
                  ? `אומתה (${formatDate(state.ownership_verified_at)})`
                  : "עוד לא אומתה"}
              </Row>
              <Row label="תעודת SSL">
                {sslActive
                  ? `פעילה${state.custom_domain_ssl_expires_at ? ` — בתוקף עד ${formatDate(state.custom_domain_ssl_expires_at)}` : ""}`
                  : status === "verified"
                    ? "מונפקת אוטומטית אחרי האימות (כמה דקות)"
                    : "תונפק אוטומטית אחרי שהחיבור יאומת"}
              </Row>
              <Row label="כתובת הניהול">
                <span dir="ltr">
                  {state.slug}.{state.baseDomain}/studio
                </span>{" "}
                <span className="font-normal text-muted-foreground">
                  (הניהול לא עובר לדומיין האישי)
                </span>
              </Row>
            </dl>

            <div className="space-y-2">
              <p className="text-sm font-medium">הרשומות להוספה אצל רשם הדומיין:</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                  <caption className="sr-only">רשומות DNS להוספה</caption>
                  <thead>
                    <tr className="border-b text-start text-muted-foreground">
                      <th scope="col" className="py-1.5 pe-4 text-start font-medium">
                        סוג
                      </th>
                      <th scope="col" className="py-1.5 pe-4 text-start font-medium">
                        שם / Host
                      </th>
                      <th scope="col" className="py-1.5 pe-4 text-start font-medium">
                        ערך
                      </th>
                      <th scope="col" className="py-1.5 pe-4 text-start font-medium">
                        למה
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.records.map((r) => (
                      <tr key={`${r.type}-${r.name}-${r.value}`} className="border-b last:border-0">
                        <td className="py-1.5 pe-4 font-mono">{r.type}</td>
                        <td className="py-1.5 pe-4 font-mono">
                          <bdi dir="ltr">{r.host}</bdi>
                        </td>
                        <td className="py-1.5 pe-4 font-mono">
                          <span className="inline-flex flex-wrap items-center gap-2">
                            <bdi dir="ltr" className="break-all">
                              {r.value}
                            </bdi>
                            <CopyButton text={r.value} label={`${r.type} ${r.host}`} />
                          </span>
                        </td>
                        <td className="py-1.5 text-muted-foreground">{r.purpose}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                עדכון DNS אצל הרשם יכול לקחת מכמה דקות ועד יום. אחרי שהוספתם — לחצו על "בדיקת
                חיבור".
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => checkM.mutate()} disabled={checkM.isPending}>
                {checkM.isPending ? "בודק…" : "בדיקת חיבור"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirmRemove(true)}>
                הסרת הדומיין
              </Button>
            </div>
            {(checked || state.last_check) && (
              <div role="status">
                <ul aria-label="תוצאת הבדיקה" className="m-0 list-none space-y-1 p-0 text-sm">
                  <CheckLine
                    ok={checked ? checked.txtOk : Boolean(state.last_check?.txt)}
                    label="בעלות (רשומת TXT)"
                  />
                  <CheckLine
                    ok={checked ? checked.dnsOk : Boolean(state.last_check?.dns)}
                    label="הפניה לשרת (DNS)"
                  />
                  <CheckLine ok={sslActive} pendingText="תונפק אחרי האימות" label="תעודת SSL" />
                  <li className="text-xs text-muted-foreground">
                    {checked?.message ?? state.last_check?.message}
                    {state.last_check?.at ? ` · נבדק ${formatDate(state.last_check.at)}` : ""}
                  </li>
                </ul>
              </div>
            )}
          </section>
        )}

        <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>להסיר את הדומיין האישי?</AlertDialogTitle>
              <AlertDialogDescription>
                האתר יחזור לכתובת של Nuriel. הדומיין עצמו נשאר שלכם — ה-DNS אצל הרשם לא משתנה מכאן.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ביטול</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => saveM.mutate({ domain: "", alternateRedirect: true })}
              >
                הסרת הדומיין
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

function CheckLine({
  ok,
  label,
  pendingText,
}: {
  ok: boolean;
  label: string;
  pendingText?: string;
}) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden="true" className={ok ? "text-emerald-700" : "text-destructive"}>
        {ok ? "✓" : "✗"}
      </span>
      {label}: {ok ? "תקין" : (pendingText ?? "עוד לא")}
    </li>
  );
}

function GoogleCard({ state }: { state: AddressState }) {
  const loadDraft = useServerFn(studioDraft);
  const draft = useQuery({ queryKey: ["bp", "draft"], queryFn: () => loadDraft() });
  const lib = useMediaLibrary();
  const seo = useMemo(() => {
    if (!draft.data) return null;
    const home = pageBySlug(draft.data.document, "");
    if (!home) return null;
    return seoSummary(
      draft.data.document,
      home,
      previewMediaMap(lib.data),
      state.publicOrigin,
      draft.data.document.business.name.he,
    );
  }, [draft.data, lib.data, state.publicOrigin]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">איך האתר ייראה בגוגל</CardTitle>
        <CardDescription>
          מהטיוטה הנוכחית: שם העסק, הכתובת, הכותרת והתיאור של דף הבית. משנים אותם בעורך, בלשונית
          "SEO וגוגל".
        </CardDescription>
      </CardHeader>
      <CardContent>
        {seo ? <GooglePreview seo={seo} /> : <p className="text-sm text-muted-foreground">טוען…</p>}
      </CardContent>
    </Card>
  );
}
