// סרטון הפתיח (H-1): האורך וה-codec נקראים מהקובץ עצמו — MP4 / MOV / WebM, moov בסוף, רצועת
// קול ראשונה, fMP4 — וההחלטה אם הסרטון מתאים (עד 12 שניות, עד 20MB). קבצי הבדיקה נוצרו ב-ffmpeg
// (tests/fixtures/video, 96×54, כמה KB).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HERO_VIDEO_MAX_BYTES,
  heroVideoProblem,
  videoInfo,
} from "@/engines/hospitality/media/video-info";
import { normalizeDesign } from "@/engines/hospitality/website/design/schema";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, "../fixtures/video", name)));

describe("reading a video's length and codec from the file", () => {
  it.each([
    ["h264-4s.mp4", "mp4", 4, "h264"],
    ["audio-first-5s.mp4", "mp4", 5, "h264"], // moov בסוף הקובץ, רצועת הקול ראשונה
    ["frag-3s.mp4", "mp4", 3, "h264"], // fMP4: האורך ב-mehd
    ["hevc-6s.mov", "mov", 6, "hevc"], // אייפון ("יעילות גבוהה")
    ["hero-3s.webm", "webm", 3, "vp9"],
    ["long-13s.webm", "webm", 13, "vp9"],
  ] as const)("%s", (name, container, seconds, codec) => {
    const info = videoInfo(fixture(name));
    expect(info?.container).toBe(container);
    expect(info?.seconds).toBeCloseTo(seconds, 0);
    expect(info?.codec).toBe(codec);
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

describe("is it right for the hero (up to 12 seconds, up to 20MB)", () => {
  it("short and small — fine; long, big, unreadable or not a video — a Hebrew reason", () => {
    expect(heroVideoProblem(videoInfo(fixture("hero-3s.webm")), 9_456)).toBeNull();
    expect(heroVideoProblem({ container: "mp4", seconds: 12.3, codec: "h264" }, 1)).toBeNull();
    expect(heroVideoProblem(videoInfo(fixture("long-13s.webm")), 23_716)).toBe(
      "הסרטון ארוך מדי (13 שניות). עד 12 שניות — קצרו אותו ונסו שוב.",
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
