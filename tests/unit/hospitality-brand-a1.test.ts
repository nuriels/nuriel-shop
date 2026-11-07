// A1 — הלוגו של העסק בשיתוף קישורים (ווטסאפ / פייסבוק) ובמסך הבית (אייפון / אנדרואיד): תמונת השיתוף
// והאייקונים נוצרים מהלוגו שהעסק העלה ומוגשים מהדומיין של האתר; האייקון הכללי (נוריאל) — רק כשאין לוגו.
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { SiteRef } from "@/platform/engines/contract";
import { hospitalityGate } from "@/engines/hospitality/edge/gate";
import { isBrandAssetPath } from "@/engines/hospitality/edge/paths";
import {
  FALLBACK_ICON,
  hospitalityHeadLinks,
  hospitalityHeadMeta,
} from "@/engines/hospitality/management/head";
import type { PublicMedia, PublicSite, PublicUnit } from "@/engines/hospitality/types/website";
import { manifestFor, renderBrandPng } from "@/engines/hospitality/website/brand.server";
import { defaultDesign } from "@/engines/hospitality/website/design/schema";
import { siteHomeHead, siteUnitHead } from "@/engines/hospitality/website/head";
import { brandAssetUrl, brandVersion, isBrandAsset } from "@/engines/hospitality/website/lib/brand";

const LOGO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PHOTO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CHOSEN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ORIGIN = "https://nofi-dorit.nuri1.fit";

const media = (id: string): PublicMedia => ({
  id,
  kind: "image",
  alt: null,
  width: 1600,
  height: 1067,
  is_cover: false,
  is_demo: false,
  embed_provider: null,
  embed_id: null,
  url: `https://cdn.test/${id}.webp`,
  srcset: null,
  thumb_url: null,
});

const design = (extra: Record<string, unknown> = {}) => ({
  kind: "published" as const,
  version: 1,
  revision: 1,
  theme: "luxury",
  document: JSON.stringify({ ...defaultDesign(), ...extra }),
  updated_at: "2026-11-01T10:00:00Z",
});

const site = (extra: Partial<PublicSite> = {}): PublicSite =>
  ({
    business: {
      name: "נופי דורית",
      phone: null,
      whatsapp: null,
      email: null,
      address: null,
      check_in_time: "15:00",
      check_out_time: "11:00",
      currency: "ILS",
      timezone: "Asia/Jerusalem",
      booking_mode: "request",
      approval_hours: 12,
    },
    today: "2026-11-01",
    booking_open: true,
    gallery: [media(PHOTO), media(CHOSEN)],
    brand: [media(LOGO)],
    policy: null,
    properties: [],
    units: [],
    design: design({ logo: LOGO }),
    room_types: [],
    origin: ORIGIN,
    ...extra,
  }) as PublicSite;

const meta = (head: { meta: Record<string, unknown>[] }, key: string) =>
  head.meta.filter((m) => m["property"] === key || m["name"] === key).map((m) => m["content"]);

describe("A1: the share preview uses the business logo", () => {
  it("home page: og:image / twitter:image are the logo as a PNG on the site's own domain, with its size", () => {
    const head = siteHomeHead(site());
    const url = `${ORIGIN}/stay/brand/og-image?v=${brandVersion(LOGO)}`;
    expect(meta(head, "og:image")).toEqual([url]);
    expect(meta(head, "twitter:image")).toEqual([url]);
    expect(meta(head, "og:image:width")).toEqual(["1200"]);
    expect(meta(head, "og:image:height")).toEqual(["630"]);
    expect(meta(head, "og:image:type")).toEqual(["image/png"]);
    expect(meta(head, "og:title")).toHaveLength(1);
    expect(meta(head, "og:description")).toHaveLength(1);
    expect(JSON.stringify(head)).not.toContain("favicon");
  });

  it("an image the owner chose in 'Google and sharing' (E5) still wins over the logo", () => {
    const head = siteHomeHead(site({ design: design({ logo: LOGO, seo: { image: CHOSEN } }) }));
    expect(meta(head, "og:image")).toEqual([`https://cdn.test/${CHOSEN}.webp`]);
    expect(meta(head, "og:image:width")).toEqual([]);
  });

  it("no logo uploaded → the hero photo, as before (the fallback); unknown origin → never a relative link", () => {
    const noLogo = siteHomeHead(site({ brand: [], design: design() }));
    expect(meta(noLogo, "og:image")).toEqual([`https://cdn.test/${PHOTO}.webp`]);
    const noOrigin = siteHomeHead(site({ origin: null }));
    expect(meta(noOrigin, "og:image")).toEqual([`https://cdn.test/${PHOTO}.webp`]);
  });

  it("structured data keeps a photo as image and the logo as logo", () => {
    const head = siteHomeHead(site());
    const ld = head.meta.find((m) => "script:ld+json" in m)?.[
      "script:ld+json"
    ] as unknown as Record<string, string>;
    expect(ld["image"]).toBe(`https://cdn.test/${PHOTO}.webp`);
    expect(ld["logo"]).toBe(`https://cdn.test/${LOGO}.webp`);
  });

  it("a unit page: the unit photo; a unit without photos → the logo, not an empty preview", () => {
    const unit = {
      id: "u1",
      slug: "vip",
      name: "סוויטת VIP",
      description: null,
      media: [],
      member_ids: null,
      property_id: "p1",
      seo_title: null,
      seo_description: null,
    } as unknown as PublicUnit;
    const withPhoto = siteUnitHead(site(), { ...unit, media: [media(PHOTO)] }, "/stay/units/vip");
    expect(meta(withPhoto, "og:image")).toEqual([`https://cdn.test/${PHOTO}.webp`]);
    const bare = siteUnitHead(site(), unit, "/stay/units/vip");
    expect(meta(bare, "og:image")).toEqual([brandAssetUrl("og-image", LOGO, ORIGIN)]);
  });
});

describe("A1: favicon, home-screen icon and manifest", () => {
  it("with a logo: the icons and the manifest come from the logo (versioned) — never the general icon", () => {
    const links = hospitalityHeadLinks({ name: "נופי דורית", logoId: LOGO });
    const v = brandVersion(LOGO);
    expect(links).toEqual([
      { rel: "icon", type: "image/png", sizes: "192x192", href: `/stay/brand/icon-192?v=${v}` },
      { rel: "apple-touch-icon", sizes: "180x180", href: `/stay/brand/apple-touch-icon?v=${v}` },
      { rel: "manifest", href: `/stay/brand/manifest?v=${v}` },
    ]);
    expect(JSON.stringify(links)).not.toContain(FALLBACK_ICON);
  });

  it("without a logo: only the general icon (the fallback)", () => {
    expect(hospitalityHeadLinks({ name: "x", logoId: null })).toEqual([
      { rel: "icon", type: "image/png", href: FALLBACK_ICON },
    ]);
    expect(hospitalityHeadLinks({ name: "x" })).toEqual([
      { rel: "icon", type: "image/png", href: FALLBACK_ICON },
    ]);
  });

  it("the name under the home-screen icon is the business name", () => {
    const m = hospitalityHeadMeta({ name: "נופי דורית" }) as Record<string, string>[];
    expect(m).toContainEqual({ name: "apple-mobile-web-app-title", content: "נופי דורית" });
  });

  it("the manifest: business name, Hebrew RTL, the site as start page, the three logo icons", () => {
    const m = manifestFor({ logoId: LOGO, name: "נופי דורית" }) as {
      name: string;
      start_url: string;
      dir: string;
      icons: { src: string; sizes: string; purpose: string }[];
    };
    expect(m.name).toBe("נופי דורית");
    expect(m.start_url).toBe("/stay");
    expect(m.dir).toBe("rtl");
    expect(m.icons.map((i) => [i.sizes, i.purpose])).toEqual([
      ["192x192", "any"],
      ["512x512", "any"],
      ["512x512", "maskable"],
    ]);
    for (const i of m.icons) expect(i.src).toMatch(/^\/stay\/brand\/icon-[a-z0-9-]+\?v=/);
  });

  it("renders the logo into the right PNG sizes (share image 1200×630, iPhone 180, Android 192/512)", async () => {
    const logo = await sharp({
      create: {
        width: 400,
        height: 200,
        channels: 4,
        background: { r: 20, g: 90, b: 60, alpha: 1 },
      },
    })
      .webp()
      .toBuffer();
    const sizes: [Parameters<typeof renderBrandPng>[1], number, number][] = [
      ["og-image", 1200, 630],
      ["apple-touch-icon", 180, 180],
      ["icon-192", 192, 192],
      ["icon-512", 512, 512],
      ["icon-maskable-512", 512, 512],
    ];
    for (const [asset, w, h] of sizes) {
      const png = await renderBrandPng(logo, asset);
      const info = await sharp(png).metadata();
      expect([info.format, info.width, info.height], asset).toEqual(["png", w, h]);
      // קובץ קטן — ווטסאפ לא מציג תמונות כבדות
      expect(png.length, asset).toBeLessThan(300 * 1024);
    }
  });
});

describe("A1: the brand path at the edge", () => {
  const HOSP: SiteRef = { id: "s1", siteType: "hospitality", status: "active" };
  const get = (pathname: string, method = "GET") => ({ pathname, method });
  const both = { managementOpen: async () => true, siteOpen: async () => true };

  it("only /stay/brand/<name> without a file extension (a path with an extension is a static file)", () => {
    expect(isBrandAssetPath("/stay/brand/og-image")).toBe(true);
    expect(isBrandAssetPath("/stay/brand/og-image.png")).toBe(false);
    expect(isBrandAssetPath("/stay/brand/../x")).toBe(false);
    expect(isBrandAsset("manifest")).toBe(true);
    expect(isBrandAsset("secrets")).toBe(false);
  });

  it("served while the public site or the management area is open; closed / suspended / POST → 404", async () => {
    expect(await hospitalityGate(HOSP, get("/stay/brand/og-image"), both)).toBeNull();
    const managementOnly = { managementOpen: async () => true, siteOpen: async () => false };
    expect(await hospitalityGate(HOSP, get("/stay/brand/icon-192"), managementOnly)).toBeNull();
    const closed = { managementOpen: async () => false, siteOpen: async () => false };
    expect((await hospitalityGate(HOSP, get("/stay/brand/icon-192"), closed))?.status).toBe(404);
    const suspended: SiteRef = { ...HOSP, status: "suspended" };
    expect((await hospitalityGate(suspended, get("/stay/brand/og-image"), both))?.status).toBe(404);
    expect((await hospitalityGate(HOSP, get("/stay/brand/og-image", "POST"), both))?.status).toBe(
      404,
    );
  });
});
