// מידע על קובץ סרטון — מתוך המכולה עצמה, בלי ffmpeg: אורך ו-codec. משמש את סרטון הפתיח של
// האתר (עד 15 שניות, עד 20MB) — הבדיקה בשרת, על הבייטים שהועלו, ולא על מה שהדפדפן דיווח
// (וגם לא לפי הסיומת). האורך = הארוך מבין כל מה שהקובץ מראה, כדי שקובץ "שמצהיר" על אורך קצר
// מהתוכן האמיתי לא יעבור:
//   • MP4 / MOV (ISO BMFF): mvhd, mvex/mehd, ולכל רצועה — mdhd ומשך הדגימות בפועל (stts);
//     ב-fMP4 בלי mehd — סכום הדגימות ב-moof/traf/trun. ה-codec מ-stsd של רצועת הווידאו
//     (avc1 / hvc1 / hev1 / av01 / vp09);
//   • WebM (EBML): Info (TimecodeScale, Duration — חסר בהקלטות מהדפדפן), וגם הזמן של הפריים
//     האחרון בפועל (Cluster → Timecode + SimpleBlock / Block). ה-codec מ-Tracks → CodecID.
// פונקציות טהורות (גם לבדיקות היחידה). קובץ פגום / קטוע — null, לא חריגה.

export type VideoCodec = "h264" | "hevc" | "av1" | "vp8" | "vp9" | null;
export interface VideoInfo {
  container: "mp4" | "mov" | "webm";
  /** אורך בשניות; null — לא נמצא בקובץ */
  seconds: number | null;
  codec: VideoCodec;
}

export const HERO_VIDEO_MAX_SECONDS = 15;
/** עד 20MB: נכנס במגבלת ההעלאה של השרת (25MB), ו-15 שניות ב-1080p מהטלפון — כ-12–20MB */
export const HERO_VIDEO_MAX_BYTES = 20 * 1024 * 1024;
/** סובלנות קטנה: "15 שניות" בטלפון יוצא לפעמים 15.3. אותו גבול גם במסד (מיגרציה 62) */
export const HERO_VIDEO_TOLERANCE_SECONDS = 0.5;
/** הנגן באתר עוצר כל סיבוב כאן — גם אם הקובץ באחסון הוחלף אחרי שהשרת מדד אותו */
export const HERO_VIDEO_PLAY_LIMIT_SECONDS = HERO_VIDEO_MAX_SECONDS + HERO_VIDEO_TOLERANCE_SECONDS;

/**
 * האם לעצור עכשיו את הסיבוב של סרטון הפתיח: הגיע לגבול, והקובץ לא מסתיים לבד עד הגבול (ארוך
 * מהמותר, או בלי אורך ידוע — הקלטה בלי Duration). סרטון שנמדד כתקין מסתיים לבד, ולא נחתך.
 */
export function heroPlaybackOverLimit(currentTime: number, duration: number): boolean {
  if (!(currentTime >= HERO_VIDEO_PLAY_LIMIT_SECONDS)) return false;
  return !(Number.isFinite(duration) && duration <= HERO_VIDEO_PLAY_LIMIT_SECONDS);
}

/** האם אורך שנמדד בשרת מתאים לפתיח (null — לא נמדד / לא נקרא: לא מתאים) */
export function heroVideoFits(seconds: number | null | undefined): boolean {
  return (
    typeof seconds === "number" &&
    Number.isFinite(seconds) &&
    seconds > 0 &&
    seconds <= HERO_VIDEO_MAX_SECONDS + HERO_VIDEO_TOLERANCE_SECONDS
  );
}

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
  if (!heroVideoFits(info.seconds))
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

/** mvhd / mdhd: timescale ומשך (גרסה 0 — 32 ביט, גרסה 1 — 64 ביט); "לא ידוע" / 0 — null */
function headerDuration(
  b: Uint8Array,
  box: Box | null,
): { timescale: number; seconds: number | null } {
  if (!box || box.end - box.body < 20) return { timescale: 0, seconds: null };
  const v1 = b[box.body] === 1;
  if (v1 && box.end - box.body < 32) return { timescale: 0, seconds: null };
  const timescale = u32(b, box.body + (v1 ? 20 : 12));
  const duration = v1 ? u64(b, box.body + 24) : u32(b, box.body + 16);
  const unknown = v1 ? duration >= 2 ** 64 - 1 : duration === 0xffffffff;
  return {
    timescale,
    seconds: timescale > 0 && duration > 0 && !unknown ? duration / timescale : null,
  };
}

/** משך הדגימות בפועל ברצועה (stts: מספר דגימות × משך לכל רשומה), ביחידות של ה-mdhd */
function sampleSeconds(b: Uint8Array, stbl: Box | null, timescale: number): number | null {
  const stts = stbl ? child(b, stbl, "stts") : null;
  if (!stts || timescale <= 0 || stts.end - stts.body < 8) return null;
  const count = u32(b, stts.body + 4);
  let total = 0;
  for (let i = 0, p = stts.body + 8; i < count && p + 8 <= stts.end; i++, p += 8)
    total += u32(b, p) * u32(b, p + 4);
  return total > 0 ? total / timescale : null;
}

/** מספר הדגימות ברצועה (stts) */
function sampleCount(b: Uint8Array, stbl: Box | null): number {
  const stts = stbl ? child(b, stbl, "stts") : null;
  if (!stts || stts.end - stts.body < 8) return 0;
  const count = u32(b, stts.body + 4);
  let total = 0;
  for (let i = 0, p = stts.body + 8; i < count && p + 8 <= stts.end; i++, p += 8)
    total += u32(b, p);
  return total;
}

const longest = (values: (number | null)[]): number | null => {
  const real = values.filter((v): v is number => v !== null && Number.isFinite(v) && v > 0);
  return real.length ? Math.max(...real) : null;
};

/**
 * יותר פריימים בשנייה מזה — האורך שנמדד לא אמין: הרבה פריימים ב"כמעט אפס זמן" הם סימן לקובץ שנבנה
 * כדי להיראות קצר (משכי הדגימות מכווצים, והזמן האמיתי במקום אחר בקובץ). גם סלואו-מושן מהטלפון
 * (240 / 960) רחוק מזה
 */
const MAX_PLAUSIBLE_FPS = 1000;

function isoInfo(b: Uint8Array): { seconds: number | null; codec: VideoCodec } {
  const candidates: (number | null)[] = [];
  let codec: VideoCodec = null;
  let videoSamples = 0;
  for (const top of boxes(b, 0, b.length)) {
    if (top.type !== "moov") continue;
    const movie = headerDuration(b, child(b, top, "mvhd"));
    candidates.push(movie.seconds);
    // fMP4: האורך ב-mvex/mehd
    const mehd = (() => {
      const mvex = child(b, top, "mvex");
      return mvex ? child(b, mvex, "mehd") : null;
    })();
    if (mehd && movie.timescale > 0 && mehd.end - mehd.body >= 8) {
      const v1 = b[mehd.body] === 1;
      const duration = v1 ? u64(b, mehd.body + 4) : u32(b, mehd.body + 4);
      if (duration > 0) candidates.push(duration / movie.timescale);
    }
    const fragments = fragmentedSeconds(b, top);
    candidates.push(fragments.seconds);
    videoSamples += fragments.samples;
    // כל רצועה: ה-mdhd שלה וסכום הדגימות בפועל — כותרת "קצרה" לא מסתירה תוכן ארוך
    for (const trak of boxes(b, top.body, top.end)) {
      if (trak.type !== "trak") continue;
      const mdia = child(b, trak, "mdia");
      const media = headerDuration(b, mdia ? child(b, mdia, "mdhd") : null);
      const minf = mdia ? child(b, mdia, "minf") : null;
      const stbl = minf ? child(b, minf, "stbl") : null;
      candidates.push(media.seconds, sampleSeconds(b, stbl, media.timescale));
      const hdlr = mdia && child(b, mdia, "hdlr");
      if (hdlr && hdlr.end - hdlr.body >= 12 && ascii(b, hdlr.body + 8, hdlr.body + 12) === "vide")
        videoSamples += sampleCount(b, stbl);
    }
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
  let seconds = longest(candidates);
  if (seconds !== null && videoSamples / seconds > MAX_PLAUSIBLE_FPS) seconds = null;
  return { seconds, codec };
}

/**
 * fMP4 (למשל ffmpeg, הקלטות מסך): האורך מ-moof/traf של רצועת הווידאו — הארוך מבין סכום משכי
 * הדגימות (trun) לבין המקום שאליו מגיע המקטע האחרון: tfdt (baseMediaDecodeTime — לפיו נגנים ו-ffmpeg
 * מציבים כל מקטע) ועוד משכי הדגימות שבו. אחרת קובץ עם "קפיצות" ב-tfdt ייראה קצר ויתנגן ארוך.
 * גם מספר הדגימות — לבדיקת הסבירות (MAX_PLAUSIBLE_FPS)
 */
function fragmentedSeconds(b: Uint8Array, moov: Box): { seconds: number | null; samples: number } {
  const none = { seconds: null, samples: 0 };
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
  if (trackId < 0 || timescale <= 0) return none;
  let trexDefault = 0;
  const mvex = child(b, moov, "mvex");
  for (const trex of mvex ? boxes(b, mvex.body, mvex.end) : []) {
    if (trex.type === "trex" && u32(b, trex.body + 4) === trackId)
      trexDefault = u32(b, trex.body + 12);
  }
  let total = 0;
  let end = 0;
  let samples = 0;
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
      let duration = 0;
      for (const trun of boxes(b, traf.body, traf.end)) {
        if (trun.type !== "trun") continue;
        const flags = u32(b, trun.body) & 0xffffff;
        const count = u32(b, trun.body + 4);
        samples += count;
        if (!(flags & 0x100)) {
          duration += count * fallback;
          continue;
        }
        let p = trun.body + 8 + (flags & 0x01 ? 4 : 0) + (flags & 0x04 ? 4 : 0);
        const step = 4 * [0x100, 0x200, 0x400, 0x800].filter((f) => flags & f).length;
        for (let i = 0; i < count && p + 4 <= trun.end; i++, p += step) duration += u32(b, p);
      }
      total += duration;
      // tfdt: גרסה + דגלים (4), ואז baseMediaDecodeTime — 32 ביט (גרסה 0) או 64 ביט (גרסה 1)
      const tfdt = child(b, traf, "tfdt");
      if (tfdt) {
        const v1 = b[tfdt.body] === 1;
        if (tfdt.end - tfdt.body >= (v1 ? 12 : 8))
          end = Math.max(end, (v1 ? u64(b, tfdt.body + 4) : u32(b, tfdt.body + 4)) + duration);
      }
    }
  }
  const longestEnd = Math.max(total, end);
  return { seconds: longestEnd > 0 ? longestEnd / timescale : null, samples };
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
  clusterTimecode: 0xe7,
  simpleBlock: 0xa3,
  blockGroup: 0xa0,
  block: 0xa1,
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
  /** גודל לא ידוע (שידור / הקלטה חיה): elements() ממשיך לתוך הילדים כאילו היו אחים */
  unknown: boolean;
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
    yield { id: id.value, body, end: elEnd, unknown: size.unknown };
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

/** הזמן היחסי של בלוק (SimpleBlock / Block): מספר הרצועה (VINT) ואז int16 */
function blockOffset(b: Uint8Array, el: Element): number | null {
  const track = vint(b, el.body, false);
  if (!track || el.body + track.length + 2 > el.end) return null;
  const at = el.body + track.length;
  const raw = (b[at]! << 8) | b[at + 1]!;
  return raw >= 0x8000 ? raw - 0x10000 : raw;
}

function webmInfo(b: Uint8Array): { seconds: number | null; codec: VideoCodec } {
  let scale = 1_000_000; // ננו-שניות לכל יחידת זמן (ברירת המחדל של WebM)
  let duration: number | null = null;
  let codec: VideoCodec = null;
  // הפריים האחרון בפועל: Timecode של ה-Cluster + הזמן היחסי של הבלוק. Cluster בגודל לא ידוע
  // (הקלטה חיה) — הילדים שלו מגיעים כאחים באותה לולאה, ולכן אותו טיפול בשתי הרמות
  let clusterTime = 0;
  let lastFrame: number | null = null;
  const frame = (el: Element) => {
    const offset = el.id === EBML.simpleBlock || el.id === EBML.block ? blockOffset(b, el) : null;
    if (offset !== null) lastFrame = Math.max(lastFrame ?? 0, clusterTime + offset);
  };
  const clusterPart = (el: Element) => {
    if (el.id === EBML.clusterTimecode) clusterTime = uint(b, el);
    else if (el.id === EBML.simpleBlock) frame(el);
    else if (el.id === EBML.blockGroup)
      for (const g of elements(b, el.body, el.end)) if (g.id === EBML.block) frame(g);
  };
  for (const top of elements(b, 0, b.length)) {
    if (top.id !== EBML.segment) continue;
    for (const el of elements(b, top.body, top.end)) {
      if (el.id === EBML.cluster) {
        // גודל ידוע: הילדים בפנים; לא ידוע — elements() כבר ממשיך לתוכו (הילדים יגיעו כאחים)
        if (!el.unknown) for (const c of elements(b, el.body, el.end)) clusterPart(c);
        continue;
      }
      clusterPart(el);
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
  const toSeconds = (units: number | null) =>
    units !== null && Number.isFinite(units) && units > 0 ? (units * scale) / 1e9 : null;
  return { seconds: longest([toSeconds(duration), toSeconds(lastFrame)]), codec };
}
