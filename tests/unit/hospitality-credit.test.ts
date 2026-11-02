// שלב F1: קרדיט נוריאל הקבוע — בכל ארבע הערכות, בכל העמודים (כולל עמודי שגיאה, "לא נמצא" והעמודים
// הסטטיים של השער), עם rel="nofollow", ובטלפון מעל שורת הפעולות. הבדיקות מרנדרות את המעטפת
// האמיתית של האתר (SiteShell) עם נתב בזיכרון.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import {
  NURIEL_CREDIT_BUILT,
  NURIEL_CREDIT_LINES,
  NURIEL_CREDIT_REL,
  NURIEL_CREDIT_RIGHTS,
  NURIEL_CREDIT_URL,
  nurielCreditHtml,
} from "@/platform/branding/credit";
import { NurielCredit } from "@/platform/branding/NurielCredit";
import { hospitalityGate } from "@/engines/hospitality/edge/gate";
import { SiteShell, type SitePage } from "@/engines/hospitality/website/SiteLayout";
import { FOOTER_BAR_SPACE, hasActionBar } from "@/engines/hospitality/website/lib/action-bar";
import { SiteError, SiteNotFound } from "@/engines/hospitality/website/pages/SiteMessage";
import {
  THEME_IDS,
  defaultDesign,
  normalizeDesign,
} from "@/engines/hospitality/website/design/schema";
import { THEMES } from "@/engines/hospitality/website/theme/themes";
import { contrast, mix } from "@/engines/hospitality/website/theme/color";
import type { PublicSite } from "@/engines/hospitality/types/website";
import type { SiteRef } from "@/platform/engines/contract";

/** הטקסט הגלוי בלי תגיות (כולל <bdi>) */
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

const site = {
  business: {
    name: "צימרי הגליל",
    phone: "050-0000101",
    whatsapp: null,
    email: "hello@example.test",
    address: "ראש פינה",
    check_in_time: "15:00",
    check_out_time: "11:00",
    currency: "ILS",
    timezone: "Asia/Jerusalem",
    booking_mode: "request",
    approval_hours: 12,
  },
  today: "2026-11-02",
  booking_open: true,
  gallery: [],
  policy: null,
  properties: [],
  units: [],
  design: null,
  room_types: [],
} as unknown as PublicSite;

function renderAt(path: string, ui: ReturnType<typeof createElement>): string {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return renderToStaticMarkup(createElement(RouterContextProvider, { router, children: ui }));
}

function shellAt(path: string, theme: (typeof THEME_IDS)[number], page: SitePage = "other") {
  return renderAt(
    path,
    createElement(SiteShell, {
      site,
      design: defaultDesign(theme),
      page,
      children: createElement("p", null, "תוכן העמוד"),
    }),
  );
}

describe("the credit itself (F1)", () => {
  it("has the exact wording, the platform link and nofollow", () => {
    expect(NURIEL_CREDIT_BUILT).toBe("האתר נבנה באמצעות Nuriel Hospitality מבית נוריאל מחשבים");
    expect(NURIEL_CREDIT_RIGHTS).toBe("© כל הזכויות שמורות לנוריאל מחשבים");
    expect(NURIEL_CREDIT_LINES).toEqual([NURIEL_CREDIT_BUILT, NURIEL_CREDIT_RIGHTS]);
    expect(NURIEL_CREDIT_URL).toBe("https://nuriel-app2.nuri1.fit");
    expect(NURIEL_CREDIT_REL.split(" ")).toContain("nofollow");
  });

  it("renders both lines inside one link that opens in a new tab", () => {
    const html = renderToStaticMarkup(createElement(NurielCredit));
    expect(html).toContain('data-nuriel-credit=""');
    expect(html).toContain(`href="${NURIEL_CREDIT_URL}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain(`rel="${NURIEL_CREDIT_REL}"`);
    expect(textOf(html)).toContain(NURIEL_CREDIT_BUILT);
    expect(textOf(html)).toContain(NURIEL_CREDIT_RIGHTS);
    // שם המוצר בלטינית מבודד (bdi), כדי שלא יתהפך בתוך שורה בעברית
    expect(html).toMatch(/<bdi dir="ltr"[^>]*>Nuriel Hospitality<\/bdi>/);
  });

  it("the static (non-React) version is the same credit", () => {
    const html = nurielCreditHtml();
    expect(html).toContain(`href="${NURIEL_CREDIT_URL}"`);
    expect(html).toContain(`rel="${NURIEL_CREDIT_REL}"`);
    expect(textOf(html)).toContain(NURIEL_CREDIT_BUILT);
    expect(textOf(html)).toContain(NURIEL_CREDIT_RIGHTS);
  });

  it("the editor preview marks it as fixed", () => {
    const html = renderToStaticMarkup(createElement(NurielCredit, { locked: true }));
    expect(html).toContain("לא ניתן להסרה");
  });
});

describe("every theme, every page", () => {
  const PAGES: [string, SitePage][] = [
    ["/stay", "home"],
    ["/stay/units/oak", "unit"],
    ["/stay/rooms/suite", "unit"],
    ["/stay/book", "other"],
    ["/stay/booking-received", "other"],
    ["/stay/my-booking", "other"],
    ["/stay/privacy", "other"],
    ["/stay/accessibility", "other"],
    ["/stay/no-such-page", "other"],
  ];

  for (const theme of THEME_IDS) {
    it(`${theme}: the footer with the credit and the legal links on all ${PAGES.length} pages`, () => {
      for (const [path, page] of PAGES) {
        const html = shellAt(path, theme, page);
        expect(html, `${theme} ${path}`).toContain(`data-site-theme="${theme}"`);
        expect(html, `${theme} ${path}`).toContain("data-site-footer");
        expect(textOf(html), `${theme} ${path}`).toContain(NURIEL_CREDIT_BUILT);
        expect(textOf(html), `${theme} ${path}`).toContain(NURIEL_CREDIT_RIGHTS);
        expect(html, `${theme} ${path}`).toContain(`rel="${NURIEL_CREDIT_REL}"`);
        expect(html, `${theme} ${path}`).toContain('href="/stay/privacy"');
        expect(html, `${theme} ${path}`).toContain('href="/stay/accessibility"');
      }
    });
  }

  it("phone: the footer leaves room for the fixed action bar wherever the bar is shown", () => {
    for (const path of ["/stay", "/stay/units/oak", "/stay/privacy", "/stay/accessibility"]) {
      expect(hasActionBar(path), path).toBe(true);
      const footer = shellAt(path, "luxury").match(/<footer[^>]*>/)?.[0] ?? "";
      for (const cls of FOOTER_BAR_SPACE.split(" ")) expect(footer, path).toContain(cls);
    }
    // עמודי ההזמנה בלי השורה — ובלי ריפוד מיותר
    for (const path of ["/stay/book", "/stay/booking-received", "/stay/my-booking"]) {
      expect(hasActionBar(path), path).toBe(false);
      const footer = shellAt(path, "luxury").match(/<footer[^>]*>/)?.[0] ?? "";
      expect(footer, path).not.toContain("safe-area-inset-bottom");
    }
  });

  it("the footer colours are fixed per theme (the owner's colours never reach them) and readable", () => {
    for (const theme of THEME_IDS) {
      const t = THEMES[theme];
      const vars = t.vars as Record<string, string>;
      const bg = vars["--site-deep"] ?? t.palette.deep;
      const fg = vars["--site-deep-foreground"];
      expect(fg, theme).toMatch(/^#[0-9a-f]{6}$/i);
      // השורה השנייה בשקיפות 85% — עדיין מעל 4.5:1
      expect(contrast(mix(bg, fg!, 0.85), bg), theme).toBeGreaterThanOrEqual(4.5);
      expect(contrast(fg!, bg), theme).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the design document has no field that reaches the footer or the credit", () => {
    const hostile = normalizeDesign(
      {
        v: 1,
        theme: "luxury",
        footer: { hidden: true },
        credit: false,
        hideCredit: true,
        css: "[data-nuriel-credit]{display:none}",
        sections: [{ id: "x", type: "footer", hidden: true, content: {} }],
      },
      "luxury",
    );
    const json = JSON.stringify(hostile);
    for (const word of ["footer", "credit", "Credit", "css", "display:none"]) {
      expect(json).not.toContain(word);
    }
  });
});

describe("error and not-found pages", () => {
  it("the site's error and not-found screens carry the credit", () => {
    for (const ui of [
      createElement(SiteError, { error: new Error("boom") }),
      createElement(SiteError, { error: new Error("האתר עדיין לא פתוח") }),
      createElement(SiteNotFound, {}),
      createElement(SiteNotFound, { data: { closed: true } }),
    ]) {
      const html = renderAt("/stay/x", ui);
      expect(textOf(html)).toContain(NURIEL_CREDIT_BUILT);
      expect(html).toContain(`rel="${NURIEL_CREDIT_REL}"`);
    }
  });

  const HOSP: SiteRef = {
    id: "22222222-2222-2222-2222-222222222222",
    siteType: "hospitality",
    status: "active",
  };
  const get = (pathname: string) => ({ pathname, method: "GET" });
  const open = { managementOpen: async () => false, siteOpen: async () => true };
  const closed = { managementOpen: async () => false, siteOpen: async () => false };

  it("the gate's static pages (not open, not found, suspended) carry the credit", async () => {
    const notOpen = await hospitalityGate(HOSP, get("/"), closed);
    const notFound = await hospitalityGate(HOSP, get("/products/x"), open);
    const suspended = await hospitalityGate({ ...HOSP, status: "suspended" }, get("/stay"), open);
    for (const res of [notOpen, notFound, suspended]) {
      const body = (await res?.text()) ?? "";
      expect(textOf(body)).toContain(NURIEL_CREDIT_BUILT);
      expect(textOf(body)).toContain(NURIEL_CREDIT_RIGHTS);
      expect(body).toContain(`rel="${NURIEL_CREDIT_REL}"`);
    }
    expect(notOpen?.status).toBe(404);
    expect(notFound?.status).toBe(404);
    expect(suspended?.status).toBe(403);
  });

  it("an unknown address on an open site says 'not found' (with a way home), not 'not open'", async () => {
    const body = (await (await hospitalityGate(HOSP, get("/no-such-page"), open))?.text()) ?? "";
    expect(body).toContain("העמוד לא נמצא");
    expect(body).toContain('href="/stay"');
    const shut = (await (await hospitalityGate(HOSP, get("/no-such-page"), closed))?.text()) ?? "";
    expect(shut).toContain("האתר עדיין לא פתוח");
  });
});
