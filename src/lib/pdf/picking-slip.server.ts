/**
 * בון ליקוט למחסן — מסמך A4 מלא, באותה שפה חזותית של מסמך ההזמנה
 * (לוגו, כותרת, טבלה עם פסים לסירוגין ומעבר עמוד אוטומטי).
 * עמודת "איתור" בולטת כי זה הייעוד המרכזי של המסמך; בלי מחירים — זה
 * מסמך מחסן, לא מסמך ללקוח.
 */

import { jsPDF } from "jspdf";
import { toVisualRtl } from "./rtl";
import { DEFAULT_STORE_NAME } from "@/lib/branding";

export type PickingItem = {
  name: string;
  barcode: string | null;
  sku: string | null;
  shelfLocation: string | null;
  quantity: number;
  /** גודל המארז ברגע ההזמנה — מוצג "2 מארזים" מתחת לכמות */
  packSize?: number | null;
};

export type PickingSlipData = {
  orderNumber: string;
  createdAt: string;
  kindLabel: string;
  /** שם העסק שלנו (המוכר) — מוצג בכותרת עם הלוגו */
  sellerName: string;
  /** שם העסק של הלקוח שההזמנה עבורו */
  customerBusinessName: string;
  contactName: string;
  phone: string;
  agentNumber: string | null;
  note: string | null;
  items: PickingItem[];
  /** לוגו העסק כ-data URL (PNG/JPEG בלבד) — אותו מנגנון כמו מסמך ההזמנה */
  logoDataUrl: string | null;
};

const INK = "#12211F";
const BRASS = "#9C6F22";
const MUTED = "#6B7570";
const HAIRLINE = "#DCE1DC";
const SOFT = "#F2F5F2";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const RIGHT = PAGE_WIDTH - MARGIN;
const LEFT = MARGIN;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function formatDate(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function imageFormat(dataUrl: string): "PNG" | "JPEG" | null {
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  if (dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")) return "JPEG";
  return null;
}

export async function buildPickingSlipPdf(
  data: PickingSlipData,
): Promise<{ base64: string; filename: string }> {
  const [{ HEEBO_REGULAR_BASE64 }, { HEEBO_BOLD_BASE64 }] = await Promise.all([
    import("./heebo-regular"),
    import("./heebo-bold"),
  ]);

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.addFileToVFS("Heebo-Regular.ttf", HEEBO_REGULAR_BASE64);
  doc.addFont("Heebo-Regular.ttf", "Heebo", "normal");
  doc.addFileToVFS("Heebo-Bold.ttf", HEEBO_BOLD_BASE64);
  doc.addFont("Heebo-Bold.ttf", "Heebo", "bold");
  doc.setFont("Heebo", "normal");

  const write = (
    text: string,
    x: number,
    y: number,
    options: {
      size?: number;
      bold?: boolean;
      align?: "right" | "left" | "center";
      color?: string;
    } = {},
  ) => {
    doc.setFont("Heebo", options.bold ? "bold" : "normal");
    doc.setFontSize(options.size ?? 10);
    doc.setTextColor(options.color ?? INK);
    doc.text(toVisualRtl(text), x, y, {
      align: options.align ?? "right",
      isInputVisual: true,
      isOutputVisual: true,
    });
  };

  const wrapped = (text: string, width: number, size: number): string[] => {
    doc.setFontSize(size);
    return doc.splitTextToSize(text, width) as string[];
  };

  // ---------- כותרת: לוגו + שם העסק מימין, תיבת "בון ליקוט" משמאל ----------
  let y = MARGIN + 4;
  const headerTop = y;

  let businessTextTop = y;
  if (data.logoDataUrl) {
    const format = imageFormat(data.logoDataUrl);
    if (format) {
      try {
        const props = doc.getImageProperties(data.logoDataUrl);
        const maxWidth = 38;
        const maxHeight = 16;
        const ratio = Math.min(maxWidth / props.width, maxHeight / props.height);
        const width = props.width * ratio;
        const height = props.height * ratio;
        doc.addImage(data.logoDataUrl, format, RIGHT - width, y - 4, width, height);
        businessTextTop = y + height;
      } catch {
        // לוגו פגום לא יעצור את הפקת המסמך
      }
    }
  }

  y = businessTextTop + 2;
  write(data.sellerName || DEFAULT_STORE_NAME, RIGHT, y, { size: 15, bold: true });
  y += 6;

  const boxWidth = 62;
  const boxHeight = 26;
  doc.setFillColor(INK);
  doc.roundedRect(LEFT, headerTop - 4, boxWidth, boxHeight, 2, 2, "F");
  write("בון ליקוט", LEFT + boxWidth - 5, headerTop + 3, {
    size: 13,
    bold: true,
    color: "#FFFFFF",
  });
  write(data.orderNumber, LEFT + boxWidth - 5, headerTop + 9.5, { size: 10, color: "#C9D6CF" });
  write(formatDate(data.createdAt), LEFT + boxWidth - 5, headerTop + 15.5, {
    size: 9,
    color: "#C9D6CF",
  });
  write(data.kindLabel, LEFT + boxWidth - 5, headerTop + 20.5, { size: 9, color: "#C9D6CF" });

  y = Math.max(y + 2, headerTop + boxHeight + 4);
  doc.setDrawColor(BRASS);
  doc.setLineWidth(0.6);
  doc.line(LEFT, y, RIGHT, y);
  y += 8;

  // ---------- פרטי לקוח וסוכן ----------
  const customerLines: [string, string][] = (
    [
      ["לקוח", data.customerBusinessName],
      ["איש קשר", data.contactName],
      ["טלפון", data.phone],
      ["סוכן", data.agentNumber ?? ""],
    ] as [string, string][]
  ).filter((entry) => entry[1].trim() !== "");

  if (customerLines.length > 0) {
    const rows = Math.ceil(customerLines.length / 2);
    const blockHeight = rows * 5.6 + 8;
    doc.setFillColor(SOFT);
    doc.setDrawColor(HAIRLINE);
    doc.setLineWidth(0.2);
    doc.roundedRect(LEFT, y, CONTENT_WIDTH, blockHeight, 2, 2, "FD");
    const columnWidth = (CONTENT_WIDTH - 12) / 2;
    customerLines.forEach(([label, value], index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = RIGHT - 4 - column * (columnWidth + 4);
      write(`${label}: ${value}`, x, y + 6.5 + row * 5.6, { size: 9.5, bold: true, color: INK });
    });
    y += blockHeight + 8;
  }

  // ---------- טבלת הליקוט: #, פריט, מק"ט/ברקוד, איתור, כמות ----------
  const columns = [
    { key: "index", label: "#", width: 8 },
    { key: "name", label: "פריט", width: 78 },
    { key: "sku", label: 'מק"ט / ברקוד', width: 34 },
    { key: "location", label: "איתור", width: 26 },
    { key: "quantity", label: "כמות", width: 26 },
  ];

  const columnRight: number[] = [];
  let cursor = RIGHT;
  for (const column of columns) {
    columnRight.push(cursor);
    cursor -= column.width;
  }

  const drawTableHeader = (top: number): number => {
    doc.setFillColor(INK);
    doc.rect(LEFT, top, CONTENT_WIDTH, 9, "F");
    columns.forEach((column, index) => {
      write(column.label, columnRight[index]! - 2, top + 6, {
        size: 9.5,
        bold: true,
        color: "#FFFFFF",
      });
    });
    return top + 9;
  };

  const footerReserve = 26;
  y = drawTableHeader(y);

  const nameWidth = columns[1]!.width - 4;
  let zebra = false;

  for (const [index, item] of data.items.entries()) {
    const nameLines = wrapped(item.name, nameWidth, 10);
    const rowHeight = Math.max(11, nameLines.length * 4.6 + 5.5);

    if (y + rowHeight > PAGE_HEIGHT - footerReserve) {
      doc.addPage();
      y = MARGIN + 4;
      y = drawTableHeader(y);
      zebra = false;
    }

    if (zebra) {
      doc.setFillColor(SOFT);
      doc.rect(LEFT, y, CONTENT_WIDTH, rowHeight, "F");
    }
    zebra = !zebra;
    doc.setDrawColor(HAIRLINE);
    doc.setLineWidth(0.15);
    doc.line(LEFT, y + rowHeight, RIGHT, y + rowHeight);

    const baseline = y + 6;
    write(String(index + 1), columnRight[0]! - 2, baseline, { size: 9, color: MUTED });
    nameLines.forEach((line, lineIndex) => {
      write(line, columnRight[1]! - 2, baseline + lineIndex * 4.6, { size: 10, bold: true });
    });
    const skuBarcode = [item.sku, item.barcode].filter((v) => v).join(" · ") || "—";
    write(skuBarcode, columnRight[2]! - 2, baseline, { size: 8.5, color: MUTED });
    // "איתור" הוא הייעוד המרכזי של המסמך — בולט ומודגש, עם ברירת מחדל
    // A0A כשלא הוגדר איתור למוצר (במקום להשאיר תא ריק ומבלבל)
    write(item.shelfLocation || "A0A", columnRight[3]! - 2, baseline, {
      size: 11,
      bold: true,
      color: BRASS,
    });
    write(`× ${item.quantity}`, columnRight[4]! - 2, baseline, { size: 11, bold: true });
    // מוצר שנמכר במארזים: המחסנאי מרים קרטונים — מציגים גם כמה מארזים
    if (item.packSize && item.packSize >= 2 && item.quantity % item.packSize === 0) {
      const packs = item.quantity / item.packSize;
      write(packs === 1 ? "מארז 1" : `${packs} מארזים`, columnRight[4]! - 2, baseline + 4.6, {
        size: 8.5,
        color: MUTED,
      });
    }

    y += rowHeight;
  }

  y += 6;
  const units = data.items.reduce((sum, item) => sum + item.quantity, 0);
  write(`${data.items.length} שורות · ${units} יחידות`, RIGHT, y, { size: 10, bold: true });
  y += 6;

  if (data.note && data.note.trim() !== "") {
    const noteLines = wrapped(`הערות: ${data.note.trim()}`, CONTENT_WIDTH, 9);
    for (const line of noteLines) {
      write(line, RIGHT, y, { size: 9, color: MUTED });
      y += 4.4;
    }
  }

  const base64 = doc.output("datauristring").split(",")[1] ?? "";
  return { base64, filename: `picking-${data.orderNumber}.pdf` };
}
