// מידע על קובץ סרטון — מתוך המכולה עצמה, בלי ffmpeg: אורך ו-codec. משמש את סרטון הפתיח של
// האתר (עד 12 שניות, עד 20MB) — הבדיקה בשרת, על הבייטים שהועלו, ולא על מה שהדפדפן דיווח.
//   • MP4 / MOV (ISO BMFF): moov → mvhd (timescale, duration; ב-fMP4 — mvex/mehd),
//     ו-stsd של רצועת הווידאו (avc1 / hvc1 / hev1 / av01 / vp09).
//   • WebM (EBML): Segment → Info (TimecodeScale, Duration) ו-Tracks → CodecID.
// פונקציות טהורות (גם לבדיקות היחידה). קובץ פגום / קטוע — null, לא חריגה.

export type VideoCodec = "h264" | "hevc" | "av1" | "vp8" | "vp9" | null;
export interface VideoInfo {
  container: "mp4" | "mov" | "webm";
  /** אורך בשניות; null — לא נמצא בקובץ */
  seconds: number | null;
  codec: VideoCodec;
}

export const HERO_VIDEO_MAX_SECONDS = 12;
/** עד 20MB: נכנס במגבלת ההעלאה של השרת (25MB), ו-12 שניות ב-1080p מהטלפון — כ-10–20MB */
export const HERO_VIDEO_MAX_BYTES = 20 * 1024 * 1024;
/** סובלנות קטנה: "12 שניות" בטלפון יוצא לפעמים 12.3 */
const SECONDS_TOLERANCE = 0.5;

const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...Array.from(b.subarray(from, to)));

function u32(b: Uint8Array, at: number): number {
  return ((b[at]! << 24) >>> 0) + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!;
}
function u64(b: Uint8Array, at: number): number {
  return u32(b, at) * 2 ** 32 + u32(b, at + 4);
}

export function videoInfo(bytes: Uint8Array): VideoInfo | null {
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const container = ascii(bytes, 8, 10) === "qt" ? "mov" : "mp4";
    return { container, ...isoInfo(bytes) };
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return { container: "webm", ...webmInfo(bytes) };
  return null;
}

/** למה הסרטון לא מתאים לפתיח (עברית, לבעל העסק) — או null כשהוא תקין */
export function heroVideoProblem(info: VideoInfo | null, size: number): string | null {
  if (!info) return "הקובץ לא נראה כמו סרטון. אפשר MP4, MOV (מהאייפון) או WebM.";
  if (size > HERO_VIDEO_MAX_BYTES)
    return "הסרטון גדול מ-20MB. צלמו ב-1080p (לא ב-4K) או קצרו אותו, ונסו שוב.";
  if (info.seconds === null)
    return "לא הצלחנו לקרוא את אורך הסרטון. שמרו אותו מחדש כ-MP4 ונסו שוב.";
  if (info.seconds > HERO_VIDEO_MAX_SECONDS + SECONDS_TOLERANCE)
    return `הסרטון ארוך מדי (${Math.round(info.seconds)} שניות). עד ${HERO_VIDEO_MAX_SECONDS} שניות — קצרו אותו ונסו שוב.`;
  return null;
}

// ---------- ISO BMFF (MP4 / MOV) ----------

interface Box {
  type: string;
  /** תחילת התוכן (אחרי הכותרת) */
  body: number;
  end: number;
}

function* boxes(b: Uint8Array, start: number, end: number): Generator<Box> {
  let at = start;
  while (at + 8 <= end) {
    let size = u32(b, at);
    const type = ascii(b, at + 4, at + 8);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) return;
      size = u64(b, at + 8);
      header = 16;
    } else if (size === 0) size = end - at;
    if (size < header || at + size > end) return;
    yield { type, body: at + header, end: at + size };
    at += size;
  }
}

const child = (b: Uint8Array, box: Box, type: string) => {
  for (const c of boxes(b, box.body, box.end)) if (c.type === type) return c;
  return null;
};

const ISO_CODECS: Record<string, VideoCodec> = {
  avc1: "h264",
  avc3: "h264",
  hvc1: "hevc",
  hev1: "hevc",
  av01: "av1",
  vp09: "vp9",
  vp08: "vp8",
};

function isoInfo(b: Uint8Array): { seconds: number | null; codec: VideoCodec } {
  let seconds: number | null = null;
  let codec: VideoCodec = null;
  for (const top of boxes(b, 0, b.length)) {
    if (top.type !== "moov") continue;
    const mvhd = child(b, top, "mvhd");
    let timescale = 0;
    if (mvhd && mvhd.end - mvhd.body >= 20) {
      const v1 = b[mvhd.body] === 1;
      timescale = u32(b, mvhd.body + (v1 ? 20 : 12));
      const duration = v1 ? u64(b, mvhd.body + 24) : u32(b, mvhd.body + 16);
      const unknown = v1 ? duration >= 2 ** 64 - 1 : duration === 0xffffffff;
      if (timescale > 0 && duration > 0 && !unknown) seconds = duration / timescale;
    }
    // fMP4: האורך ב-mvex/mehd
    const mehd = (() => {
      const mvex = child(b, top, "mvex");
      return mvex ? child(b, mvex, "mehd") : null;
    })();
    if (seconds === null && mehd && timescale > 0) {
      const v1 = b[mehd.body] === 1;
      const duration = v1 ? u64(b, mehd.body + 4) : u32(b, mehd.body + 4);
      if (duration > 0) seconds = duration / timescale;
    }
    if (seconds === null) seconds = fragmentedSeconds(b, top);
    for (const trak of boxes(b, top.body, top.end)) {
      if (trak.type !== "trak" || codec) continue;
      let stsd: Box | null = trak;
      for (const type of ["mdia", "minf", "stbl", "stsd"])
        stsd = stsd ? child(b, stsd, type) : null;
      // stsd: גרסה + דגלים (4) + מספר רשומות (4) → הרשומה הראשונה: גודל (4) + סוג (4).
      // רצועת קול (mp4a) לא במפה — ממשיכים לרצועה הבאה
      if (stsd && stsd.end - stsd.body >= 16)
        codec = ISO_CODECS[ascii(b, stsd.body + 12, stsd.body + 16)] ?? null;
    }
  }
  return { seconds, codec };
}

/** fMP4 בלי mehd (למשל ffmpeg, הקלטות מסך): סכום משכי הדגימות ב-moof/traf/trun של רצועת הווידאו */
function fragmentedSeconds(b: Uint8Array, moov: Box): number | null {
  // רצועת הווידאו: track_ID (tkhd), timescale (mdhd), ומשך ברירת מחדל (mvex/trex)
  let trackId = -1;
  let timescale = 0;
  for (const trak of boxes(b, moov.body, moov.end)) {
    if (trak.type !== "trak") continue;
    const tkhd = child(b, trak, "tkhd");
    const mdia = child(b, trak, "mdia");
    const hdlr = mdia && child(b, mdia, "hdlr");
    const mdhd = mdia && child(b, mdia, "mdhd");
    if (!tkhd || !hdlr || !mdhd || ascii(b, hdlr.body + 8, hdlr.body + 12) !== "vide") continue;
    trackId = u32(b, tkhd.body + (b[tkhd.body] === 1 ? 20 : 12));
    timescale = u32(b, mdhd.body + (b[mdhd.body] === 1 ? 20 : 12));
    break;
  }
  if (trackId < 0 || timescale <= 0) return null;
  let trexDefault = 0;
  const mvex = child(b, moov, "mvex");
  for (const trex of mvex ? boxes(b, mvex.body, mvex.end) : []) {
    if (trex.type === "trex" && u32(b, trex.body + 4) === trackId)
      trexDefault = u32(b, trex.body + 12);
  }
  let total = 0;
  for (const moof of boxes(b, 0, b.length)) {
    if (moof.type !== "moof") continue;
    for (const traf of boxes(b, moof.body, moof.end)) {
      if (traf.type !== "traf") continue;
      const tfhd = child(b, traf, "tfhd");
      if (!tfhd || u32(b, tfhd.body + 4) !== trackId) continue;
      const tf = u32(b, tfhd.body) & 0xffffff;
      let at = tfhd.body + 8;
      if (tf & 0x01) at += 8; // base_data_offset
      if (tf & 0x02) at += 4; // sample_description_index
      const fallback = tf & 0x08 ? u32(b, at) : trexDefault;
      for (const trun of boxes(b, traf.body, traf.end)) {
        if (trun.type !== "trun") continue;
        const flags = u32(b, trun.body) & 0xffffff;
        const count = u32(b, trun.body + 4);
        if (!(flags & 0x100)) {
          total += count * fallback;
          continue;
        }
        let p = trun.body + 8 + (flags & 0x01 ? 4 : 0) + (flags & 0x04 ? 4 : 0);
        const step = 4 * [0x100, 0x200, 0x400, 0x800].filter((f) => flags & f).length;
        for (let i = 0; i < count && p + 4 <= trun.end; i++, p += step) total += u32(b, p);
      }
    }
  }
  return total > 0 ? total / timescale : null;
}

// ---------- EBML (WebM) ----------

const EBML = {
  segment: 0x18538067,
  info: 0x1549a966,
  timecodeScale: 0x2ad7b1,
  duration: 0x4489,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackType: 0x83,
  codecId: 0x86,
  cluster: 0x1f43b675,
} as const;

/** VINT: אורך לפי מספר האפסים המובילים; במזהה הסימון נשאר, בגודל הוא מוסר */
function vint(b: Uint8Array, at: number, keepMarker: boolean) {
  const first = b[at];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || at + length > b.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === (keepMarker ? first : 0xff >> length);
  for (let i = 1; i < length; i++) {
    value = value * 256 + b[at + i]!;
    if (b[at + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

interface Element {
  id: number;
  body: number;
  end: number;
}

function* elements(b: Uint8Array, start: number, end: number): Generator<Element> {
  let at = start;
  while (at < end) {
    const id = vint(b, at, true);
    if (!id) return;
    const size = vint(b, at + id.length, false);
    if (!size) return;
    const body = at + id.length + size.length;
    const elEnd = size.unknown ? end : Math.min(end, body + size.value);
    if (body > end) return;
    yield { id: id.value, body, end: elEnd };
    // גודל לא ידוע (Segment / Cluster בשידור חי) — ממשיכים לרוץ על הילדים מבפנים
    at = size.unknown ? body : elEnd;
  }
}

function uint(b: Uint8Array, el: Element): number {
  let v = 0;
  for (let i = el.body; i < el.end; i++) v = v * 256 + b[i]!;
  return v;
}

function float(b: Uint8Array, el: Element): number | null {
  const view = new DataView(b.buffer, b.byteOffset + el.body, el.end - el.body);
  if (el.end - el.body === 4) return view.getFloat32(0);
  if (el.end - el.body === 8) return view.getFloat64(0);
  return null;
}

const WEBM_CODECS: Record<string, VideoCodec> = {
  V_VP8: "vp8",
  V_VP9: "vp9",
  V_AV1: "av1",
  "V_MPEG4/ISO/AVC": "h264",
  V_MPEGH_ISO_HEVC: "hevc",
};

function webmInfo(b: Uint8Array): { seconds: number | null; codec: VideoCodec } {
  let scale = 1_000_000; // ננו-שניות לכל יחידת זמן (ברירת המחדל של WebM)
  let duration: number | null = null;
  let codec: VideoCodec = null;
  for (const top of elements(b, 0, b.length)) {
    if (top.id !== EBML.segment) continue;
    for (const el of elements(b, top.body, top.end)) {
      if (el.id === EBML.cluster) break; // המידע תמיד לפני הנתונים
      if (el.id === EBML.info) {
        for (const i of elements(b, el.body, el.end)) {
          if (i.id === EBML.timecodeScale) scale = uint(b, i) || scale;
          if (i.id === EBML.duration) duration = float(b, i);
        }
      }
      if (el.id === EBML.tracks && !codec) {
        for (const entry of elements(b, el.body, el.end)) {
          if (entry.id !== EBML.trackEntry) continue;
          let type = 0;
          let id = "";
          for (const f of elements(b, entry.body, entry.end)) {
            if (f.id === EBML.trackType) type = uint(b, f);
            if (f.id === EBML.codecId) id = ascii(b, f.body, f.end).replace(/\0+$/, "");
          }
          if (type === 1 && !codec) codec = WEBM_CODECS[id] ?? null;
        }
      }
    }
    break;
  }
  const seconds = duration !== null && duration > 0 ? (duration * scale) / 1e9 : null;
  return { seconds, codec };
}
