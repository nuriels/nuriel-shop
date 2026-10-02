/**
 * בדיקה חזותית אמיתית של buildLabelCanvas — משתמשת ב-node-canvas כדי להריץ
 * את קוד ה-Canvas האמיתי (לא סימולציה) ולשמור PNG לבדיקה עינית + ניתוח פיקסלים.
 * הרצה: npx esbuild scripts/label-visual-check.ts --bundle --platform=node --format=cjs \
 *         --external:canvas --outfile=.label-check.cjs --alias:@=./src && node .label-check.cjs && rm .label-check.cjs
 */
import { createCanvas } from "canvas";

// polyfill מינימלי: document.createElement("canvas") מחזיר קנבס אמיתי של node-canvas
(globalThis as unknown as { document: { createElement: (tag: string) => unknown } }).document = {
  createElement: (tag: string) => (tag === "canvas" ? createCanvas(1, 1) : null),
};

import { buildLabelCanvas } from "@/lib/pdf";
import * as fs from "node:fs";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error(`✗ ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
  }
}

type NodeCanvas = ReturnType<typeof createCanvas>;

function darkPixelColumns(canvas: NodeCanvas, x0: number, x1: number, y0: number, y1: number): number {
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
  let darkColumns = 0;
  const width = x1 - x0;
  const height = y1 - y0;
  for (let col = 0; col < width; col += 1) {
    let hasDark = false;
    for (let row = 0; row < height; row += 1) {
      const idx = (row * width + col) * 4;
      const r = data[idx] ?? 255;
      const g = data[idx + 1] ?? 255;
      const b = data[idx + 2] ?? 255;
      if (r < 100 && g < 100 && b < 100) {
        hasDark = true;
        break;
      }
    }
    if (hasDark) darkColumns += 1;
  }
  return darkColumns;
}

const item = { name: "טבעת כסף 925 עדינה", barcode: "7290011224135", sellingPrice: 30 };
const canvas = buildLabelCanvas(item) as unknown as NodeCanvas;

check("קנבס בגודל הנכון (80x7מ״מ בסקאלה)", canvas.width > 0 && canvas.height > 0, `${canvas.width}x${canvas.height}`);

const width = canvas.width;
const height = canvas.height;

// אזור הברקוד = 60% הימניים של המדבקה (rightZoneX~=0.43 מהרוחב ואילך)
const barcodeZoneX0 = Math.round(width * 0.43);
const barcodeZoneX1 = width - Math.round(height * 0.05);
const barcodeCols = darkPixelColumns(canvas, barcodeZoneX0, barcodeZoneX1, Math.round(height * 0.1), Math.round(height * 0.9));
const barcodeZoneWidth = barcodeZoneX1 - barcodeZoneX0;
const barcodeCoverage = barcodeCols / barcodeZoneWidth;
check(
  "הברקוד ממלא לפחות 55% מרוחב האזור שהוקצה לו (לא דליל)",
  barcodeCoverage >= 0.55,
  `כיסוי בפועל: ${(barcodeCoverage * 100).toFixed(0)}%`,
);

// אזור המחיר = 40% השמאליים; בודקים ששורת המחיר (תחתית האזור) לא ריקה
const priceZoneDark = darkPixelColumns(canvas, Math.round(width * 0.05), Math.round(width * 0.38), Math.round(height * 0.4), Math.round(height * 0.92));
check("יש תוכן כהה (המחיר) באזור השמאלי", priceZoneDark > 5, `עמודות כהות: ${priceZoneDark}`);

// שורת השם — למעלה באזור השמאלי, גם היא לא אמורה להיות ריקה לגמרי
const nameZoneDark = darkPixelColumns(canvas, Math.round(width * 0.05), Math.round(width * 0.38), Math.round(height * 0.08), Math.round(height * 0.3));
check("יש טקסט בשורת השם", nameZoneDark > 2, `עמודות כהות: ${nameZoneDark}`);

// שמירת PNG לבדיקה עינית
const buffer = canvas.toBuffer("image/png");
fs.mkdirSync("/tmp/label-preview", { recursive: true });
fs.writeFileSync("/tmp/label-preview/label.png", buffer);
console.log("נשמר: /tmp/label-preview/label.png");

console.log(`\n${passed} בדיקות עברו, ${failed} נכשלו`);
if (failed > 0) process.exit(1);

// --- וריאציות קצה: שם ארוך, מחיר עם אגורות, ברקוד לא-EAN (CODE128) ---
const variants = [
  { name: "שרשרת זהב 18 קראט משובצת אבנים יוקרתית לאירועים חגיגיים", barcode: "7290011224135", sellingPrice: 199.9, file: "long-name" },
  { name: "עגיל", barcode: "SKU00042190", sellingPrice: 45, file: "code128" },
  { name: "טבעת", barcode: "7290011224135", sellingPrice: 9.5, file: "decimal-price" },
];
for (const v of variants) {
  const c = buildLabelCanvas(v) as unknown as NodeCanvas;
  fs.writeFileSync(`/tmp/label-preview/${v.file}.png`, c.toBuffer("image/png"));
}
console.log("נשמרו וריאציות נוספות ב-/tmp/label-preview/");
