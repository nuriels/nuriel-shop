// סרטון הפתיח (H-1, מיגרציה 62): האורך וה-codec נקראים מהקובץ עצמו — MP4 / MOV / WebM, moov בסוף,
// רצועת קול ראשונה, fMP4, הקלטה בלי Duration, וקובץ ש"מצהיר" על אורך קצר מהתוכן — וההחלטה אם הסרטון
// מתאים (עד 15 שניות, עד 20MB). קבצי הבדיקה נוצרו ב-ffmpeg (tests/fixtures/video, 96×54, כמה KB);
// frag-tfdt-lie-20s.mp4 ו-squashed-timeline.mp4 — אותם קבצים אחרי תיקון בייטים (משכי דגימות של טיק).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HERO_VIDEO_MAX_BYTES,
  HERO_VIDEO_MAX_SECONDS,
  HERO_VIDEO_PLAY_LIMIT_SECONDS,
  heroPlaybackOverLimit,
  heroVideoFits,
  heroVideoProblem,
  videoInfo,
} from "@/engines/hospitality/media/video-info";
import { stripVideoMetadata } from "@/engines/hospitality/media/video-metadata";
import { normalizeDesign } from "@/engines/hospitality/website/design/schema";
import { heroVideoStatus, videoById } from "@/engines/hospitality/website/lib/media";
import type { PublicMedia, PublicSite } from "@/engines/hospitality/types/website";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, "../fixtures/video", name)));

describe("reading a video's length and codec from the file", () => {
  it.each([
    ["h264-4s.mp4", "mp4", 4, "h264"],
    ["audio-first-5s.mp4", "mp4", 5, "h264"], // moov בסוף הקובץ, רצועת הקול ראשונה
    ["frag-3s.mp4", "mp4", 3, "h264"], // fMP4: האורך ב-mehd
    ["hevc-6s.mov", "mov", 6, "hevc"], // אייפון ("יעילות גבוהה")
    ["hero-3s.webm", "webm", 3, "vp9"],
    ["hero-2s.webm", "webm", 2, "vp9"],
    ["long-13s.webm", "webm", 13, "vp9"],
    ["edge-15s.webm", "webm", 15, "vp9"],
    ["long-16s.webm", "webm", 16, "vp9"],
    ["h264-16s.mp4", "mp4", 16, "h264"],
    ["live-4s.webm", "webm", 4, "vp9"], // הקלטה "חיה" בלי Duration — לפי הפריים האחרון
    // הכותרת אומרת 4 שניות (mvhd / tkhd), הדגימות עצמן — 16
    ["lying-mvhd-16s.mp4", "mp4", 16, "h264"],
    // Info/Duration אומר 3 שניות, הפריים האחרון — 15.8 (אחריו עוד פריים של 0.2)
    ["lying-duration-16s.webm", "webm", 16, "vp9"],
  ] as const)("%s", (name, container, seconds, codec) => {
    const info = videoInfo(fixture(name));
    expect(info?.container).toBe(container);
    expect(info?.seconds).toBeCloseTo(seconds, 0);
    expect(info?.codec).toBe(codec);
  });

  it("a file built to look short: fMP4 with the real timeline only in tfdt; a squashed timeline", () => {
    // כל דגימה "באורך" טיק אחד, אבל tfdt של כל מקטע מציב אותו על ציר של 20 שניות (כך נגנים
    // ו-ffmpeg מנגנים אותו) — נמדד לפי המקום שאליו מגיע המקטע האחרון, לא לפי סכום הדגימות
    const tfdt = fixture("frag-tfdt-lie-20s.mp4");
    const info = videoInfo(tfdt);
    expect(info?.seconds).toBeCloseTo(19.5, 0);
    expect(heroVideoProblem(info, tfdt.length)).toContain("ארוך מדי");
    // דגימות וכותרות של טיק אחד: אלפי פריימים לשנייה — האורך לא אמין, הקובץ לא מתקבל
    const squashed = fixture("squashed-timeline.mp4");
    const squashedInfo = videoInfo(squashed);
    expect(squashedInfo).toEqual({ container: "mp4", seconds: null, codec: "h264" });
    expect(heroVideoProblem(squashedInfo, squashed.length)).toContain(
      "לא הצלחנו לקרוא את אורך הסרטון",
    );
  });

  it("not a video, an empty or a cut file → no crash", () => {
    expect(videoInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    expect(videoInfo(new Uint8Array())).toBeNull();
    const cut = fixture("h264-4s.mp4").subarray(0, 40);
    expect(videoInfo(cut)).toEqual({ container: "mp4", seconds: null, codec: null });
    const cutWebm = fixture("hero-3s.webm").subarray(0, 30);
    expect(videoInfo(cutWebm)?.container).toBe("webm");
  });
});

describe("a synthetic live WebM: unknown-size Segment and Clusters, no Duration", () => {
  // EBML בכתב יד: כל אלמנט — מזהה, גודל (VINT), תוכן; גודל לא ידוע — 0x01FFFFFFFFFFFFFF
  const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  const size = (n: number) => [0x80 | n];
  const el = (id: number[], body: number[]) => [...id, ...size(body.length), ...body];
  const block = (rel: number) => el([0xa3], [0x81, (rel >> 8) & 0xff, rel & 0xff, 0x80, 0, 0]);
  const bytes = new Uint8Array([
    ...el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], [0x77, 0x65, 0x62, 0x6d])), // EBML: DocType webm
    ...[0x18, 0x53, 0x80, 0x67, ...UNKNOWN], // Segment
    ...el([0x15, 0x49, 0xa9, 0x66], el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40])), // Info: TimecodeScale 1ms
    ...el(
      [0x16, 0x54, 0xae, 0x6b],
      el([0xae], [...el([0x83], [1]), ...el([0x86], [...Buffer.from("V_VP9")])]),
    ),
    ...[0x1f, 0x43, 0xb6, 0x75, ...UNKNOWN, ...el([0xe7], [0]), ...block(0), ...block(900)],
    ...[0x1f, 0x43, 0xb6, 0x75, ...UNKNOWN, ...el([0xe7], [0x1b, 0x58]), ...block(500)], // 7000ms + 500
  ]);
  it("the length is the last frame (7.5 s), the codec from Tracks", () => {
    expect(videoInfo(bytes)).toEqual({ container: "webm", seconds: 7.5, codec: "vp9" });
  });
});

describe("is it right for the hero (up to 15 seconds, up to 20MB)", () => {
  it("the limit is 15 seconds with half a second of tolerance", () => {
    expect(HERO_VIDEO_MAX_SECONDS).toBe(15);
    expect(heroVideoFits(15.5)).toBe(true);
    expect(heroVideoFits(15.51)).toBe(false);
    expect(heroVideoFits(0)).toBe(false);
    expect(heroVideoFits(null)).toBe(false);
    expect(heroVideoFits(undefined)).toBe(false);
    expect(heroVideoFits(Number.NaN)).toBe(false);
  });

  it("short and small — fine; long, big, unreadable or not a video — a Hebrew reason", () => {
    expect(heroVideoProblem(videoInfo(fixture("hero-3s.webm")), 9_456)).toBeNull();
    expect(heroVideoProblem(videoInfo(fixture("edge-15s.webm")), 22_448)).toBeNull();
    expect(heroVideoProblem({ container: "mp4", seconds: 15.3, codec: "h264" }, 1)).toBeNull();
    expect(heroVideoProblem(videoInfo(fixture("long-13s.webm")), 23_716)).toBeNull();
    expect(heroVideoProblem(videoInfo(fixture("long-16s.webm")), 23_583)).toBe(
      "הסרטון ארוך מדי (16 שניות). עד 15 שניות — קצרו אותו ונסו שוב.",
    );
    // "12 דקות" — נדחה לפי הקובץ, לא לפי מה שהדפדפן אמר
    expect(heroVideoProblem({ container: "mp4", seconds: 720, codec: "h264" }, 1)).toBe(
      "הסרטון ארוך מדי (720 שניות). עד 15 שניות — קצרו אותו ונסו שוב.",
    );
    expect(heroVideoProblem(videoInfo(fixture("lying-mvhd-16s.mp4")), 15_875)).toContain(
      "ארוך מדי",
    );
    expect(heroVideoProblem(videoInfo(fixture("lying-duration-16s.webm")), 23_583)).toContain(
      "ארוך מדי",
    );
    expect(
      heroVideoProblem({ container: "mp4", seconds: 5, codec: "h264" }, HERO_VIDEO_MAX_BYTES + 1),
    ).toContain("גדול מ-20MB");
    expect(heroVideoProblem({ container: "webm", seconds: null, codec: "vp8" }, 1)).toContain(
      "לא הצלחנו לקרוא את אורך הסרטון",
    );
    expect(heroVideoProblem(null, 1)).toContain("לא נראה כמו סרטון");
  });
});

describe("the player stops a round at the limit (also if the stored file was replaced after the check)", () => {
  it("cuts at 15.5 s a file that is longer or has no known length; a file that ends by itself is never cut", () => {
    expect(HERO_VIDEO_PLAY_LIMIT_SECONDS).toBe(15.5);
    // replaced in storage with a longer file (60 s), or a recording without Duration (Infinity / NaN)
    expect(heroPlaybackOverLimit(15.49, 60)).toBe(false);
    expect(heroPlaybackOverLimit(15.5, 60)).toBe(true);
    expect(heroPlaybackOverLimit(15.7, Number.POSITIVE_INFINITY)).toBe(true);
    expect(heroPlaybackOverLimit(15.7, Number.NaN)).toBe(true);
    // a measured video (up to 15.5 s) ends by itself — the "ended" event moves to the image
    expect(heroPlaybackOverLimit(15.5, 15.5)).toBe(false);
    expect(heroPlaybackOverLimit(4, 4.04)).toBe(false);
    expect(heroPlaybackOverLimit(Number.NaN, 60)).toBe(false);
  });
});

describe("the hero section keeps its video", () => {
  it("a video id on the hero only; not on other sections; not a garbage value", () => {
    const id = "6a1e0000-0000-4000-8000-0000000000aa";
    const d = normalizeDesign({
      sections: [
        { id: "h", type: "hero", hidden: false, content: { video: id.toUpperCase() } },
        { id: "a", type: "about", hidden: false, content: { video: id } },
        { id: "g", type: "gallery", hidden: false, content: { video: "../etc" } },
      ],
    });
    const byType = (t: string) => d.sections.find((s) => s.type === t)?.content ?? {};
    expect(byType("hero").video).toBe(id);
    expect(byType("about").video).toBeUndefined();
    expect(byType("gallery").video).toBeUndefined();
  });
});

describe("the site shows a hero video only when the server measured it at up to 15 seconds", () => {
  const media = (
    id: string,
    seconds: number | null | undefined,
    kind: PublicMedia["kind"] = "video",
  ) =>
    ({
      id,
      kind,
      alt: null,
      width: null,
      height: null,
      is_cover: false,
      is_demo: false,
      embed_provider: null,
      embed_id: null,
      url: kind === "embed" ? null : `https://x.test/${id}`,
      srcset: null,
      thumb_url: null,
      ...(seconds === undefined ? {} : { seconds }),
    }) as PublicMedia;
  const site = {
    gallery: [
      media("short", 4.04),
      media("edge", 15.5),
      media("long", 16.2),
      media("unchecked", null),
      media("legacy", undefined), // מסד לפני מיגרציה 62 — בלי השדה בכלל
      media("photo", null, "image"),
    ],
    properties: [{ media: [media("prop-clip", 9)] }],
    units: [{ media: [] }],
  } as unknown as PublicSite;

  it("measured and short — shown; long, unmeasured, an image, unknown — not (the image stays)", () => {
    expect(videoById(site, "short")?.id).toBe("short");
    expect(videoById(site, "edge")?.id).toBe("edge");
    expect(videoById(site, "prop-clip")?.id).toBe("prop-clip");
    for (const id of ["long", "unchecked", "legacy", "photo", "nope", undefined])
      expect(videoById(site, id)).toBeNull();
  });

  it("the editor explains why a chosen video is not shown", () => {
    expect(heroVideoStatus(site, undefined)).toEqual({ status: "none", seconds: null });
    expect(heroVideoStatus(site, "short")).toEqual({ status: "ok", seconds: 4.04 });
    expect(heroVideoStatus(site, "long")).toEqual({ status: "too_long", seconds: 16.2 });
    expect(heroVideoStatus(site, "unchecked")).toEqual({ status: "not_checked", seconds: null });
    expect(heroVideoStatus(site, "legacy")).toEqual({ status: "not_checked", seconds: null });
    expect(heroVideoStatus(site, "photo")).toEqual({ status: "missing", seconds: null });
    expect(heroVideoStatus(site, "nope")).toEqual({ status: "missing", seconds: null });
  });
});

describe("a video goes to the public bucket without the personal metadata (no re-encoding)", () => {
  // location-2s.mov: מיקום (©xyz / loci), com.apple.quicktime.location.ISO6709, דגם המכשיר ותאריך הצילום
  const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");
  it("the location, the device and the date are gone; the size, the length and the frames stay", () => {
    const src = fixture("location-2s.mov");
    expect(text(src)).toContain("+32.0853+034.7818");
    expect(text(src)).toContain("iPhone 15 Pro");
    const out = stripVideoMetadata(src);
    expect(out.removed).toContain("moov/udta");
    for (const s of ["+32.0853", "034.7818", "com.apple", "iPhone", "loci"])
      expect(text(out.bytes)).not.toContain(s);
    // באותו גודל — שום היסט לא זז, והסרטון נקרא בדיוק כמו קודם
    expect(out.bytes.length).toBe(src.length);
    expect(videoInfo(out.bytes)).toEqual(videoInfo(src));
    // המקור לא השתנה (עותק)
    expect(text(src)).toContain("+32.0853+034.7818");
  });

  it("a file without metadata, a WebM, garbage — unchanged", () => {
    const webm = fixture("hero-2s.webm");
    expect(stripVideoMetadata(webm).bytes).toBe(webm);
    const junk = new Uint8Array([1, 2, 3, 4, 5]);
    expect(stripVideoMetadata(junk).bytes).toBe(junk);
    const plain = fixture("h264-4s.mp4");
    const out = stripVideoMetadata(plain);
    expect(videoInfo(out.bytes)).toEqual(videoInfo(plain));
    expect(out.bytes.length).toBe(plain.length);
  });
});
