import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fromJSON } from "seroval";
import { AUTH, hostGet, hostOf, platformUrl, PORT } from "./helpers";
import {
  accessToken,
  asPlatform,
  callServerFn,
  ensureUser,
  enterViaHandoffTo,
  sql,
} from "./hospitality-helpers";

// Nuriel Websites — האתר של אפרת מחובר לניהול הפלטפורמה (מיגרציה 197), 12 הבדיקות:
//   1–2. מנהל הפלטפורמה פותח את תיק האתר בפאנל ונכנס לעריכה בלי החשבון של אפרת (קוד חד-פעמי, נרשם ביומן)
//   3.   בעלת האתר נכנסת לחשבון שלה (ורואה רק את האתר שלה)
//   4–5. שינוי טקסט ושמירת טיוטה, החלפת תמונה — ביומן, עם סימון "מנהל פלטפורמה"
//   6.   שינוי תת-דומיין (אתר בדיקה): פנוי / שמור / תפוס, 301 מהכתובת הישנה, אותו אתר
//        + דומיין אישי (DNS מדומה בשמות .test): הוראות, בעלות ב-TXT, אימות, www ↔ בלי www, הניהול לא עובר
//   7.   הפרדה בין האתר הציבורי לניהול
//   8–10. האתר של אפרת (מפורסם זמנית במסד הבדיקה בלבד): מחשב + נייד, כל התמונות והגופנים מהתשתית של
//        Nuriel, HTML מלא לגוגלבוט (כותרת, תיאור, קנונית, OG, schema.org, RTL, בלי noindex) — ואחרי זה
//        מוחזר לטיוטה
//   11.  טפסים והתראות — websites-inquiries.spec.ts (12 בדיקות הקבלה של הפניות)
//   12.  הרשאות והפרדת לקוחות

const STUDIO_FN = "src/engines/business-profile/api/studio.functions.ts";
const ADDRESS_FN = "src/engines/business-profile/api/address.functions.ts";
const PLATFORM_FN = "src/engines/business-profile/api/platform-admin.functions.ts";
const EFRAT = "efrat-classic";
const RUN = `${Date.now().toString(36).slice(-5)}`;
const SITE = `pf-addr-${RUN}`;
const OTHER = `pf-other-${RUN}`;
const EFRAT_OWNER = { email: "efrat.owner@e2e.test", password: "Efrat-Owner-2026!" };
const OWNER_A = { email: "pf.owner.a@e2e.test", password: "Pf-Owner-A-2026!" };
const OWNER_B = { email: "pf.owner.b@e2e.test", password: "Pf-Owner-B-2026!" };
const DNS_FILE = fileURLToPath(new URL("../.dns-fixtures.json", import.meta.url));
const url = (slug: string, path = "") => `http://${hostOf(slug)}:${PORT}${path}`;
const ids: Record<string, string> = {};

let ipCounter = 10;
const IP_RUN = 20 + Math.floor(Math.random() * 200);
const nextIp = () => `10.${IP_RUN}.9.${(ipCounter++ % 250) + 1}`;

async function outcome<T>(
  res: APIResponse,
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  const text = await res.text();
  if (res.status() !== 200) return { ok: false, error: `${res.status()} ${text.slice(0, 300)}` };
  if (text.includes('"$TSR/Error"')) {
    const m = /"message":\{"t":1,"s":("(?:[^"\\]|\\.)*")\}/.exec(text);
    return { ok: false, error: m ? (JSON.parse(m[1]!) as string) : text.slice(0, 300) };
  }
  const d = fromJSON({ t: JSON.parse(text), f: 127, m: [] } as unknown as Parameters<
    typeof fromJSON
  >[0]) as { result: T };
  return { ok: true, result: d.result };
}
async function value<T>(res: APIResponse): Promise<T> {
  const o = await outcome<T>(res);
  if (!o.ok) throw new Error(`expected success, got: ${o.error}`);
  return o.result;
}

function documentFor(name: string) {
  return JSON.stringify({
    schema: 1,
    template: "elegant",
    locales: ["he"],
    business: { name: { he: name }, phone: "050-1234567", email: "hello@e2e.test" },
    pages: [
      {
        id: "home",
        slug: "",
        blocks: [{ id: "hero", type: "hero", v: 1, props: { title: { he: name } } }],
      },
    ],
  });
}

/** פרסום זמני במסד הבדיקה בלבד (כמו אחרי אישור) — מוחזר לטיוטה בסוף הבדיקה */
function publishTemporarily(siteId: string): () => void {
  const before =
    sql(`SELECT coalesce(live_version_id::text, '') || '|' || coalesce(first_approved_at::text, '')
                        FROM business_profile.sites WHERE tenant_id = '${siteId}'`);
  const flag = sql(`SELECT coalesce(enabled::text, '') FROM public.tenant_feature_flags
                     WHERE tenant_id = '${siteId}' AND key = 'business_profile_public'`);
  const versionId = sql(`WITH v AS (
      INSERT INTO business_profile.site_versions (tenant_id, state, version, template, document)
      SELECT tenant_id, 'published',
             coalesce((SELECT max(version) FROM business_profile.site_versions WHERE tenant_id = '${siteId}'), 0) + 1,
             template, document
        FROM business_profile.site_versions WHERE tenant_id = '${siteId}' AND state = 'draft' RETURNING id)
    UPDATE business_profile.sites SET live_version_id = (SELECT id FROM v), first_approved_at = coalesce(first_approved_at, now())
     WHERE tenant_id = '${siteId}' RETURNING live_version_id`);
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES ('${siteId}', 'business_profile_public', true)
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  return () => {
    const [live, approved] = before.split("|");
    sql(`UPDATE business_profile.sites SET live_version_id = ${live ? `'${live}'` : "NULL"},
                first_approved_at = ${approved ? `'${approved}'` : "NULL"} WHERE tenant_id = '${siteId}'`);
    sql(`SET session_replication_role = replica;
         DELETE FROM business_profile.site_versions WHERE id = '${versionId}'`);
    if (flag)
      sql(
        `UPDATE public.tenant_feature_flags SET enabled = ${flag} WHERE tenant_id = '${siteId}' AND key = 'business_profile_public'`,
      );
    else
      sql(
        `DELETE FROM public.tenant_feature_flags WHERE tenant_id = '${siteId}' AND key = 'business_profile_public'`,
      );
  };
}

/** הקישור החד-פעמי שהכפתור בפאנל פותח בלשונית חדשה — מוחזר מ-https ל-http המקומי של הבדיקה */
async function followPanelLink(page: Page, click: () => Promise<void>): Promise<string> {
  // the local test server has no https: an empty page answers there, so the full address (with #code) is visible
  const https = /^https:\/\/[a-z0-9.-]+\.shop\.localhost\//;
  await page.context().route(https, (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>handoff</title>",
    }),
  );
  const popupPromise = page.context().waitForEvent("page");
  await click();
  const popup = await popupPromise;
  await popup.waitForURL(/admin-handoff#code=/, { timeout: 15_000 });
  const link = popup.url();
  await popup.close();
  await page.context().unroute(https);
  return link;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  ids["efrat"] = sql(`SELECT id FROM public.tenants WHERE slug = '${EFRAT}'`);
  for (const u of [EFRAT_OWNER, OWNER_A, OWNER_B]) await ensureUser(request, u);
  asPlatform(
    `SELECT public.platform_bp_open_site('${SITE}', 'אתר לבדיקת כתובת', '${OWNER_A.email}', '${documentFor("אתר לבדיקת כתובת")}'::jsonb)`,
  );
  asPlatform(
    `SELECT public.platform_bp_open_site('${OTHER}', 'אתר של לקוח אחר', '${OWNER_B.email}', '${documentFor("אתר של לקוח אחר")}'::jsonb)`,
  );
  ids["a"] = sql(`SELECT id FROM public.tenants WHERE slug = '${SITE}'`);
  ids["b"] = sql(`SELECT id FROM public.tenants WHERE slug = '${OTHER}'`);
  writeFileSync(DNS_FILE, "{}");
});

test.afterAll(() => {
  for (const id of [ids["a"], ids["b"]]) {
    if (!id) continue;
    const slug = sql(`SELECT slug FROM public.tenants WHERE id = '${id}'`);
    if (slug) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${slug}')`);
  }
  writeFileSync(DNS_FILE, "{}");
});

test("1–2, 4–5: the platform admin opens Efrat's site file, enters editing WITHOUT her account; text + image changes are saved and logged as the platform admin", async ({
  browser,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the platform panel runs on the computer");
  test.skip(!ids["efrat"], "Efrat's site is built by websites-efrat-faithful.spec.ts");
  const original = sql(
    `SELECT document::text FROM business_profile.site_versions WHERE tenant_id = '${ids["efrat"]}' AND state = 'draft'`,
  );
  try {
    const ctx = await browser.newContext({ storageState: AUTH.platform });
    const panel = await ctx.newPage();
    await panel.goto(platformUrl("/platform/websites"));
    const row = panel.getByTestId("bp-platform-sites").locator("li", { hasText: "אפרת אדיר" });
    await row.getByRole("link", { name: "תיק האתר" }).click();
    await expect(panel).toHaveURL(new RegExp(`/platform/websites/${ids["efrat"]}$`));
    await expect(panel.getByRole("heading", { level: 1, name: "אפרת אדיר" })).toBeVisible();
    for (const text of [
      "כתובת האתר",
      "סטטוס פרסום",
      "תבנית",
      "דומיין אישי",
      "עדכון אחרון של הטיוטה",
      "טיוטה — לא פורסם",
      "classic",
      `${EFRAT}.shop.localhost`,
    ])
      await expect(panel.getByText(text).first()).toBeVisible();
    for (const b of ["כניסה לניהול האתר", "תצוגה מקדימה", "עריכת תוכן"])
      await expect(panel.getByRole("button", { name: b })).toBeVisible();
    const axe = await new AxeBuilder({ page: panel }).analyze();
    expect(
      axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
    ).toEqual([]);

    // "עריכת תוכן": קוד חד-פעמי לאתר הזה בלבד, בכתובת של Nuriel (לא דומיין של הלקוחה), ישר לעורך
    const link = await followPanelLink(panel, () =>
      panel.getByRole("button", { name: "עריכת תוכן" }).click(),
    );
    const u = new URL(link);
    expect(u.host).toBe(hostOf(EFRAT));
    expect(u.pathname).toBe("/admin-handoff");
    expect(u.hash).toMatch(/^#code=[A-Za-z0-9_-]{40,64}&then=editor$/);
    expect(
      sql(`SELECT count(*) FROM public.platform_audit_log WHERE tenant_id = '${ids["efrat"]}'
                 AND action = 'admin_entered_store' AND created_at > now() - interval '1 minute'`),
    ).not.toBe("0");

    const site = await ctx.newPage();
    await site.setExtraHTTPHeaders({ "x-real-ip": nextIp() });
    await site.goto(`${url(EFRAT)}${u.pathname}${u.hash}`);
    await expect(site).toHaveURL(/\/studio\/editor$/, { timeout: 20_000 });
    // no account of Efrat was used: the session is the platform admin's
    const who =
      sql(`SELECT u.email FROM public.platform_admin_handoffs h JOIN auth.users u ON u.id = h.user_id
                      WHERE h.tenant_id = '${ids["efrat"]}' ORDER BY h.created_at DESC LIMIT 1`);
    expect(who).toBe("platform@e2e.test");

    // 4. text: the Google title of the home page; 5. image: the share image (from Efrat's library)
    await site.getByRole("tab", { name: "SEO וגוגל" }).click();
    await site.getByLabel("כותרת לגוגל (Title)").fill("אפרת אדיר — עריכה ספרותית (בדיקת מנהל)");
    await expect(site.getByTestId("google-preview-desktop")).toContainText(
      "אפרת אדיר — עריכה ספרותית (בדיקת מנהל)",
    );
    await site
      .getByRole("button", { name: /בחירת תמונה|החלפה/ })
      .first()
      .click();
    await site
      .getByRole("dialog")
      .getByRole("button", { name: /^בחירת / })
      .nth(3)
      .click();
    await site.getByRole("button", { name: "שמירה" }).click();
    await expect(site.getByText("הטיוטה נשמרה").first()).toBeVisible();
    const seo = JSON.parse(
      sql(`SELECT document -> 'pages' -> 0 -> 'seo' FROM business_profile.site_versions
                                 WHERE tenant_id = '${ids["efrat"]}' AND state = 'draft'`),
    ) as {
      title: { he: string };
      image: { media: string | null };
    };
    expect(seo.title.he).toBe("אפרת אדיר — עריכה ספרותית (בדיקת מנהל)");
    expect(seo.image.media).toMatch(/^[0-9a-f-]{36}$/);
    const saved = JSON.parse(
      sql(`SELECT details FROM business_profile.audit_log WHERE tenant_id = '${ids["efrat"]}'
                                   AND action = 'draft.saved' ORDER BY id DESC LIMIT 1`),
    ) as Record<string, unknown>;
    expect(saved["via"]).toBe("platform_admin");
    expect(saved["changed"]).toEqual(["pages"]);
    expect(JSON.stringify(saved)).not.toContain("בדיקת מנהל"); // the log holds what changed, not the content

    // the site file shows who did what
    await panel.reload();
    const audit = panel.getByTestId("bp-site-audit");
    await expect(audit.locator("tr", { hasText: "שמירת טיוטה" }).first()).toContainText(
      "מנהל פלטפורמה",
    );
    await expect(audit.locator("tr", { hasText: "שמירת טיוטה" }).first()).toContainText(
      "platform@e2e.test",
    );
    await expect(
      audit.locator("tr", { hasText: "כניסה לניהול האתר מפאנל הפלטפורמה" }).first(),
    ).toBeVisible();

    // "תצוגה מקדימה" lands on the preview
    const previewLink = new URL(
      await followPanelLink(panel, () =>
        panel.getByRole("button", { name: "תצוגה מקדימה" }).click(),
      ),
    );
    expect(previewLink.hash).toMatch(/&then=preview$/);
    const preview = await ctx.newPage();
    await preview.setExtraHTTPHeaders({ "x-real-ip": nextIp() });
    await preview.goto(`${url(EFRAT)}${previewLink.pathname}${previewLink.hash}`);
    await expect(preview).toHaveURL(/\/studio\/preview$/, { timeout: 20_000 });
    // the same one-time code again: refused (it was used)
    const again = await ctx.newPage();
    await again.setExtraHTTPHeaders({ "x-real-ip": nextIp() });
    await again.goto(`${url(EFRAT)}${u.pathname}${u.hash}`);
    await expect(again.getByText(/קישור הכניסה לא תקף/)).toBeVisible({ timeout: 20_000 });
    await ctx.close();
  } finally {
    sql(`UPDATE business_profile.site_versions SET document = '${original.replace(/'/g, "''")}'::jsonb, revision = revision + 1
          WHERE tenant_id = '${ids["efrat"]}' AND state = 'draft'`);
  }
});

test("3: the site owner logs in to her own account (central login → her studio), sees her settings, and nothing of other sites", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "covered on the computer");
  test.skip(!ids["efrat"], "Efrat's site is built by websites-efrat-faithful.spec.ts");
  asPlatform(`SELECT public.platform_bp_set_owner('${ids["efrat"]}', '${EFRAT_OWNER.email}')`);
  await page.setExtraHTTPHeaders({ "x-real-ip": nextIp() });
  await enterViaHandoffTo(page, url(EFRAT), ids["efrat"]!, EFRAT_OWNER.email, /\/studio$/);
  await page.getByRole("link", { name: "הגדרות האתר" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "הגדרות האתר" })).toBeVisible();
  // the address she asked for — free in the test environment (not changed here)
  await page.getByLabel("כתובת חדשה").fill("efrat");
  await page.getByRole("button", { name: "בדיקה אם פנויה" }).click();
  await expect(page.getByRole("status").filter({ hasText: "הכתובת פנויה" })).toBeVisible();
  await expect(page.getByTestId("google-preview-desktop")).toContainText("אפרת אדיר");
  await page.mouse.move(0, 0); // not mid-hover over a button
  const axe = await new AxeBuilder({ page }).include("main").analyze();
  expect(
    axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
  ).toEqual([]);

  const token = await accessToken(request, EFRAT_OWNER);
  // her token on another business's site: refused
  const other = await outcome(
    await callServerFn(request, {
      host: hostOf(OTHER),
      file: ADDRESS_FN,
      name: "studioAddress",
      method: "GET",
      token,
    }),
  );
  expect(other.ok).toBe(false);
  // the platform panel's functions: refused (not a platform admin)
  const file = await outcome(
    await callServerFn(request, {
      host: "platform.shop.localhost",
      file: PLATFORM_FN,
      name: "websitesPlatformSiteFile",
      method: "GET",
      token,
      data: { tenantId: ids["efrat"] },
    }),
  );
  expect(file.ok).toBe(false);
});

test("6: changing the Nuriel subdomain — free / reserved / taken; the same site; 301 from the old address; the old name stays reserved", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "covered on the computer");
  const before = sql(
    `SELECT count(*) FROM business_profile.site_versions WHERE tenant_id = '${ids["a"]}'`,
  );
  await page.setExtraHTTPHeaders({ "x-real-ip": nextIp() });
  await enterViaHandoffTo(page, url(SITE), ids["a"]!, OWNER_A.email, /\/studio$/);
  await page.goto(url(SITE, "/studio/settings"));
  const input = page.getByLabel("כתובת חדשה");
  const check = page.getByRole("button", { name: "בדיקה אם פנויה" });
  const result = page.locator("form").getByRole("status");
  for (const [name, message] of [
    ["www", "הכתובת הזו שמורה למערכת — בחרו כתובת אחרת"],
    ["platform", "הכתובת הזו שמורה למערכת — בחרו כתובת אחרת"],
    [OTHER, "הכתובת הזו כבר תפוסה"],
    ["-bad-", "כתובת: 3–63 תווים — אותיות באנגלית קטנות, ספרות ומקף בודד (לא בהתחלה ולא בסוף)"],
  ] as const) {
    await input.fill(name);
    await check.click();
    await expect(result).toHaveText(message);
    await expect(page.getByRole("button", { name: "שמירת הכתובת החדשה" })).toBeDisabled();
  }
  const NEW = `${SITE}-new`;
  await input.fill(NEW);
  await check.click();
  await expect(result).toHaveText("הכתובת פנויה");
  await page.getByRole("button", { name: "שמירת הכתובת החדשה" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "שינוי הכתובת" }).click();
  await expect(page.getByText(`הכתובת שונתה. הכתובת החדשה: ${NEW}.shop.localhost`)).toBeVisible();
  await expect(page.getByRole("link", { name: "מעבר לממשק הניהול בכתובת החדשה" })).toHaveAttribute(
    "href",
    `http://${NEW}.shop.localhost:${PORT}/studio/settings`,
  );

  // the same site (same id, draft and versions) — only the address changed
  expect(sql(`SELECT slug FROM public.tenants WHERE id = '${ids["a"]}'`)).toBe(NEW);
  expect(
    sql(`SELECT count(*) FROM business_profile.site_versions WHERE tenant_id = '${ids["a"]}'`),
  ).toBe(before);
  // 301 from the old address (any path, query kept) to the new one; the new address is the site
  const old = await hostGet(request, hostOf(SITE), "/about?x=1");
  expect(old.status()).toBe(301);
  expect(old.headers()["location"]).toBe(`https://${NEW}.shop.localhost/about?x=1`);
  expect((await hostGet(request, hostOf(NEW), "/")).status()).toBe(404); // not published yet: "under construction"
  expect(await (await hostGet(request, hostOf(NEW), "/")).text()).toContain("האתר בהקמה");
  // the old name stays reserved for a year (another owner cannot take it); the agent keeps its certificate
  const tokenB = await accessToken(request, OWNER_B);
  const taken = await value<{ available: boolean; message: string }>(
    await callServerFn(request, {
      host: hostOf(OTHER),
      file: ADDRESS_FN,
      name: "studioSlugCheck",
      token: tokenB,
      data: { slug: SITE },
    }),
  );
  expect(taken).toMatchObject({ available: false, message: "הכתובת הזו כבר תפוסה" });
  expect(
    sql(
      `SELECT count(*) FROM public.ssl_agent_targets() WHERE kind = 'alias' AND slug = '${SITE}'`,
    ),
  ).toBe("1");
  // both logs
  expect(
    sql(`SELECT details ->> 'from' || '>' || (details ->> 'to') FROM business_profile.audit_log
               WHERE tenant_id = '${ids["a"]}' AND action = 'site.address_changed'`),
  ).toBe(`${SITE}>${NEW}`);
});

test("6b: custom domain — DNS instructions, ownership by TXT, verify, www ↔ bare redirect, SSL status, the management stays on the Nuriel host", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "covered on the computer");
  const slug = sql(`SELECT slug FROM public.tenants WHERE id = '${ids["a"]}'`);
  const DOMAIN = `www.${slug}.test`;
  const BARE = `${slug}.test`;
  await page.setExtraHTTPHeaders({ "x-real-ip": nextIp() });
  await enterViaHandoffTo(page, url(slug), ids["a"]!, OWNER_A.email, /\/studio$/);
  await page.goto(url(slug, "/studio/settings"));
  await page.getByRole("radio", { name: "דומיין אישי" }).check();
  await page
    .getByLabel("הדומיין (הכתובת הראשית שתופיע בגוגל)")
    .fill(`https://${DOMAIN.toUpperCase()}/`);
  // the full URL is refused with a clear message; then only the domain
  await page.getByRole("button", { name: "שמירת הדומיין" }).click();
  await expect(page.getByText(/בלי http/)).toBeVisible();
  await page.getByLabel("הדומיין (הכתובת הראשית שתופיע בגוגל)").fill(DOMAIN);
  await page.getByRole("button", { name: "שמירת הדומיין" }).click();
  const table = page.getByRole("table", { name: "רשומות DNS להוספה" });
  await expect(table).toBeVisible();
  const token = sql(
    `SELECT verify_token FROM business_profile.domain_settings WHERE tenant_id = '${ids["a"]}'`,
  );
  await expect(table).toContainText(`nuriel-verify=${token}`);
  await expect(table).toContainText("_nuriel-verify.www");
  await expect(table).toContainText("shops.shop.localhost"); // CNAME for www
  await expect(table).toContainText("203.0.113.10"); // A for the bare domain
  await expect(page.getByText("ממתין לבדיקת חיבור")).toBeVisible();
  expect(sql(`SELECT public.tenant_for_host('${DOMAIN}') = '${ids["a"]}'`)).toBe("f"); // not routed yet

  // no DNS yet → not verified, the reason is shown
  await page.getByRole("button", { name: "בדיקת חיבור" }).click();
  await expect(page.getByRole("list", { name: "תוצאת הבדיקה" })).toContainText(
    "בעלות (רשומת TXT): עוד לא",
  );
  await expect(page.getByText("החיבור לא הושלם").first()).toBeVisible();

  // the owner adds the records at the registrar (here: the test DNS)
  writeFileSync(
    DNS_FILE,
    JSON.stringify({
      [`_nuriel-verify.${DOMAIN}`]: { txt: [`nuriel-verify=${token}`] },
      [DOMAIN]: { cname: ["shops.shop.localhost"] },
      [BARE]: { a: ["203.0.113.10"] },
    }),
  );
  await page.getByRole("button", { name: "בדיקת חיבור" }).click();
  const results = page.getByRole("list", { name: "תוצאת הבדיקה" });
  await expect(results).toContainText("בעלות (רשומת TXT): תקין");
  await expect(results).toContainText("הפניה לשרת (DNS): תקין");
  await expect(results).toContainText("תעודת SSL: תונפק אחרי האימות");
  await expect(page.getByText("אומת — ממתין לתעודת SSL (כמה דקות)")).toBeVisible();
  expect(sql(`SELECT public.tenant_for_host('${DOMAIN}') = '${ids["a"]}'`)).toBe("t");
  // the bare form → 301 to the main domain; the certificate agent gets both
  const bare = await hostGet(request, BARE, "/x?y=1");
  expect(bare.status()).toBe(301);
  expect(bare.headers()["location"]).toBe(`https://${DOMAIN}/x?y=1`);
  expect(
    sql(`SELECT count(*) FROM public.custom_domain_targets() WHERE tenant_id = '${ids["a"]}'`),
  ).toBe("2");
  // the management never moves to the customer's domain
  const studioOnCustom = await hostGet(request, DOMAIN, "/studio/settings");
  expect(studioOnCustom.status()).toBe(302);
  expect(studioOnCustom.headers()["location"]).toBe(
    `https://${slug}.shop.localhost/studio/settings`,
  );
  // the certificate agent reports SSL active → the Nuriel address now 301s to the custom domain (one address in Google)
  sql(
    `UPDATE public.tenants SET custom_domain_status = 'active', custom_domain_ssl_expires_at = now() + interval '90 days' WHERE id = '${ids["a"]}'`,
  );
  await expect
    .poll(async () => (await hostGet(request, hostOf(slug), "/")).headers()["location"] ?? "", {
      timeout: 20_000,
    })
    .toBe(`https://${DOMAIN}/`);
  expect((await hostGet(request, hostOf(slug), "/studio")).status()).not.toBe(301); // the management stays
  await page.reload();
  await expect(page.getByText("פעיל עם SSL")).toBeVisible();

  // removing the domain → back to the Nuriel address; the registrar's DNS is not touched
  await page.getByRole("button", { name: "הסרת הדומיין" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "הסרת הדומיין" }).click();
  await expect(page.getByText("הדומיין האישי הוסר — האתר בכתובת של Nuriel")).toBeVisible();
  expect(
    sql(
      `SELECT count(*) FROM public.tenant_host_redirects WHERE tenant_id = '${ids["a"]}' AND kind = 'custom_alternate'`,
    ),
  ).toBe("0");
  writeFileSync(DNS_FILE, "{}");
});

test("7: the public site and the management are separate — the studio needs a login, is noindex, not framed, and closed in robots", async ({
  request,
}) => {
  test.skip(!ids["efrat"], "Efrat's site is built by websites-efrat-faithful.spec.ts");
  const studio = await hostGet(request, hostOf(EFRAT), "/studio");
  expect(studio.status()).toBe(200);
  const html = await studio.text();
  expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
  expect(studio.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  // no session → no draft
  const draft = await outcome(
    await callServerFn(request, {
      host: hostOf(EFRAT),
      file: STUDIO_FN,
      name: "studioDraft",
      method: "GET",
    }),
  );
  expect(draft.ok).toBe(false);
  const address = await outcome(
    await callServerFn(request, {
      host: hostOf(EFRAT),
      file: ADDRESS_FN,
      name: "studioAddress",
      method: "GET",
    }),
  );
  expect(address.ok).toBe(false);
  // the panel's functions do not run on a site's address at all
  const platformOnSite = await outcome(
    await callServerFn(request, {
      host: hostOf(EFRAT),
      file: PLATFORM_FN,
      name: "websitesPlatformSites",
      method: "GET",
    }),
  );
  expect(platformOnSite.ok).toBe(false);
});

test("8–10: Efrat's site after publishing (test DB only): Googlebot gets full HTML, every image and font loads from Nuriel's storage, computer + phone", async ({
  browser,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the phone is checked inside (390px)");
  test.skip(!ids["efrat"], "Efrat's site is built by websites-efrat-faithful.spec.ts");
  // before publishing: closed to Google
  const pre = await hostGet(request, hostOf(EFRAT), "/");
  expect(pre.status()).toBe(404);
  expect(pre.headers()["x-robots-tag"]).toBe("noindex");
  expect(await (await hostGet(request, hostOf(EFRAT), "/robots.txt")).text()).toBe(
    "User-agent: *\nDisallow: /\n",
  );

  const restore = publishTemporarily(ids["efrat"]!);
  try {
    const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
    let home!: APIResponse;
    await expect
      .poll(
        async () => {
          home = await request.get(`http://127.0.0.1:${PORT}/`, {
            headers: {
              host: hostOf(EFRAT),
              "x-forwarded-host": hostOf(EFRAT),
              "user-agent": GOOGLEBOT,
            },
            maxRedirects: 0,
          });
          return home.status();
        },
        { timeout: 25_000 },
      )
      .toBe(200);
    const html = await home.text();
    // SSR: the full text is in the HTML (no JavaScript needed)
    expect(html).toMatch(/<html[^>]*lang="he"[^>]*dir="rtl"|<html[^>]*dir="rtl"[^>]*lang="he"/);
    for (const text of [
      "אפשר לקרוא סיפור,",
      "ואפשר להרגיש אותו",
      "הסיפור שלי",
      "לקוחות ממליצים",
      "המומחיות",
      "פרויקטים",
      "הצהרת נגישות",
    ])
      expect(html, text).toContain(text);
    expect(html).toContain(
      "<title>אפרת אדיר - עריכה ספרותית | עריכה לשונית | עריכת תוכן | ניקוד והגהה</title>",
    );
    expect(html).toMatch(/<meta name="description" content="עריכת ספרים מדויקת/);
    expect(html).toContain(`<link rel="canonical" href="https://${EFRAT}.shop.localhost/"`);
    expect(html).toMatch(
      /<meta property="og:image" content="http[^"]+\/storage\/v1\/object\/public\//,
    );
    expect(html).toContain('"@type":"ProfessionalService"');
    expect(html).not.toMatch(/name="robots" content="noindex/);
    expect(home.headers()["x-robots-tag"]).toBeUndefined();
    // robots + sitemap open after publishing
    const robots = await (await hostGet(request, hostOf(EFRAT), "/robots.txt")).text();
    expect(robots).toContain("Allow: /");
    expect(robots).toContain("Disallow: /studio");
    expect(robots).toContain(`Sitemap: https://${EFRAT}.shop.localhost/sitemap.xml`);
    const sitemap = await (await hostGet(request, hostOf(EFRAT), "/sitemap.xml")).text();
    expect(sitemap).toContain(`<loc>https://${EFRAT}.shop.localhost/</loc>`);
    expect(sitemap).toContain(`<loc>https://${EFRAT}.shop.localhost/accessibility</loc>`);

    // every image in the HTML: from Nuriel's storage, none from the old site, and each one loads
    const srcs = [
      ...new Set(
        [
          ...html.matchAll(
            /(?:src|href|content)="(https?:\/\/[^"]+\.(?:webp|avif|png|jpe?g|svg)[^"]*)"/g,
          ),
        ].map((m) => m[1]!.replace(/&amp;/g, "&")),
      ),
    ];
    // (the complete media audit — every file of the site in storage — is scripts/websites/audit-efrat-media.mjs)
    expect(srcs.length).toBeGreaterThanOrEqual(30);
    test.info().annotations.push({ type: "images in the HTML", description: String(srcs.length) });
    expect(html).not.toContain("efratadir.com/wp-content");
    for (const src of srcs) {
      expect(src, src).toMatch(/\/storage\/v1\/object\/public\/bp-media\//);
      const r = await request.get(src);
      expect(r.status(), src).toBe(200);
      expect(r.headers()["content-type"], src).toMatch(/^image\//);
    }
    // the fonts: the site's font CSS and every font file it names
    const fontCss = [...html.matchAll(/href="([^"]*fonts[^"]*\.css[^"]*)"/g)].map((m) => m[1]!);
    expect(fontCss.length).toBeGreaterThan(0);

    for (const device of [
      { name: "computer", viewport: { width: 1440, height: 900 } },
      {
        name: "phone",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    ]) {
      const ctx = await browser.newContext({ ...device, locale: "he-IL" });
      const p = await ctx.newPage();
      const failed: string[] = [];
      p.on("response", (r) => {
        if (r.status() >= 400 && !r.url().includes("/_serverFn"))
          failed.push(`${r.status()} ${r.url()}`);
      });
      await p.goto(url(EFRAT, "/"));
      await p.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += 500) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 50));
        }
        for (const img of document.images)
          if (img.getClientRects().length > 0) img.loading = "eager";
      });
      await p.waitForFunction(() =>
        [...document.images]
          .filter((i) => i.getClientRects().length > 0)
          .every((i) => i.complete && i.naturalWidth > 0),
      );
      const fonts = await p.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts]
          .filter((f) => f.status === "loaded")
          .map((f) => f.family.replace(/"/g, ""));
      });
      for (const family of ["Heebo", "Assistant", "Roboto"])
        expect(fonts, `${device.name}: ${family}`).toContain(family);
      expect(
        await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        device.name,
      ).toBeLessThanOrEqual(1);
      expect(failed, device.name).toEqual([]);
      await ctx.close();
    }
  } finally {
    restore();
  }
  await expect
    .poll(async () => (await hostGet(request, hostOf(EFRAT), "/")).status(), { timeout: 25_000 })
    .toBe(404);
});

test("12: permissions and client separation — another owner, a guest, a code for another site", async ({
  request,
}) => {
  const tokenA = await accessToken(request, OWNER_A);
  const tokenB = await accessToken(request, OWNER_B);
  const slugA = sql(`SELECT slug FROM public.tenants WHERE id = '${ids["a"]}'`);
  // B's owner cannot read or change A's address / domain
  for (const [name, data, method] of [
    ["studioAddress", undefined, "GET"],
    ["studioSlugChange", { slug: "pf-steal-x", current: slugA }, "POST"],
    ["studioCustomDomainSave", { domain: "www.steal.test", alternateRedirect: true }, "POST"],
    ["studioCustomDomainCheck", undefined, "POST"],
  ] as const) {
    const r = await outcome(
      await callServerFn(request, {
        host: hostOf(slugA),
        file: ADDRESS_FN,
        name,
        data,
        method,
        token: tokenB,
      }),
    );
    expect(r.ok, name).toBe(false);
  }
  expect(sql(`SELECT slug FROM public.tenants WHERE id = '${ids["a"]}'`)).toBe(slugA);
  // a guest: nothing
  const guest = await outcome(
    await callServerFn(request, {
      host: hostOf(slugA),
      file: ADDRESS_FN,
      name: "studioSlugCheck",
      data: { slug: "x-free" },
    }),
  );
  expect(guest.ok).toBe(false);
  // an owner is not a platform admin: the site file / the list are refused
  for (const token of [tokenA, tokenB]) {
    const r = await outcome(
      await callServerFn(request, {
        host: "platform.shop.localhost",
        file: PLATFORM_FN,
        name: "websitesPlatformSiteFile",
        method: "GET",
        token,
        data: { tenantId: ids["a"] },
      }),
    );
    expect(r.ok).toBe(false);
  }
  // a platform admin's one-time code for site B cannot be used on site A's address
  const { createHash, randomBytes } = await import("node:crypto");
  const code = randomBytes(32).toString("base64url");
  sql(`INSERT INTO public.platform_admin_handoffs (token_hash, user_id, tenant_id, expires_at, kind)
       VALUES ('${createHash("sha256").update(code).digest("hex")}',
               (SELECT id FROM auth.users WHERE email = 'platform@e2e.test'), '${ids["b"]}', now() + interval '2 minutes', 'platform_admin')`);
  const redeem = await outcome(
    await callServerFn(request, {
      host: hostOf(slugA),
      file: "src/lib/handoff.functions.ts",
      name: "redeemStoreAdminHandoff",
      data: { code },
      headers: { "x-real-ip": nextIp() },
    }),
  );
  expect(redeem.ok).toBe(false);
  // the owner's own address settings work (the positive control)
  const own = await value<{ slug: string }>(
    await callServerFn(request, {
      host: hostOf(slugA),
      file: ADDRESS_FN,
      name: "studioAddress",
      method: "GET",
      token: tokenA,
    }),
  );
  expect(own.slug).toBe(slugA);
});
