import { useCallback, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Radar,
  RotateCcw,
  ScanSearch,
  Square,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  applySourceChanges,
  compareSourceCatalog,
  discoverSourceCatalog,
  fetchSourceBatch,
  type ApplyResult,
  type CompareResult,
} from "@/lib/source-scan.functions";
import {
  DIFF_LABEL,
  SCAN_BATCH_SIZE,
  approvalSummary,
  type ApprovedChanges,
  type DiffField,
  type ScanRow,
  type SourceProduct,
} from "@/lib/source-scan";
import type { SourceDiscovery } from "@/server/services/source-scan";
import { cn } from "@/lib/utils";

/**
 * חלק 44: לשונית "סריקת אתר מקור" (ניהול מוצרים).
 *
 * הכתובת זמנית — לסריקה הנוכחית בלבד. שום דבר לא נשמר בין סריקות: התוצאות חיות בזיכרון
 * הדפדפן ונמחקות בסריקה חדשה. הסריקה וההשוואה לא משנות את החנות; רק אחרי סימון, סיכום
 * ואישור מפורש מתבצעות הוספה ועדכון (ללא מחיקות).
 */

type Phase = "idle" | "scanning" | "report" | "confirm" | "applying" | "done" | "error";

type Choice = {
  /** מוצר חדש: להוסיף */
  add: boolean;
  /** התאמה לא ודאית: מה לעשות */
  mode: "skip" | "same" | "new";
  fields: DiffField[];
};

type ScanProgress = { stage: string; done: number; total: number };

const KIND_LABEL: Record<ScanRow["kind"], string> = {
  new: "חדש",
  changed: "עם שינויים",
  uncertain: "התאמה לא ודאית",
  unchanged: "ללא שינוי",
};
const KIND_TONE: Record<ScanRow["kind"], string> = {
  new: "border-emerald-300 bg-emerald-50 text-emerald-900",
  changed: "border-amber-300 bg-amber-50 text-amber-900",
  uncertain: "border-violet-300 bg-violet-50 text-violet-900",
  unchanged: "border-border bg-muted/40 text-muted-foreground",
};
const PLATFORM_LABEL: Record<SourceDiscovery["platform"], string> = {
  shopify: "חנות Shopify (רשימת המוצרים הציבורית)",
  woocommerce: "חנות WooCommerce (ה-API הציבורי)",
  jsonld: "נתוני מוצרים מובנים בעמודים",
  links: "קישורי מוצרים בעמודי הקטלוג",
  single: "עמוד מוצר בודד",
  none: "לא זוהה קטלוג",
};

const money = (value: string) => (/^[\d.]+$/.test(value) ? `₪${value}` : value);

export function SourceScanPanel({ onApplied }: { onApplied: () => void | Promise<void> }) {
  const discover = useServerFn(discoverSourceCatalog);
  const fetchBatch = useServerFn(fetchSourceBatch);
  const compare = useServerFn(compareSourceCatalog);
  const apply = useServerFn(applySourceChanges);

  const [phase, setPhase] = useState<Phase>("idle");
  const [url, setUrl] = useState("");
  /** הכתובת שנסרקת כעכשיו / נסרקה — מוצגת בבירור */
  const [scanning, setScanning] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress>({ stage: "", done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<CompareResult | null>(null);
  const [discovery, setDiscovery] = useState<SourceDiscovery | null>(null);
  const [failures, setFailures] = useState<{ url: string; reason: string }[]>([]);
  const [partial, setPartial] = useState<string[]>([]);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [filter, setFilter] = useState<ScanRow["kind"] | "all">("all");
  const [results, setResults] = useState<{
    created: number;
    failed: number;
    duplicates: number;
    updatedOk: number;
    updatedFailed: { name: string; error: string }[];
    messages: string[];
  } | null>(null);
  const runId = useRef(0);
  const stopMode = useRef<"none" | "stop" | "cancel">("none");
  // (נקרא אחרי awaits — TypeScript לא יודע שהערך השתנה בינתיים מהכפתורים)
  const stopped = () => stopMode.current as "none" | "stop" | "cancel";

  // ---------------------------------------------------------------- איפוס מלא לסריקה חדשה
  const reset = useCallback(() => {
    runId.current += 1; // תוצאות של סריקה קודמת שעוד בדרך — לא יוצגו
    stopMode.current = "none";
    setPhase("idle");
    setScanning(null);
    setProgress({ stage: "", done: 0, total: 0 });
    setError(null);
    setReport(null);
    setDiscovery(null);
    setFailures([]);
    setPartial([]);
    setChoices({});
    setFilter("all");
    setResults(null);
    setUrl("");
  }, []);

  // ---------------------------------------------------------------- סריקה
  const start = async () => {
    const target = url.trim();
    if (!target) {
      setError("הדביקו כתובת של אתר או של עמוד קטלוג");
      return;
    }
    const id = ++runId.current;
    stopMode.current = "none";
    // סריקה חדשה לא נשענת על תוצאות קודמות
    setReport(null);
    setDiscovery(null);
    setFailures([]);
    setPartial([]);
    setChoices({});
    setFilter("all");
    setResults(null);
    setError(null);
    setScanning(target);
    setPhase("scanning");
    setProgress({ stage: "בודקים את האתר…", done: 0, total: 0 });
    const alive = () => runId.current === id;

    try {
      const found = await discover({ data: { url: target } });
      if (!alive()) return;
      setScanning(found.sourceUrl);
      setDiscovery(found);
      const products: SourceProduct[] = [...found.inline];
      const failed: { url: string; reason: string }[] = [];
      const total = found.inline.length + found.productUrls.length;
      setProgress({ stage: "קוראים מוצרים…", done: found.inline.length, total });

      for (let i = 0; i < found.productUrls.length; i += SCAN_BATCH_SIZE) {
        if (stopped() !== "none" || !alive()) break;
        const urls = found.productUrls.slice(i, i + SCAN_BATCH_SIZE);
        const hints = Object.fromEntries(
          urls.flatMap((u) => (found.hints[u] ? [[u, found.hints[u]]] : [])),
        );
        try {
          const batch = await fetchBatch({ data: { origin: found.origin, urls, hints } });
          if (!alive()) return;
          products.push(...batch.products);
          failed.push(...batch.failed);
        } catch (e) {
          failed.push(
            ...urls.map((u) => ({
              url: u,
              reason: e instanceof Error ? e.message : "הקריאה נכשלה",
            })),
          );
        }
        setFailures([...failed]);
        setProgress({
          stage: "קוראים מוצרים…",
          done: found.inline.length + Math.min(i + SCAN_BATCH_SIZE, found.productUrls.length),
          total,
        });
      }
      if (!alive()) return;
      if (stopped() === "cancel") {
        reset();
        return;
      }
      const notes = [...found.notes];
      if (stopped() === "stop")
        notes.push("הסריקה נעצרה לפני סיומה — הדוח מבוסס על מה שנקרא עד כה");
      if (found.partial) notes.push("סריקה חלקית — לא כל הקטלוג נקרא");
      if (failed.length > 0) notes.push(`${failed.length} מוצרים לא ניתנו לקריאה`);
      setPartial(notes);
      setFailures(failed);

      if (products.length === 0) {
        setError(
          (found.notes.length > 0 ? found.notes.join(" ") : null) ??
            "לא נמצאו מוצרים שאפשר לקרוא בכתובת הזו. אפשר לנסות כתובת של קטגוריה או של עמוד מוצר.",
        );
        setPhase("error");
        return;
      }
      setProgress({ stage: "משווים לקטלוג החנות…", done: products.length, total: products.length });
      const compared = await compare({ data: { products } });
      if (!alive()) return;
      setReport(compared);
      setPhase("report");
    } catch (e) {
      if (!alive()) return;
      setError(e instanceof Error ? e.message : "הסריקה נכשלה");
      setPhase("error");
    }
  };

  // ---------------------------------------------------------------- בחירות
  const choiceOf = (row: ScanRow): Choice =>
    choices[row.key] ?? { add: false, mode: "skip", fields: [] };
  const setChoice = (row: ScanRow, next: Partial<Choice>) =>
    setChoices((all) => ({ ...all, [row.key]: { ...choiceOf(row), ...next } }));

  const applicableFields = (row: ScanRow): DiffField[] =>
    row.diffs.filter((d) => d.applicable).map((d) => d.field);

  const toggleField = (row: ScanRow, field: DiffField, on: boolean) => {
    const current = choiceOf(row).fields;
    setChoice(row, {
      fields: on ? [...new Set([...current, field])] : current.filter((f) => f !== field),
    });
  };

  /** כל המוצרים הרלוונטיים — לפי פעולה מרוכזת */
  const bulk = (kind: "all-changes" | "price" | "new" | "clear") => {
    if (!report) return;
    const next: Record<string, Choice> = {};
    for (const row of report.rows) {
      const base: Choice = { add: false, mode: "skip", fields: [] };
      if (kind === "clear") {
        next[row.key] = base;
        continue;
      }
      const prev = choices[row.key] ?? base;
      if (row.kind === "new") {
        next[row.key] = {
          ...prev,
          add: (kind === "new" || kind === "all-changes") && !row.blocked ? true : prev.add,
        };
      } else if (row.kind === "changed") {
        const fields =
          kind === "price"
            ? [
                ...new Set([
                  ...prev.fields,
                  ...(row.diffs.some((d) => d.field === "price" && d.applicable)
                    ? (["price"] as DiffField[])
                    : []),
                ]),
              ]
            : kind === "all-changes"
              ? applicableFields(row)
              : prev.fields;
        next[row.key] = { ...prev, fields };
      } else {
        next[row.key] = prev;
      }
    }
    setChoices(next);
  };

  /** המוצרים והשדות שאושרו */
  const approved: ApprovedChanges = useMemo(() => {
    const adds: SourceProduct[] = [];
    const updates: ApprovedChanges["updates"] = [];
    for (const row of report?.rows ?? []) {
      const c = choices[row.key];
      if (!c) continue;
      if (row.kind === "new" && c.add && !row.blocked) adds.push(row.source);
      else if (row.kind === "changed" && c.fields.length > 0 && row.match) {
        updates.push({
          productId: row.match.productId,
          sourceUrl: row.key,
          fields: c.fields,
          source: row.source,
        });
      } else if (row.kind === "uncertain") {
        if (c.mode === "new" && !newBlocked(row)) adds.push(row.source);
        else if (c.mode === "same" && c.fields.length > 0 && row.match) {
          updates.push({
            productId: row.match.productId,
            sourceUrl: row.key,
            fields: c.fields,
            source: row.source,
          });
        }
      }
    }
    return { adds, updates };
  }, [report, choices]);
  const totalApproved = approved.adds.length + approved.updates.length;

  // ---------------------------------------------------------------- ביצוע
  const execute = async () => {
    setPhase("applying");
    const id = runId.current;
    const out = {
      created: 0,
      failed: 0,
      duplicates: 0,
      updatedOk: 0,
      updatedFailed: [] as { name: string; error: string }[],
      messages: [] as string[],
    };
    const nameOf = (productId: string) =>
      report?.rows.find((r) => r.match?.productId === productId)?.match?.name ?? productId;
    const steps = Math.ceil(approved.adds.length / 10) + Math.ceil(approved.updates.length / 20);
    let done = 0;
    setProgress({ stage: "מבצעים את מה שאושר…", done: 0, total: steps });
    try {
      for (let i = 0; i < approved.adds.length; i += 10) {
        const res: ApplyResult = await apply({
          data: { adds: approved.adds.slice(i, i + 10), updates: [] },
        });
        if (runId.current !== id) return;
        out.created += res.added?.created ?? 0;
        out.failed += res.added?.failed ?? 0;
        out.duplicates += res.added?.duplicates ?? 0;
        for (const issue of res.added?.errors ?? [])
          out.messages.push(`${issue.name}: ${issue.message}`);
        for (const issue of res.added?.warnings ?? [])
          out.messages.push(`${issue.name}: ${issue.message}`);
        setProgress({ stage: "מבצעים את מה שאושר…", done: ++done, total: steps });
      }
      for (let i = 0; i < approved.updates.length; i += 20) {
        const slice = approved.updates.slice(i, i + 20);
        const res = await apply({
          data: {
            adds: [],
            updates: slice.map((u) => ({
              productId: u.productId,
              fields: u.fields,
              source: u.source,
            })),
          },
        });
        if (runId.current !== id) return;
        for (const item of res.updated) {
          if (item.ok) out.updatedOk += 1;
          else
            out.updatedFailed.push({
              name: nameOf(item.productId),
              error: item.error ?? "העדכון נכשל",
            });
          if (item.ok && item.error) out.messages.push(`${nameOf(item.productId)}: ${item.error}`);
        }
        setProgress({ stage: "מבצעים את מה שאושר…", done: ++done, total: steps });
      }
    } catch (e) {
      out.messages.push(e instanceof Error ? e.message : "הביצוע נעצר בגלל שגיאה");
    }
    setResults(out);
    setPhase("done");
    void onApplied();
  };

  // ---------------------------------------------------------------- תצוגה
  const rows = useMemo(
    () => (report?.rows ?? []).filter((row) => filter === "all" || row.kind === filter),
    [report, filter],
  );

  return (
    <div className="space-y-4" data-testid="source-scan" data-phase={phase}>
      <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="flex items-start gap-2">
            <Radar className="mt-0.5 size-5 text-primary" aria-hidden="true" />
            <div>
              <h3 className="font-bold">סריקת אתר מקור</h3>
              <p className="text-sm text-muted-foreground">
                מדביקים כתובת של אתר או של קטגוריה, והמערכת קוראת את המוצרים שהאתר חושף, משווה אותם
                לקטלוג של החנות הזו ומציגה דוח. כלום לא משתנה עד שתסמנו ותאשרו. הכתובת זמנית — לא
                נשמרת, ובכל פעם אפשר להדביק אתר אחר.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="scan-url">כתובת האתר או הקטלוג לסריקה</Label>
              <Input
                id="scan-url"
                dir="ltr"
                inputMode="url"
                placeholder="https://example.co.il/zap/"
                value={url}
                disabled={phase === "scanning" || phase === "applying"}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    (phase === "idle" || phase === "error" || phase === "report")
                  )
                    void start();
                }}
                data-testid="scan-url"
              />
            </div>
            {phase === "scanning" ? (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => (stopMode.current = "stop")}
                  data-testid="scan-stop"
                >
                  <Square className="size-4" aria-hidden="true" /> עצור והשווה
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => (stopMode.current = "cancel")}
                  data-testid="scan-cancel"
                >
                  ביטול
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                onClick={() => void start()}
                disabled={phase === "applying" || url.trim() === ""}
                data-testid="scan-start"
              >
                <ScanSearch className="size-4" aria-hidden="true" /> סרוק עכשיו
              </Button>
            )}
          </div>
          {scanning && (
            <p className="text-sm" data-testid="scan-source-url">
              {phase === "scanning" ? "נסרק כעת: " : "האתר שנסרק: "}
              <span dir="ltr" className="break-all font-semibold">
                {scanning}
              </span>
            </p>
          )}
          {phase === "idle" && error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {phase === "scanning" && (
        <Card data-testid="scan-progress">
          <CardContent className="space-y-2 pt-5">
            <p className="flex items-center gap-2 text-sm font-medium" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> {progress.stage}
            </p>
            {progress.total > 0 && (
              <>
                <Progress
                  value={Math.round((progress.done / progress.total) * 100)}
                  aria-label="התקדמות הסריקה"
                />
                <p className="text-xs text-muted-foreground" data-testid="scan-progress-count">
                  {progress.done} מתוך {progress.total} מוצרים נקראו
                  {failures.length > 0 ? ` · ${failures.length} לא נקראו` : ""}
                </p>
              </>
            )}
            {discovery && (
              <p className="text-xs text-muted-foreground">
                זוהה: {PLATFORM_LABEL[discovery.platform]}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {phase === "error" && (
        <Card className="border-destructive/40" data-testid="scan-error">
          <CardContent className="space-y-3 pt-5">
            <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
              <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
            <p className="text-xs text-muted-foreground">
              לא בוצע שום שינוי בחנות. אפשר לנסות כתובת אחרת, או לייבא מקובץ CSV.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={reset}
              data-testid="scan-new"
            >
              <RotateCcw className="size-4" aria-hidden="true" /> סריקה חדשה
            </Button>
          </CardContent>
        </Card>
      )}

      {(phase === "report" || phase === "confirm") && report && (
        <>
          <Card data-testid="scan-report">
            <CardContent className="space-y-3 pt-5">
              <p className="text-sm">
                הושווה לחנות <strong>{report.storeName || "הפעילה"}</strong> ({report.catalogSize}{" "}
                מוצרים בקטלוג).
              </p>
              {partial.length > 0 && (
                <div
                  className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                  role="status"
                  data-testid="scan-partial"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <div>
                    <strong>הסריקה חלקית — אין להתייחס אליה כקטלוג מלא.</strong>
                    <ul className="mt-1 list-disc pr-4 text-xs">
                      {partial.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2 text-xs" data-testid="scan-summary">
                <SummaryChip label="נקראו" value={report.summary.scanned} />
                <SummaryChip
                  label="חדשים"
                  value={report.summary.newCount}
                  tone="new"
                  onClick={() => setFilter("new")}
                />
                <SummaryChip
                  label="עם שינויים"
                  value={report.summary.changed}
                  tone="changed"
                  onClick={() => setFilter("changed")}
                />
                <SummaryChip
                  label="התאמה לא ודאית"
                  value={report.summary.uncertain}
                  tone="uncertain"
                  onClick={() => setFilter("uncertain")}
                />
                <SummaryChip
                  label="ללא שינוי"
                  value={report.summary.unchanged}
                  tone="unchanged"
                  onClick={() => setFilter("unchanged")}
                />
                {report.summary.duplicatesInSource > 0 && (
                  <SummaryChip
                    label="כפילויות במקור (הוסרו)"
                    value={report.summary.duplicatesInSource}
                  />
                )}
                {failures.length > 0 && (
                  <SummaryChip label="לא נקראו" value={failures.length} tone="changed" />
                )}
              </div>
              {failures.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer font-medium">
                    מוצרים שלא ניתן היה לקרוא ({failures.length})
                  </summary>
                  <ul
                    className="mt-1 max-h-40 space-y-1 overflow-y-auto"
                    data-testid="scan-failures"
                  >
                    {failures.slice(0, 100).map((f) => (
                      <li key={f.url}>
                        <span dir="ltr" className="break-all">
                          {f.url}
                        </span>{" "}
                        — {f.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-2" data-testid="scan-toolbar">
            {(["all", "changed", "new", "uncertain", "unchanged"] as const).map((k) => (
              <Button
                key={k}
                type="button"
                size="sm"
                variant={filter === k ? "default" : "outline"}
                onClick={() => setFilter(k)}
                data-testid={`scan-filter-${k}`}
              >
                {k === "all" ? "הכל" : KIND_LABEL[k]}
              </Button>
            ))}
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => bulk("price")}
              data-testid="scan-bulk-price"
            >
              סמן את כל עדכוני המחיר
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => bulk("new")}>
              סמן את כל החדשים
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => bulk("all-changes")}
              data-testid="scan-bulk-all"
            >
              סמן הכל (חוץ מלא ודאיים)
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => bulk("clear")}>
              נקה בחירה
            </Button>
          </div>

          <div className="space-y-3" data-testid="scan-rows">
            {rows.length === 0 && (
              <p className="text-sm text-muted-foreground">אין שורות בסינון הזה.</p>
            )}
            {rows.map((row) => (
              <ScanRowCard
                key={row.key}
                row={row}
                choice={choiceOf(row)}
                onChoice={(next) => setChoice(row, next)}
                onToggleField={(field, on) => toggleField(row, field, on)}
                onApproveAll={() =>
                  setChoice(row, {
                    fields: applicableFields(row),
                    mode: row.kind === "uncertain" ? "same" : choiceOf(row).mode,
                  })
                }
              />
            ))}
          </div>

          <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3 shadow-card">
            <p className="text-sm" data-testid="scan-selected-count">
              נבחרו: <strong>{approved.adds.length}</strong> להוספה ·{" "}
              <strong>{approved.updates.length}</strong> לעדכון
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={reset}
                data-testid="scan-new"
              >
                <RotateCcw className="size-4" aria-hidden="true" /> סריקה חדשה (מנקה הכל)
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={totalApproved === 0}
                onClick={() => setPhase("confirm")}
                data-testid="scan-approve-continue"
              >
                המשך לסיכום ואישור
              </Button>
            </div>
          </div>
        </>
      )}

      {phase === "confirm" && (
        <Card className="border-primary/50" data-testid="scan-confirm">
          <CardContent className="space-y-3 pt-5">
            <h3 className="font-bold">סיכום הפעולות שאושרו — לפני ביצוע</h3>
            <ul className="list-disc space-y-1 pr-5 text-sm">
              {approvalSummary(approved).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              לא יימחק שום מוצר ושום שדה שלא סומן. עדכון מחיר / שם / תיאור דורס את הערך הקיים — אין
              ביטול אוטומטי, ולכן כדאי לוודא את הרשימה.
            </p>
            <div className="flex gap-2">
              <Button type="button" onClick={() => void execute()} data-testid="scan-apply">
                אישור וביצוע
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPhase("report")}
                data-testid="scan-back"
              >
                חזרה לדוח
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {phase === "applying" && (
        <Card data-testid="scan-applying">
          <CardContent className="space-y-2 pt-5">
            <p className="flex items-center gap-2 text-sm font-medium" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> {progress.stage}
            </p>
            <Progress
              value={progress.total ? Math.round((progress.done / progress.total) * 100) : 0}
            />
            <p className="text-xs text-muted-foreground">אל תסגרו את העמוד עד הסיום.</p>
          </CardContent>
        </Card>
      )}

      {phase === "done" && results && (
        <Card className="border-emerald-300" data-testid="scan-done">
          <CardContent className="space-y-3 pt-5">
            <p className="flex items-center gap-2 font-bold">
              <CheckCircle2 className="size-5 text-emerald-600" aria-hidden="true" /> הביצוע הסתיים
            </p>
            <ul className="space-y-1 text-sm">
              <li>
                נוספו {results.created} מוצרים חדשים
                {results.failed > 0 ? ` · ${results.failed} נכשלו` : ""}
                {results.duplicates > 0
                  ? ` · ${results.duplicates} כבר היו בחנות (לא נוצרה כפילות)`
                  : ""}
              </li>
              <li>
                עודכנו {results.updatedOk} מוצרים
                {results.updatedFailed.length > 0
                  ? ` · ${results.updatedFailed.length} לא עודכנו`
                  : ""}
              </li>
            </ul>
            {(results.updatedFailed.length > 0 || results.messages.length > 0) && (
              <ul
                className="max-h-48 space-y-1 overflow-y-auto rounded-md border bg-muted/30 p-2 text-xs"
                data-testid="scan-result-issues"
              >
                {results.updatedFailed.map((f) => (
                  <li key={f.name + f.error}>
                    <strong>{f.name}:</strong> {f.error}
                  </li>
                ))}
                {results.messages.slice(0, 40).map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
            <Button type="button" onClick={reset} data-testid="scan-new">
              <RotateCcw className="size-4" aria-hidden="true" /> סריקה חדשה עם כתובת אחרת
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function newBlocked(row: ScanRow): boolean {
  return !row.source.name.trim() || row.source.price === null || !(row.source.price > 0);
}

function SummaryChip({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  tone?: ScanRow["kind"];
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "rounded-full border px-3 py-1 font-medium",
        tone ? KIND_TONE[tone] : "border-border bg-muted/40",
        onClick && "cursor-pointer hover:opacity-80",
      )}
    >
      {label}: <span className="numeric font-bold">{value}</span>
    </button>
  );
}

function ScanRowCard({
  row,
  choice,
  onChoice,
  onToggleField,
  onApproveAll,
}: {
  row: ScanRow;
  choice: Choice;
  onChoice: (next: Partial<Choice>) => void;
  onToggleField: (field: DiffField, on: boolean) => void;
  onApproveAll: () => void;
}) {
  const { source } = row;
  const blocked = row.kind === "new" ? row.blocked : newBlocked(row) ? "אין מחיר" : undefined;
  const fieldsEnabled =
    row.kind === "changed" || (row.kind === "uncertain" && choice.mode === "same");
  return (
    <article
      className="space-y-2 rounded-lg border bg-card p-3"
      data-testid="scan-row"
      data-kind={row.kind}
      data-url={row.key}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          {source.image && (
            <img
              src={source.image}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="size-14 shrink-0 rounded border bg-white object-contain"
            />
          )}
          <div className="min-w-0">
            <h4 className="break-words font-bold">{source.name}</h4>
            <p className="text-xs text-muted-foreground">
              {source.sku && (
                <>
                  מק"ט במקור: <span dir="ltr">{source.sku}</span> ·{" "}
                </>
              )}
              {source.barcode && (
                <>
                  ברקוד: <span dir="ltr">{source.barcode}</span> ·{" "}
                </>
              )}
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-0.5 text-primary underline"
              >
                עמוד המוצר במקור <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            </p>
          </div>
        </div>
        <Badge className={cn("border", KIND_TONE[row.kind])} variant="outline">
          {KIND_LABEL[row.kind]}
        </Badge>
      </div>

      {row.match && (
        <p className="text-xs">
          {row.kind === "uncertain" ? "מוצר דומה בחנות: " : "מוצר בחנות: "}
          <strong>{row.match.name}</strong> (מק"ט <span dir="ltr">{row.match.sku}</span>
          {row.kind !== "uncertain"
            ? ` · זוהה לפי ${row.match.by === "barcode" ? "ברקוד" : 'מק"ט'}`
            : ` · דמיון בשם ${Math.round((row.score ?? 0) * 100)}%`}
          )
        </p>
      )}

      {row.kind === "new" && (
        <div className="space-y-1 text-sm">
          <p>
            מחיר: <strong>{source.price !== null ? `₪${source.price}` : "—"}</strong>
            {source.category ? ` · קטגוריה: ${source.category} (תיווצר אם חסרה)` : ""}
          </p>
          {source.description && (
            <p className="line-clamp-2 text-xs text-muted-foreground">{source.description}</p>
          )}
          <p className="text-xs text-muted-foreground">
            מוצר חדש נכנס בלי מלאי (אין נתון מלאי אמין); אפשר לעדכן אחר כך.
          </p>
          {blocked ? (
            <p className="text-xs font-medium text-destructive" data-testid="scan-blocked">
              לא ניתן להוסיף: {blocked}
            </p>
          ) : (
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={choice.add}
                onCheckedChange={(v) => onChoice({ add: v === true })}
                data-testid="scan-add-check"
              />
              הוספת המוצר לחנות
            </label>
          )}
        </div>
      )}

      {row.kind === "uncertain" && (
        <fieldset
          className="space-y-1 rounded-md bg-violet-50/60 p-2 text-sm"
          data-testid="scan-uncertain"
        >
          <legend className="px-1 text-xs font-bold text-violet-900">
            אין מק"ט / ברקוד תואם — זו אולי אותה פריט. מה לעשות?
          </legend>
          {(
            [
              ["skip", "לא לגעת (ברירת מחדל)"],
              ["same", "זה אותו מוצר — לעדכן את השדות שאסמן"],
              ...(newBlocked(row) ? [] : ([["new", "זה מוצר שונה — להוסיף כמוצר חדש"]] as const)),
            ] as const
          ).map(([mode, label]) => (
            <label key={mode} className="flex items-center gap-2">
              <input
                type="radio"
                name={`mode-${row.key}`}
                checked={choice.mode === mode}
                onChange={() => onChoice({ mode, fields: mode === "same" ? choice.fields : [] })}
                data-testid={`scan-mode-${mode}`}
              />
              {label}
            </label>
          ))}
        </fieldset>
      )}

      {row.diffs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm" data-testid="scan-diff-table">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="w-10 text-start font-medium" />
                <th className="w-20 text-start font-medium">שדה</th>
                <th className="text-start font-medium">בחנות</th>
                <th className="text-start font-medium">באתר המקור</th>
              </tr>
            </thead>
            <tbody>
              {row.diffs.map((diff) => (
                <tr key={diff.field} className="border-t align-top">
                  <td className="py-1.5">
                    <Checkbox
                      checked={choice.fields.includes(diff.field)}
                      disabled={!diff.applicable || !fieldsEnabled}
                      onCheckedChange={(v) => onToggleField(diff.field, v === true)}
                      aria-label={`לעדכן ${DIFF_LABEL[diff.field]}`}
                      data-testid={`scan-check-${diff.field}`}
                    />
                  </td>
                  <td className="py-1.5 font-medium">{DIFF_LABEL[diff.field]}</td>
                  <td className="break-words py-1.5">
                    {diff.field === "price" ? money(diff.current) : diff.current}
                  </td>
                  <td className="break-words py-1.5 font-semibold">
                    {diff.field === "price"
                      ? money(diff.found)
                      : diff.field === "image"
                        ? "תמונה חדשה"
                        : diff.found}
                    {diff.note && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {diff.note}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {fieldsEnabled && row.diffs.some((d) => d.applicable) && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-1"
              onClick={onApproveAll}
              data-testid="scan-row-all"
            >
              אישור כל השינויים של המוצר
            </Button>
          )}
        </div>
      )}

      {row.kind === "changed" && row.diffs.every((d) => !d.applicable) && (
        <p className="text-xs text-muted-foreground">אין שינוי שאפשר ליישם אוטומטית במוצר הזה.</p>
      )}
      {row.stockNote && <p className="text-xs text-muted-foreground">מלאי: {row.stockNote}</p>}
    </article>
  );
}
