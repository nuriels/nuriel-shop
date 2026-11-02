// ייצוא CSV (שלב F7) — נפתח ב-Excel בעברית (BOM של UTF-8), שורות CRLF. הגנה מהזרקת נוסחאות:
// תא שמתחיל ב-= + - @ (או טאב / ירידת שורה) — מקבל ' לפניו, כך ש-Excel לא מריץ אותו כנוסחה
// (למשל שם אורח "=HYPERLINK(...)"). מספרים — כמו שהם (לחישובים ב-Excel). טהור, חוץ מההורדה.

export interface CsvColumn<T> {
  label: string;
  value: (row: T) => string | number | null | undefined;
}

export const CSV_BOM = "﻿";

export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  const lines = [columns.map((c) => csvCell(c.label)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(c.value(r))).join(","));
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}

/** "reports-bookings-2026-11-01_2026-11-30.csv" — רק אותיות לטיניות, ספרות ומקפים */
export function csvFileName(section: string, from: string, to: string): string {
  const safe = section.replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "report";
  return `reports-${safe}-${from}_${to}.csv`;
}

/** הורדה בדפדפן */
export function downloadCsv(fileName: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
