/**
 * מדבקות משלוח — מצוירות בדפדפן על canvas, בגודל שהוגדר בהגדרות החנות
 * (site_settings.label_width_mm × label_height_mm), למדפסות תרמיות כמו Zebra.
 *
 * - הפריסה דינמית: כל אזור (שם, כתובת, טלפון, ברקוד) מקבל חלק יחסי מהגובה,
 *   והגופן מוקטן אוטומטית עד שהטקסט נכנס ברוחב. כך אותה מדבקה נראית טוב
 *   גם ב-70×50 וגם ב-100×150.
 * - שחור-לבן בלבד (בלי גווני אפור) — מדפסת תרמית לא מדפיסה אפור.
 * - עברית נכתבת בכיוון RTL; מספר ההזמנה והטלפון — LTR.
 * - ברקוד CODE128 של מספר ההזמנה (jsbarcode במצב אובייקט — בלי DOM).
 * - PDF: עמוד אחד לכל מדבקה בגודל המדבקה המדויק (jsPDF).
 * - תמונה (PNG): לשיתוף מהיר בוואטסאפ לשליח.
 *
 * צד לקוח בלבד.
 */

import { deliveryOf, formatPhone, type ProfileContact } from "@/lib/order-details";
import type { OrderRow } from "@/lib/orders";
import { DEFAULT_LABEL_SIZE } from "@/lib/site";

export type LabelSize = { width: number; height: number };

export type LabelData = {
  orderNumber: string;
  recipientName: string;
  phone: string;
  street: string;
  /** עיר + מיקוד */
  cityLine: string;
  note: string | null;
  storeName: string;
  storePhone: string | null;
  /** "3 פריטים · 12 יח׳" */
  itemsSummary: string;
  /** ניסיון מסירה (1 = ראשון). מוצג רק מהניסיון השני */
  attempt: number;
};

/** רזולוציה: 12 פיקסלים למ"מ ≈ 300 DPI — חד גם במדפסת 203/300 DPI */
export const LABEL_DPMM = 12;

const INK = "#000000";
const PAPER = "#ffffff";

function fontFamily(): string {
  if (typeof document === "undefined") return "Heebo, Arial, sans-serif";
  const family = getComputedStyle(document.body).fontFamily;
  return family && family.trim() !== "" ? family : "Heebo, Arial, sans-serif";
}

/** הגופן של האתר (Heebo) חייב להיטען לפני הציור — אחרת canvas נופל ל-Arial */
async function ensureFonts(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  try {
    await Promise.all([
      document.fonts.load(`700 20px ${fontFamily()}`),
      document.fonts.load(`400 20px ${fontFamily()}`),
    ]);
    await document.fonts.ready;
  } catch {
    // גופן גיבוי — עדיין קריא
  }
}

/** מידות תקינות (כמו ה-CHECK במסד) */
export function normalizeLabelSize(size: Partial<LabelSize> | null | undefined): LabelSize {
  const width = Number(size?.width);
  const height = Number(size?.height);
  return {
    width: Number.isFinite(width) && width >= 30 && width <= 200 ? width : DEFAULT_LABEL_SIZE.width,
    height:
      Number.isFinite(height) && height >= 20 && height <= 300 ? height : DEFAULT_LABEL_SIZE.height,
  };
}

/** פרטי המדבקה מהזמנה (כתובת המשלוח בפועל — חלופית אם נבחרה בקופה) */
export function labelDataFromOrder(
  order: OrderRow,
  profile: ProfileContact | null,
  store: { name: string; phone: string | null },
): LabelData {
  const delivery = deliveryOf(order, profile);
  let street: string | null | undefined;
  let city: string | null | undefined;
  let zip: string | null | undefined;
  if (order.ship_to_different) {
    street = order.shipping_address;
    city = order.shipping_city;
    zip = order.shipping_zip;
  } else if (order.billing_address || order.billing_city) {
    street = order.billing_address;
    city = order.billing_city;
    zip = order.billing_zip;
  } else {
    street = profile?.business_address;
    city = profile?.city;
    zip = profile?.zip_code;
  }
  const products = order.order_items.filter((item) => !item.is_deposit);
  const units = products.reduce((sum, item) => sum + item.quantity, 0);
  return {
    orderNumber: order.order_number,
    recipientName: delivery.name || "—",
    phone: delivery.phone,
    street: street?.trim() ?? "",
    cityLine: [city?.trim(), zip?.trim()].filter(Boolean).join(" "),
    note: order.note?.trim() || null,
    storeName: store.name,
    storePhone: store.phone ? formatPhone(store.phone) : null,
    itemsSummary: `${products.length} פריטים · ${units} יח׳`,
    attempt: (order.delivery_attempts ?? 0) + 1,
  };
}

/** נתוני דוגמה — לתצוגה המקדימה בהגדרות */
export const SAMPLE_LABEL: LabelData = {
  orderNumber: "SH260000123",
  recipientName: "ישראל ישראלי",
  phone: "050-123-4567",
  street: "הרצל 12 דירה 4",
  cityLine: "תל אביב 6100001",
  note: "להשאיר אצל השכן בקומה 2",
  storeName: "החנות שלי",
  storePhone: "03-123-4567",
  itemsSummary: "3 פריטים · 12 יח׳",
  attempt: 1,
};

type Ctx = CanvasRenderingContext2D;

function setFont(ctx: Ctx, weight: number, px: number): void {
  ctx.font = `${weight} ${Math.max(1, Math.round(px))}px ${fontFamily()}`;
}

/** הגופן הגדול ביותר (עד max) שבו הטקסט נכנס ברוחב */
function fitFont(ctx: Ctx, text: string, weight: number, maxPx: number, width: number): number {
  let px = maxPx;
  setFont(ctx, weight, px);
  const measured = ctx.measureText(text).width;
  if (measured > width) px = Math.max(1, Math.floor(px * (width / measured)));
  setFont(ctx, weight, px);
  return px;
}

/** חלוקה לשורות לפי רוחב; השורה האחרונה מקוצרת עם "…" */
function wrapLines(ctx: Ctx, text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= width || line === "") {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`;
  while (last.length > 1 && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

/**
 * טקסט בתוך תיבה: קודם מנסים שורה אחת בגופן המלא; אם לא נכנס — מקטינים
 * עד minRatio, ומשם עוברים לשתי שורות (אם מותר).
 */
function drawTextBox(
  ctx: Ctx,
  text: string,
  box: { x: number; y: number; width: number; height: number },
  options: {
    weight: number;
    maxLines?: number;
    dir?: "rtl" | "ltr";
    minRatio?: number;
    /** ברירת מחדל: ימין לעברית, שמאל ל-LTR */
    align?: "right" | "left" | "center";
  },
): void {
  if (!text) return;
  const maxLines = options.maxLines ?? 1;
  const minRatio = options.minRatio ?? 0.62;
  const fullPx = box.height * 0.78;
  ctx.direction = options.dir ?? "rtl";
  const align = options.align ?? (options.dir === "ltr" ? "left" : "right");
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = INK;
  const x =
    align === "center" ? box.x + box.width / 2 : align === "left" ? box.x : box.x + box.width;

  const px = fitFont(ctx, text, options.weight, fullPx, box.width);
  if (px >= fullPx * minRatio || maxLines === 1) {
    ctx.fillText(text, x, box.y + box.height / 2);
    return;
  }
  const linePx = (box.height / maxLines) * 0.8;
  setFont(ctx, options.weight, linePx);
  const lines = wrapLines(ctx, text, box.width, maxLines);
  const lineHeight = box.height / lines.length;
  // שורות שעדיין רחבות מדי (מילה ארוכה אחת) — מוקטנות כל אחת לחוד
  lines.forEach((line, index) => {
    fitFont(ctx, line, options.weight, Math.min(linePx, lineHeight * 0.8), box.width);
    ctx.fillText(line, x, box.y + lineHeight * index + lineHeight / 2);
  });
}

/** ברקוד CODE128 — רשימת 0/1 של מודולים (jsbarcode במצב אובייקט) */
async function barcodeModules(value: string): Promise<string | null> {
  try {
    const { default: JsBarcode } = await import("jsbarcode");
    const target: { encodings?: { data: string }[] } = {};
    JsBarcode(target, value, { format: "CODE128" });
    return target.encodings?.map((encoding) => encoding.data).join("") ?? null;
  } catch {
    return null;
  }
}

function drawBarcode(
  ctx: Ctx,
  modules: string,
  box: { x: number; y: number; width: number; height: number },
): void {
  // רוחב מודול בפיקסלים שלמים — קווים חדים במדפסת; 10 מודולים "שקט" מכל צד
  const total = modules.length + 20;
  const moduleWidth = Math.max(1, Math.floor(box.width / total));
  const barcodeWidth = modules.length * moduleWidth;
  let x = Math.round(box.x + (box.width - barcodeWidth) / 2);
  ctx.fillStyle = INK;
  for (const bit of modules) {
    if (bit === "1") ctx.fillRect(x, Math.round(box.y), moduleWidth, Math.round(box.height));
    x += moduleWidth;
  }
}

/** קו מפריד */
function rule(ctx: Ctx, x: number, y: number, width: number, thickness: number): void {
  ctx.fillStyle = INK;
  ctx.fillRect(x, Math.round(y), width, Math.max(1, Math.round(thickness)));
}

/**
 * ציור מדבקה אחת. הגובה מחולק ל"משקלות" — כל אזור מקבל חלק יחסי, ואזורים
 * אופציונליים (הערה, ברקוד) נופלים במדבקות נמוכות מאוד.
 */
export async function renderLabelCanvas(
  data: LabelData,
  sizeMm: LabelSize,
  dpmm: number = LABEL_DPMM,
): Promise<HTMLCanvasElement> {
  await ensureFonts();
  const size = normalizeLabelSize(sizeMm);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(size.width * dpmm);
  canvas.height = Math.round(size.height * dpmm);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("הדפדפן לא תומך בציור מדבקות");

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const mm = (value: number) => value * dpmm;
  const pad = mm(Math.min(4, Math.max(1.5, Math.min(size.width, size.height) * 0.05)));
  const left = pad;
  const width = canvas.width - pad * 2;
  const top = pad;
  const height = canvas.height - pad * 2;

  const showBarcode = size.height >= 28;
  const modules = showBarcode ? await barcodeModules(data.orderNumber) : null;
  const showNote = Boolean(data.note) && size.height >= 40;
  const showAttempt = data.attempt > 1;
  // מדבקה "גבוהה" (לאורך) — שם וכתובת בשתי שורות אם צריך
  const tall = size.height >= size.width * 1.15;

  type Block = {
    weight: number;
    draw: (box: { x: number; y: number; width: number; height: number }) => void;
  };
  const blocks: Block[] = [
    {
      // שורת כותרת: שם החנות (ימין) · מספר ההזמנה (שמאל)
      weight: 1,
      draw: (box) => {
        const half = box.width * 0.52;
        drawTextBox(
          ctx,
          data.storeName,
          { ...box, x: box.x + box.width - half, width: half },
          {
            weight: 700,
          },
        );
        drawTextBox(
          ctx,
          data.orderNumber,
          { ...box, width: box.width - half - mm(1) },
          { weight: 700, dir: "ltr" },
        );
        rule(ctx, box.x, box.y + box.height + mm(0.4), box.width, mm(0.35));
      },
    },
    {
      weight: 0.75,
      draw: (box) =>
        drawTextBox(ctx, showAttempt ? `נמען · ניסיון מסירה ${data.attempt}` : "נמען", box, {
          weight: showAttempt ? 700 : 400,
        }),
    },
    {
      weight: tall ? 2.2 : 1.6,
      draw: (box) =>
        drawTextBox(ctx, data.recipientName, box, { weight: 800, maxLines: tall ? 2 : 1 }),
    },
    {
      weight: tall ? 2.2 : 1.3,
      draw: (box) => drawTextBox(ctx, data.street || "—", box, { weight: 600, maxLines: 2 }),
    },
    {
      weight: 1.3,
      draw: (box) => drawTextBox(ctx, data.cityLine, box, { weight: 800 }),
    },
    {
      weight: 1.3,
      draw: (box) =>
        // טלפון: ספרות LTR, מיושר לימין כמו שאר המדבקה
        drawTextBox(ctx, data.phone, box, { weight: 800, dir: "ltr", align: "right" }),
    },
  ];
  if (showNote && data.note) {
    blocks.push({
      weight: tall ? 1.6 : 1,
      draw: (box) =>
        drawTextBox(ctx, `הערה: ${data.note}`, box, { weight: 400, maxLines: 2, minRatio: 0.9 }),
    });
  }
  blocks.push({
    weight: 0.8,
    draw: (box) => {
      rule(ctx, box.x, box.y - mm(0.2), box.width, mm(0.25));
      const summary = [data.itemsSummary, data.storePhone ? `שירות: ${data.storePhone}` : ""]
        .filter(Boolean)
        .join(" · ");
      drawTextBox(ctx, summary, box, { weight: 400 });
    },
  });
  if (modules) {
    blocks.push({
      weight: tall ? 3 : 2.4,
      draw: (box) => {
        const textHeight = box.height * 0.26;
        drawBarcode(ctx, modules, {
          x: box.x,
          y: box.y + box.height * 0.04,
          width: box.width,
          height: box.height - textHeight - box.height * 0.04,
        });
        drawTextBox(
          ctx,
          data.orderNumber,
          { x: box.x, y: box.y + box.height - textHeight, width: box.width, height: textHeight },
          // מספר ההזמנה ממורכז מתחת לברקוד
          { weight: 600, dir: "ltr", align: "center" },
        );
      },
    });
  }

  const totalWeight = blocks.reduce((sum, block) => sum + block.weight, 0);
  const gap = mm(0.5);
  const unit = (height - gap * (blocks.length - 1)) / totalWeight;
  let y = top;
  for (const block of blocks) {
    const blockHeight = unit * block.weight;
    block.draw({ x: left, y, width, height: blockHeight });
    y += blockHeight + gap;
  }

  // מסגרת דקה — עוזרת ליישר בהדבקה (וגם מראה את גבולות המדבקה בתצוגה)
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, mm(0.2));
  ctx.strokeRect(mm(0.6), mm(0.6), canvas.width - mm(1.2), canvas.height - mm(1.2));
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("יצירת התמונה נכשלה"))),
      "image/png",
    ),
  );
}

/** תמונת PNG של מדבקה אחת */
export async function renderLabelPng(data: LabelData, size: LabelSize): Promise<File> {
  const canvas = await renderLabelCanvas(data, size);
  const blob = await canvasToBlob(canvas);
  return new File([blob], `label-${data.orderNumber}.png`, { type: "image/png" });
}

/** PDF עם עמוד אחד לכל מדבקה, בגודל המדבקה המדויק (להדפסה ישירה ב-Zebra) */
export async function renderLabelsPdf(labels: LabelData[], sizeMm: LabelSize): Promise<Blob> {
  if (labels.length === 0) throw new Error("לא נבחרו הזמנות");
  const size = normalizeLabelSize(sizeMm);
  const { jsPDF } = await import("jspdf");
  const orientation = size.width > size.height ? "landscape" : "portrait";
  // compress + FAST: תמונה שחור-לבן נדחסת לעשרות KB למדבקה (בלי זה — מגה לכל אחת)
  const pdf = new jsPDF({
    unit: "mm",
    format: [size.width, size.height],
    orientation,
    compress: true,
  });
  for (const [index, label] of labels.entries()) {
    if (index > 0) pdf.addPage([size.width, size.height], orientation);
    const canvas = await renderLabelCanvas(label, size);
    pdf.addImage(canvas, "PNG", 0, 0, size.width, size.height, undefined, "FAST");
  }
  return pdf.output("blob");
}

/** הורדת קובץ מהדפדפן */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** טלפון ישראלי לפורמט וואטסאפ (972...) — null אם לא נראה כמו טלפון */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/[^0-9+]/g, "");
  if (/^\+?972\d{8,9}$/.test(digits)) return digits.replace(/^\+/, "");
  if (/^0\d{8,9}$/.test(digits)) return `972${digits.slice(1)}`;
  if (/^\+\d{9,15}$/.test(digits)) return digits.slice(1);
  return null;
}

/** קישור wa.me — לשליח מסוים (אם יש טלפון) או לבחירת איש קשר */
export function whatsappLink(text: string, phone?: string | null): string {
  const number = whatsappNumber(phone);
  return `https://wa.me/${number ?? ""}?text=${encodeURIComponent(text)}`;
}

/** הודעת וואטסאפ לשליח: פרטי המשלוח + הקישור לעדכון מסירה */
export function courierMessage(label: LabelData, courierUrl: string | null): string {
  return [
    `📦 משלוח ${label.orderNumber}${label.attempt > 1 ? ` (ניסיון ${label.attempt})` : ""}`,
    `${label.recipientName}${label.phone ? ` · ${label.phone}` : ""}`,
    [label.street, label.cityLine].filter(Boolean).join(", "),
    label.note ? `הערה: ${label.note}` : "",
    courierUrl ? `\nעדכון מסירה (נמסר / לא נמסר):\n${courierUrl}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * שיתוף מדבקה לשליח: במובייל — שיתוף התמונה עצמה (Web Share, בוחרים
 * וואטסאפ); במחשב — הורדת התמונה ופתיחת וואטסאפ עם הטקסט והקישור.
 * מחזיר "shared" / "whatsapp" לפי מה שקרה.
 */
export async function shareLabelToCourier(
  label: LabelData,
  size: LabelSize,
  courierUrl: string | null,
  courierPhone?: string | null,
): Promise<"shared" | "whatsapp"> {
  const file = await renderLabelPng(label, size);
  const text = courierMessage(label, courierUrl);
  const nav = typeof navigator !== "undefined" ? navigator : null;
  if (nav?.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text, title: `משלוח ${label.orderNumber}` });
      return "shared";
    } catch (error) {
      // המשתמש סגר את חלון השיתוף — לא נופלים לוואטסאפ
      if (error instanceof DOMException && error.name === "AbortError") return "shared";
    }
  }
  downloadBlob(file, file.name);
  window.open(whatsappLink(text, courierPhone), "_blank", "noopener");
  return "whatsapp";
}

export function courierUrlFor(token: string): string {
  return `${window.location.origin}/courier/${token}`;
}
