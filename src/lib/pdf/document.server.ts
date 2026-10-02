/**
 * הפקת מסמך PDF להזמנה או לבקשת הצעת מחיר.
 *
 * רץ בצד השרת בלבד (נקרא מ-server functions), משתמש ב-jsPDF עם גופן Heebo
 * מוטמע כדי לתמוך בעברית, ובממיר ה-RTL שלנו כדי להדפיס בסדר ויזואלי נכון.
 */

import { jsPDF } from "jspdf";
import { toVisualRtl } from "./rtl";
import type { VatBreakdown } from "@/lib/vat";
import { ORDER_HOURS } from "@/lib/order-hours";
import { formatUnitIls } from "@/lib/catalog";
import { DEFAULT_STORE_NAME } from "@/lib/branding";

export type DocumentBusiness = {
  name: string;
  taxId: string;
  address: string;
  phone: string;
  supportPhone: string;
  email: string;
  /** תמונת לוגו כ-data URL (PNG/JPEG בלבד) */
  logoDataUrl: string | null;
};

export type DocumentCustomer = {
  businessName: string;
  taxId: string;
  address: string;
  contactName: string;
  phone: string;
  email: string;
};

export type DocumentItem = {
  name: string;
  barcode: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: number;
};

export type DocumentData = {
  kind: "order" | "quote";
  orderNumber: string;
  createdAt: string;
  statusLabel: string;
  business: DocumentBusiness;
  customer: DocumentCustomer;
  agentNumber: string | null;
  /** שם הסוכן בעברית, כפי שהלקוח רואה אותו */
  agentName: string | null;
  items: DocumentItem[];
  /** null בבקשת הצעת מחיר — במסמך כזה אין מחירים כלל */
  vat: VatBreakdown | null;
  note: string | null;
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

function formatMoney(value: number): string {
  return `₪${value.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** זיהוי פורמט תמונה לפי החתימה בתחילת ה-data URL (jsPDF תומך ב-PNG/JPEG) */
function imageFormat(dataUrl: string): "PNG" | "JPEG" | null {
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  if (dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")) return "JPEG";
  return null;
}

export async function buildOrderDocumentPdf(
  data: DocumentData,
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

  const isQuote = data.kind === "quote";
  const showPrices = !isQuote && data.vat !== null;

  /** כתיבת טקסט לוגי — ההמרה לסדר ויזואלי נעשית כאן, במקום אחד */
  const write = (
    text: string,
    x: number,
    y: number,
    options: {
      size?: number;
      bold?: boolean;
      color?: string;
      align?: "right" | "left" | "center";
    } = {},
  ) => {
    doc.setFont("Heebo", options.bold ? "bold" : "normal");
    doc.setFontSize(options.size ?? 10);
    doc.setTextColor(options.color ?? INK);
    // ל-jsPDF יש מנוע דו-כיווני פנימי שמסדר מחדש מחרוזות שמכילות עברית —
    // הוא היה הופך שוב את הספרות (טלפונים, ח.פ, אחוזי מע"מ). הסימון הזה
    // אומר לו שהקלט *כבר* בסדר ויזואלי ואין לגעת בו.
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

  // ---------- כותרת: פרטי העסק מימין, סוג המסמך משמאל ----------
  let y = MARGIN + 4;
  const headerTop = y;

  let businessTextTop = y;
  if (data.business.logoDataUrl) {
    const format = imageFormat(data.business.logoDataUrl);
    if (format) {
      try {
        const props = doc.getImageProperties(data.business.logoDataUrl);
        const maxWidth = 38;
        const maxHeight = 16;
        const ratio = Math.min(maxWidth / props.width, maxHeight / props.height);
        const width = props.width * ratio;
        const height = props.height * ratio;
        doc.addImage(data.business.logoDataUrl, format, RIGHT - width, y - 4, width, height);
        businessTextTop = y + height;
      } catch {
        // לוגו פגום לא יעצור את הפקת המסמך
      }
    }
  }

  y = businessTextTop + 2;
  write(data.business.name || DEFAULT_STORE_NAME, RIGHT, y, { size: 15, bold: true });
  y += 5.5;

  const businessLines = [
    data.business.taxId ? `ח.פ / עוסק מורשה: ${data.business.taxId}` : "",
    data.business.address,
    data.business.supportPhone || data.business.phone
      ? `שירות לקוחות: ${data.business.supportPhone || data.business.phone}`
      : "",
    data.business.email,
  ].filter((line) => line.trim() !== "");

  for (const line of businessLines) {
    write(line, RIGHT, y, { size: 9, color: MUTED });
    y += 4.4;
  }

  // תיבת סוג המסמך (צד שמאל)
  const boxWidth = 62;
  const boxHeight = 26;
  doc.setFillColor(INK);
  doc.roundedRect(LEFT, headerTop - 4, boxWidth, boxHeight, 2, 2, "F");
  write(isQuote ? "בקשה להצעת מחיר" : "אישור הזמנה", LEFT + boxWidth - 5, headerTop + 3, {
    size: 13,
    bold: true,
    color: "#FFFFFF",
  });
  write(data.orderNumber, LEFT + boxWidth - 5, headerTop + 9.5, { size: 10, color: "#C9D6CF" });
  write(formatDate(data.createdAt), LEFT + boxWidth - 5, headerTop + 15.5, {
    size: 9,
    color: "#C9D6CF",
  });
  write(data.statusLabel, LEFT + boxWidth - 5, headerTop + 20.5, { size: 9, color: "#C9D6CF" });

  y = Math.max(y + 2, headerTop + boxHeight + 4);
  doc.setDrawColor(BRASS);
  doc.setLineWidth(0.6);
  doc.line(LEFT, y, RIGHT, y);
  y += 8;

  // ---------- פרטי הלקוח ----------
  const customerLines: [string, string][] = (
    [
      ["שם העסק", data.customer.businessName],
      ["ח.פ / עוסק מורשה", data.customer.taxId],
      ["כתובת", data.customer.address],
      ["איש קשר", data.customer.contactName],
      ["טלפון", data.customer.phone],
      ["אימייל", data.customer.email],
    ] as [string, string][]
  ).filter((entry) => entry[1].trim() !== "");
  if (data.agentName) customerLines.push(["סוכן מטפל", data.agentName]);
  if (data.agentNumber) customerLines.push(["מספר סוכן", data.agentNumber]);

  const rows = Math.ceil(customerLines.length / 2);
  const blockHeight = rows * 5.6 + 12;
  doc.setFillColor(SOFT);
  doc.setDrawColor(HAIRLINE);
  doc.setLineWidth(0.2);
  doc.roundedRect(LEFT, y, CONTENT_WIDTH, blockHeight, 2, 2, "FD");

  write("פרטי הלקוח", RIGHT - 4, y + 6.5, { size: 10, bold: true });
  const columnWidth = (CONTENT_WIDTH - 12) / 2;
  customerLines.forEach(([label, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = RIGHT - 4 - column * (columnWidth + 4);
    write(`${label}: ${value}`, x, y + 12.5 + row * 5.6, { size: 9, color: INK });
  });
  y += blockHeight + 8;

  // ---------- טבלת הפריטים ----------
  // רוחבי עמודות מימין לשמאל: מספר שורה, פריט, ברקוד, כמות, מחיר, סה"כ
  const columns = showPrices
    ? [
        { key: "index", label: "#", width: 8 },
        { key: "name", label: "פריט", width: 68 },
        { key: "barcode", label: "ברקוד", width: 34 },
        { key: "quantity", label: "כמות", width: 16 },
        { key: "unit", label: "מחיר יחידה", width: 27 },
        { key: "total", label: 'סה"כ', width: 29 },
      ]
    : [
        { key: "index", label: "#", width: 10 },
        { key: "name", label: "פריט", width: 100 },
        { key: "barcode", label: "ברקוד", width: 50 },
        { key: "quantity", label: "כמות", width: 22 },
      ];

  // מיקום הקצה הימני של כל עמודה (הטבלה נבנית מימין לשמאל)
  const columnRight: number[] = [];
  let cursor = RIGHT;
  for (const column of columns) {
    columnRight.push(cursor);
    cursor -= column.width;
  }

  const drawTableHeader = (top: number): number => {
    doc.setFillColor(INK);
    doc.rect(LEFT, top, CONTENT_WIDTH, 8, "F");
    columns.forEach((column, index) => {
      const isNumeric = column.key !== "name" && column.key !== "barcode" && column.key !== "index";
      write(column.label, columnRight[index]! - 2, top + 5.5, {
        size: 9,
        bold: true,
        color: "#FFFFFF",
        align: isNumeric ? "right" : "right",
      });
    });
    return top + 8;
  };

  const footerReserve = 26;
  y = drawTableHeader(y);

  const nameWidth = columns[1]!.width - 4;
  let zebra = false;

  for (const [index, item] of data.items.entries()) {
    const nameLines = wrapped(item.name, nameWidth, 9);
    const rowHeight = Math.max(7.5, nameLines.length * 4.4 + 3.2);

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

    const baseline = y + 5;
    write(String(index + 1), columnRight[0]! - 2, baseline, { size: 9, color: MUTED });
    nameLines.forEach((line, lineIndex) => {
      write(line, columnRight[1]! - 2, baseline + lineIndex * 4.4, { size: 9 });
    });
    write(item.barcode ?? "—", columnRight[2]! - 2, baseline, { size: 9, color: MUTED });
    write(String(item.quantity), columnRight[3]! - 2, baseline, { size: 9 });
    if (showPrices) {
      write(formatUnitIls(item.unitPrice), columnRight[4]! - 2, baseline, { size: 9 });
      write(formatMoney(item.unitPrice * item.quantity), columnRight[5]! - 2, baseline, {
        size: 9,
        bold: true,
      });
    }

    y += rowHeight;
    doc.setDrawColor(HAIRLINE);
    doc.setLineWidth(0.15);
    doc.line(LEFT, y, RIGHT, y);
  }

  y += 8;

  // ---------- סיכום ----------
  if (y > PAGE_HEIGHT - footerReserve - 34) {
    doc.addPage();
    y = MARGIN + 8;
  }

  if (showPrices && data.vat) {
    const summaryWidth = 78;
    const summaryLeft = LEFT;
    const lines: [string, string, boolean][] = data.vat.showBreakdown
      ? [
          ['סה"כ לפני מע"מ', formatMoney(data.vat.net), false],
          [`מע"מ ${data.vat.vatRate}%`, formatMoney(data.vat.vat), false],
          ['סה"כ לתשלום', formatMoney(data.vat.gross), true],
        ]
      : [['סה"כ לתשלום (כולל מע"מ)', formatMoney(data.vat.gross), true]];

    const summaryHeight = lines.length * 7 + 6;
    doc.setFillColor(SOFT);
    doc.setDrawColor(HAIRLINE);
    doc.setLineWidth(0.2);
    doc.roundedRect(summaryLeft, y, summaryWidth, summaryHeight, 2, 2, "FD");

    lines.forEach(([label, value, strong], index) => {
      const lineY = y + 8 + index * 7;
      write(label, summaryLeft + summaryWidth - 4, lineY, {
        size: strong ? 11 : 9.5,
        bold: strong,
        color: strong ? INK : MUTED,
      });
      write(value, summaryLeft + 4, lineY, {
        size: strong ? 12 : 9.5,
        bold: strong,
        color: strong ? BRASS : INK,
        align: "left",
      });
    });
    y += summaryHeight + 6;
  } else {
    doc.setFillColor(SOFT);
    doc.setDrawColor(HAIRLINE);
    doc.roundedRect(LEFT, y, CONTENT_WIDTH, 14, 2, 2, "FD");
    write(
      "מסמך זה הוא בקשה להצעת מחיר ואינו כולל מחירים. נציג יחזור אליכם עם הצעת מחיר מותאמת.",
      RIGHT - 4,
      y + 9,
      { size: 9.5, color: INK },
    );
    y += 20;
  }

  // הזמנה (לא הצעת מחיר): מה קורה עכשיו + שעות הטיפול
  if (!isQuote) {
    const lines = wrapped(ORDER_HOURS.document, CONTENT_WIDTH - 8, 9.5);
    const boxHeight = 6 + lines.length * 5;
    if (y + boxHeight > PAGE_HEIGHT - footerReserve) {
      doc.addPage();
      y = MARGIN + 8;
    }
    doc.setFillColor(SOFT);
    doc.setDrawColor(HAIRLINE);
    doc.roundedRect(LEFT, y, CONTENT_WIDTH, boxHeight, 2, 2, "FD");
    lines.forEach((line, index) => {
      write(line, RIGHT - 4, y + 7 + index * 5, { size: 9.5, color: INK });
    });
    y += boxHeight + 6;
  }

  if (data.note && data.note.trim() !== "") {
    const noteLines = wrapped(`הערות: ${data.note.trim()}`, CONTENT_WIDTH - 4, 9);
    for (const line of noteLines) {
      write(line, RIGHT, y, { size: 9, color: MUTED });
      y += 4.4;
    }
  }

  // ---------- כותרת תחתונה בכל העמודים ----------
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(HAIRLINE);
    doc.setLineWidth(0.2);
    doc.line(LEFT, PAGE_HEIGHT - 16, RIGHT, PAGE_HEIGHT - 16);
    const support = data.business.supportPhone || data.business.phone;
    write(support ? `שירות לקוחות: ${support}` : "", RIGHT, PAGE_HEIGHT - 11, {
      size: 8.5,
      color: MUTED,
    });
    write("מסמך ממוחשב — הופק אוטומטית ואינו דורש חתימה", PAGE_WIDTH / 2, PAGE_HEIGHT - 11, {
      size: 8.5,
      color: MUTED,
      align: "center",
    });
    write(`עמוד ${page} מתוך ${pageCount}`, LEFT, PAGE_HEIGHT - 11, {
      size: 8.5,
      color: MUTED,
      align: "left",
    });
  }

  const base64 = doc.output("datauristring").split(",")[1] ?? "";
  const prefix = isQuote ? "quote" : "order";
  return { base64, filename: `${prefix}-${data.orderNumber}.pdf` };
}
