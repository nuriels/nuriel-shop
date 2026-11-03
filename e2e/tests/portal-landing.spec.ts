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
    // the heading is about the two products — two lines, a space between them for crawlers
    expect(html).toMatch(
      /<h1 id="hero-title"[^>]*><span[^>]*>חנות אינטרנטית לעסק<\/span> <span[^>]*>ואתר הזמנות לצימר<\/span><\/h1>/,
    );
    // no repeated "מחשבים" in the heading (the old "נוריאל מחשבים: מחשבים, …")
    expect(/<h1[^>]*>.*?<\/h1>/s.exec(html)?.[0]).not.toContain("מחשבים");
    for (const id of ["computers", "online-store", "hospitality", "pricing", "faq", "contact"]) {
      expect(html).toContain(`id="${id}"`);
    }
    // the trials — each with its own button text
    expect(html).toContain("התחילו 14 ימי ניסיון בחינם");
    expect(html).toContain("התחילו 30 ימי ניסיון בחינם");
    // the store prices are the ones in the database (platform_plans)
    for (const price of plans()) expect(html).toContain(`${price.toLocaleString("he-IL")} ₪`);
    // head: title, description, canonical and structured data
    expect(html).toContain("<title>חנות אינטרנטית לעסק ואתר הזמנות לצימר | נוריאל מחשבים</title>");
    expect(html).toMatch(/<link rel="canonical" href="[^"]+\/"/);
    const ld = /<script type="application\/ld\+json">(.+?)<\/script>/s.exec(html);
    expect(ld).not.toBeNull();
    const graph = JSON.parse(ld![1]!)["@graph"] as { "@type": string; logo?: { url: string } }[];
    expect(graph.map((n) => n["@type"])).toEqual([
      "ComputerStore",
      "WebSite",
      "Service",
      "Service",
      "FAQPage",
    ]);
    expect(graph[0]!.logo?.url).toMatch(/\/brand\/nuriel-computers-logo-512\.jpg$/);
    // every image has a text alternative
    for (const img of html.match(/<img [^>]*>/g) ?? []) expect(img).toMatch(/ alt="[^"]+"/);
    // the original logo instead of the business name in text: the header (a link to the top) and
    // the computers section + the footer (described with the text inside the logo)
    const logos = html.match(/<img [^>]*data-testid="brand-logo"[^>]*>/g) ?? [];
    expect(logos).toHaveLength(3);
    expect(logos.filter((l) => l.includes('alt="נוריאל מחשבים"'))).toHaveLength(1);
    expect(
      logos.filter((l) =>
        l.includes('alt="הלוגו של נוריאל מחשבים: מחשבים, תיקונים, שדרוגים, בניית אתרים"'),
      ),
    ).toHaveLength(2);
    // the WhatsApp number confirmed by the business — every WhatsApp and phone link
    const wa = html.match(/href="https:\/\/wa\.me\/[^"?]+/g) ?? [];
    expect(wa.length).toBeGreaterThanOrEqual(4);
    for (const href of wa) expect(href).toBe('href="https://wa.me/972505492178');
    const tel = html.match(/href="tel:[^"]+"/g) ?? [];
    expect(tel.length).toBeGreaterThanOrEqual(3);
    for (const href of tel) expect(href).toBe('href="tel:+972505492178"');
    expect(html).toContain("050-5492178");
    // the logo files are served (the original, and the web sizes made from it)
    for (const file of ["nuriel-computers-logo-original.png", "nuriel-computers-logo-192.webp"]) {
      expect((await siteGet(request, "nuriel-app2", `/brand/${file}`)).status(), file).toBe(200);
    }
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

  test("every trial button opens the onboarding on its own path — 14 days store, 30 days Hospitality", async ({
    page,
  }) => {
    test.skip(test.info().project.name === "mobile", "desktop flow");
    await page.goto(PORTAL);
    const dialog = page.getByRole("dialog");
    const buttons: [string, RegExp][] = [
      ["hero-store-trial", /חנות אינטרנטית — 14 ימי ניסיון בחינם/],
      ["store-trial", /חנות אינטרנטית — 14 ימי ניסיון בחינם/],
      ["plan-cta-store-basic", /חנות אינטרנטית — 14 ימי ניסיון בחינם/],
      ["plan-cta-store-premium", /חנות אינטרנטית — 14 ימי ניסיון בחינם/],
      ["hero-zimmer-trial", /Nuriel Hospitality — 30 ימי ניסיון בחינם/],
      ["zimmer-trial", /Nuriel Hospitality — 30 ימי ניסיון בחינם/],
      ["plan-cta-zimmer-basic", /Nuriel Hospitality — 30 ימי ניסיון בחינם/],
      ["plan-cta-zimmer-premium", /Nuriel Hospitality — 30 ימי ניסיון בחינם/],
    ];
    for (const [id, title] of buttons) {
      const button = page.getByTestId(id);
      await expect(button, id).toHaveText(/14|30/);
      await button.click();
      await expect(dialog.getByRole("heading", { name: title }), id).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
    // the header: the logo is the link to the top; "כניסה" opens the plain login
    await expect(page.getByRole("link", { name: "נוריאל מחשבים — לראש הדף" })).toHaveAttribute(
      "href",
      "#top",
    );
    await page.getByRole("button", { name: "כניסה", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "כניסה לניהול" })).toBeVisible();
  });

  test("the prominent signup button, the login link, and the link from the email (#login)", async ({
    page,
  }) => {
    test.skip(test.info().project.name === "mobile", "desktop flow");
    await page.goto(PORTAL);
    const dialog = page.getByRole("dialog");
    // the header and the hero: "הרשמה קלה — תוך 2 דקות"
    for (const id of ["header-signup", "hero-signup"]) {
      await expect(page.getByTestId(id)).toContainText("הרשמה");
      await page.getByTestId(id).click();
      await expect(
        dialog.getByRole("heading", { name: "הרשמה קלה — תוך 2 דקות" }),
        id,
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
    // the visible label on a computer (the phone shows the short "הרשמה")
    await expect(page.getByTestId("header-signup")).toHaveText("הרשמה קלה — תוך 2 דקות", {
      useInnerText: true,
    });
    // "כבר נרשמתם? כניסה לניהול"
    await page.getByTestId("hero-login").click();
    await expect(dialog.getByRole("heading", { name: "כניסה לניהול" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // the button in the "store opened" email: /#login opens the login window at once (a fresh page)
    await page.goto("about:blank");
    await page.goto(`${PORTAL}#login`);
    await expect(dialog.getByRole("heading", { name: "כניסה לניהול" })).toBeVisible();
    await expect(page.locator("#portal-email")).toBeVisible();
    expect(await page.evaluate(() => window.location.hash)).toBe("");
  });

  test("the footer pages answer: terms, privacy, accessibility", async ({ request }) => {
    test.skip(test.info().project.name === "mobile", "server pages");
    for (const path of ["/terms", "/privacy", "/accessibility"]) {
      expect((await siteGet(request, "nuriel-app2", path)).status(), path).toBe(200);
    }
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
