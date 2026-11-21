// NURIEL AI SEO ENGINE — the owner's SEO center (both engines). Honest by design:
//  • the score is a technical checklist of the site — NOT a ranking prediction (said on screen);
//  • keyword "ideas" come from the business's own facts (or AI) and never carry numbers; only Google Search
//    Console rows show impressions / clicks / position, with their date range;
//  • nothing on the site changes from here without the owner: proposals wait for approval (the engine's list
//    below), and the auto switches are OFF by default and fill EMPTY fields only.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Gauge,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Input,
  Label,
  Switch,
} from "@/platform/ui";
import type { AuditIssue, Severity } from "../audit/rules";
import {
  addKeywordIdeaFn,
  disconnectGscFn,
  getSeoCenter,
  gscConnectLinkFn,
  importGscCsvFn,
  requestSeoRunFn,
  saveSeoSettingsFn,
  setKeywordIdeaFn,
} from "../center.functions";
import type { SeoCenterView, SeoKeywordIdea, SeoSettingsPatch } from "../types";

export const SEO_CENTER_KEY = ["seo", "center"] as const;

const SEVERITY: Record<Severity, { label: string; className: string }> = {
  critical: { label: "קריטי", className: "bg-red-100 text-red-900" },
  high: { label: "חשוב", className: "bg-orange-100 text-orange-900" },
  medium: { label: "בינוני", className: "bg-amber-100 text-amber-900" },
  low: { label: "קטן", className: "bg-slate-100 text-slate-800" },
  info: { label: "לידיעה", className: "bg-blue-50 text-blue-900" },
};
const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

const GSC_RESULT: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Search Console חובר. הנתונים הראשונים יופיעו כאן בתוך כמה דקות." },
  denied: { ok: false, text: "החיבור בוטל ב-Google — לא חובר כלום." },
  no_property: {
    ok: false,
    text: "בחשבון Google הזה אין נכס Search Console שמכסה את כתובת האתר. מוסיפים את האתר ב-Search Console ומחברים שוב.",
  },
  no_scope: {
    ok: false,
    text: "לא אושרה הרשאת הקריאה ל-Search Console. מחברים שוב ומאשרים את ההרשאה.",
  },
  error: { ok: false, text: "החיבור לא הצליח. נסו שוב בעוד כמה דקות." },
};

const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("he-IL", {
        day: "numeric",
        month: "numeric",
        year: "numeric",
      })
    : "";
const pct = (n: number | undefined) => `${((n ?? 0) * 100).toFixed(1)}%`;
const num = (n: number | undefined) => (n ?? 0).toLocaleString("he-IL");
const pathOf = (url: string | null) => {
  if (!url) return "";
  try {
    const u = new URL(url);
    return decodeURI(u.pathname + u.search) || "/";
  } catch {
    return url;
  }
};
const messageOf = (e: unknown) =>
  e instanceof Error && /[֐-׿]/.test(e.message) ? e.message : "הפעולה נכשלה — נסו שוב";

export function SeoCenter(props: {
  /** the engine's proposals list (store / hospitality) — rendered in its own section */
  proposals?: ReactNode;
  /** store: the "keywords" auto switch exists (store SEO keywords field) */
  variant: "store" | "hospitality";
}) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: SEO_CENTER_KEY, queryFn: () => getSeoCenter(), retry: false });
  const view = query.data;
  const set = (v: SeoCenterView) => qc.setQueryData(SEO_CENTER_KEY, v);

  // back from Google (?gsc=…): one notice, then the parameter is removed from the address
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const r = url.searchParams.get("gsc");
    if (!r) return;
    const m = GSC_RESULT[r] ?? GSC_RESULT["error"]!;
    if (m.ok) toast.success(m.text);
    else toast.error(m.text);
    url.searchParams.delete("gsc");
    window.history.replaceState(null, "", url.toString());
  }, []);

  if (query.isPending)
    return (
      <p className="py-8 text-center text-sm text-muted-foreground" role="status">
        <Loader2 className="me-1 inline size-4 animate-spin" aria-hidden="true" />
        טוענים את מרכז ה-SEO…
      </p>
    );
  if (query.isError || !view)
    return (
      <p role="alert" className="py-8 text-center text-sm text-destructive">
        {messageOf(query.error)}
      </p>
    );

  return (
    <div className="flex flex-col gap-4" data-testid="seo-center">
      <AuditCard view={view} />
      {props.proposals}
      <KeywordsCard
        view={view}
        onChange={() => void qc.invalidateQueries({ queryKey: SEO_CENTER_KEY })}
      />
      <SearchConsoleCard view={view} onView={set} />
      <SettingsCard view={view} variant={props.variant} onView={set} />
    </div>
  );
}

// ------------------------------------------------------------------ the technical check

function AuditCard({ view }: { view: SeoCenterView }) {
  const a = view.audit;
  const run = useMutation({
    mutationFn: () => requestSeoRunFn({ data: { kind: "audit" } }),
    onSuccess: (r) =>
      toast.success(
        r.queued
          ? "הבדיקה תרוץ בדקות הקרובות — אפשר להמשיך לעבוד"
          : "הבדיקה כבר בתור — היא תרוץ עכשיו",
      ),
    onError: (e) => toast.error(messageOf(e)),
  });
  const [all, setAll] = useState(false);
  const issues = useMemo(() => {
    const list = [...(a?.issues ?? [])];
    list.sort((x, y) => SEVERITY_ORDER.indexOf(x.severity) - SEVERITY_ORDER.indexOf(y.severity));
    return list;
  }, [a]);
  const shown = all ? issues : issues.slice(0, 12);
  return (
    <Card data-testid="seo-audit">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="size-5 text-primary" aria-hidden="true" />
          בדיקה טכנית של האתר
        </CardTitle>
        <CardDescription>
          בודקים את מה שגוגל רואה: כותרות, תיאורים, מפת אתר, robots, נתונים מובנים, תמונות וקישורים.
          הציון הוא רשימת בדיקה טכנית — <strong>לא תחזית למיקום בגוגל</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {a ? (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-baseline gap-1" data-testid="seo-score">
              <span className="text-3xl font-bold tabular-nums">{a.score}</span>
              <span className="text-sm text-muted-foreground">/ 100</span>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {SEVERITY_ORDER.map((s) =>
                (a.counts[s] ?? 0) > 0 ? (
                  <span key={s} className={cn("rounded px-1.5 py-0.5", SEVERITY[s].className)}>
                    {SEVERITY[s].label}: {a.counts[s]}
                  </span>
                ) : null,
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              נבדקו {a.pages_audited} עמודים · {fmtDate(a.finished_at)}
              {a.sitemap_urls ? ` · ${a.sitemap_urls} כתובות במפת האתר` : ""}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            עוד לא נבדק. הבדיקה הראשונה רצה מעצמה, או בלחיצה כאן.
          </p>
        )}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            disabled={run.isPending}
            onClick={() => run.mutate()}
            data-testid="seo-audit-run"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            לבדוק עכשיו
          </Button>
        </div>
        {issues.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold">מה כדאי לתקן</h3>
            <ul className="flex flex-col gap-1.5" data-testid="seo-issues">
              {shown.map((i, n) => (
                <IssueRow key={`${i.code}:${i.url ?? ""}:${n}`} issue={i} />
              ))}
            </ul>
            {issues.length > 12 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => setAll((x) => !x)}
              >
                {all ? "להציג פחות" : `להציג את כל ${issues.length} הממצאים`}
              </Button>
            )}
          </div>
        )}
        {a && issues.length === 0 && (
          <p className="flex items-center gap-1.5 text-sm text-emerald-800">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            לא נמצאו בעיות טכניות בעמודים שנבדקו.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function IssueRow({ issue }: { issue: AuditIssue }) {
  return (
    <li className="flex flex-wrap items-start gap-2 rounded border p-2 text-sm">
      <span
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-[11px]",
          SEVERITY[issue.severity].className,
        )}
      >
        {SEVERITY[issue.severity].label}
      </span>
      <span className="min-w-0 flex-1">
        {issue.message}
        {issue.count && issue.count > 1 ? ` (${issue.count})` : ""}
        {issue.url && (
          <span dir="ltr" className="block truncate text-xs text-muted-foreground">
            {pathOf(issue.url)}
          </span>
        )}
      </span>
    </li>
  );
}

// ------------------------------------------------------------------ keyword ideas

const KIND_LABEL: Record<string, string> = {
  brand: "שם העסק",
  primary: "ראשי",
  local: "מקומי",
  service: "שירות",
  product: "מוצר",
  long_tail: "ביטוי ארוך",
  question: "שאלה",
  transactional: "כוונת קנייה / הזמנה",
};

function KeywordsCard({ view, onChange }: { view: SeoCenterView; onChange: () => void }) {
  const mark = useMutation({
    mutationFn: (v: { id: string; status: SeoKeywordIdea["status"] }) =>
      setKeywordIdeaFn({ data: v }),
    onSuccess: onChange,
    onError: (e) => toast.error(messageOf(e)),
  });
  const [own, setOwn] = useState("");
  const add = useMutation({
    mutationFn: (phrase: string) => addKeywordIdeaFn({ data: { phrase } }),
    onSuccess: () => {
      setOwn("");
      toast.success("הביטוי נוסף לביטויים שבחרתם");
      onChange();
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const ownId = useId();
  const adopted = view.keywords.filter((k) => k.status === "adopted");
  const fresh = view.keywords.filter((k) => k.status === "new");
  const [more, setMore] = useState(false);
  const list = more ? fresh : fresh.slice(0, 15);
  return (
    <Card data-testid="seo-keywords">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Search className="size-5 text-primary" aria-hidden="true" />
          ביטויי חיפוש
        </CardTitle>
        <CardDescription>
          רעיונות מהפרטים שכבר באתר שלכם. <strong>לרעיונות אין נתוני נפח חיפוש</strong> — מספרים
          מוצגים רק כשהם מגיעים מ-Google Search Console, עם התקופה שלהם.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form
          className="flex flex-wrap items-end gap-2"
          data-testid="seo-keyword-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (own.trim().length >= 2) add.mutate(own.trim());
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Label htmlFor={ownId} className="text-sm">
              ביטוי משלכם — חיפוש שאתם רוצים שימצאו אתכם בו
            </Label>
            <Input
              id={ownId}
              value={own}
              maxLength={80}
              onChange={(e) => setOwn(e.target.value)}
              placeholder="למשל: צימר לכלה ליד בית שמש"
            />
          </div>
          <Button type="submit" variant="outline" disabled={add.isPending || own.trim().length < 2}>
            {add.isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            הוספה
          </Button>
        </form>
        {adopted.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-semibold">הביטויים שבחרתם</h3>
            <ul className="flex flex-wrap gap-1.5">
              {adopted.map((k) => (
                <li key={k.id}>
                  <Badge variant="secondary" className="gap-1 text-sm font-normal">
                    {k.phrase}
                    {k.metrics && (
                      <span className="text-[11px]" data-testid="seo-keyword-metrics">
                        · Google: {num(k.metrics.impressions)} חשיפות · מיקום{" "}
                        {k.metrics.position?.toFixed(1) ?? "—"}
                      </span>
                    )}
                    <button
                      type="button"
                      className="ms-1 rounded px-1 text-xs underline"
                      onClick={() => mark.mutate({ id: k.id, status: "new" })}
                      aria-label={`להחזיר לרעיונות: ${k.phrase}`}
                    >
                      הסרה
                    </button>
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
        {fresh.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין רעיונות חדשים כרגע.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded border" data-testid="seo-keyword-ideas">
            {list.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-2 p-2 text-sm">
                <span className="min-w-0 flex-1 font-medium">{k.phrase}</span>
                <span className="text-[11px] text-muted-foreground">
                  {KIND_LABEL[k.kind] ?? k.kind}
                </span>
                {k.metrics ? (
                  <span
                    className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-900"
                    data-testid="seo-keyword-metrics"
                  >
                    נתוני Google: {num(k.metrics.impressions)} חשיפות · {num(k.metrics.clicks)}{" "}
                    קליקים · מיקום {k.metrics.position?.toFixed(1) ?? "—"}
                  </span>
                ) : (
                  <span
                    className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                    data-testid="seo-keyword-idea-label"
                  >
                    רעיון —{" "}
                    {k.source === "ai"
                      ? "NURIEL AI"
                      : k.source === "owner"
                        ? "ביטוי שהוזן ידנית"
                        : "מהפרטים שלכם"}
                  </span>
                )}
                <span className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8"
                    disabled={mark.isPending}
                    onClick={() => mark.mutate({ id: k.id, status: "adopted" })}
                  >
                    לבחור
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8"
                    disabled={mark.isPending}
                    onClick={() => mark.mutate({ id: k.id, status: "dismissed" })}
                  >
                    לא רלוונטי
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {fresh.length > 15 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setMore((x) => !x)}
          >
            {more ? "פחות" : `עוד ${fresh.length - 15} רעיונות`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ Search Console

function SearchConsoleCard({
  view,
  onView,
}: {
  view: SeoCenterView;
  onView: (v: SeoCenterView) => void;
}) {
  const g = view.gsc;
  const connect = useMutation({
    mutationFn: () => gscConnectLinkFn(),
    onSuccess: (r) => {
      window.location.assign(r.url);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const disconnect = useMutation({
    mutationFn: () => disconnectGscFn(),
    onSuccess: (v) => {
      onView(v);
      toast.success("Search Console נותק — ההרשאה נמחקה מהמערכת");
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const queries = g.snapshots
    .filter((s) => s.dimension === "query")
    .sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
  const top = useMemo(
    () =>
      [...(queries?.rows ?? [])]
        .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
        .slice(0, 10),
    [queries],
  );
  return (
    <Card data-testid="seo-gsc">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-5 text-primary" aria-hidden="true" />
          Google Search Console — נתונים אמיתיים
        </CardTitle>
        <CardDescription>
          חשיפות, קליקים, אחוז הקלקה ומיקום ממוצע — ישירות מ-Google, בהרשאת קריאה בלבד. אנחנו לא
          משנים כלום בחשבון Google שלכם.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {g.connected ? (
          <div
            className="flex flex-wrap items-center gap-2 text-sm"
            data-testid="seo-gsc-connected"
          >
            <CheckCircle2 className="size-4 text-emerald-700" aria-hidden="true" />
            <span>
              מחובר: <span dir="ltr">{g.property}</span>
              {g.last_sync_at ? ` · עודכן ${fmtDate(g.last_sync_at)}` : " · הנתונים הראשונים בדרך"}
            </span>
            {g.status === "error" || g.status === "revoked" ? (
              <span className="text-orange-800">{g.last_error ?? "יש בעיה בחיבור"}</span>
            ) : null}
            {view.can_connect_gsc && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                ניתוק
              </Button>
            )}
          </div>
        ) : !view.gsc_configured ? (
          <p className="text-sm text-muted-foreground">
            החיבור הישיר ל-Search Console עוד לא הופעל בפלטפורמה. בינתיים אפשר לייבא קובץ CSV
            שמייצאים מ-Search Console.
          </p>
        ) : view.can_connect_gsc ? (
          <div className="flex flex-col gap-1">
            <Button
              type="button"
              className="min-h-11 self-start"
              disabled={connect.isPending}
              onClick={() => connect.mutate()}
              data-testid="seo-gsc-connect"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              חיבור Google Search Console
            </Button>
            <span className="text-xs text-muted-foreground">
              תועברו ל-Google לאישור הרשאת קריאה בלבד ({"webmasters.readonly"}), ותחזרו לכאן.
            </span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">רק בעל העסק יכול לחבר את Search Console.</p>
        )}
        {g.platform_connection && !g.connected && (
          <p className="text-xs text-muted-foreground">
            לאתרים בכתובת של הפלטפורמה יש גם חיבור כללי של הפלטפורמה — הנתונים מסוננים לעמודים של
            האתר שלכם בלבד.
          </p>
        )}

        {queries ? (
          <div className="flex flex-col gap-2" data-testid="seo-gsc-data">
            <p className="text-xs text-muted-foreground">
              {fmtDate(queries.period_start)}–{fmtDate(queries.period_end)} ·{" "}
              {queries.source === "csv" ? "מקובץ שייבאתם" : "מ-Search Console"}
            </p>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <Stat label="קליקים" value={num(queries.totals.clicks)} />
              <Stat label="חשיפות" value={num(queries.totals.impressions)} />
              <Stat label="אחוז הקלקה" value={pct(queries.totals.ctr)} />
              <Stat label="מיקום ממוצע" value={(queries.totals.position ?? 0).toFixed(1)} />
            </dl>
            {top.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="mb-1 text-start text-sm font-semibold">
                    החיפושים המובילים
                  </caption>
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th scope="col" className="p-1 text-start font-normal">
                        חיפוש
                      </th>
                      <th scope="col" className="p-1 text-start font-normal">
                        קליקים
                      </th>
                      <th scope="col" className="p-1 text-start font-normal">
                        חשיפות
                      </th>
                      <th scope="col" className="p-1 text-start font-normal">
                        מיקום
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.map((r) => (
                      <tr key={r.key} className="border-t">
                        <td className="p-1">{r.key}</td>
                        <td className="p-1 tabular-nums">{num(r.clicks)}</td>
                        <td className="p-1 tabular-nums">{num(r.impressions)}</td>
                        <td className="p-1 tabular-nums">{r.position.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {view.opportunities.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-semibold">הזדמנויות מהנתונים</h3>
                <ul className="flex flex-col gap-1 text-sm" data-testid="seo-opportunities">
                  {view.opportunities.slice(0, 10).map((o) => (
                    <li key={`${o.kind}:${o.key}`} className="flex items-start gap-1.5">
                      <AlertTriangle
                        className="mt-0.5 size-4 shrink-0 text-amber-700"
                        aria-hidden="true"
                      />
                      <span>
                        <strong>{o.key}</strong> — {o.message}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">עוד אין נתונים מ-Search Console.</p>
        )}
        {view.can_connect_gsc && <CsvImport onView={onView} />}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function CsvImport({ onView }: { onView: (v: SeoCenterView) => void }) {
  const fileId = useId();
  const startId = useId();
  const endId = useId();
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [start, setStart] = useState(iso(new Date(today.getTime() - 30 * 86_400_000)));
  const [end, setEnd] = useState(iso(new Date(today.getTime() - 3 * 86_400_000)));
  const [file, setFile] = useState<File | null>(null);
  const run = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("לא נבחר קובץ");
      if (file.size > 3_000_000) throw new Error("הקובץ גדול מדי (עד 3MB)");
      return importGscCsvFn({ data: { csv: await file.text(), start, end } });
    },
    onSuccess: (v) => {
      onView(v);
      setFile(null);
      toast.success("הנתונים מ-Search Console יובאו");
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  return (
    <details className="rounded border p-2 text-sm">
      <summary className="cursor-pointer font-medium">ייבוא קובץ מ-Search Console (CSV)</summary>
      <p className="mt-1 text-xs text-muted-foreground">
        ב-Search Console: "ביצועים" → בוחרים טווח תאריכים → "ייצוא" → CSV. מעלים כאן את הקובץ
        "שאילתות" או "דפים".
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={fileId}>קובץ</Label>
          <Input
            id={fileId}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={startId}>מתאריך</Label>
          <Input
            id={startId}
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            dir="ltr"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={endId}>עד תאריך</Label>
          <Input
            id={endId}
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            dir="ltr"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={!file || run.isPending}
          onClick={() => run.mutate()}
        >
          <Upload className="size-4" aria-hidden="true" />
          ייבוא
        </Button>
      </div>
    </details>
  );
}

// ------------------------------------------------------------------ settings

function SettingsCard(props: {
  view: SeoCenterView;
  variant: "store" | "hospitality";
  onView: (v: SeoCenterView) => void;
}) {
  const s = props.view.settings;
  const save = useMutation({
    mutationFn: (patch: SeoSettingsPatch) => saveSeoSettingsFn({ data: patch }),
    onSuccess: (v) => {
      props.onView(v);
      toast.success("נשמר");
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const rows: { field: keyof SeoSettingsPatch; label: string; hint: string; value: boolean }[] = [
    {
      field: "meta",
      label:
        props.variant === "store"
          ? "למלא אוטומטית כותרת ותיאור לגוגל"
          : "למלא אוטומטית כותרת ותיאור לגוגל ליחידות ולחבילות",
      hint: "רק בשדות ריקים — אף פעם לא במקום טקסט שכתבתם. אפשר לשחזר כל מילוי.",
      value: s.auto_apply.meta,
    },
    ...(props.variant === "hospitality"
      ? [
          {
            field: "alt" as const,
            label: "למלא אוטומטית תיאורי תמונות",
            hint: "רק לתמונות בלי תיאור. עוזר לנגישות ולחיפוש תמונות.",
            value: s.auto_apply.alt,
          },
        ]
      : [
          {
            field: "keywords" as const,
            label: "למלא אוטומטית ביטויי חיפוש למוצרים",
            hint: "רק כשהשדה ריק.",
            value: s.auto_apply.keywords,
          },
        ]),
    {
      field: "weekly_audit",
      label: "בדיקה טכנית שבועית",
      hint: "בודקים את האתר פעם בשבוע ומציגים כאן מה השתנה.",
      value: s.weekly_audit,
    },
  ];
  return (
    <Card data-testid="seo-settings">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">הגדרות</CardTitle>
        <CardDescription>
          ברירת המחדל: <strong>שום דבר לא משתנה באתר בלי האישור שלכם</strong>. המילוי האוטומטי כבוי
          עד שתפעילו אותו.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.map((r) => (
          <SettingRow
            key={r.field}
            label={r.label}
            hint={r.hint}
            value={r.value}
            disabled={save.isPending}
            onChange={(v) => save.mutate({ [r.field]: v })}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function SettingRow(props: {
  label: string;
  hint: string;
  value: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  const hint = useId();
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col">
        <Label htmlFor={id} className="text-sm">
          {props.label}
        </Label>
        <span id={hint} className="text-xs text-muted-foreground">
          {props.hint}
        </span>
      </div>
      <Switch
        id={id}
        checked={props.value}
        disabled={props.disabled}
        onCheckedChange={props.onChange}
        aria-describedby={hint}
      />
    </div>
  );
}
