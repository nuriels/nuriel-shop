import { expect, test, type APIRequestContext } from "@playwright/test";
import { hostGet, PORT, storeUrl } from "./helpers";
import { sql } from "./hospitality-helpers";

// Migration 40: a zimmer owner opens the business from the portal by themselves — a 30-day trial,
// straight into the management area (the same one-time entry code as a store), the site opens when
// they publish. In parallel the request is kept and the platform gets the details to call back.
// Everything runs against the disposable local stack; emails go to the mock server.

const MOCK = "http://127.0.0.1:4010";
const PORTAL = storeUrl("nuriel-app2");
/** the new address opens at https://<slug>.shop.localhost — not served locally */
const NEW_SITE = /^https:\/\/[^/]+\.shop\.localhost\//;
/** a fresh report of the certificates timer → a new address waits for its certificate (as on the server) */
const HEARTBEAT = "e2e-zimmer-ssl-agent.shop.localhost";

type MockCall = { url: string; body: string };

async function mails(request: APIRequestContext): Promise<{ to: string[]; subject: string }[]> {
  const calls = (await (await request.get(`${MOCK}/__calls`)).json()) as MockCall[];
  return calls
    .filter((c) => c.url.startsWith("/emails"))
    .map((c) => JSON.parse(c.body) as { to: string[] | string; subject?: string })
    .map((m) => ({ to: ([] as string[]).concat(m.to), subject: m.subject ?? "" }));
}

/** the 6-digit code from the newest mocked email sent to this address */
async function lastCodeFor(request: APIRequestContext, email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    for (const mail of (await mails(request)).reverse()) {
      if (!mail.to.includes(email)) continue;
      const match = /(\d{6})/.exec(mail.subject);
      if (match) return match[1]!;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no login code email for ${email}`);
}

test.beforeAll(() => {
  // the engine and the public sites are on in the platform (as on the server)
  sql(`UPDATE public.platform_feature_flags SET enabled = true
        WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled',
                      'hospitality_frontend_enabled', 'hospitality_booking_enabled')`);
  sql(`INSERT INTO public.tenant_ssl (host, status, checked_at) VALUES ('${HEARTBEAT}', 'active', now() + interval '1 hour')
       ON CONFLICT (host) DO UPDATE SET checked_at = EXCLUDED.checked_at`);
});

test.afterAll(() => {
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
  sql(`DELETE FROM public.tenant_ssl WHERE host = '${HEARTBEAT}'`);
});

test("portal → zimmer → the business opens (30-day trial) → management → publish opens the site", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now().toString().slice(-6);
  const email = `zimmer.${stamp}@e2e.test`;
  const slug = `e2e-zimmer-${stamp}`;
  const name = `צימרי הבדיקה ${stamp}`;

  await page.goto(PORTAL);
  // דף הנחיתה החדש: "כניסה" בכותרת — כניסה רגילה, בלי מסלול שנבחר מראש ("מה מקימים?")
  await page.getByRole("button", { name: "כניסה", exact: true }).click();
  await page.locator("#portal-email").fill(email);
  await page.getByRole("button", { name: "שליחת קוד למייל" }).click();
  await page.locator("#portal-code").fill(await lastCodeFor(request, email));

  // "מה מקימים?" — the zimmer card says it opens now, with the trial
  const zimmer = page.getByRole("button", { name: /אתר לצימר/ });
  await expect(zimmer).toBeVisible({ timeout: 20_000 });
  await expect(zimmer).toContainText("30 ימי ניסיון");
  await zimmer.click();

  await page.locator("#portal-zim-business_name").fill(name);
  await page.locator("#portal-zim-slug").fill(slug);
  await expect(page.getByText("הכתובת פנויה — היא תהיה שלכם")).toBeVisible();
  await page.locator("#portal-zim-phone").fill("050-765 4321");
  await page.locator("#portal-zim-units").fill("3");

  // the new address answers with a stub page — the entry code stays in its address (#code=…)
  await page.route(NEW_SITE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>stub</title>",
    }),
  );
  await page.getByRole("button", { name: "פתיחת העסק — 30 ימי ניסיון" }).click();
  await expect(page.getByRole("heading", { name: "העסק נפתח!" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/העסק נפתח — ניסיון עד \d/)).toBeVisible();
  await expect(page.getByText("נכנסים לאזור הניהול — מדריך ההקמה")).toBeVisible();

  // ---- the database: one transaction ----
  const id = sql(
    `SELECT id FROM public.tenants WHERE slug = '${slug}' AND site_type = 'hospitality'`,
  );
  expect(id).not.toBe("");
  expect(
    sql(`SELECT s.status || ':' || (s.trial_ends_at BETWEEN now() + interval '29 days 23 hours'
                                                    AND now() + interval '30 days 1 hour')
           FROM hospitality.subscriptions s WHERE s.tenant_id = '${id}'`),
  ).toBe("trialing:true");
  expect(
    sql(`SELECT r.role || ':' || r.is_protected FROM public.user_roles r
          WHERE r.tenant_id = '${id}' AND r.email = '${email}'`),
  ).toBe("admin:true");
  expect(
    sql(`SELECT r.status || ':' || r.units || ':' || r.phone FROM hospitality.site_requests r
          WHERE r.opened_tenant_id = '${id}' AND r.opened_at IS NOT NULL`),
  ).toBe("new:3:0507654321");
  expect(
    sql(`SELECT count(*) FROM public.tenant_feature_flags WHERE tenant_id = '${id}' AND enabled
          AND key IN ('hospitality_frontend_enabled', 'hospitality_booking_enabled')`),
  ).toBe("0");

  // ---- the emails: the owner (way back in) and the platform (call back) ----
  await expect
    .poll(async () => (await mails(request)).map((m) => m.subject))
    .toEqual(
      expect.arrayContaining([
        `${name} נפתח — אפשר להתחיל להקים את האתר`,
        `צימר חדש נפתח לניסיון: ${name}`,
      ]),
    );

  // ---- the certificate is ready → the portal goes in by itself with a one-time entry code ----
  sql(`INSERT INTO public.tenant_ssl (host, tenant_id, status, checked_at)
       VALUES ('${slug}.shop.localhost', '${id}', 'active', now())`);
  await page.waitForURL(NEW_SITE, { timeout: 20_000 });
  const handoff = /\/admin-handoff#code=([A-Za-z0-9_-]+)&from=portal$/.exec(page.url());
  expect(handoff, "the portal went in with a one-time entry code").not.toBeNull();
  await page.unroute(NEW_SITE);
  // the same code, on the local address of the business → the management area
  const site = `http://${slug}.shop.localhost:${PORT}`;
  await page.goto(`${site}/admin-handoff#code=${handoff![1]}&from=portal`);
  await expect(page).toHaveURL(/\/manage$/, { timeout: 20_000 });
  await page.goto(`${site}/manage/setup`);
  await expect(
    page.getByText("האתר ייפתח לגולשים ולהזמנות ברגע שתפרסמו אותו.").first(),
  ).toBeVisible({
    timeout: 20_000,
  });
  expect((await hostGet(request, `${slug}.shop.localhost`, "/stay")).status()).toBe(404);

  // ---- the owner publishes → the site and bookings open ----
  await page.goto(`${site}/manage/website`);
  await page.getByRole("button", { name: /יוקרה/ }).click();
  await page.getByRole("tab", { name: "פרסום" }).click();
  await expect(page.getByText("האתר ייפתח לגולשים ולהזמנות ברגע שתפרסמו.")).toBeVisible();
  await page.getByRole("button", { name: "פרסום האתר" }).click();
  await expect(page.getByText(/ונפתח לגולשים/).first()).toBeVisible({ timeout: 20_000 });
  expect(
    sql(`SELECT count(*) FROM public.tenant_feature_flags WHERE tenant_id = '${id}' AND enabled
          AND key IN ('hospitality_frontend_enabled', 'hospitality_booking_enabled')`),
  ).toBe("2");
  // the server keeps the site flags for 15 seconds
  await expect
    .poll(async () => (await hostGet(request, `${slug}.shop.localhost`, "/stay")).status(), {
      timeout: 30_000,
    })
    .toBe(200);
});
