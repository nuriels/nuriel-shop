// Nuriel Websites — כתובת האתר, ההפניות, ה-SEO ותיק האתר (מיגרציה 197): הלוגיקה הטהורה
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { alternateHostOf } from "@/engines/business-profile/api/address.functions";
import { initialDocument } from "@/engines/business-profile/document/defaults";
import { businessProfileGate, hostRedirect } from "@/engines/business-profile/edge/gate";
import { auditLabel } from "@/engines/business-profile/platform-admin/PlatformSiteFile";
import { jsonLd, pageHead, seoSummary } from "@/engines/business-profile/site/page-head";
import { breadcrumb, clip } from "@/engines/business-profile/studio/GooglePreview";
import type { PublicSiteData } from "@/engines/business-profile/types";
import { expectedFor, lookupHost, lookupTxt } from "@/platform/tenancy/domains.server";

const HOSTS = {
  requestHost: "efrat.nuri1.fit",
  slugHost: "efrat.nuri1.fit",
  canonicalOrigin: "https://efrat.nuri1.fit",
  customDomain: null as string | null,
};

describe("bp address: redirects by host (gate)", () => {
  it("no custom domain: nothing redirects", () => {
    for (const p of ["/", "/about", "/robots.txt", "/sitemap.xml", "/studio", "/admin-handoff"])
      expect(hostRedirect(p, "", HOSTS), p).toBeNull();
  });
  it("custom domain active: public pages, robots and sitemap on the Nuriel host → 301 to the canonical domain (query kept)", () => {
    const h = {
      ...HOSTS,
      canonicalOrigin: "https://www.efratadir.com",
      customDomain: "www.efratadir.com",
    };
    expect(hostRedirect("/", "", h)).toBe("https://www.efratadir.com/");
    expect(hostRedirect("/about", "?a=1", h)).toBe("https://www.efratadir.com/about?a=1");
    expect(hostRedirect("/robots.txt", "", h)).toBe("https://www.efratadir.com/robots.txt");
    expect(hostRedirect("/sitemap.xml", "", h)).toBe("https://www.efratadir.com/sitemap.xml");
    expect(hostRedirect("/accessibility", "", h)).toBe("https://www.efratadir.com/accessibility");
    // the management stays on the Nuriel host
    expect(hostRedirect("/studio", "", h)).toBeNull();
    expect(hostRedirect("/studio/editor", "", h)).toBeNull();
    expect(hostRedirect("/admin-handoff", "", h)).toBeNull();
    // the internal router prefix and files are never redirected
    expect(hostRedirect("/bp-site/x", "", h)).toBeNull();
    expect(hostRedirect("/favicon.png", "", h)).toBeNull();
  });
  it("on the custom domain: the management → 302 to the same path on the Nuriel host; pages stay", () => {
    const h = {
      ...HOSTS,
      requestHost: "www.efratadir.com",
      canonicalOrigin: "https://www.efratadir.com",
      customDomain: "www.efratadir.com",
    };
    expect(hostRedirect("/studio", "", h)).toBe("https://efrat.nuri1.fit/studio");
    expect(hostRedirect("/studio/settings", "?x=1", h)).toBe(
      "https://efrat.nuri1.fit/studio/settings?x=1",
    );
    expect(hostRedirect("/admin-handoff", "", h)).toBe("https://efrat.nuri1.fit/admin-handoff");
    expect(hostRedirect("/admin", "", h)).toBe("https://efrat.nuri1.fit/admin");
    expect(hostRedirect("/", "", h)).toBeNull();
    expect(hostRedirect("/about", "", h)).toBeNull();
  });
  it("custom domain not active yet (canonical is still the Nuriel host): no 301", () => {
    const h = { ...HOSTS, customDomain: "www.efratadir.com" };
    expect(hostRedirect("/", "", h)).toBeNull();
  });
  it("the gate answers with the redirect (301 pages / 302 management), only for GET/HEAD", async () => {
    const site = { id: "s", siteType: "business_profile" as const, status: "active" as const };
    const h = {
      ...HOSTS,
      canonicalOrigin: "https://www.efratadir.com",
      customDomain: "www.efratadir.com",
    };
    const opts = {
      hosts: async () => h,
      studioOpen: async () => true,
      siteOpen: async () => true,
    };
    const r = await businessProfileGate(
      site,
      { pathname: "/", method: "GET", host: "efrat.nuri1.fit", search: "" },
      opts,
    );
    expect(r?.status).toBe(301);
    expect(r?.headers.get("location")).toBe("https://www.efratadir.com/");
    const post = await businessProfileGate(
      site,
      { pathname: "/", method: "POST", host: "efrat.nuri1.fit", search: "" },
      opts,
    );
    expect(post).toBeNull();
    const onCustom = await businessProfileGate(
      site,
      { pathname: "/studio", method: "GET", host: "www.efratadir.com", search: "" },
      { ...opts, hosts: async () => ({ ...h, requestHost: "www.efratadir.com" }) },
    );
    expect(onCustom?.status).toBe(302);
    expect(onCustom?.headers.get("location")).toBe("https://efrat.nuri1.fit/studio");
    expect(onCustom?.headers.get("cache-control")).toBe("no-store");
  });
  it("before publishing: robots.txt still blocks everything, the pages are 404 + noindex", async () => {
    const site = { id: "s", siteType: "business_profile" as const, status: "active" as const };
    const opts = {
      hosts: async () => HOSTS,
      studioOpen: async () => true,
      siteOpen: async () => false,
    };
    const robots = await businessProfileGate(
      site,
      { pathname: "/robots.txt", method: "GET", host: "efrat.nuri1.fit" },
      opts,
    );
    expect(await robots!.text()).toBe("User-agent: *\nDisallow: /\n");
    const home = await businessProfileGate(
      site,
      { pathname: "/", method: "GET", host: "efrat.nuri1.fit" },
      opts,
    );
    expect(home?.status).toBe(404);
    expect(home?.headers.get("x-robots-tag")).toBe("noindex");
  });
});

describe("bp address: the second form of a custom domain", () => {
  const apex = (d: string) =>
    d.split(".").length === 2 || (/\.co\.il$/.test(d) && d.split(".").length === 3);
  it("www ↔ bare, only for the main domain", () => {
    expect(alternateHostOf("www.efratadir.com", apex)).toBe("efratadir.com");
    expect(alternateHostOf("efratadir.com", apex)).toBe("www.efratadir.com");
    expect(alternateHostOf("www.shop.co.il", apex)).toBe("shop.co.il");
    expect(alternateHostOf("blog.efratadir.com", apex)).toBeNull();
  });
});

describe("bp address: DNS for tests — only .test names, only with the fixture file", () => {
  const prev = process.env["DNS_TEST_FIXTURES"];
  afterEach(() => {
    if (prev === undefined) delete process.env["DNS_TEST_FIXTURES"];
    else process.env["DNS_TEST_FIXTURES"] = prev;
  });
  it("answers from the fixture for .test names", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dns-"));
    const file = join(dir, "dns.json");
    writeFileSync(
      file,
      JSON.stringify({
        "www.efrat-adir.test": { cname: ["efrat.shop.localhost"] },
        "_nuriel-verify.www.efrat-adir.test": { txt: ["nuriel-verify=abc"] },
      }),
    );
    process.env["DNS_TEST_FIXTURES"] = file;
    expect(await lookupHost("www.efrat-adir.test")).toEqual({
      cnames: ["efrat.shop.localhost"],
      a: [],
      aaaa: [],
    });
    expect(await lookupTxt("_nuriel-verify.www.efrat-adir.test")).toEqual(["nuriel-verify=abc"]);
    expect(await lookupTxt("_nuriel-verify.unknown.test")).toEqual([]);
    const expected = await expectedFor(
      "www.efrat-adir.test",
      "efrat.shop.localhost",
      "shops.shop.localhost",
    );
    expect(expected.host).toBe("shops.shop.localhost");
    expect(expected.aliases).toEqual(["efrat.shop.localhost"]);
  });
});

describe("bp seo: what Google and social networks get", () => {
  const doc = initialDocument("elegant", "אפרת אדיר");
  const home = doc.pages[0]!;
  const media = {
    "11111111-1111-4111-8111-111111111111": {
      url: "https://api.example/storage/hero.webp",
      width: 1600,
      height: 900,
      srcset:
        "https://api.example/storage/hero-480.webp 480w, https://api.example/storage/hero.webp 1600w",
      avif: null,
    },
    "22222222-2222-4222-8222-222222222222": {
      url: "https://api.example/storage/logo.webp",
      width: 400,
      height: 400,
      srcset:
        "https://api.example/storage/logo-480.webp 480w, https://api.example/storage/logo.webp 400w",
      avif: null,
    },
  };
  const withImages = {
    ...doc,
    business: {
      ...doc.business,
      phone: "052-4653108",
      logo: { media: "22222222-2222-4222-8222-222222222222", alt: { he: "הלוגו" } },
    },
    pages: [
      {
        ...home,
        blocks: home.blocks.map((b) =>
          b.type === "hero"
            ? {
                ...b,
                props: {
                  ...b.props,
                  image: {
                    media: "11111111-1111-4111-8111-111111111111",
                    alt: { he: "שולחן כתיבה" },
                  },
                },
              }
            : b,
        ),
      },
    ],
  };
  it("defaults: the business name as the title; the hero image as the share image; the logo as the icon", () => {
    const s = seoSummary(withImages, withImages.pages[0]!, media, "https://efrat.nuri1.fit", "x");
    expect(s.title).toBe("אפרת אדיר");
    expect(s.canonical).toBe("https://efrat.nuri1.fit/");
    expect(s.image?.url).toBe("https://api.example/storage/hero.webp");
    expect(s.image?.alt).toBe("שולחן כתיבה");
    expect(s.icon).toBe("https://api.example/storage/logo-480.webp");
  });
  it("the page's own SEO fields win (title, description, share image)", () => {
    const page = {
      ...withImages.pages[0]!,
      seo: {
        title: { he: "אפרת אדיר - עריכה ספרותית" },
        description: { he: "עריכת ספרים מדויקת" },
        image: { media: "22222222-2222-4222-8222-222222222222", alt: { he: "" } },
      },
    };
    const s = seoSummary(withImages, page, media, null, "x");
    expect(s.title).toBe("אפרת אדיר - עריכה ספרותית");
    expect(s.description).toBe("עריכת ספרים מדויקת");
    expect(s.image?.url).toBe("https://api.example/storage/logo.webp");
    expect(s.canonical).toBeNull();
  });
  it("the head: OG + Twitter + image size, canonical, icon, and schema.org (business + website) on the home page only", () => {
    const site = {
      name: "אפרת אדיר",
      document: withImages,
      media,
      origin: "https://efrat.nuri1.fit",
      publishedAt: null,
    } as unknown as PublicSiteData;
    const head = pageHead(site, withImages.pages[0]!);
    const meta = (k: string) =>
      head.meta.find((m) => m["property"] === k || m["name"] === k)?.["content"];
    expect(meta("og:image")).toBe("https://api.example/storage/hero.webp");
    expect(meta("og:image:width")).toBe("1600");
    expect(meta("og:locale")).toBe("he_IL");
    expect(meta("twitter:card")).toBe("summary_large_image");
    expect(head.links).toContainEqual({ rel: "canonical", href: "https://efrat.nuri1.fit/" });
    expect(head.links).toContainEqual({
      rel: "icon",
      href: "https://api.example/storage/logo-480.webp",
    });
    expect(head.scripts).toHaveLength(1);
    const ld = JSON.parse(head.scripts[0]!.children) as { "@graph": Record<string, unknown>[] };
    expect(ld["@graph"][0]!["@type"]).toBe("ProfessionalService");
    expect(ld["@graph"][0]!["telephone"]).toBe("052-4653108");
    expect(ld["@graph"][1]!["@type"]).toBe("WebSite");
    expect(ld["@graph"][1]!["name"]).toBe("אפרת אדיר");
    // another page: no schema.org block
    expect(pageHead(site, { ...withImages.pages[0]!, slug: "about" }).scripts).toEqual([]);
  });
  it("schema.org JSON cannot close the script tag or inject HTML", () => {
    const out = jsonLd({ name: "</script><img src=x onerror=alert(1)> & ok" });
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<img");
    expect(JSON.parse(out).name).toBe("</script><img src=x onerror=alert(1)> & ok");
  });
});

describe("bp google preview", () => {
  it("clips like Google (title ~60 / description ~155), on a word", () => {
    expect(clip("קצר", 60)).toBe("קצר");
    const long = "מילה ".repeat(40);
    expect(clip(long, 60).length).toBeLessThanOrEqual(60);
    expect(clip(long, 60).endsWith("…")).toBe(true);
  });
  it("the address as Google shows it", () => {
    expect(breadcrumb("https://efrat.nuri1.fit/")).toEqual({ host: "efrat.nuri1.fit", path: "" });
    expect(breadcrumb("https://efrat.nuri1.fit/about")).toEqual({
      host: "efrat.nuri1.fit",
      path: " › about",
    });
    expect(breadcrumb(null).host).toContain("תיקבע");
  });
});

describe("bp site file: the audit log in words", () => {
  it("draft saves name the parts that changed; the platform entry, address and domain events", () => {
    expect(auditLabel("draft.saved", { revision: "12", changed: '["business","pages"]' })).toBe(
      "שמירת טיוטה (גרסת עבודה 12): פרטי העסק, מקטעים ותוכן",
    );
    expect(auditLabel("admin_entered_store", {})).toBe("כניסה לניהול האתר מפאנל הפלטפורמה");
    expect(auditLabel("site.address_changed", { from: "efrat-classic", to: "efrat" })).toBe(
      "שינוי כתובת: efrat-classic ← efrat",
    );
    expect(auditLabel("site.custom_domain_checked", { domain: "www.x.co.il", ok: "true" })).toBe(
      "בדיקת דומיין www.x.co.il: תקין",
    );
    expect(auditLabel("inquiry.status", {})).toBe("פעולה בפניות מלקוחות");
    expect(auditLabel("something.new", {})).toBe("something.new");
  });
});

describe("edgeRequestOf (the request parts the engine gate reads)", () => {
  it("takes the forwarded host without port, lower-cased, and keeps the query", async () => {
    const { edgeRequestOf } = await import("@/platform/engines/edge");
    const r = edgeRequestOf(
      new Request("http://127.0.0.1:3100/studio?x=1", {
        headers: { "x-forwarded-host": "Efrat.Nuri1.fit:443, proxy.local" },
      }),
    );
    expect(r).toEqual({
      pathname: "/studio",
      method: "GET",
      host: "efrat.nuri1.fit",
      search: "?x=1",
    });
    expect(edgeRequestOf(new Request("http://a.shop.localhost:3100/")).host).toBe(
      "a.shop.localhost",
    );
  });
});
