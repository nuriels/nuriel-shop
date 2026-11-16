// Nuriel Websites (business_profile) — Stage 1: מיפוי הכתובות, הנתיבים, השער, המסמך, robots / sitemap
import { describe, expect, it } from "vitest";
import {
  businessProfileRewrite,
  toInternalPath,
  toPublicPath,
} from "@/engines/business-profile/edge/rewrite";
import {
  clientRouteRedirect,
  isInternalSitePath,
  isPublicPagePath,
  isStudioPath,
} from "@/engines/business-profile/edge/paths";
import {
  businessProfileGate,
  robotsTxt,
  type GateOptions,
} from "@/engines/business-profile/edge/gate";
import {
  normalizeDocument,
  pageBySlug,
  tx,
  mediaIdsOf,
} from "@/engines/business-profile/document/normalize";
import { initialDocument } from "@/engines/business-profile/document/defaults";
import { BLOCK_TYPES, normalizeBlockProps } from "@/engines/business-profile/document/blocks";
import { SAFE_LINK } from "@/engines/business-profile/document/schema";
import { sitemapXml } from "@/engines/business-profile/data/seo.server";
import {
  templateOf,
  AVAILABLE_TEMPLATES,
  TEMPLATES,
} from "@/engines/business-profile/templates/registry";
import { telHref, whatsappHref } from "@/engines/business-profile/site/context";
import { formatPhone } from "@/engines/business-profile/site/blocks";
import { businessSiteOnly } from "@/engines/business-profile/studio/route-guard";
import { businessProfileEngine } from "@/engines/business-profile/engine";
import { businessProfileSwitchOn } from "@/engines/business-profile/config";
import { engineRouteRedirect } from "@/app/site-routes";
import { createEngineRegistry } from "@/platform/engines/registry";
import { ecommerceEngine } from "@/engines/ecommerce/engine";
import { hospitalityEngine } from "@/engines/hospitality/engine";
import { decideServerFnAccess } from "@/platform/engines/engine-guard";
import { isSiteType, SITE_TYPES, type SiteRef } from "@/platform/engines/contract";

const site: SiteRef = { id: "s1", siteType: "business_profile", status: "active" };
const opts = (studio: boolean, open: boolean): GateOptions => ({
  studioOpen: async () => studio,
  siteOpen: async () => open,
  siteOrigin: async () => "https://efrat.nuri1.fit",
  sitemap: async () => new Response("<urlset/>", { status: 200 }),
});
const gate = (path: string, o: GateOptions, s = site, method = "GET") =>
  businessProfileGate(s, { pathname: path, method }, o);

describe("bp: the site type and the engine registration", () => {
  it("business_profile is the third site type; the registry accepts the three engines", () => {
    expect(SITE_TYPES).toEqual(["ecommerce", "hospitality", "business_profile"]);
    expect(isSiteType("business_profile")).toBe(true);
    const registry = createEngineRegistry([
      ecommerceEngine,
      hospitalityEngine,
      businessProfileEngine,
    ]);
    expect(registry.ownerOf("src/engines/business-profile/api/studio.functions.ts")).toBe(
      "business_profile",
    );
    expect(registry.ownerOf("src/engines/hospitality/api/site.functions.ts")).toBe("hospitality");
    expect(registry.ownerOf("src/lib/orders.functions.ts")).toBe("ecommerce");
    expect(
      registry.isPlatformAdminFn("src/engines/business-profile/api/platform-admin.functions.ts"),
    ).toBe(true);
    expect(registry.isPlatformAdminFn("src/engines/business-profile/api/studio.functions.ts")).toBe(
      false,
    );
  });

  it("server functions: a business function runs only on a business site with the engine on — never on a store or zimmer", () => {
    expect(decideServerFnAccess({ owner: "business_profile", site, ownerEnabled: true })).toBe(
      "allow",
    );
    expect(decideServerFnAccess({ owner: "business_profile", site, ownerEnabled: false })).toBe(
      "not_found",
    );
    for (const other of ["ecommerce", "hospitality"] as const) {
      expect(
        decideServerFnAccess({
          owner: "business_profile",
          site: { ...site, siteType: other },
          ownerEnabled: true,
        }),
      ).toBe("not_found");
    }
    // store functions do not run on a business site
    expect(decideServerFnAccess({ owner: "ecommerce", site, ownerEnabled: true })).toBe(
      "not_found",
    );
    // the platform panel (no site): only the platform-admin file
    expect(
      decideServerFnAccess({ owner: "business_profile", site: null, ownerEnabled: false }),
    ).toBe("not_found");
    expect(
      decideServerFnAccess({
        owner: "business_profile",
        site: null,
        ownerEnabled: false,
        platformAdmin: true,
      }),
    ).toBe("allow");
  });

  it("the environment switch: only BUSINESS_PROFILE_ENGINE=on (off by default — production unchanged)", () => {
    expect(businessProfileSwitchOn({})).toBe(false);
    expect(businessProfileSwitchOn({ BUSINESS_PROFILE_ENGINE: "off" })).toBe(false);
    expect(businessProfileSwitchOn({ BUSINESS_PROFILE_ENGINE: " ON " })).toBe(true);
  });
});

describe("bp: the router rewrite (business sites only)", () => {
  it("maps public paths to the internal prefix and back", () => {
    expect(toInternalPath("/")).toBe("/bp-site");
    expect(toInternalPath("/about")).toBe("/bp-site/about");
    expect(toPublicPath("/bp-site")).toBe("/");
    expect(toPublicPath("/bp-site/")).toBe("/");
    expect(toPublicPath("/bp-site/about")).toBe("/about");
    for (const p of ["/", "/about", "/services/editing"])
      expect(toPublicPath(toInternalPath(p))).toBe(p);
  });

  it("leaves the studio, the login handoff, the old /admin landing and server functions alone", () => {
    for (const p of [
      "/studio",
      "/studio/editor",
      "/studio/preview",
      "/admin-handoff",
      "/admin",
      "/_serverFn/abc",
    ]) {
      expect(toInternalPath(p)).toBe(p);
      expect(toPublicPath(p)).toBe(p);
    }
  });

  it("the TanStack rewrite pair keeps the query and hash", () => {
    const inUrl = businessProfileRewrite.input({ url: new URL("https://x.test/about?a=1#top") });
    expect(inUrl.pathname).toBe("/bp-site/about");
    expect(inUrl.search).toBe("?a=1");
    expect(inUrl.hash).toBe("#top");
    expect(businessProfileRewrite.output({ url: new URL("https://x.test/bp-site?x=2") }).href).toBe(
      "https://x.test/?x=2",
    );
  });

  it("a typed internal path is not a second address of the same page", () => {
    // /bp-site/about (typed by hand) → /bp-site/bp-site/about → not a page
    expect(toInternalPath("/bp-site/about")).toBe("/bp-site/bp-site/about");
  });
});

describe("bp: paths and in-app navigation", () => {
  it("studio paths", () => {
    expect(isStudioPath("/studio")).toBe(true);
    expect(isStudioPath("/studio/versions")).toBe(true);
    expect(isStudioPath("/admin-handoff")).toBe(true);
    expect(isStudioPath("/studios")).toBe(false);
    expect(isStudioPath("/manage")).toBe(false);
  });
  it("public page paths: the home page and page names; never files, the internal prefix or the studio", () => {
    for (const p of ["/", "/about", "/services/editing", "/contact/"])
      expect(isPublicPagePath(p), p).toBe(true);
    for (const p of ["/robots.txt", "/a/b/c", "/bp-site", "/studio", "/../etc", "/a b"])
      expect(isPublicPagePath(p), p).toBe(false);
    expect(isInternalSitePath("/bp-site/x")).toBe(true);
  });
  it("in-app navigation on a business site: pages and studio stay, /admin → /studio, anything else → home", () => {
    expect(clientRouteRedirect("/bp-site")).toBeNull();
    expect(clientRouteRedirect("/bp-site/about")).toBeNull();
    expect(clientRouteRedirect("/studio/editor")).toBeNull();
    expect(clientRouteRedirect("/admin-handoff")).toBeNull();
    expect(clientRouteRedirect("/admin")).toBe("/studio");
    expect(clientRouteRedirect("/cart")).toBe("/");
    expect(clientRouteRedirect("/manage")).toBe("/");
  });
  it("the composition root sends each site type to its own rule; stores are untouched", () => {
    expect(engineRouteRedirect("ecommerce", "/cart")).toBeNull();
    expect(engineRouteRedirect("business_profile", "/cart")).toBe("/");
    expect(engineRouteRedirect("hospitality", "/studio")).toBe("/manage");
  });
  it("studio routes exist only on a business site", () => {
    expect(() =>
      businessSiteOnly({ context: { hostMode: { siteType: "business_profile" } } }),
    ).not.toThrow();
    for (const t of ["ecommerce", "hospitality"])
      expect(() => businessSiteOnly({ context: { hostMode: { siteType: t } } })).toThrow();
  });
});

describe("bp: the edge gate", () => {
  it("server functions always pass to the app (the engine guard decides)", async () => {
    expect(await gate("/_serverFn/x", opts(false, false))).toBeNull();
  });

  it("studio: open → the app; closed → 'under construction' 404; suspended → 403; /admin → 302 /studio", async () => {
    expect(await gate("/studio", opts(true, false))).toBeNull();
    expect(await gate("/admin-handoff", opts(true, false))).toBeNull();
    expect((await gate("/studio", opts(false, false)))!.status).toBe(404);
    expect(
      (await gate("/studio", opts(true, true), { ...site, status: "suspended" }))!.status,
    ).toBe(403);
    const admin = (await gate("/admin", opts(true, false)))!;
    expect(admin.status).toBe(302);
    expect(admin.headers.get("location")).toBe("/studio");
    expect((await gate("/admin", opts(false, false)))!.status).toBe(404);
  });

  it("public pages: only when published and open; never before", async () => {
    expect(await gate("/", opts(true, true))).toBeNull();
    expect(await gate("/about", opts(true, true))).toBeNull();
    const closed = (await gate("/", opts(true, false)))!;
    expect(closed.status).toBe(404);
    expect(closed.headers.get("x-robots-tag")).toBe("noindex");
    expect(await closed.text()).toContain("האתר בהקמה");
    expect((await gate("/", opts(true, true), { ...site, status: "suspended" }))!.status).toBe(403);
  });

  it("files, deep paths and the internal prefix → 404 with the Nuriel credit", async () => {
    for (const p of [
      "/product/abc/def",
      "/bp-site",
      "/bp-site/about",
      "/llms.txt",
      "/assets/x.js.map",
    ]) {
      const r = (await gate(p, opts(true, true)))!;
      expect(r.status, p).toBe(404);
      expect(await r.text(), p).toContain("Nuriel Websites");
    }
  });

  it("a store or zimmer page name (/cart, /manage, /stay) is just a page name here: the rewrite sends it to the business pages, which 404 when there is no such page", async () => {
    for (const p of ["/cart", "/manage", "/stay"]) {
      expect(await gate(p, opts(true, true)), p).toBeNull();
      expect(toInternalPath(p)).toBe(`/bp-site${p}`);
    }
  });

  it("robots.txt: closed site → Disallow everything; open → allowed, studio disallowed, sitemap line", async () => {
    expect(await (await gate("/robots.txt", opts(true, false)))!.text()).toBe(
      "User-agent: *\nDisallow: /\n",
    );
    const open = await (await gate("/robots.txt", opts(true, true)))!.text();
    expect(open).toContain("Allow: /");
    expect(open).toContain("Disallow: /studio");
    expect(open).toContain("Sitemap: https://efrat.nuri1.fit/sitemap.xml");
    expect(robotsTxt(true, null)).not.toContain("Sitemap");
  });

  it("sitemap.xml only when open", async () => {
    expect((await gate("/sitemap.xml", opts(true, true)))!.status).toBe(200);
    expect((await gate("/sitemap.xml", opts(true, false)))!.status).toBe(404);
  });
});

describe("bp: the site document", () => {
  it("normalize never throws: garbage → a valid document with a home page", () => {
    for (const input of [
      null,
      undefined,
      42,
      "x",
      [],
      { pages: "nope" },
      { template: "<script>" },
    ]) {
      const doc = normalizeDocument(input);
      expect(doc.schema).toBe(1);
      expect(doc.template).toBe("elegant");
      expect(doc.locales).toEqual(["he"]);
      expect(doc.pages[0]!.slug).toBe("");
    }
  });

  it("unknown block types, duplicate ids and bad page slugs are dropped; the home page comes first", () => {
    const doc = normalizeDocument({
      pages: [
        { id: "about", slug: "about", blocks: [] },
        {
          id: "home",
          slug: "",
          blocks: [
            { id: "a", type: "hero", props: {} },
            { id: "a", type: "about", props: {} },
            { id: "b", type: "iframe_embed", props: { src: "https://evil" } },
            { id: "c", type: "contact", props: {} },
          ],
        },
        { id: "bad", slug: "../etc", blocks: [] },
        { id: "about", slug: "again", blocks: [] },
      ],
    });
    expect(doc.pages.map((p) => p.slug)).toEqual(["", "about"]);
    expect(doc.pages[0]!.blocks.map((b) => `${b.id}:${b.type}`)).toEqual(["a:hero", "c:contact"]);
  });

  it("unsafe links are emptied; safe ones (https, mailto, tel, #anchor, /path) stay", () => {
    const doc = normalizeDocument({
      pages: [
        {
          id: "home",
          slug: "",
          blocks: [
            {
              id: "h1",
              type: "hero",
              props: { primary: { label: { he: "x" }, href: "javascript:alert(1)" } },
            },
            {
              id: "h2",
              type: "hero",
              props: { primary: { label: { he: "x" }, href: "data:text/html,<b>" } },
            },
            {
              id: "h3",
              type: "hero",
              props: { primary: { label: { he: "x" }, href: "#contact" } },
            },
          ],
        },
      ],
      business: {
        social: { facebook: "javascript:alert(1)", instagram: "https://instagram.com/x" },
      },
    });
    const hrefs = doc.pages[0]!.blocks.map(
      (b) => (b.props as { primary: { href: string } }).primary.href,
    );
    expect(hrefs).toEqual(["", "", "#contact"]);
    expect(doc.business.social.facebook).toBe("");
    expect(doc.business.social.instagram).toBe("https://instagram.com/x");
    for (const ok of [
      "https://wa.me/972500000000",
      "mailto:a@b.co",
      "tel:+972-50-000",
      "#a",
      "/about",
    ])
      expect(SAFE_LINK.test(ok), ok).toBe(true);
    for (const bad of [
      "javascript:x",
      "http://plain.test",
      "vbscript:x",
      "//evil.test",
      'https://x"onload',
    ])
      expect(SAFE_LINK.test(bad), bad).toBe(false);
  });

  it("colors must be #rrggbb (no CSS injection); bad values fall back to the defaults", () => {
    const doc = normalizeDocument({
      theme: { palette: { accent: "red;background:url(x)", text: "#123456" }, radius: "circle" },
    });
    expect(doc.theme.palette.accent).toBe("#7a4e3f");
    expect(doc.theme.palette.text).toBe("#123456");
    expect(doc.theme.radius).toBe("soft");
  });

  it("English is ready in the model but not enabled yet (decision 5)", () => {
    expect(normalizeDocument({ locales: ["he", "en", "fr"] }).locales).toEqual(["he"]);
    expect(tx({ he: "שלום", en: "Hello" }, "en")).toBe("Hello");
    expect(tx({ he: "שלום" }, "en")).toBe("שלום");
  });

  it("collections: invalid items are dropped and the counts are capped", () => {
    const items = Array.from({ length: 250 }, (_, i) => ({ id: `w${i}`, title: { he: `${i}` } }));
    const doc = normalizeDocument({
      collections: {
        portfolio: { items: [...items, { id: "BAD ID" }] },
        services: [{ title: { he: "no id" } }],
      },
    });
    expect(doc.collections.portfolio.items).toHaveLength(200);
    expect(doc.collections.services).toHaveLength(0);
  });

  it("every block type has defaults that survive normalization", () => {
    for (const type of BLOCK_TYPES) {
      const props = normalizeBlockProps(type, null) as Record<string, unknown>;
      expect(Object.keys(props).length, type).toBeGreaterThan(0);
    }
  });

  it("the initial document: a full landing page per template", () => {
    const e = initialDocument("elegant", "אפרת אדיר");
    expect(e.template).toBe("elegant");
    expect(e.pages[0]!.blocks.map((b) => b.type)).toEqual([
      "hero",
      "about",
      "services",
      "portfolio",
      "testimonials",
      "cta",
      "contact",
    ]);
    expect((e.pages[0]!.blocks[0]!.props as { title: { he: string } }).title.he).toBe("אפרת אדיר");
    expect(initialDocument("portfolio", "x").pages[0]!.blocks[1]!.type).toBe("portfolio");
    expect(normalizeDocument(JSON.parse(JSON.stringify(e)))).toEqual(e);
    expect(pageBySlug(e, "")).not.toBeNull();
    expect(pageBySlug(e, "nope")).toBeNull();
  });

  it("media ids are collected from the whole document", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const doc = normalizeDocument({ business: { logo: { media: id, alt: { he: "לוגו" } } } });
    expect(mediaIdsOf(doc)).toEqual([id]);
  });
});

describe("bp: templates, contact links and the sitemap", () => {
  it("Elegant, Portfolio and Classic are available; the others are registered as planned and fall back", () => {
    expect(AVAILABLE_TEMPLATES.map((t) => t.key)).toEqual(["elegant", "portfolio", "classic"]);
    expect(Object.keys(TEMPLATES)).toHaveLength(7);
    expect(templateOf("luxury").key).toBe("elegant");
    expect(templateOf("portfolio").className).toBe("bps-portfolio");
  });

  it("WhatsApp and phone links are built only from valid numbers", () => {
    expect(whatsappHref("972524653108", "היי")).toBe(
      `https://wa.me/972524653108?text=${encodeURIComponent("היי")}`,
    );
    expect(whatsappHref("0524653108", "")).toBeNull();
    expect(whatsappHref('972524653108"><script>', "")).toBeNull();
    expect(telHref("052-465-3108")).toBe("tel:0524653108");
    expect(telHref("12")).toBeNull();
    expect(formatPhone("972524653108")).toBe("052-465-3108");
  });

  it("sitemap: one URL per page, escaped, with the publish date", () => {
    const xml = sitemapXml(
      "https://efrat.nuri1.fit",
      ["", "about", "about"],
      "2026-11-16T10:00:00Z",
    );
    expect(xml.match(/<url>/g)).toHaveLength(2);
    expect(xml).toContain("<loc>https://efrat.nuri1.fit/</loc>");
    expect(xml).toContain("<loc>https://efrat.nuri1.fit/about</loc>");
    expect(xml).toContain("<lastmod>2026-11-16</lastmod>");
  });
});
