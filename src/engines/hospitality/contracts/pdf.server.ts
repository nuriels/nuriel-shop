// ה-PDF החתום (מיגרציה 64): הנוסח המלא כפי שנחתם (מהמסד — signed_body), החתימות (צד א' — של הנציג
// אם שמורה; צד ב' — של הלקוח: ציור או שם מוקלד), עמוד X מתוך Y, ובסוף "תיעוד החתימה האלקטרונית" —
// מתי, מי, מאיזו כתובת IP ודפדפן, מספר המסמך, טביעת SHA-256 של הנוסח החתום, ההודעה שהוצגה לחותם
// (שעות הבריכה), ושזה תיעוד בלבד — לא אישור משפטי. בשרת בלבד (jsPDF + Heebo).
import { jsPDF } from "jspdf";
import { heeboFonts, toVisualRtl } from "@/platform/pdf/hebrew.server";
import { contractBlocks, type ContractBlock } from "./blocks";
import { pathPoints, SIGNATURE_HEIGHT, SIGNATURE_WIDTH, type ContractSignature } from "./signature";

export interface SignedContractPdf {
  number: number;
  title: string;
  body: string;
  bodySha256: string;
  businessName: string;
  representativeName: string | null;
  /** חתימת הנציג (צד א'), אם שמורה בתנאי העסק */
  representativeSignature: string[] | null;
  signerName: string;
  signerEmail: string;
  signature: ContractSignature;
  signedAtLocal: string;
  signerIp: string | null;
  signerUserAgent: string | null;
  /** ההודעה שהוצגה לחותם לפני החתימה (שעות הבריכה — poolNotice), מחוץ לנוסח ההסכם */
  poolNote?: string | null;
}

const MARGIN = 16;
const INK = "#1d2b28";
const MUTED = "#5b6b67";
const LINE = "#c9d3d0";
const BOX_FILL = "#f4f7f6";

/** תווים שאין בגופן — לחלופה שנקראת (הסימון בחוזה: ☒ נבחר, ☐ לא נבחר) */
const pdfText = (s: string) => s.replace(/☒/g, "[X]").replace(/☐/g, "[ ]").replace(/•/g, "·");

export async function buildSignedContractPdf(c: SignedContractPdf): Promise<Uint8Array> {
  const fonts = heeboFonts();
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.addFileToVFS("Heebo-Regular.ttf", fonts.regular);
  doc.addFont("Heebo-Regular.ttf", "Heebo", "normal");
  doc.addFileToVFS("Heebo-Bold.ttf", fonts.bold);
  doc.addFont("Heebo-Bold.ttf", "Heebo", "bold");
  doc.setFont("Heebo", "normal");
  doc.setProperties({
    title: `${c.title} — מסמך ${c.number}`,
    subject: c.title,
    author: c.businessName,
    creator: "Nuriel",
  });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const right = W - MARGIN;
  const width = W - MARGIN * 2;
  let y = MARGIN + 4;

  const font = (size: number, bold = false, color = INK) => {
    doc.setFont("Heebo", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(color);
  };
  const ensure = (needed: number) => {
    if (y + needed > H - MARGIN - 10) {
      doc.addPage();
      y = MARGIN + 4;
    }
  };
  /** פסקה מימין לשמאל: גלישת שורות בסדר הלוגי, ואז כל שורה לסדר ויזואלי (jsPDF לא מסדר מחדש) */
  const write = (
    text: string,
    size: number,
    opts: {
      bold?: boolean;
      color?: string;
      indent?: number;
      align?: "right" | "center";
      lead?: number;
    } = {},
  ) => {
    font(size, opts.bold, opts.color);
    const lineH = size * 0.42 * (opts.lead ?? 1.45);
    const lines = doc.splitTextToSize(pdfText(text), width - (opts.indent ?? 0)) as string[];
    for (const line of lines) {
      ensure(lineH);
      const x = opts.align === "center" ? W / 2 : right - (opts.indent ?? 0);
      doc.text(toVisualRtl(line), x, y, {
        align: opts.align ?? "right",
        isInputVisual: true,
        isOutputVisual: true,
      });
      y += lineH;
    }
  };
  const drawSignature = (paths: string[], x: number, top: number, w: number, h: number) => {
    doc.setDrawColor(INK);
    doc.setLineWidth(0.35);
    for (const p of paths) {
      const pts = pathPoints(p);
      for (let i = 1; i < pts.length; i++) {
        const [x1, y1] = pts[i - 1]!;
        const [x2, y2] = pts[i]!;
        doc.line(
          x + (x1 / SIGNATURE_WIDTH) * w,
          top + (y1 / SIGNATURE_HEIGHT) * h,
          x + (x2 / SIGNATURE_WIDTH) * w,
          top + (y2 / SIGNATURE_HEIGHT) * h,
        );
      }
    }
  };
  const signatures = () => {
    ensure(52);
    y += 4;
    const colW = (width - 10) / 2;
    const top = y;
    const cols: {
      label: string;
      x: number;
      render: (x: number, top: number) => void;
      name: string;
    }[] = [
      {
        label: "חתימת המשכיר (צד א')",
        x: right - colW,
        name: c.representativeName
          ? `${c.representativeName} — בשם ${c.businessName}`
          : c.businessName,
        render: (x, t) => {
          if (c.representativeSignature?.length)
            drawSignature(c.representativeSignature, x + 4, t, colW - 8, 22);
        },
      },
      {
        label: "חתימת השוכר / המזמין (צד ב')",
        x: MARGIN,
        name: c.signerName,
        render: (x, t) => {
          if (c.signature.kind === "drawn")
            drawSignature(c.signature.paths, x + 4, t, colW - 8, 22);
          else {
            font(15, true);
            doc.text(toVisualRtl(c.signature.name), x + colW / 2, t + 14, {
              align: "center",
              isInputVisual: true,
              isOutputVisual: true,
            });
          }
        },
      },
    ];
    for (const col of cols) {
      font(10, true);
      doc.text(toVisualRtl(col.label), col.x + colW, top, {
        align: "right",
        isInputVisual: true,
        isOutputVisual: true,
      });
      doc.setDrawColor(LINE);
      doc.setLineWidth(0.3);
      doc.rect(col.x, top + 3, colW, 26, "S");
      col.render(col.x, top + 4);
      font(9, false, MUTED);
      doc.text(toVisualRtl(pdfText(col.name)), col.x + colW, top + 34, {
        align: "right",
        isInputVisual: true,
        isOutputVisual: true,
      });
    }
    font(9, false, MUTED);
    doc.text(toVisualRtl(`נחתם ביום ${c.signedAtLocal}`), MARGIN + colW, top + 39, {
      align: "right",
      isInputVisual: true,
      isOutputVisual: true,
    });
    if (c.signature.kind === "typed") {
      doc.text(toVisualRtl("(חתימה בהקלדת השם המלא)"), MARGIN + colW, top + 43, {
        align: "right",
        isInputVisual: true,
        isOutputVisual: true,
      });
    }
    y = top + 50;
  };

  for (const b of contractBlocks(c.body) as ContractBlock[]) {
    switch (b.kind) {
      case "title":
        write(b.text, 16, { bold: true, align: "center", lead: 1.3 });
        y += 1;
        break;
      case "subtitle":
        write(b.text, 10.5, { color: MUTED, align: "center" });
        y += 3;
        break;
      case "heading":
        y += 3;
        ensure(12);
        write(b.text, 12, { bold: true });
        y += 0.5;
        break;
      case "strong":
        write(b.text, 10.5, { bold: true });
        break;
      case "item": {
        font(10);
        ensure(6);
        doc.text("·", right, y, { align: "right" });
        write(b.text, 10, { indent: 4 });
        break;
      }
      case "paragraph":
        write(b.text, 10);
        y += 1.5;
        break;
      case "box": {
        font(9.5);
        const lines = doc.splitTextToSize(pdfText(b.text), width - 8) as string[];
        const h = lines.length * 9.5 * 0.42 * 1.45 + 6;
        ensure(h + 2);
        doc.setFillColor(BOX_FILL);
        doc.setDrawColor(LINE);
        doc.rect(MARGIN, y - 4, width, h, "FD");
        y += 0.5;
        write(b.text, 9.5, { indent: 4 });
        y += 3;
        break;
      }
      case "signatures":
        signatures();
        break;
    }
  }

  // ---- תיעוד החתימה האלקטרונית (תיעוד — לא אישור משפטי) ----
  doc.addPage();
  y = MARGIN + 4;
  write("תיעוד החתימה האלקטרונית", 14, { bold: true });
  y += 2;
  const facts: [string, string][] = [
    ["המסמך", `${c.title} — מסמך מס' ${c.number}`],
    ["העסק", c.businessName],
    ["נחתם על ידי", c.signerName],
    ["אימייל החותם (אליו נשלח הקישור האישי)", c.signerEmail],
    ["מועד החתימה (שעון ישראל)", c.signedAtLocal],
    ["אופן החתימה", c.signature.kind === "drawn" ? "ציור באצבע / בעכבר" : "הקלדת השם המלא"],
    ["כתובת IP", c.signerIp ?? "—"],
    ["דפדפן", (c.signerUserAgent ?? "—").slice(0, 160)],
  ];
  for (const [k, v] of facts) write(`${k}: ${v}`, 10);
  y += 2;
  write("טביעת SHA-256 של נוסח ההסכם החתום:", 10, { bold: true });
  font(9, false, INK);
  ensure(6);
  doc.text(c.bodySha256, right, y, { align: "right" });
  y += 7;
  if (c.poolNote) {
    write("הודעה שהוצגה לחותם לפני החתימה (מחוץ לנוסח ההסכם):", 10, { bold: true });
    write(c.poolNote, 10);
    y += 2;
  }
  write(
    "החתימה נעשתה באמצעות קישור אישי וחד-פעמי שנשלח לאימייל של החותם. לפני החתימה אישר החותם שקרא את כל סעיפי ההסכם ושהוא מסכים להם. הנוסח החתום נשמר במערכת ולא ניתן לשנותו; כל שינוי בפרטים מחייב הסכם מתוקן וחתימה חדשה.",
    9.5,
    { color: MUTED },
  );
  write(
    "עמוד זה מתעד את אופן החתימה בלבד, ואינו אישור משפטי של תוכן ההסכם. החתימה היא חתימה אלקטרונית פשוטה — לא חתימה אלקטרונית מאובטחת או מאושרת.",
    9.5,
    { color: MUTED },
  );

  // ---- עמוד X מתוך Y ----
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    font(8.5, false, MUTED);
    doc.text(toVisualRtl(`עמוד ${p} מתוך ${pages}`), W / 2, H - 8, {
      align: "center",
      isInputVisual: true,
      isOutputVisual: true,
    });
    doc.text(`#${c.number} · ${c.bodySha256.slice(0, 16)}`, MARGIN, H - 8, { align: "left" });
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
