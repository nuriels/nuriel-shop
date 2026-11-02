import { expect, test, type APIRequestContext } from "@playwright/test";
import { hostOf, PORT, storeUrl } from "./helpers";
import { expectAccessible, sql } from "./hospitality-helpers";

// דף הנחיתה של נוריאל מחשבים (עמוד הבית של nuriel-app2), על השרת הבנוי:
//   • SSR — כל התוכן ב-HTML הראשוני (בלי JavaScript): H1 אחד, המחירים מהמסד, JSON-LD, קנונית;
//   • שתי תקופות ניסיון נפרדות: הכפתור של החנות פותח את חלון הכניסה במסלול החנות (14 יום),
//     והכפתור של Hospitality — במסלול הצימר (30 יום); אחרי הקוד — ישר למסלול שנבחר;
//   • טופס יצירת קשר שעובד (נשמר בתיבת הפניות של השער), WhatsApp וקישורים אמיתיים;
//   • llms.txt רק לשער; חנות אחרת — עמוד הבית שלה לא השתנה;
//   • נגישות (axe) במחשב ובטלפון.

const PORTAL = storeUrl("nuriel-app2");
const MOCK = "http://127.0.0.1:4010";

/** בקשת HTTP רגילה (בלי דפדפן ובלי JavaScript) לאתר לפי שם המארח — כמו סורק */
const siteGet = (
  request: APIRequestContext,
  slug: string,
  path: string,
  headers: Record<string, string> = {},
) =>
  request.get(`http://127.0.0.1:${PORT}${path}`, {
    headers: { host: hostOf(slug), "x-forwarded-host": hostOf(slug), ...headers },
    maxRedirects: 0,
  });

/** הקוד בן 6 הספרות מהמייל האחרון שנשלח לכתובת (שירות המייל המדומה) */
async function lastCodeFor(request: APIRequestContext, email: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const calls = (await (await request.get(`${MOCK}/__calls`)).json()) as {
      url: string;
      body: string;
    }[];
    for (const call of calls.filter((c) => c.url.startsWith("/emails")).reverse()) {
      const mail = JSON.parse(call.body) as { to?: string[] | string; subject?: string };
      if (!([] as string[]).concat(mail.to ?? []).includes(email)) continue;
      const match = /(\d{6})/.exec(mail.subject ?? "");
      if (match) return match[1]!;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no login code email for ${email}`);
}

const plans = () =>
  sql(`SELECT string_agg(monthly_price::numeric::int::text, ',' ORDER BY plan_type)
         FROM public.platform_plans WHERE plan_type IN ('basic', 'premium')`)
    .split(",")
    .map(Number);

test.describe("landing page — server-rendered content", () => {
  test("the first HTML already has the page: one H1, sections, prices from the database, JSON-LD", async ({
    request,
  }) => {
    test.skip(test.info().project.name === "mobile", "one HTML check is enough");
    const res = await siteGet(request, "nuriel-app2", "/", {
      "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    });
    expect(res.status()).toBe(200);
    const html = await res.text();

    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain("נוריאל מחשבים: מחשבים, חנויות אונליין ומערכת לניהול צימרים");
    for (const id of ["computers", "online-store", "hospitality", "pricing", "faq", "contact"]) {
      expect(html).toContain(`id="${id}"`);
    }
    // the trials — each with its own button text
    expect(html).toContain("התחילו 14 ימי ניסיון בחינם");
    expect(html).toContain("התחילו 30 ימי ניסיון בחינם");
    // the store prices are the ones in the database (platform_plans)
    for (const price of plans()) expect(html).toContain(`${price.toLocaleString("he-IL")} ₪`);
    // head: title, description, canonical and structured data
    expect(html).toMatch(/<title>נוריאל מחשבים — /);
    expect(html).toMatch(/<link rel="canonical" href="[^"]+\/"/);
    const ld = /<script type="application\/ld\+json">(.+?)<\/script>/s.exec(html);
    expect(ld).not.toBeNull();
    const types = (JSON.parse(ld![1]!)["@graph"] as { "@type": string }[]).map((n) => n["@type"]);
    expect(types).toEqual(["ComputerStore", "WebSite", "Service", "Service", "FAQPage"]);
    // every image has a text alternative
    for (const img of html.match(/<img [^>]*>/g) ?? []) expect(img).toMatch(/ alt="[^"]+"/);
  });

  test("llms.txt and the sitemap of the portal; a regular store home page is unchanged", async ({
    request,
  }) => {
    test.skip(test.info().project.name === "mobile", "server files");
    const llms = await siteGet(request, "nuriel-app2", "/llms.txt");
    expect(llms.status()).toBe(200);
    const text = await llms.text();
    expect(text).toContain("# נוריאל מחשבים");
    expect(text).toContain("14 ימי ניסיון בחינם (לחנות אינטרנטית בלבד)");
    expect(text).not.toMatch(/\/(admin|manage|platform)\b/);
    const sitemap = await (await siteGet(request, "nuriel-app2", "/sitemap.xml")).text();
    expect(sitemap).toMatch(/<loc>[^<]+\/<\/loc>/);

    // another store: its home page is the catalog as before — no landing page
    const store = await (await siteGet(request, "kobi", "/")).text();
    expect(store).not.toContain('data-testid="platform-landing"');
    expect(store).not.toContain("התחילו 30 ימי ניסיון בחינם");
  });
});

test.describe("landing page — in the browser", () => {
  test("the trial buttons open their own path; after the code — straight to it", async ({
    page,
    request,
  }) => {
    test.skip(test.info().project.name === "mobile", "desktop flow");
    test.setTimeout(90_000);
    await page.goto(PORTAL);

    // the online store: 14 days
    await page.getByTestId("hero-store-trial").click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: /חנות אינטרנטית — 14 ימי ניסיון בחינם/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // Nuriel Hospitality: 30 days — and after the code, straight to the zimmer form
    await page.getByTestId("hero-zimmer-trial").click();
    await expect(
      dialog.getByRole("heading", { name: /Nuriel Hospitality — 30 ימי ניסיון בחינם/ }),
    ).toBeVisible();
    const email = `landing.${Date.now().toString(36)}@e2e.test`;
    await page.locator("#portal-email").fill(email);
    await page.getByRole("button", { name: "שליחת קוד למייל" }).click();
    await page.locator("#portal-code").fill(await lastCodeFor(request, email));
    await expect(page.locator("#portal-zim-business_name")).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toContainText("30 ימי ניסיון");
  });

  test("the contact form is real: validates, sends, and the message reaches the portal inbox", async ({
    page,
  }) => {
    test.skip(test.info().project.name === "mobile", "desktop flow");
    await page.goto(`${PORTAL}#contact`);
    const form = page.locator("#contact");
    await form.getByRole("button", { name: "שליחת הפנייה" }).click();
    await expect(form.getByText("נא למלא שם מלא")).toBeVisible();

    const stamp = Date.now().toString(36);
    const email = `contact.${stamp}@e2e.test`;
    await form.getByLabel("שם מלא").fill(`פונה ${stamp}`);
    await form.getByLabel("טלפון").fill("050-1234567");
    await form.getByLabel("אימייל").fill(email);
    await form.getByLabel("במה נוכל לעזור?").selectOption("Nuriel Hospitality");
    await form.getByLabel("ההודעה").fill("אשמח לשמוע על אתר לצימר שלנו");
    await form.getByRole("button", { name: "שליחת הפנייה" }).click();
    await expect(page.getByTestId("contact-sent")).toContainText("הפנייה נשלחה");

    expect(
      // FormData (multipart) sends line breaks as CRLF — like any form; compare without them
      sql(`SELECT replace(replace(m.message, E'\\r', ''), E'\\n', '|') FROM public.contact_messages m
             JOIN public.tenants t ON t.id = m.tenant_id
            WHERE t.slug = 'nuriel-app2' AND m.email = '${email}'`),
    ).toBe("נושא: Nuriel Hospitality||אשמח לשמוע על אתר לצימר שלנו");
  });

  test("links go where they say: WhatsApp, the example store and the example zimmer site", async ({
    page,
  }) => {
    test.skip(test.info().project.name === "mobile", "desktop flow");
    await page.goto(PORTAL);
    await expect(page.getByTestId("whatsapp-float")).toHaveAttribute(
      "href",
      /^https:\/\/wa\.me\/972505492178\?text=/,
    );
    const zimmer = page.getByTestId("zimmer-demo-link");
    await expect(zimmer).toHaveAttribute("href", "https://nofi-dorit.nuri1.fit/stay");
    await expect(zimmer).toHaveAttribute("target", "_blank");
    await expect(zimmer).toHaveAttribute("rel", /noopener/);
    await expect(
      page.locator("#online-store").getByRole("link", { name: /צפו בחנות לדוגמה/ }),
    ).toHaveAttribute("href", "https://nuriel-shop.nuri1.fit/");
    // every in-page link has its section
    const anchors = await page
      .locator('a[href^="#"]')
      .evaluateAll((links) => [...new Set(links.map((a) => a.getAttribute("href")!))]);
    for (const anchor of anchors) {
      expect(await page.locator(anchor).count(), anchor).toBeGreaterThan(0);
    }
    await expectAccessible(page, "landing page (desktop)");
  });

  test("@mobile the phone: menu, no sideways scroll, trial buttons, accessible", async ({
    page,
  }) => {
    test.skip(test.info().project.name !== "mobile", "the phone layout");
    await page.goto(PORTAL);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole("button", { name: "תפריט", exact: true }).click();
    const nav = page.locator("#landing-mobile-nav");
    await expect(nav).toBeVisible();
    await nav.getByRole("link", { name: "מחירים" }).click();
    await expect(nav).toBeHidden();
    await expect(
      page.locator("#pricing").getByRole("heading", { name: "חבילות ומחירים" }),
    ).toBeInViewport();
    await expect(page.getByTestId("hero-zimmer-trial")).toHaveText("התחילו 30 ימי ניסיון בחינם");
    await expectAccessible(page, "landing page (phone)");
  });
});
