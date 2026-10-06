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
import { pdfPalette } from "./brand";

export type DocumentBusiness = {
  name: string;
  taxId: string;
  address: string;
  phone: string;
  supportPhone: string;
  email: string;
  /** תמונת לוגו כ-data URL (PNG/JPEG בלבד) */
  logoDataUrl: string | null;
  /** חלק 22: צבע המותג של החנות (#rrggbb) — כותרות המסמך והטבלה; null = ברירת המחדל */
  brandColor?: string | null;
  /** חלק 23: עוסק פטור — "עוסק פטור" ליד המספר, וסה"כ בלי מע"מ */
  businessType?: "exempt" | "authorized" | null;
};

export type DocumentCustomer = {
  businessName: string;
  taxId: string;
  address: string;
  contactName: string;
  phone: string;
  email: string;
};

/** כתובת משלוח חלופית ("שלח לכתובת אחרת" בקופה) */
export type DocumentShipping = {
  name: string;
  phone: string;
  address: string;
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
  /** null = המשלוח לכתובת של הלקוח */
  shipping?: DocumentShipping | null;
  agentNumber: string | null;
  /** שם הסוכן בעברית, כפי שהלקוח רואה אותו */
  agentName: string | null;
  items: DocumentItem[];
  /** null בבקשת הצעת מחיר — במסמך כזה אין מחירים כלל */
  vat: VatBreakdown | null;
  note: string | null;
  /**
   * חלק 22: חנות B2B (דרגי מחיר פעילים) — רק שם מוצגת ההודעה "ההזמנה הועברה
   * לטיפול סוכן להסדרת תשלום / עד 16:00". בחנות רגילה היא מטעה ולא מוצגת.
   */
  b2b?: boolean;
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
  // שורת הנחה (קופון) — סכום שלילי: "-₪4.80"
  const sign = value < 0 ? "-" : "";
  return `${sign}₪${Math.abs(value).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  // חלק 22: צבעי המסמך לפי צבע המותג של החנות (טקסט לבן / כהה לפי הניגודיות)
  const palette = pdfPalette(data.business.brandColor);

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
    data.business.taxId
      ? data.business.businessType === "exempt"
        ? `עוסק פטור: ${data.business.taxId}`
        : `ח.פ / עוסק מורשה: ${data.business.taxId}`
      : "",
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
  doc.setFillColor(palette.fill);
  doc.roundedRect(LEFT, headerTop - 4, boxWidth, boxHeight, 2, 2, "F");
  write(isQuote ? "בקשה להצעת מחיר" : "אישור הזמנה", LEFT + boxWidth - 5, headerTop + 3, {
    size: 13,
    bold: true,
    color: palette.onFill,
  });
  write(data.orderNumber, LEFT + boxWidth - 5, headerTop + 9.5, {
    size: 10,
    color: palette.onFillSoft,
  });
  write(formatDate(data.createdAt), LEFT + boxWidth - 5, headerTop + 15.5, {
    size: 9,
    color: palette.onFillSoft,
  });
  write(data.statusLabel, LEFT + boxWidth - 5, headerTop + 20.5, {
    size: 9,
    color: palette.onFillSoft,
  });

  y = Math.max(y + 2, headerTop + boxHeight + 4);
  doc.setDrawColor(palette.accent);
  doc.setLineWidth(0.6);
  doc.line(LEFT, y, RIGHT, y);
  y += 8;

  // ---------- פרטי הלקוח ----------
  const customerLines: [string, string][] = (
    [
      ["שם / שם העסק", data.customer.businessName],
      ["ת.ז / ח.פ", data.customer.taxId],
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

  // ---------- משלוח לכתובת אחרת ----------
  if (data.shipping) {
    const shippingLines = (
      [
        ["שם המקבל", data.shipping.name],
        ["טלפון", data.shipping.phone],
        ["כתובת למשלוח", data.shipping.address],
      ] as [string, string][]
    ).filter((entry) => entry[1].trim() !== "");
    const shippingRows = Math.ceil(shippingLines.length / 2);
    const shippingHeight = shippingRows * 5.6 + 12;
    doc.setFillColor("#FFF6E5");
    doc.setDrawColor(BRASS);
    doc.setLineWidth(0.5);
    doc.roundedRect(LEFT, y, CONTENT_WIDTH, shippingHeight, 2, 2, "FD");
    write("משלוח לכתובת אחרת", RIGHT - 4, y + 6.5, { size: 10, bold: true, color: BRASS });
    shippingLines.forEach(([label, value], index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = RIGHT - 4 - column * (columnWidth + 4);
      write(`${label}: ${value}`, x, y + 12.5 + row * 5.6, { size: 9, color: INK });
    });
    y += shippingHeight + 8;
  }

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
    doc.setFillColor(palette.fill);
    doc.rect(LEFT, top, CONTENT_WIDTH, 8, "F");
    columns.forEach((column, index) => {
      const isNumeric = column.key !== "name" && column.key !== "barcode" && column.key !== "index";
      write(column.label, columnRight[index]! - 2, top + 5.5, {
        size: 9,
        bold: true,
        color: palette.onFill,
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
      write(
        item.unitPrice < 0 ? formatMoney(item.unitPrice) : formatUnitIls(item.unitPrice),
        columnRight[4]! - 2,
        baseline,
        { size: 9 },
      );
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
      : data.vat.exempt
        ? // חלק 23: לא נגבה מע"מ (עוסק פטור / 0%)
          [
            [
              data.business.businessType === "exempt" ? 'עוסק פטור — ללא מע"מ' : 'ללא מע"מ',
              "",
              false,
            ],
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
        color: strong ? palette.accent : INK,
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

  // הזמנה (לא הצעת מחיר) בחנות B2B: מה קורה עכשיו + שעות הטיפול
  if (!isQuote && data.b2b === true) {
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
