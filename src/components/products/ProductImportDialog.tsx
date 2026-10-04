import { useRef, useState, type DragEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileUp,
  FolderPlus,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CSV_MAX_BYTES,
  CSV_MAX_ROWS,
  IMPORT_FIELDS,
  SAMPLE_CSV,
  decodeCsvBytes,
  fieldLabel,
  parseCsv,
  prepareImport,
  type PreparedImport,
} from "@/lib/csv-import";
import { importProductsCsv, type ImportSummary } from "@/lib/product-import.functions";
import { refreshCategories } from "@/hooks/useCategories";
import { cn } from "@/lib/utils";

type Loaded = { fileName: string; text: string; prepared: PreparedImport; columns: number };

function downloadText(fileName: string, text: string) {
  const blob = new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

/**
 * ייבוא קטלוג מוצרים מקובץ CSV (חלק 14): בחירת קובץ (או גרירה), תצוגה
 * מקדימה עם זיהוי העמודות, ייבוא בשרת, וסיכום — כמה נוספו, מה דולג ולמה.
 * קבצים מאקסל בעברית (Windows-1255), מ-WooCommerce ומ-Shopify נתמכים.
 */
export function ProductImportDialog({
  onImported,
  productCount,
  maxProducts,
}: {
  onImported: () => void | Promise<void>;
  productCount: number;
  maxProducts: number | null;
}) {
  const importFn = useServerFn(importProductsCsv);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [dragging, setDragging] = useState(false);

  const reset = () => {
    setLoaded(null);
    setProblem(null);
    setSummary(null);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setSummary(null);
    if (!/\.(csv|txt)$/i.test(file.name) && !/csv|text/i.test(file.type)) {
      setProblem("נא לבחור קובץ CSV (באקסל: קובץ ← שמירה בשם ← CSV UTF-8)");
      return;
    }
    if (file.size > CSV_MAX_BYTES) {
      setProblem("הקובץ גדול מדי (עד 5MB) — פצלו אותו לכמה קבצים");
      return;
    }
    const text = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
    const table = parseCsv(text);
    if (table.headers.length === 0) {
      setProblem("הקובץ ריק או שאין בו שורת כותרות");
      return;
    }
    const prepared = prepareImport(table);
    setLoaded({ fileName: file.name, text, prepared, columns: table.headers.length });
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    void readFile(event.dataTransfer.files?.[0]);
  };

  const runImport = async () => {
    if (!loaded) return;
    setBusy(true);
    try {
      const result = await importFn({ data: { csv: loaded.text, fileName: loaded.fileName } });
      setSummary(result);
      if (result.newCategories.length > 0) await refreshCategories().catch(() => undefined);
      await onImported();
      if (result.created > 0) {
        toast.success(`${result.created.toLocaleString("he-IL")} מוצרים נוספו לקטלוג`);
      } else {
        toast.warning("לא נוספו מוצרים — ראו את הפירוט");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "הייבוא נכשל");
    } finally {
      setBusy(false);
    }
  };

  const downloadReport = () => {
    if (!summary) return;
    const lines = [
      ["שורה בקובץ", "מוצר", "מה קרה"].map(csvCell).join(","),
      ...summary.errors.map((e) => [e.row, e.name, e.message].map(csvCell).join(",")),
      ...summary.warnings.map((w) => [w.row, w.name, w.message].map(csvCell).join(",")),
      ...summary.skipped.map((s) => [s.row, "", s.reason].map(csvCell).join(",")),
    ];
    downloadText("import-report.csv", lines.join("\r\n"));
  };

  const prepared = loaded?.prepared ?? null;
  const rowCount = prepared?.rows.length ?? 0;
  const room = maxProducts !== null ? Math.max(0, maxProducts - productCount) : null;
  const overLimit = room !== null && rowCount > room;
  const tooMany = rowCount > CSV_MAX_ROWS;
  const canImport =
    prepared !== null && prepared.missing.length === 0 && rowCount > 0 && !tooMany && !busy;
  const found = prepared
    ? IMPORT_FIELDS.filter((f) => f.key !== "short_description" && f.key !== "published").map(
        (f) => ({ key: f.key, label: f.label, on: prepared.mapping[f.key] !== undefined, required: f.required }),
      )
    : [];

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <FileUp className="size-4" />
        ייבא מ-CSV
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto text-right sm:max-w-2xl">
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="size-5 text-emerald-600" aria-hidden="true" />
              ייבוא מוצרים מקובץ CSV
            </DialogTitle>
            <DialogDescription>
              מעבירים קטלוג שלם בבת אחת — מאקסל, מ-WooCommerce או מ-Shopify. המוצרים נוספים כמוצרים
              חדשים; מוצר שהברקוד או המק"ט שלו כבר קיים בחנות לא נדרס.
            </DialogDescription>
          </DialogHeader>

          {summary ? (
            <ImportResult summary={summary} onReport={downloadReport} onAgain={reset} />
          ) : !loaded ? (
            <div className="space-y-4">
              <label
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition",
                  dragging
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50 hover:bg-secondary/40",
                )}
              >
                <span className="flex size-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <Upload className="size-7" aria-hidden="true" />
                </span>
                <span className="text-base font-semibold">בחרו קובץ CSV או גררו אותו לכאן</span>
                <span className="text-xs text-muted-foreground">
                  עד 5MB ועד {CSV_MAX_ROWS.toLocaleString("he-IL")} מוצרים בקובץ
                </span>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv,.txt"
                  className="sr-only"
                  onChange={(event) => void readFile(event.target.files?.[0])}
                />
              </label>
              {problem && (
                <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {problem}
                </p>
              )}
              <div className="space-y-2 rounded-xl bg-secondary/50 p-4 text-sm">
                <p className="font-semibold">העמודות בקובץ (שורה ראשונה = כותרות)</p>
                <p className="leading-6 text-muted-foreground">
                  <strong className="text-foreground">חובה:</strong> שם המוצר, מחיר.{" "}
                  <strong className="text-foreground">לא חובה:</strong> קטגוריה (חדשה תיווצר לבד),
                  תיאור, מק"ט, ברקוד, מלאי, תמונה (קישור), מחיר מבצע + סיום מבצע, מחיר עלות, מוסתר,
                  הצג בזאפ, כותרת / תיאור SEO.
                </p>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => downloadText("products-sample.csv", SAMPLE_CSV)}
                >
                  <Download className="size-4" />
                  הורדת קובץ לדוגמה
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold" dir="auto">
                    {loaded.fileName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {rowCount.toLocaleString("he-IL")} מוצרים לייבוא · {loaded.columns} עמודות
                    {prepared && prepared.skipped.length > 0
                      ? ` · ${prepared.skipped.length} שורות ידולגו`
                      : ""}
                  </p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={busy}>
                  קובץ אחר
                </Button>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold">העמודות שזוהו</p>
                <div className="flex flex-wrap gap-1.5">
                  {found.map((field) => (
                    <span
                      key={field.key}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs",
                        field.on
                          ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                          : field.required
                            ? "border-destructive/50 bg-destructive/10 text-destructive"
                            : "border-border text-muted-foreground",
                      )}
                    >
                      {field.on ? (
                        <CheckCircle2 className="size-3" aria-hidden="true" />
                      ) : field.required ? (
                        <XCircle className="size-3" aria-hidden="true" />
                      ) : null}
                      {field.label}
                    </span>
                  ))}
                </div>
              </div>

              {prepared && prepared.missing.length > 0 && (
                <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  חסרות עמודות חובה: {prepared.missing.map(fieldLabel).join(", ")}. ודאו ששורת
                  הכותרות בקובץ כוללת אותן (אפשר להיעזר בקובץ הדוגמה).
                </p>
              )}

              {prepared && prepared.missing.length === 0 && rowCount > 0 && (
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full min-w-[28rem] text-sm">
                    <thead className="bg-secondary/60 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-right font-medium">שורה</th>
                        <th className="px-3 py-2 text-right font-medium">שם</th>
                        <th className="px-3 py-2 text-right font-medium">מחיר</th>
                        <th className="px-3 py-2 text-right font-medium">קטגוריה</th>
                        <th className="px-3 py-2 text-right font-medium">מלאי</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prepared.rows.slice(0, 5).map((row) => (
                        <tr key={row.row} className="border-t">
                          <td className="px-3 py-2 text-muted-foreground">{row.row}</td>
                          <td className="max-w-[14rem] truncate px-3 py-2 font-medium">{row.name}</td>
                          <td className="px-3 py-2" dir="ltr">
                            {row.price || "—"}
                          </td>
                          <td className="px-3 py-2">{row.category || "כללי"}</td>
                          <td className="px-3 py-2">{row.stock || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rowCount > 5 && (
                    <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                      ועוד {(rowCount - 5).toLocaleString("he-IL")} מוצרים…
                    </p>
                  )}
                </div>
              )}

              {tooMany && (
                <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  עד {CSV_MAX_ROWS.toLocaleString("he-IL")} מוצרים בקובץ אחד — פצלו לכמה קבצים.
                </p>
              )}
              {overLimit && room !== null && (
                <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  בחבילה הבסיסית נשאר מקום ל-{room.toLocaleString("he-IL")} מוצרים — רק הם ייובאו.
                  מוצרים ללא הגבלה זמינים בחבילת פרימיום.
                </p>
              )}

              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={!canImport}
                onClick={() => void runImport()}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {busy
                  ? "מייבאים… זה יכול לקחת כמה רגעים"
                  : `ייבוא ${rowCount.toLocaleString("he-IL")} מוצרים`}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ImportResult({
  summary,
  onReport,
  onAgain,
}: {
  summary: ImportSummary;
  onReport: () => void;
  onAgain: () => void;
}) {
  const issues = summary.errors.length + summary.warnings.length + summary.skipped.length;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/40">
          <p className="text-2xl font-black text-emerald-700 dark:text-emerald-300">
            {summary.created.toLocaleString("he-IL")}
          </p>
          <p className="text-xs text-emerald-800 dark:text-emerald-200">נוספו</p>
        </div>
        <div className="rounded-xl bg-secondary p-3">
          <p className="text-2xl font-black">{summary.duplicates.toLocaleString("he-IL")}</p>
          <p className="text-xs text-muted-foreground">כבר קיימים</p>
        </div>
        <div
          className={cn(
            "rounded-xl p-3",
            summary.failed - summary.duplicates > 0 ? "bg-destructive/10" : "bg-secondary",
          )}
        >
          <p
            className={cn(
              "text-2xl font-black",
              summary.failed - summary.duplicates > 0 && "text-destructive",
            )}
          >
            {Math.max(0, summary.failed - summary.duplicates).toLocaleString("he-IL")}
          </p>
          <p className="text-xs text-muted-foreground">לא נוספו</p>
        </div>
      </div>

      {summary.limitReached && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          הגעתם למגבלת המוצרים של החבילה הבסיסית — שאר המוצרים לא נוספו. מוצרים ללא הגבלה זמינים
          בחבילת פרימיום.
        </p>
      )}
      {summary.newCategories.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
          <FolderPlus className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          נוצרו קטגוריות חדשות: {summary.newCategories.join(", ")}
        </p>
      )}
      {summary.skuReplaced > 0 && (
        <p className="text-xs text-muted-foreground">
          {summary.skuReplaced} מוצרים קיבלו מק"ט פנימי חדש (מק"ט בחנות = 8 ספרות). המק"ט המקורי
          לא נשמר — אפשר להוסיף אותו לתיאור או כברקוד.
        </p>
      )}

      {issues > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">פירוט ({issues})</p>
            <Button type="button" variant="outline" size="sm" onClick={onReport}>
              <Download className="size-4" />
              הורדת הדוח
            </Button>
          </div>
          <ul className="max-h-60 space-y-1 overflow-y-auto rounded-xl border p-2 text-sm">
            {summary.errors.map((issue, index) => (
              <li key={`e${index}`} className="flex gap-2 rounded-md px-2 py-1 hover:bg-secondary/50">
                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="text-muted-foreground">שורה {issue.row}</span>
                  {issue.name ? ` · ${issue.name}` : ""} — {issue.message}
                </span>
              </li>
            ))}
            {summary.warnings.map((issue, index) => (
              <li key={`w${index}`} className="flex gap-2 rounded-md px-2 py-1 hover:bg-secondary/50">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="text-muted-foreground">שורה {issue.row}</span>
                  {issue.name ? ` · ${issue.name}` : ""} — נוסף, אבל: {issue.message}
                </span>
              </li>
            ))}
            {summary.skipped.map((skip, index) => (
              <li key={`s${index}`} className="flex gap-2 rounded-md px-2 py-1 text-muted-foreground hover:bg-secondary/50">
                <span className="mt-0.5 size-4 shrink-0 text-center">·</span>
                <span>
                  שורה {skip.row} — {skip.reason}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button type="button" variant="outline" className="w-full" onClick={onAgain}>
        ייבוא קובץ נוסף
      </Button>
    </div>
  );
}
