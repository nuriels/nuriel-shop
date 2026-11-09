// Stage 2e — תמונות וגלריות: בדיקת התוכן האמיתי וקידוד מחדש (sharp), סירוב ל-SVG / HTML /
// קבצים "כפולים", סרטונים לפי החתימה, הגנת SSRF של מתאם ההורדה (בלי רשת: הכתובת נחסמת לפני
// החיבור), קישורי YouTube / Vimeo וקלט הגלריה.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { prepareMedia, sniffVideoType } from "@/engines/hospitality/server/media.server";
import {
  altError,
  formatBytes,
  parseGallery,
  parseImportInput,
  parseMediaOrder,
  parseUploadForm,
  parseVideoLink,
  parseVideoLinkInput,
} from "@/engines/hospitality/validation/media";
import {
  assertFetchableUrl,
  fetchRemoteImage,
  isBlockedAddress,
} from "@/platform/media/remote-image.server";

const SITE = "6a1e0000-0000-4000-8000-000000000001";
const A = "6a1e0000-0000-4000-8000-0000000000a1";
const B = "6a1e0000-0000-4000-8000-0000000000b2";

const jpeg = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 120, b: 200 } } })
    .withMetadata({ exif: { IFD0: { Copyright: "secret-owner", Artist: "x" } } })
    .jpeg()
    .toBuffer();

describe("prepareMedia: real content, re-encoded", () => {
  it("a JPEG becomes 4 WebP files under <site>/<uuid>, metadata stripped, sizes bounded", async () => {
    const out = await prepareMedia(SITE, await jpeg(3000, 2000), true);
    expect(out.kind).toBe("image");
    expect(out.files.map((f) => f.path.replace(/[0-9a-f-]{36}(?=[-.])/, "ID"))).toEqual([
      `${SITE}/ID.webp`,
      `${SITE}/ID-960.webp`,
      `${SITE}/ID-480.webp`,
      `${SITE}/ID-thumb.webp`,
    ]);
    const main = await sharp(out.files[0]!.bytes).metadata();
    expect(main.format).toBe("webp");
    expect(Math.max(main.width!, main.height!)).toBe(1600);
    expect(main.exif).toBeUndefined();
    const thumb = await sharp(out.files[3]!.bytes).metadata();
    expect([thumb.width, thumb.height]).toEqual([320, 240]);
    expect(out.item.size_bytes).toBe(out.files.reduce((n, f) => n + f.bytes.length, 0));
    expect(out.item.variants["960"]).toBe(out.item.storage_path.replace(".webp", "-960.webp"));
  });
  it("a small image is not enlarged", async () => {
    const out = await prepareMedia(SITE, await jpeg(400, 300), true);
    expect([out.item.width, out.item.height]).toEqual([400, 300]);
  });
  it("refuses SVG, HTML, a renamed text file and a broken image — by content, not by name", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
    await expect(prepareMedia(SITE, svg, true)).rejects.toThrow(/SVG/);
    await expect(
      prepareMedia(SITE, Buffer.from("<!doctype html><script>x</script>"), true),
    ).rejects.toThrow(/אינו תמונה/);
    await expect(
      prepareMedia(SITE, Buffer.from("just text pretending to be a.jpg"), true),
    ).rejects.toThrow(/אינו תמונה/);
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
    await expect(prepareMedia(SITE, broken, true)).rejects.toThrow(/פגום/);
  });
  it("a polyglot (image + appended script) is re-encoded: the extra bytes are gone", async () => {
    const poly = Buffer.concat([
      await jpeg(200, 200),
      Buffer.from("<script>alert(document.cookie)</script>"),
    ]);
    const out = await prepareMedia(SITE, poly, true);
    for (const f of out.files) expect(f.bytes.includes(Buffer.from("<script>"))).toBe(false);
  });
  it("videos by signature: MP4 / MOV / WebM; no video from a link import", async () => {
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from("ftypisom"),
      Buffer.alloc(32),
    ]);
    const mov = Buffer.concat([
      Buffer.from([0, 0, 0, 0x14]),
      Buffer.from("ftypqt  "),
      Buffer.alloc(32),
    ]);
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(32)]);
    expect([sniffVideoType(mp4), sniffVideoType(mov), sniffVideoType(webm)]).toEqual([
      "mp4",
      "mov",
      "webm",
    ]);
    const out = await prepareMedia(SITE, mp4, true);
    expect(out.item).toMatchObject({ kind: "video", variants: {}, width: null });
    expect(out.item.storage_path).toMatch(new RegExp(`^${SITE}/[0-9a-f-]{36}\\.mp4$`));
    await expect(prepareMedia(SITE, mp4, false)).rejects.toThrow(/לא מוביל לקובץ תמונה/);
  });

  it("a video from the phone is stored without its location, device and date (same size, no re-encoding)", async () => {
    const src = readFileSync(join(__dirname, "../fixtures/video/location-2s.mov"));
    expect(src.toString("latin1")).toContain("+32.0853+034.7818");
    const out = await prepareMedia(SITE, src, true);
    const stored = out.files[0]!.bytes;
    expect(out.item.storage_path).toMatch(/\.mov$/);
    expect(stored.length).toBe(src.length);
    expect(out.item.size_bytes).toBe(src.length);
    for (const s of ["+32.0853", "com.apple", "iPhone"])
      expect(stored.toString("latin1")).not.toContain(s);
  });
  it("size limits: image 15MB, empty file", async () => {
    const big = Buffer.concat([await jpeg(10, 10), Buffer.alloc(16 * 1024 * 1024)]);
    await expect(prepareMedia(SITE, big, true)).rejects.toThrow(/עד 15MB/);
    await expect(prepareMedia(SITE, Buffer.alloc(0), true)).rejects.toThrow(/ריק/);
  });
});

describe("link import: SSRF protection of the platform adapter (blocked before any connection)", () => {
  it.each([
    "http://127.0.0.1/x.jpg",
    "http://10.0.0.5/x.jpg",
    "http://192.168.1.1/x.jpg",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/x.jpg",
    "http://[fd00::1]/x.jpg",
    "http://[::ffff:127.0.0.1]/x.jpg",
    "http://2130706433/x.jpg",
    "http://0x7f000001/x.jpg",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://router.local/x.jpg",
    "http://intranet/x.jpg",
  ])("%s is refused", (url) => {
    expect(() => assertFetchableUrl(url)).toThrow(/כתובת פנימית/);
  });
  it.each([
    "file:///etc/passwd",
    "ftp://example.com/x.jpg",
    "gopher://example.com/",
    "https://user:pw@example.com/x.jpg",
  ])("%s is refused (scheme / credentials)", (url) => {
    expect(() => assertFetchableUrl(url)).toThrow(/לא נתמך|http/);
  });
  it("unusual ports are refused; private ranges are recognised (IPv4 and IPv6)", () => {
    expect(() => assertFetchableUrl("https://example.com:6379/x.jpg")).toThrow(/פורט/);
    for (const ip of ["127.0.0.1", "100.64.0.1", "172.17.0.1", "224.0.0.1", "::1", "fe80::1"])
      expect(isBlockedAddress(ip), ip).toBe(true);
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
  });
  it("fetchRemoteImage refuses a private address without connecting", async () => {
    await expect(fetchRemoteImage("http://169.254.169.254/latest/meta-data/iam")).rejects.toThrow(
      /כתובת פנימית/,
    );
  });
});

describe("video links and gallery input", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=10", "youtube", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://vimeo.com/76979871", "vimeo", "76979871"],
    ["https://player.vimeo.com/video/76979871?h=abc", "vimeo", "76979871"],
  ])("%s", (url, provider, id) => {
    expect(parseVideoLink(url)).toEqual({ provider, id });
  });
  it("other sites and broken ids are refused", () => {
    for (const s of [
      "https://dailymotion.com/video/x7tgad0",
      "https://youtube.com/watch?v=short",
      "javascript:alert(1)",
      "vimeo",
    ])
      expect(parseVideoLink(s), s).toBeNull();
  });
  it("gallery refs, order, ALT and import input", () => {
    expect(parseGallery({ ownerKind: "site", ownerId: A })).toEqual({
      ownerKind: "site",
      ownerId: null,
    });
    expect(parseGallery({ ownerKind: "unit", ownerId: A })).toEqual({
      ownerKind: "unit",
      ownerId: A,
    });
    expect(() => parseGallery({ ownerKind: "bucket" })).toThrow(/הגלריה/);
    // the logo (migration 42): only where asked for (the logo upload), and without an id
    expect(() => parseGallery({ ownerKind: "brand" })).toThrow(/הגלריה/);
    expect(parseGallery({ ownerKind: "brand", ownerId: A }, { brand: true })).toEqual({
      ownerKind: "brand",
      ownerId: null,
    });
    const logo = new FormData();
    logo.set("ownerKind", "brand");
    logo.set("file", new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" }));
    expect(parseUploadForm(logo).gallery).toEqual({ ownerKind: "brand", ownerId: null });
    expect(() =>
      parseVideoLinkInput({ ownerKind: "brand", url: "https://youtu.be/dQw4w9WgXcQ" }),
    ).toThrow(/הגלריה/);
    expect(() =>
      parseImportInput({ ownerKind: "brand", url: "https://example.com/a.png" }),
    ).toThrow(/הגלריה/);
    expect(() =>
      parseMediaOrder({ ownerKind: "unit", ownerId: A, expected: [A, B], ids: [A, A] }),
    ).toThrow(/רשימת הסדר/);
    expect(altError("א".repeat(251))).toMatch(/עד 250/);
    expect(() => parseImportInput({ ownerKind: "site", url: "file:///etc/passwd" })).toThrow(
      /http/,
    );
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
