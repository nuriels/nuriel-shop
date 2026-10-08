/**
 * מחולל מדבקות ברקוד למוצרים (חלק 32) — /admin/inventory/labels.
 *
 * כל מדבקה: ברקוד סריק (CODE128), שם המוצר, מק"ט ומחיר — מצוירת בדפדפן
 * על canvas ברזולוציית 300 DPI (כמו מדבקות המשלוח, אותם עזרי ציור), כך
 * שהתוצאה זהה בתצוגת ההדפסה (HTML עם @page) ובקובץ ה-PDF.
 *
 * - ברקוד: ברקוד היצרן של המוצר (EAN וכו') אם הוזן, אחרת המק"ט — שניהם
 *   נסרקים בקופה המהירה, בליקוט ובספירת המלאי.
 * - הקווים ברוחב שלם של פיקסלים, בכפולות של 0.25 מ"מ: חדים גם במדפסת
 *   תרמית 203 DPI (Zebra) וגם ב-300 DPI, בלי "קווים עבים ודקים" לסירוגין.
 * - גליל (מדפסת תרמית): עמוד אחד לכל מדבקה בגודל המדויק (ברירת מחדל
 *   70×40 מ"מ). דף A4: כמה שיותר מדבקות בעמוד, בשוליים של 8 מ"מ.
 *
 * הפונקציות הטהורות (קוד, מחיר, עותקים, פריסת A4) רצות גם בשרת / בבדיקות;
 * הציור — בדפדפן בלבד.
 */
import {
  LABEL_DPMM,
  barcodeModules,
  canvasToBlob,
  drawTextBox,
  ensureFonts,
} from "@/lib/shipping-label";

export type BarcodeLabelSize = { width: number; height: number };

/** ברירת המחדל של החנות (כמו במסד — site_settings.barcode_label_*) */
export const BARCODE_LABEL_DEFAULT: BarcodeLabelSize = { width: 70, height: 40 };

/** מידות נפוצות של מדבקות מוצר למדפסות תרמיות */
export const BARCODE_LABEL_PRESETS: readonly BarcodeLabelSize[] = [
  { width: 70, height: 40 },
  { width: 70, height: 30 },
  { width: 70, height: 50 },
  { width: 58, height: 40 },
  { width: 50, height: 30 },
  { width: 40, height: 25 },
  { width: 100, height: 50 },
];

/** כמו ה-CHECK במסד (וכמו מדבקות המשלוח) */
export const BARCODE_LABEL_LIMITS = {
  width: { min: 30, max: 200 },
  height: { min: 20, max: 300 },
} as const;

export function barcodeLabelSizeProblem(size: BarcodeLabelSize): string | null {
  const { width, height } = BARCODE_LABEL_LIMITS;
  if (!Number.isFinite(size.width) || size.width < width.min || size.width > width.max) {
    return `רוחב המדבקה: ${width.min} עד ${width.max} מ"מ`;
  }
  if (!Number.isFinite(size.height) || size.height < height.min || size.height > height.max) {
    return `גובה המדבקה: ${height.min} עד ${height.max} מ"מ`;
  }
  return null;
}

export function normalizeBarcodeLabelSize(
  size: Partial<BarcodeLabelSize> | null | undefined,
): BarcodeLabelSize {
  const width = Number(size?.width);
  const height = Number(size?.height);
  const ok = barcodeLabelSizeProblem({ width, height }) === null;
  return ok ? { width, height } : { ...BARCODE_LABEL_DEFAULT };
}

export type BarcodeLabelOptions = {
  showPrice: boolean;
  showSku: boolean;
  showStoreName: boolean;
};

export const DEFAULT_LABEL_OPTIONS: BarcodeLabelOptions = {
  showPrice: true,
  showSku: true,
  showStoreName: false,
};

/** roll = גליל במדפסת תרמית (מדבקה לעמוד) · a4 = דף מדבקות במדפסת רגילה */
export type LabelLayout = "roll" | "a4";

// ------------------------------------------------------------
// התוכן של מדבקה
// ------------------------------------------------------------

export type LabelProduct = {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  price_tier1: number;
  stock_quantity: number;
  is_digital: boolean;
};

export type BarcodeLabelData = {
  name: string;
  sku: string;
  /** הערך שמקודד בברקוד */
  code: string;
  codeSource: "barcode" | "sku";
  /** "149.90 ₪" (null = בלי מחיר) */
  priceText: string | null;
  /** null = בלי שם החנות */
  storeName: string | null;
};

/** CODE128 מקודד תווי ASCII מודפסים בלבד */
const CODE128_TEXT = /^[\x20-\x7e]{1,48}$/;

/** מה מקודד בברקוד: ברקוד היצרן (אם הוזן ותקין), אחרת המק"ט */
export function labelCodeFor(product: Pick<LabelProduct, "barcode" | "sku">): {
  code: string;
  source: "barcode" | "sku";
} {
  const barcode = (product.barcode ?? "").trim();
  if (barcode !== "" && CODE128_TEXT.test(barcode)) return { code: barcode, source: "barcode" };
  return { code: product.sku.trim(), source: "sku" };
}

/** "149.90 ₪" / "150 ₪" — ובחנות שמחיריה לפני מע"מ: "+ מע״מ" */
export function formatLabelPrice(
  price: number,
  vat: { pricesIncludeVat: boolean; vatRate: number },
): string {
  const value = Math.max(0, Number.isFinite(price) ? price : 0);
  const rounded = Math.round(value * 100) / 100;
  const amount = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
  const suffix = !vat.pricesIncludeVat && vat.vatRate > 0 ? " + מע״מ" : "";
  return `${amount} ₪${suffix}`;
}

export type LabelStore = {
  name: string;
  pricesIncludeVat: boolean;
  vatRate: number;
};

/** המחיר על המדבקה — המחיר הרגיל לצרכן (דרג 1), בלי מבצעים זמניים */
export function labelDataFor(
  product: LabelProduct,
  options: BarcodeLabelOptions,
  store: LabelStore,
): BarcodeLabelData {
  const { code, source } = labelCodeFor(product);
  return {
    name: product.name.trim(),
    sku: product.sku,
    code,
    codeSource: source,
    priceText: options.showPrice ? formatLabelPrice(Number(product.price_tier1), store) : null,
    storeName: options.showStoreName && store.name.trim() !== "" ? store.name.trim() : null,
  };
}

// ------------------------------------------------------------
// כמה מדבקות
// ------------------------------------------------------------

/** one = מדבקה לכל מוצר · stock = לפי הכמות במלאי · fixed = מספר קבוע */
export type CopiesMode = "one" | "stock" | "fixed";

export const MAX_COPIES = 500;
export const MAX_LABELS_PER_RUN = 3000;

export function clampCopies(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_COPIES, Math.max(0, Math.floor(value)));
}

/** "לפי המלאי": יחידה = מדבקה; מוצר דיגיטלי / בלי מלאי — 0 (לא מודפס) */
export function copiesFor(
  product: Pick<LabelProduct, "stock_quantity" | "is_digital">,
  mode: CopiesMode,
  fixed: number,
): number {
  if (mode === "one") return 1;
  if (mode === "fixed") return Math.max(1, clampCopies(fixed));
  if (product.is_digital) return 0;
  return clampCopies(product.stock_quantity);
}

// ------------------------------------------------------------
// פריסת דף A4
// ------------------------------------------------------------

export const A4 = { width: 210, height: 297 } as const;
const A4_MARGIN = 8;
const A4_GAP = 2;

export type A4Grid = {
  columns: number;
  rows: number;
  perPage: number;
  /** שוליים מימין/משמאל (ממורכז) ומלמעלה, במ"מ */
  marginX: number;
  marginY: number;
  gap: number;
};

/** כמה מדבקות נכנסות בדף A4 לאורך (שוליים 8 מ"מ, רווח 2 מ"מ) */
export function a4Grid(size: BarcodeLabelSize): A4Grid {
  const usableWidth = A4.width - A4_MARGIN * 2;
  const usableHeight = A4.height - A4_MARGIN * 2;
  const columns = Math.max(1, Math.floor((usableWidth + A4_GAP) / (size.width + A4_GAP)));
  const rows = Math.max(1, Math.floor((usableHeight + A4_GAP) / (size.height + A4_GAP)));
  const usedWidth = columns * size.width + (columns - 1) * A4_GAP;
  return {
    columns,
    rows,
    perPage: columns * rows,
    marginX: Math.max(0, (A4.width - usedWidth) / 2),
    marginY: A4_MARGIN,
    gap: A4_GAP,
  };
}

/** המיקום (מ"מ) של המדבקה ה-index בדף */
export function a4Position(grid: A4Grid, size: BarcodeLabelSize, index: number) {
  const slot = index % grid.perPage;
  const row = Math.floor(slot / grid.columns);
  // RTL: המדבקה הראשונה בפינה הימנית העליונה
  const column = grid.columns - 1 - (slot % grid.columns);
  return {
    page: Math.floor(index / grid.perPage),
    x: grid.marginX + column * (size.width + grid.gap),
    y: grid.marginY + row * (size.height + grid.gap),
  };
}

// ------------------------------------------------------------
// הברקוד
// ------------------------------------------------------------

/** אזור שקט מכל צד של הברקוד (במודולים) — תקן CODE128: לפחות 10 */
const QUIET_MODULES = 10;

/**
 * רוחב מודול (פס צר) בפיקסלים: 0.5 מ"מ אם נכנס, אחרת 0.25 מ"מ — כפולות של
 * 0.25 מ"מ נשארות שלמות גם ב-203 DPI וגם ב-300 DPI. ברקוד ארוך מדי לרוחב
 * המדבקה — הרוחב הגדול ביותר שנכנס (dense = ייתכן שיהיה קשה לסריקה).
 */
export function barcodeModuleWidth(
  moduleCount: number,
  availablePx: number,
  dpmm: number = LABEL_DPMM,
): { px: number; dense: boolean } {
  const total = moduleCount + QUIET_MODULES * 2;
  const unit = Math.max(1, Math.round(dpmm * 0.25));
  for (const px of [unit * 2, unit]) {
    if (px * total <= availablePx) return { px, dense: false };
  }
  return { px: Math.max(1, Math.floor(availablePx / total)), dense: true };
}

/** האם הקוד נכנס במדבקה בצפיפות תקינה (לאזהרה בממשק) */
export async function barcodeFits(code: string, size: BarcodeLabelSize): Promise<boolean> {
  const modules = await barcodeModules(code);
  if (!modules) return false;
  const pad = labelPaddingMm(size);
  return !barcodeModuleWidth(modules.length, (size.width - pad * 2) * LABEL_DPMM).dense;
}

function labelPaddingMm(size: BarcodeLabelSize): number {
  return Math.min(3, Math.max(1.5, Math.min(size.width, size.height) * 0.05));
}

// ------------------------------------------------------------
// הציור (דפדפן)
// ------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };

const INK = "#000000";
const PAPER = "#ffffff";

/**
 * מדבקה אחת. הגובה מחולק ל"משקלות" (כמו מדבקת המשלוח): שם החנות (אופציונלי),
 * שם המוצר (עד 2 שורות), מחיר + מק"ט, הברקוד והקוד מתחתיו. במדבקה נמוכה
 * מאוד (פחות מ-28 מ"מ) — השם בשורה אחת ובלי שם החנות.
 */
export async function renderBarcodeLabelCanvas(
  data: BarcodeLabelData,
  sizeMm: BarcodeLabelSize,
  options: BarcodeLabelOptions,
  dpmm: number = LABEL_DPMM,
): Promise<HTMLCanvasElement> {
  await ensureFonts();
  const size = normalizeBarcodeLabelSize(sizeMm);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(size.width * dpmm);
  canvas.height = Math.round(size.height * dpmm);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("הדפדפן לא תומך בציור מדבקות");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const mm = (value: number) => value * dpmm;
  const pad = mm(labelPaddingMm(size));
  const left = pad;
  const width = canvas.width - pad * 2;
  const low = size.height < 28;
  const modules = await barcodeModules(data.code);

  type Block = { weight: number; draw: (box: Box) => void };
  const blocks: Block[] = [];

  if (data.storeName && !low) {
    blocks.push({
      weight: 0.7,
      draw: (box) => drawTextBox(ctx, data.storeName ?? "", box, { weight: 500, align: "center" }),
    });
  }
  blocks.push({
    weight: low ? 1.25 : 1.9,
    draw: (box) =>
      drawTextBox(ctx, data.name, box, { weight: 700, maxLines: low ? 1 : 2, minRatio: 0.72 }),
  });

  const skuText = options.showSku ? `מק״ט ${data.sku}` : null;
  if (data.priceText || skuText) {
    blocks.push({
      weight: low ? 1.15 : 1.45,
      draw: (box) => {
        if (data.priceText && skuText) {
          const priceWidth = box.width * 0.55;
          // מחיר בצד ימין (תחילת השורה בעברית), מק"ט משמאל
          drawTextBox(
            ctx,
            data.priceText,
            { ...box, x: box.x + box.width - priceWidth, width: priceWidth },
            { weight: 800, dir: "ltr", align: "right" },
          );
          drawTextBox(
            ctx,
            skuText,
            {
              x: box.x,
              y: box.y + box.height * 0.18,
              width: box.width - priceWidth - mm(1),
              height: box.height * 0.64,
            },
            { weight: 500, align: "left" },
          );
        } else if (data.priceText) {
          drawTextBox(ctx, data.priceText, box, { weight: 800, dir: "ltr", align: "right" });
        } else if (skuText) {
          drawTextBox(ctx, skuText, box, { weight: 500 });
        }
      },
    });
  }

  if (modules) {
    blocks.push({
      weight: low ? 2.3 : 2.7,
      draw: (box) => {
        const { px } = barcodeModuleWidth(modules.length, box.width, dpmm);
        const barcodeWidth = modules.length * px;
        let x = Math.round(box.x + (box.width - barcodeWidth) / 2);
        const top = Math.round(box.y);
        const height = Math.round(box.height);
        ctx.fillStyle = INK;
        for (const bit of modules) {
          if (bit === "1") ctx.fillRect(x, top, px, height);
          x += px;
        }
      },
    });
    blocks.push({
      weight: 0.72,
      draw: (box) =>
        // הקוד ממורכז מתחת לברקוד (LTR) — למקרה שהסורק לא קורא
        drawTextBox(ctx, data.code, box, { weight: 500, dir: "ltr", align: "center" }),
    });
  }

  const totalWeight = blocks.reduce((sum, block) => sum + block.weight, 0);
  const gap = mm(low ? 0.3 : 0.5);
  const height = canvas.height - pad * 2;
  const unit = (height - gap * (blocks.length - 1)) / totalWeight;
  let y = pad;
  for (const block of blocks) {
    const blockHeight = unit * block.weight;
    block.draw({ x: left, y, width, height: blockHeight });
    y += blockHeight + gap;
  }
  return canvas;
}

export type LabelJob = {
  /** מזהה (המוצר) — לשמירת התמונה פעם אחת לכל המוצר */
  key: string;
  data: BarcodeLabelData;
  copies: number;
};

export function totalLabels(jobs: readonly LabelJob[]): number {
  return jobs.reduce((sum, job) => sum + Math.max(0, job.copies), 0);
}

/** תמונה (PNG) אחת לכל מוצר — לתצוגת ההדפסה; את הכתובות משחררים בסגירה */
export async function renderLabelImages(
  jobs: readonly LabelJob[],
  size: BarcodeLabelSize,
  options: BarcodeLabelOptions,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean,
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  let done = 0;
  for (const job of jobs) {
    if (isCancelled?.()) break;
    if (!urls.has(job.key)) {
      const canvas = await renderBarcodeLabelCanvas(job.data, size, options);
      const blob = await canvasToBlob(canvas);
      urls.set(job.key, URL.createObjectURL(blob));
    }
    done += 1;
    onProgress?.(done, jobs.length);
  }
  return urls;
}

/**
 * PDF: גליל — עמוד לכל מדבקה בגודל המדויק (להדפסה ישירה ב-Zebra);
 * A4 — רשת מדבקות בעמוד. כל מוצר מצויר פעם אחת, והעותקים חוזרים על אותה
 * תמונה (alias) — הקובץ נשאר קטן גם עם מאות מדבקות.
 */
export async function renderBarcodeLabelsPdf(
  jobs: readonly LabelJob[],
  sizeMm: BarcodeLabelSize,
  layout: LabelLayout,
  options: BarcodeLabelOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const total = totalLabels(jobs);
  if (total === 0) throw new Error("לא נבחרו מוצרים להדפסה");
  const size = normalizeBarcodeLabelSize(sizeMm);
  const { jsPDF } = await import("jspdf");
  const orientation = size.width > size.height ? "landscape" : "portrait";
  const pdf =
    layout === "roll"
      ? new jsPDF({ unit: "mm", format: [size.width, size.height], orientation, compress: true })
      : new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  const grid = a4Grid(size);
  let index = 0;
  let rendered = 0;
  for (const job of jobs) {
    if (job.copies <= 0) continue;
    const canvas = await renderBarcodeLabelCanvas(job.data, size, options);
    const alias = `label-${job.key}`;
    for (let copy = 0; copy < job.copies; copy += 1) {
      if (layout === "roll") {
        if (index > 0) pdf.addPage([size.width, size.height], orientation);
        pdf.addImage(canvas, "PNG", 0, 0, size.width, size.height, alias, "FAST");
      } else {
        const position = a4Position(grid, size, index);
        if (index > 0 && position.page > a4Position(grid, size, index - 1).page)
          pdf.addPage("a4", "portrait");
        pdf.addImage(canvas, "PNG", position.x, position.y, size.width, size.height, alias, "FAST");
      }
      index += 1;
    }
    rendered += 1;
    onProgress?.(rendered, jobs.length);
  }
  return pdf.output("blob");
}
