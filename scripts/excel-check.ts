/**
 * בדיקות אוטומטיות למודול האקסל — סבב מלא (round-trip) ותרחישי שגיאה.
 * הרצה: npx esbuild scripts/excel-check.ts --bundle --platform=node --format=cjs \
 *         --outfile=/tmp/excel-check.cjs --alias:@=./src && node /tmp/excel-check.cjs
 */
import {
  buildTemplate,
  buildWorkbook,
  parseWorkbookBytes,
  parseWorkbookData,
  EXCEL_HEADERS,
  TEMPLATE_ROWS,
} from "@/lib/excel";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`✗ ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
  }
}

const H = [...EXCEL_HEADERS];
const okRow = ["", "טבעת כסף", "טבעת", 20, 60, 3, "כסף", "", "1", "1"];

async function main(): Promise<void> {
  // --- סבב מלא: קובץ הדוגמה נבנה ומפוענח חזרה בלי שגיאות ---
  const template = await buildTemplate();
  check("קובץ הדוגמה נוצר", template.byteLength > 1000);
  const round = await parseWorkbookBytes(template);
  check("פענוח הדוגמה בלי שגיאות", round.errors.length === 0, round.errors.join(" | "));
  check("פענוח הדוגמה מחזיר 2 שורות", round.items.length === 2);
  check(
    "ערכי הדוגמה שורדים סבב מלא",
    round.items[1]?.sku === TEMPLATE_ROWS[1]?.sku &&
      round.items[1]?.selling_price === TEMPLATE_ROWS[1]?.selling_price &&
      round.items[0]?.colors.length === 2,
  );

  // --- ייצוא עם עברית, מספרים עשרוניים וצבעים מרובים ---
  const bytes = await buildWorkbook(
    [
      {
        sku: "87654321",
        name: 'שרשרת "מיוחדת", עם פסיק',
        category: "שרשרת",
        cost_price: 45.5,
        selling_price: 129.9,
        stock_quantity: 7,
        colors: ["זהב", "כסף"],
        barcode: "7290000000001",
        shelf_number: "2",
        row_number: "5",
      },
    ],
    "סניף בדיקה",
  );
  const exported = await parseWorkbookBytes(bytes);
  check("ייצוא←ייבוא בלי שגיאות", exported.errors.length === 0, exported.errors.join(" | "));
  check(
    "מחירים עשרוניים ושם עם גרשיים שורדים",
    exported.items[0]?.cost_price === 45.5 && exported.items[0]?.name.includes("מיוחדת"),
  );

  // --- תרחישי שגיאה: כל אחד חייב להיתפס ---
  const bad = (rows: unknown[][]) => parseWorkbookData([H, ...rows]);

  check("שם חסר נתפס", bad([["", "", "טבעת", 10, 20, 1, "", "", "", ""]]).errors.some((e) => e.includes("שם")));
  check("קטגוריה לא חוקית נתפסת", bad([["", "מוצר", "כובע", 10, 20, 1, "", "", "", ""]]).errors.some((e) => e.includes("קטגוריה")));
  check("מחיר שלילי נתפס", bad([["", "מוצר", "טבעת", -5, 20, 1, "", "", "", ""]]).errors.some((e) => e.includes("עלות")));
  check("מכירה מתחת לעלות נתפסת", bad([["", "מוצר", "טבעת", 50, 20, 1, "", "", "", ""]]).errors.some((e) => e.includes("נמוך")));
  check("כמות לא שלמה נתפסת", bad([["", "מוצר", "טבעת", 10, 20, 1.5, "", "", "", ""]]).errors.some((e) => e.includes("כמות")));
  check("מקט קצר נתפס", bad([["123", "מוצר", "טבעת", 10, 20, 1, "", "", "", ""]]).errors.some((e) => e.includes("מקט")));
  check(
    "מקט כפול בקובץ נתפס",
    bad([
      ["11112222", "מוצר א", "טבעת", 10, 20, 1, "", "", "", ""],
      ["11112222", "מוצר ב", "שעון", 10, 20, 1, "", "", "", ""],
    ]).errors.some((e) => e.includes("פעמיים")),
  );
  check("כותרות חסרות נתפסות", parseWorkbookData([["א", "ב"], ["1", "2"]]).errors.some((e) => e.includes("כותרות")));

  // --- קטגוריות דינמיות: רשימה מותאמת מתקבלת, ומה שלא בה נחסם ---
  const custom = parseWorkbookData([H, ["", "צמיד זהב", "צמיד", 10, 30, 2, "", "", "", ""]], ["צמיד", "טבעת"]);
  check("קטגוריה מותאמת אישית מתקבלת", custom.errors.length === 0 && custom.items[0]?.category === "צמיד", custom.errors.join(" | "));
  const notInList = parseWorkbookData([H, ["", "שעון יד", "שעון", 10, 30, 2, "", "", "", ""]], ["צמיד"]);
  check("קטגוריה שהוסרה נחסמת", notInList.errors.some((e) => e.includes("קטגוריה")));
  check("קובץ ריק נתפס", parseWorkbookData([]).errors.length === 1);
  check("קובץ לא-אקסל נתפס", (await parseWorkbookBytes(new TextEncoder().encode("לא אקסל").buffer as ArrayBuffer)).errors.length >= 1);

  // --- גמישות: סדר עמודות שונה עדיין עובד (איתור לפי כותרת) ---
  const shuffled = parseWorkbookData([
    ["שם המוצר", "כמות במלאי", "קטגוריה", "מחיר מכירה", "מחיר עלות"],
    ["עגילי פנינה", 4, "עגילים", 99, 30],
  ]);
  check("סדר עמודות שונה נתמך", shuffled.errors.length === 0 && shuffled.items[0]?.selling_price === 99, shuffled.errors.join(" | "));

  // --- שורות ריקות בסוף לא מייצרות שגיאות ---
  const withEmpty = bad([okRow, ["", "", "", "", "", "", "", "", "", ""]]);
  check("שורות ריקות מדולגות", withEmpty.errors.length === 0 && withEmpty.items.length === 1);

  console.log(`\n${passed} בדיקות עברו, ${failed} נכשלו`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
