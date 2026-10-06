/**
 * ספירת מלאי — דו"ח הספירה (חלק 23). לוגיקה טהורה (בלי דפדפן / מסד):
 *  • buildCountReport — לכל פריט שנספר: הכמות הקודמת, החדשה, ההפרש ביחידות
 *    ובשקלים (לפי השווי ליחידה שנשמר ברגע העדכון: מחיר עלות, אחרת מחיר מכירה)
 *  • countReportHtml — מסמך HTML להדפסה (RTL), כל הטקסט מנוקה
 */

/** שורת ספירה כפי שנשמרה במסד אחרי העדכון */
export type CountReportInput = {
  product_id: string;
  counted_units: number;
  recorded_before: number | null;
  reserved_open: number | null;
  applied_quantity: number | null;
  unit_value: number | string | null;
  value_source: "cost" | "price" | null;
};

export type CountReportProduct = {
  name: string;
  sku: string;
  barcode: string | null;
};

export type CountReportLine = {
  productId: string;
  name: string;
  sku: string;
  barcode: string | null;
  /** הכמות שהייתה רשומה כזמינה לפני העדכון */
  before: number;
  /** מה שנספר על המדף */
  counted: number;
  /** שמור להזמנות פתוחות (עוד במחסן) */
  reserved: number;
  /** הכמות הזמינה שנקבעה */
  after: number;
  diffUnits: number;
  unitValue: number;
  valueSource: "cost" | "price" | null;
  diffValue: number;
};

export type CountReport = {
  lines: CountReportLine[];
  totals: {
    lines: number;
    changed: number;
    /** סטטוס "אזל" — נקבע 0 */
    zeroed: number;
    unitsGained: number;
    unitsLost: number;
    valueGained: number;
    valueLost: number;
    netValue: number;
  };
  /** יש שורות עם שמירות להזמנות — מציגים עמודה */
  hasReserved: boolean;
  /** יש שווי לפי מחיר מכירה (כשאין מחיר עלות) — מציינים בדו"ח */
  usesSalePrice: boolean;
};

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const num = (value: unknown): number => {
  const parsed = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function buildCountReport(
  inputs: CountReportInput[],
  products: Map<string, CountReportProduct>,
): CountReport {
  const lines = inputs.map((input): CountReportLine => {
    const product = products.get(input.product_id);
    const before = num(input.recorded_before);
    const after =
      input.applied_quantity === null ? num(input.counted_units) : num(input.applied_quantity);
    const unitValue = round2(num(input.unit_value));
    const diffUnits = after - before;
    return {
      productId: input.product_id,
      name: product?.name ?? "מוצר שנמחק",
      sku: product?.sku ?? "",
      barcode: product?.barcode ?? null,
      before,
      counted: num(input.counted_units),
      reserved: num(input.reserved_open),
      after,
      diffUnits,
      unitValue,
      valueSource: input.value_source,
      diffValue: round2(diffUnits * unitValue),
    };
  });

  const collator = new Intl.Collator("he", { numeric: true, sensitivity: "base" });
  // ההפרשים הגדולים (בשקלים) קודם; אחר כך מה שתאם — לפי השם
  lines.sort(
    (a, b) =>
      Math.abs(b.diffValue) - Math.abs(a.diffValue) ||
      Math.abs(b.diffUnits) - Math.abs(a.diffUnits) ||
      collator.compare(a.name, b.name),
  );

  let unitsGained = 0;
  let unitsLost = 0;
  let valueGained = 0;
  let valueLost = 0;
  for (const line of lines) {
    if (line.diffUnits > 0) {
      unitsGained += line.diffUnits;
      valueGained += line.diffValue;
    } else if (line.diffUnits < 0) {
      unitsLost += -line.diffUnits;
      valueLost += -line.diffValue;
    }
  }

  return {
    lines,
    totals: {
      lines: lines.length,
      changed: lines.filter((line) => line.diffUnits !== 0).length,
      zeroed: lines.filter((line) => line.after === 0).length,
      unitsGained,
      unitsLost,
      valueGained: round2(valueGained),
      valueLost: round2(valueLost),
      netValue: round2(valueGained - valueLost),
    },
    hasReserved: lines.some((line) => line.reserved > 0),
    usesSalePrice: lines.some((line) => line.valueSource === "price"),
  };
}

export function formatMoneyIls(value: number): string {
  return `₪${round2(value).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** הפרש עם סימן: +5 / −3 / 0 */
export function signed(value: number, money = false): string {
  const text = money ? formatMoneyIls(Math.abs(value)) : Math.abs(value).toLocaleString("he-IL");
  if (value > 0) return `+${text}`;
  if (value < 0) return `−${text}`;
  return money ? formatMoneyIls(0) : "0";
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type CountReportMeta = {
  storeName: string;
  title: string;
  /** תיאור הטווח: "כל המחסן" / קטגוריה */
  scope: string;
  appliedAt: string | null;
};

/** מסמך HTML מלא להדפסה (חלון נפרד → הדפסה / שמירה כ-PDF) */
export function countReportHtml(report: CountReport, meta: CountReportMeta): string {
  const date = meta.appliedAt
    ? new Date(meta.appliedAt).toLocaleString("he-IL", {
        day: "numeric",
        month: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  const rows = report.lines
    .map((line) => {
      const tone = line.diffUnits > 0 ? "gain" : line.diffUnits < 0 ? "loss" : "";
      return `<tr>
  <td>${escapeHtml(line.name)}</td>
  <td class="num ltr">${escapeHtml(line.barcode ?? line.sku)}</td>
  <td class="num">${line.before}</td>
  <td class="num strong">${line.after}</td>
  ${report.hasReserved ? `<td class="num">${line.reserved || "—"}</td>` : ""}
  <td class="num ${tone}"><bdi>${signed(line.diffUnits)}</bdi></td>
  <td class="num">${formatMoneyIls(line.unitValue)}${line.valueSource === "price" ? "*" : ""}</td>
  <td class="num ${tone} strong"><bdi>${signed(line.diffValue, true)}</bdi></td>
</tr>`;
    })
    .join("\n");
  const t = report.totals;
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(`דו"ח ספירה — ${meta.title}`)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, "Segoe UI", sans-serif; color: #12211f; margin: 24px; font-size: 13px; background: #fff; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #555; margin-bottom: 16px; }
  .tiles { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .tile { border: 1px solid #ddd; border-radius: 8px; padding: 8px 12px; min-width: 120px; }
  .tile b { display: block; font-size: 16px; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid #e5e5e5; padding: 6px 8px; text-align: right; vertical-align: top; }
  th { background: #f3f4f4; font-size: 12px; }
  td.num, th.num { text-align: center; white-space: nowrap; }
  .ltr { direction: ltr; unicode-bidi: isolate; }
  .strong { font-weight: 700; }
  .gain { color: #166534; }
  .loss { color: #b91c1c; }
  tfoot td { font-weight: 700; background: #fafafa; }
  .note { color: #666; font-size: 11px; margin-top: 10px; }
  @media print { body { margin: 10mm; } .no-print { display: none; } tr { break-inside: avoid; } }
</style>
</head>
<body>
<h1>${escapeHtml(`דו"ח ספירת מלאי — ${meta.storeName}`)}</h1>
<div class="meta">${escapeHtml(meta.title)} · ${escapeHtml(meta.scope)}${date ? ` · עודכן ${escapeHtml(date)}` : ""}</div>
<div class="tiles">
  <div class="tile">פריטים שנספרו<b>${t.lines}</b></div>
  <div class="tile">השתנו<b>${t.changed}</b></div>
  <div class="tile">עודף (שווי)<b class="gain"><bdi>${signed(t.valueGained, true)}</bdi></b></div>
  <div class="tile">חוסר (שווי)<b class="loss"><bdi>${signed(-t.valueLost, true)}</bdi></b></div>
  <div class="tile">הפרש נטו<b class="${t.netValue > 0 ? "gain" : t.netValue < 0 ? "loss" : ""}"><bdi>${signed(t.netValue, true)}</bdi></b></div>
</div>
<table>
<thead><tr>
  <th>מוצר</th><th class="num">ברקוד / מק"ט</th><th class="num">כמות קודמת</th><th class="num">כמות חדשה</th>
  ${report.hasReserved ? `<th class="num">שמור להזמנות</th>` : ""}
  <th class="num">הפרש (יח׳)</th><th class="num">שווי ליחידה</th><th class="num">הפרש בשווי</th>
</tr></thead>
<tbody>
${rows}
</tbody>
<tfoot><tr>
  <td colspan="${report.hasReserved ? 5 : 4}">סה"כ</td>
  <td class="num"><bdi>${signed(t.unitsGained - t.unitsLost)}</bdi></td>
  <td></td>
  <td class="num"><bdi>${signed(t.netValue, true)}</bdi></td>
</tr></tfoot>
</table>
<p class="note">הכמות החדשה = מה שנספר על המדף, פחות מה ששמור ללקוחות בהזמנות שעוד לא נשלחו. השווי לפי מחיר העלות${report.usesSalePrice ? "; * = אין מחיר עלות — לפי מחיר המכירה" : ""}.</p>
<p class="no-print"><button onclick="window.print()">הדפסה</button></p>
</body>
</html>`;
}
