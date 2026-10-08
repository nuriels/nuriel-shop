import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FileDown, Loader2, Printer, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  A4,
  a4Grid,
  a4Position,
  renderBarcodeLabelsPdf,
  renderLabelImages,
  totalLabels,
  type BarcodeLabelOptions,
  type BarcodeLabelSize,
  type LabelJob,
  type LabelLayout,
} from "@/lib/barcode-labels";
import { downloadBlob } from "@/lib/shipping-label";

/**
 * תצוגת הדפסה של מדבקות הברקוד — מסך מלא מעל הפאנל. "הדפסה" פותחת את חלון
 * ההדפסה של הדפדפן: גודל העמוד נקבע ב-@page לפי המדבקה (גליל — עמוד לכל
 * מדבקה; A4 — רשת), ובהדפסה מוצגות רק המדבקות. "הורדת PDF" — אותן מדבקות
 * בקובץ, להדפסה מכל מחשב.
 */
export function LabelPrintView({
  jobs,
  size,
  layout,
  options,
  onClose,
}: {
  jobs: readonly LabelJob[];
  size: BarcodeLabelSize;
  layout: LabelLayout;
  options: BarcodeLabelOptions;
  onClose: () => void;
}) {
  const [urls, setUrls] = useState<Map<string, string> | null>(null);
  const [progress, setProgress] = useState(0);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const total = totalLabels(jobs);

  useEffect(() => setMounted(true), []);

  // הציור: תמונה אחת לכל מוצר (העותקים משתמשים באותה תמונה)
  useEffect(() => {
    let cancelled = false;
    let made: Map<string, string> | null = null;
    setUrls(null);
    setProgress(0);
    renderLabelImages(
      jobs,
      size,
      options,
      (done, all) => !cancelled && setProgress(Math.round((done / Math.max(1, all)) * 100)),
      () => cancelled,
    )
      .then((result) => {
        made = result;
        if (cancelled) {
          for (const url of result.values()) URL.revokeObjectURL(url);
          return;
        }
        setUrls(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "הפקת המדבקות נכשלה");
          onClose();
        }
      });
    return () => {
      cancelled = true;
      if (made) for (const url of made.values()) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose מהאב משתנה בכל רינדור
  }, [jobs, size, options]);

  // הדפסה: רק המדבקות, ועמוד בגודל המדבקה (או A4) בלי שוליים
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("label-printing");
    const style = document.createElement("style");
    style.setAttribute("data-label-page", "");
    style.textContent =
      layout === "roll"
        ? `@page { size: ${size.width}mm ${size.height}mm; margin: 0; }`
        : `@page { size: A4 portrait; margin: 0; }`;
    document.head.appendChild(style);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      root.classList.remove("label-printing");
      style.remove();
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [layout, size.width, size.height, onClose]);

  /** רשימת המדבקות בפועל — כל עותק בנפרד */
  const items = useMemo(() => {
    const list: { key: string; name: string }[] = [];
    for (const job of jobs) {
      for (let copy = 0; copy < job.copies; copy += 1)
        list.push({ key: job.key, name: job.data.name });
    }
    return list;
  }, [jobs]);

  const grid = useMemo(() => a4Grid(size), [size]);
  const pages = useMemo(() => {
    if (layout !== "a4") return [];
    const result: { key: string; name: string; x: number; y: number }[][] = [];
    items.forEach((item, index) => {
      const position = a4Position(grid, size, index);
      (result[position.page] ??= []).push({ ...item, x: position.x, y: position.y });
    });
    return result;
  }, [items, grid, size, layout]);

  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      const blob = await renderBarcodeLabelsPdf(jobs, size, layout, options);
      downloadBlob(
        blob,
        `barcode-labels-${size.width}x${size.height}${layout === "a4" ? "-a4" : ""}.pdf`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "הפקת ה-PDF נכשלה");
    } finally {
      setPdfBusy(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      data-label-print-root=""
      dir="rtl"
      className="fixed inset-0 z-[60] overflow-y-auto bg-muted text-right"
      role="dialog"
      aria-modal="true"
      aria-label="תצוגת הדפסה של מדבקות ברקוד"
      data-testid="label-print-view"
    >
      <div className="label-print-chrome sticky top-0 z-10 border-b border-border bg-card/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          {/* בטלפון: הכותרת בשורה משלה, הכפתורים מתחתיה */}
          <div className="min-w-[14rem] flex-1">
            <p className="font-semibold">
              {total.toLocaleString("he-IL")} מדבקות · {jobs.length.toLocaleString("he-IL")} מוצרים
            </p>
            <p className="text-xs text-muted-foreground" dir="rtl">
              {layout === "roll"
                ? `גליל — מדבקה לכל עמוד, ${size.width}×${size.height} מ"מ`
                : `דף A4 — ${grid.perPage} מדבקות בעמוד (${grid.columns}×${grid.rows}), ${pages.length} עמודים`}
            </p>
          </div>
          <Button onClick={() => window.print()} disabled={urls === null} data-testid="label-print">
            <Printer className="size-4" aria-hidden="true" />
            הדפסה
          </Button>
          <Button
            variant="outline"
            onClick={() => void downloadPdf()}
            disabled={pdfBusy}
            data-testid="label-pdf"
          >
            {pdfBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileDown className="size-4" aria-hidden="true" />
            )}
            הורדת PDF
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="סגירת תצוגת ההדפסה">
            <X className="size-5" aria-hidden="true" />
          </Button>
        </div>
        <p className="mx-auto max-w-6xl px-4 pb-2 text-xs leading-5 text-muted-foreground">
          {layout === "roll"
            ? `בחלון ההדפסה: בחרו את מדפסת המדבקות (Zebra וכדומה), גודל נייר ${size.width}×${size.height} מ"מ, שוליים "ללא" וקנה מידה 100% ("גודל בפועל").`
            : 'בחלון ההדפסה: נייר A4, שוליים "ללא" וקנה מידה 100% — כך המדבקות נשארות בגודל המדויק.'}
        </p>
      </div>

      {urls === null ? (
        <div className="label-print-chrome mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
          <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">מכין את המדבקות… {progress}%</p>
          <Progress value={progress} className="w-full" />
        </div>
      ) : layout === "roll" ? (
        <div
          className="label-print-sheet mx-auto flex max-w-6xl flex-wrap justify-center gap-4 p-6"
          style={{ ["--label-h" as string]: `${size.height}mm` }}
        >
          {items.map((item, index) => (
            // עטיפה בגובה העמוד: בהדפסה היא קצרה בשבריר מ"מ (חותכת שוליים לבנים),
            // כדי שעיגול הפיקסלים לא "יגלוש" לעמוד ריק אחרי כל מדבקה
            <div
              key={`${item.key}-${index}`}
              className="label-roll-item overflow-hidden bg-white shadow-md ring-1 ring-border"
              style={{ width: `${size.width}mm`, height: `${size.height}mm` }}
            >
              <img
                src={urls.get(item.key)}
                alt={`מדבקה: ${item.name}`}
                className="block max-w-none"
                style={{ width: `${size.width}mm`, height: `${size.height}mm` }}
                data-testid="label-item"
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="label-print-sheet flex flex-col items-center gap-6 p-6 max-sm:[zoom:0.45]">
          {pages.map((page, pageIndex) => (
            <div
              key={pageIndex}
              className="label-a4-page relative shrink-0 bg-white shadow-md ring-1 ring-border"
              style={{ width: `${A4.width}mm`, height: `${A4.height}mm` }}
            >
              {page.map((item, index) => (
                <img
                  key={`${item.key}-${index}`}
                  src={urls.get(item.key)}
                  alt={`מדבקה: ${item.name}`}
                  className="absolute outline outline-1 outline-dashed outline-border print:outline-0"
                  style={{
                    left: `${item.x}mm`,
                    top: `${item.y}mm`,
                    width: `${size.width}mm`,
                    height: `${size.height}mm`,
                  }}
                  data-testid="label-item"
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
