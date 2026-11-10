import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  FileText,
  History,
  Loader2,
  Undo2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ACTION_LABEL,
  MATCH_LABEL,
  UNDO_LABEL,
  reportCsv,
  reportStats,
  stockAfter,
  stockBefore,
  type ChangeAction,
  type ImportInfo,
  type ImportReport,
  type ReportRow,
} from "@/lib/product-import-sync";
import { downloadCsv } from "@/lib/download-csv";
import { cn } from "@/lib/utils";

const he = (value: number) => value.toLocaleString("he-IL");

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_LABEL: Record<ImportInfo["status"], string> = {
  running: "לא הושלם",
  done: "הושלם",
  undone: "בוטל",
};

function StatusBadge({ status }: { status: ImportInfo["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        status === "done" &&
          "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100",
        status === "running" &&
          "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100",
        status === "undone" && "bg-secondary text-muted-foreground",
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

type Filter = "all" | "created" | "updated" | "zero" | "missing" | "skipped" | "failed";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "הכול" },
  { key: "created", label: "נוספו" },
  { key: "updated", label: "עודכנו" },
  { key: "zero", label: "ירדו ל-0" },
  { key: "missing", label: "לא בקובץ" },
  { key: "skipped", label: "דולגו" },
  { key: "failed", label: "לא בוצעו" },
];

function matches(row: ReportRow, filter: Filter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "created":
      return row.action === "created";
    case "updated":
      return row.action === "updated";
    case "zero":
      return (row.action === "updated" || row.action === "zeroed") && stockAfter(row) === 0;
    case "missing":
      return row.action === "zeroed" || row.action === "hidden";
    case "skipped":
      return row.action === "skipped" || row.action === "unchanged";
    case "failed":
      return row.action === "failed";
  }
}

const SHOWN = 200;

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "warn" | "bad" | undefined;
}) {
  return (
    <div
      className={cn(
        "rounded-xl p-3 text-center",
        tone === "good" && "bg-emerald-50 dark:bg-emerald-950/40",
        tone === "warn" && "bg-amber-50 dark:bg-amber-950/40",
        tone === "bad" && "bg-destructive/10",
        !tone && "bg-secondary",
      )}
    >
      <p className="numeric text-2xl font-black">{he(value)}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function StockCell({ row }: { row: ReportRow }) {
  const before = stockBefore(row);
  const after = stockAfter(row);
  if (row.action === "created") return <span>{after ?? "—"}</span>;
  if (before === null || after === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap" dir="ltr">
      <span>{before}</span>
      <span aria-hidden="true">→</span>
      <span className={cn("font-semibold", after === 0 && "text-destructive")}>{after}</span>
      {after > before ? (
        <ArrowUp className="size-3.5 text-emerald-600" aria-label="עלה" />
      ) : after < before ? (
        <ArrowDown className="size-3.5 text-amber-600" aria-label="ירד" />
      ) : null}
    </span>
  );
}

/** דוח השינויים של יבוא: סיכום, סינון, טבלה, הורדה וביטול */
export function ImportReportView({
  report,
  onUndo,
  undoing,
}: {
  report: ImportReport;
  onUndo?: () => void;
  undoing?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmUndo, setConfirmUndo] = useState(false);
  const stats = useMemo(() => reportStats(report.rows), [report.rows]);
  const rows = useMemo(
    () => report.rows.filter((row) => matches(row, filter)),
    [report.rows, filter],
  );
  const info = report.import;
  const canUndo = onUndo !== undefined && info.status !== "undone";
  const fileBase = (info.file_name || "import").replace(/\.[^.]+$/, "").slice(0, 60);

  return (
    <div className="space-y-4" data-import-report={info.status}>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate font-semibold" dir="auto">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {info.file_name || "קובץ ללא שם"}
          </p>
          <p className="text-xs text-muted-foreground">
            {when(info.created_at)} · <StatusBadge status={info.status} />
            {info.status === "undone" && info.undone_at ? ` · בוטל ב-${when(info.undone_at)}` : ""}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => downloadCsv(`import-report-${fileBase}.csv`, reportCsv(report.rows))}
        >
          <Download className="size-4" aria-hidden="true" />
          הורדת דוח (CSV)
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-import-stats>
        <Stat label="נוספו" value={stats.created} tone="good" />
        <Stat label="עודכנו" value={stats.updated} tone="good" />
        <Stat label="ללא שינוי" value={stats.unchanged} />
        <Stat label="לא בוצעו" value={stats.failed} tone={stats.failed > 0 ? "bad" : undefined} />
      </div>
      <ul className="flex flex-wrap gap-2 text-xs" aria-label="פירוט השינויים במלאי">
        <li className="rounded-full bg-secondary px-3 py-1">מלאי עלה: {he(stats.stockUp)}</li>
        <li className="rounded-full bg-secondary px-3 py-1">מלאי ירד: {he(stats.stockDown)}</li>
        <li className="rounded-full bg-secondary px-3 py-1" data-import-to-zero>
          ירדו ל-0: {he(stats.toZero)}
        </li>
        {stats.priceChanged > 0 && (
          <li className="rounded-full bg-secondary px-3 py-1">
            מחיר השתנה: {he(stats.priceChanged)}
          </li>
        )}
        {stats.zeroed > 0 && (
          <li className="rounded-full bg-amber-50 px-3 py-1 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            לא בקובץ — אופסו: {he(stats.zeroed)}
          </li>
        )}
        {stats.hidden > 0 && (
          <li className="rounded-full bg-amber-50 px-3 py-1 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            לא בקובץ — הוסתרו: {he(stats.hidden)}
          </li>
        )}
        {stats.skipped > 0 && (
          <li className="rounded-full bg-secondary px-3 py-1">דולגו: {he(stats.skipped)}</li>
        )}
      </ul>
      {info.new_categories.length > 0 && (
        <p className="text-xs text-muted-foreground">
          נוצרו קטגוריות חדשות: {info.new_categories.join(", ")}
        </p>
      )}

      <div role="group" aria-label="סינון הדוח" className="flex flex-wrap gap-1.5">
        {FILTERS.map((item) => (
          <Button
            key={item.key}
            type="button"
            size="sm"
            variant={filter === item.key ? "default" : "outline"}
            aria-pressed={filter === item.key}
            className="h-7 px-2.5 text-xs"
            onClick={() => setFilter(item.key)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      <div className="max-h-80 overflow-auto rounded-xl border">
        <table className="w-full min-w-[36rem] text-sm" data-import-report-table>
          <caption className="sr-only">השינויים שהיבוא עשה, שורה אחר שורה</caption>
          <thead className="sticky top-0 bg-secondary/90 text-xs text-muted-foreground backdrop-blur">
            <tr>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                שורה
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                מוצר
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                מה קרה
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                מלאי
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                מחיר
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                הערה
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, SHOWN).map((row, index) => (
              <tr
                key={`${row.row ?? "x"}-${index}`}
                className="border-t align-top"
                data-action={row.action}
              >
                <td className="px-2 py-1.5 text-muted-foreground">{row.row ?? "—"}</td>
                <td className="max-w-[12rem] px-2 py-1.5">
                  <span className="block truncate font-medium" dir="auto">
                    {row.name || "—"}
                  </span>
                  {row.match && (
                    <span className="text-[11px] text-muted-foreground">
                      זוהה לפי {MATCH_LABEL[row.match] ?? row.match}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1",
                      row.action === "failed" && "text-destructive",
                    )}
                  >
                    {row.action === "failed" ? (
                      <XCircle className="size-3.5" aria-hidden="true" />
                    ) : row.action === "created" || row.action === "updated" ? (
                      <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden="true" />
                    ) : null}
                    {ACTION_LABEL[row.action as ChangeAction] ?? row.action}
                  </span>
                  {row.undone && (
                    <span className="block text-[11px] text-muted-foreground">
                      ביטול: {UNDO_LABEL[row.undone] ?? row.undone}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <StockCell row={row} />
                </td>
                <td className="whitespace-nowrap px-2 py-1.5" dir="ltr">
                  {row.after["price"] === undefined
                    ? "—"
                    : row.action === "created"
                      ? String(row.after["price"])
                      : `${row.before["price"] ?? "—"} → ${row.after["price"]}`}
                </td>
                <td className="max-w-[16rem] px-2 py-1.5 text-xs text-muted-foreground">
                  {[row.message, row.undo_message].filter(Boolean).join(" · ")}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  אין שורות בסינון הזה
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > SHOWN && (
        <p className="text-xs text-muted-foreground">
          מוצגות {he(SHOWN)} מתוך {he(rows.length)} שורות — כל השורות בדוח להורדה.
        </p>
      )}

      {canUndo && (
        <div className="rounded-xl border border-dashed p-3">
          <p className="text-sm font-semibold">ביטול היבוא הזה</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            מוצרים שהיבוא הוסיף יימחקו (מוצר שכבר הוזמן — יוסתר מהאתר), ומלאי, מחירים ומוצרים
            שהוסתרו או אופסו יחזרו למה שהיה. ערך ששונה ידנית אחרי היבוא — לא ייגע.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={undoing}
            onClick={() => setConfirmUndo(true)}
          >
            {undoing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Undo2 className="size-4" aria-hidden="true" />
            )}
            ביטול היבוא הזה
          </Button>
        </div>
      )}

      <AlertDialog open={confirmUndo} onOpenChange={setConfirmUndo}>
        <AlertDialogContent dir="rtl" className="text-right">
          <AlertDialogHeader className="text-right">
            <AlertDialogTitle>לבטל את היבוא?</AlertDialogTitle>
            <AlertDialogDescription>
              {he(stats.created)} מוצרים שנוספו יימחקו (או יוסתרו אם כבר הוזמנו), ו-
              {he(stats.updated + stats.zeroed + stats.hidden)} מוצרים שהשתנו יחזרו למה שהיה לפני
              היבוא. אי אפשר לבטל את הביטול.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogCancel>חזרה</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmUndo(false);
                onUndo?.();
              }}
            >
              כן, לבטל את היבוא
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** היבואים האחרונים של החנות — דוח וביטול */
export function RecentImports({
  imports,
  loading,
  onOpen,
}: {
  imports: ImportInfo[] | null;
  loading: boolean;
  onOpen: (info: ImportInfo) => void;
}) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        טוענים את היבואים האחרונים…
      </p>
    );
  }
  if (!imports || imports.length === 0) return null;
  return (
    <section className="space-y-2" aria-labelledby="recent-imports-title" data-recent-imports>
      <h3 id="recent-imports-title" className="flex items-center gap-2 text-sm font-semibold">
        <History className="size-4 text-muted-foreground" aria-hidden="true" />
        יבואים אחרונים
      </h3>
      <ul className="divide-y rounded-xl border">
        {imports.slice(0, 5).map((info) => (
          <li key={info.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium" dir="auto">
                {info.file_name || "קובץ ללא שם"}
              </p>
              <p className="text-xs text-muted-foreground">
                {when(info.created_at)} · <StatusBadge status={info.status} /> · נוספו{" "}
                {he(info.counts.created ?? 0)} · עודכנו {he(info.counts.updated ?? 0)}
                {(info.counts.failed ?? 0) > 0 ? ` · לא בוצעו ${he(info.counts.failed ?? 0)}` : ""}
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpen(info)}>
              {info.status === "undone" ? "דוח" : "דוח וביטול"}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** תוצאת הביטול — שורה קצרה */
export function UndoNotice({
  result,
}: {
  result: { deleted: number; hidden: number; restored: number; conflicts: number };
}) {
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-lg bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-100"
    >
      {result.conflicts > 0 ? (
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      )}
      היבוא בוטל: {he(result.deleted)} נמחקו, {he(result.hidden)} הוסתרו (כבר הוזמנו),{" "}
      {he(result.restored)} שוחזרו
      {result.conflicts > 0
        ? ` · ${he(result.conflicts)} לא שוחזרו כי השתנו מאז (מסומנים בדוח)`
        : ""}
      .
    </p>
  );
}
