/**
 * סידור טקסט עברי לצורך הדפסה ב-jsPDF.
 *
 * jsPDF כותב תווים בסדר שבו הם מופיעים במחרוזת (סדר לוגי), בלי אלגוריתם
 * דו-כיווני. לכן מחרוזת עברית תודפס הפוך. כאן ממומש מימוש מצומצם של
 * האלגוריתם הדו-כיווני לפסקה שכיוונה מימין לשמאל:
 *
 *  1. פיצול השורה לרצפים: עברית (RTL), לטינית/ספרות (LTR), וניטרלים
 *     (רווחים, פיסוק, ₪).
 *  2. רצף ניטרלי מקבל כיוון LTR רק אם הוא נמצא בין שני רצפי LTR; בכל
 *     מקרה אחר הוא מקבל את כיוון הפסקה (RTL). כך נקודתיים/רווח שבין
 *     תווית עברית לערך באנגלית נשארים צמודים לתווית.
 *  3. סדר הרצפים מתהפך, ובתוך רצפי RTL גם סדר התווים (וסוגריים ממוינים).
 */

const HEBREW = /[\u0590-\u05FF\uFB1D-\uFB4F]/;
const LATIN_OR_DIGIT = /[A-Za-z0-9]/;
/** סימנים שנצמדים למספר (אחוז, מטבע, פלוס) ולכן נשארים בכיוון שלו */
const NUMBER_TERMINATOR = /^[%$₪+#°]+$/;

const MIRRORED: Record<string, string> = {
  "(": ")",
  ")": "(",
  "[": "]",
  "]": "[",
  "{": "}",
  "}": "{",
  "<": ">",
  ">": "<",
};

type Direction = "rtl" | "ltr" | "neutral";
type Run = { text: string; dir: Direction };

function classify(char: string): Direction {
  if (HEBREW.test(char)) return "rtl";
  if (LATIN_OR_DIGIT.test(char)) return "ltr";
  return "neutral";
}

function splitRuns(line: string): Run[] {
  const runs: Run[] = [];
  for (const char of line) {
    const dir = classify(char);
    const last = runs[runs.length - 1];
    if (last && last.dir === dir) last.text += char;
    else runs.push({ text: char, dir });
  }
  return runs;
}

/** ניטרלים בין שני רצפי LTR נשארים LTR; כל השאר הופכים ל-RTL (כיוון הפסקה) */
function resolveNeutrals(runs: Run[]): Run[] {
  const resolved = runs.map((run, index) => {
    if (run.dir !== "neutral") return run;
    const previous = runs[index - 1]?.dir;
    const next = runs[index + 1]?.dir;
    // סימן שנצמד למספר (18%, ₪120) הולך עם המספר, גם אם הוא בקצה השורה
    const attachedToNumber =
      NUMBER_TERMINATOR.test(run.text) && (previous === "ltr" || next === "ltr");
    const dir: Direction =
      previous === "ltr" && next === "ltr" ? "ltr" : attachedToNumber ? "ltr" : "rtl";
    return { text: run.text, dir } as Run;
  });

  const merged: Run[] = [];
  for (const run of resolved) {
    const last = merged[merged.length - 1];
    if (last && last.dir === run.dir) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged;
}

function reverseRtl(text: string): string {
  return [...text]
    .reverse()
    .map((char) => MIRRORED[char] ?? char)
    .join("");
}

/** ממיר שורה אחת מסדר לוגי לסדר ויזואלי (להדפסה עם היישור לימין) */
export function toVisualRtl(line: string): string {
  if (!HEBREW.test(line)) return line;
  return resolveNeutrals(splitRuns(line))
    .reverse()
    .map((run) => (run.dir === "rtl" ? reverseRtl(run.text) : run.text))
    .join("");
}

/** ממיר מערך שורות (למשל אחרי גלישת שורות) לסדר ויזואלי */
export function toVisualRtlLines(lines: string[]): string[] {
  return lines.map(toVisualRtl);
}
