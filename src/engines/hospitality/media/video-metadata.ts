// הסרת המטא-דאטה האישי מסרטון MP4 / MOV לפני שהוא נשמר בדלי הציבורי — בלי קידוד מחדש ובלי ffmpeg.
// סרטון מהאייפון / מהאנדרואיד נושא את מקום הצילום (©xyz, loci, com.apple.quicktime.location.ISO6709),
// את דגם המכשיר, את גרסת התוכנה ואת תאריך הצילום. תמונות עוברות קידוד מחדש עם sharp (שמסיר הכול);
// סרטונים נשמרים כמו שהם — ולכן כאן:
//   • כל תיבת מטא-דאטה — udta / meta / XMP (uuid) ברמת הקובץ, ב-moov ובכל trak — הופכת לתיבת free
//     באותו גודל, והתוכן שלה מתאפס. שום גודל ושום היסט בקובץ לא זזים (stco / co64 נשארים נכונים),
//     ונגנים מדלגים על free;
//   • בכותרות mvhd / tkhd / mdhd — זמני היצירה והשינוי מתאפסים;
//   • רצועות המדיה, המשכים והסיבוב (המטריצה ב-tkhd) — לא נוגעים.
// לא מכוסה: רצועת מטא-דאטה מתוזמנת (GPS לאורך הסרטון — מצלמות אקסטרים / רחפנים) ו-WebM (מהדפדפן
// ומהטלפון אין בו מיקום). פתרון מלא לשני אלה — המרה בשרת (docs/hospitality/release-events-contracts.md).
// פונקציה טהורה: מחזירה עותק; קובץ שאינו ISO BMFF — כמו שהוא.

interface Box {
  type: string;
  start: number;
  body: number;
  end: number;
}

const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...Array.from(b.subarray(from, to)));

function u32(b: Uint8Array, at: number): number {
  return ((b[at]! << 24) >>> 0) + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!;
}

function* boxes(b: Uint8Array, start: number, end: number): Generator<Box> {
  let at = start;
  while (at + 8 <= end) {
    let size = u32(b, at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) return;
      size = u32(b, at + 8) * 2 ** 32 + u32(b, at + 12);
      header = 16;
    } else if (size === 0) size = end - at;
    if (size < header || at + size > end) return;
    yield { type: ascii(b, at + 4, at + 8), start: at, body: at + header, end: at + size };
    at += size;
  }
}

/** ה-UUID של XMP (Adobe) — מטא-דאטה שיכול לכלול גם מיקום */
const XMP_UUID = [
  0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac,
];
const FREE = [0x66, 0x72, 0x65, 0x65]; // "free"

export interface StrippedVideo {
  bytes: Uint8Array;
  /** מה הוסר (לבדיקות וליומן): "moov/udta", "moov/trak/meta"… */
  removed: string[];
}

export function stripVideoMetadata(input: Uint8Array): StrippedVideo {
  if (!(input.length >= 12 && ascii(input, 4, 8) === "ftyp")) return { bytes: input, removed: [] };
  const b = new Uint8Array(input);
  const removed: string[] = [];
  const isMetadata = (box: Box) =>
    box.type === "udta" ||
    box.type === "meta" ||
    (box.type === "uuid" &&
      box.end - box.body >= 16 &&
      XMP_UUID.every((v, i) => b[box.body + i] === v));
  const neutralize = (box: Box, path: string) => {
    b.set(FREE, box.start + 4);
    b.fill(0, box.body, box.end);
    removed.push(path);
  };
  // גרסה + דגלים (4), ואז זמן יצירה וזמן שינוי: 32 ביט כל אחד (גרסה 0) או 64 ביט (גרסה 1)
  const clearTimes = (box: Box | null) => {
    if (!box) return;
    const bytes = b[box.body] === 1 ? 16 : 8;
    if (box.end - box.body >= 4 + bytes) b.fill(0, box.body + 4, box.body + 4 + bytes);
  };
  for (const top of boxes(b, 0, b.length)) {
    if (isMetadata(top)) {
      neutralize(top, top.type);
      continue;
    }
    if (top.type !== "moov") continue;
    for (const m of boxes(b, top.body, top.end)) {
      if (isMetadata(m)) neutralize(m, `moov/${m.type}`);
      else if (m.type === "mvhd") clearTimes(m);
      else if (m.type === "trak") {
        for (const t of boxes(b, m.body, m.end)) {
          if (isMetadata(t)) neutralize(t, `moov/trak/${t.type}`);
          else if (t.type === "tkhd") clearTimes(t);
          else if (t.type === "mdia") {
            for (const d of boxes(b, t.body, t.end)) if (d.type === "mdhd") clearTimes(d);
          }
        }
      }
    }
  }
  return { bytes: b, removed };
}
