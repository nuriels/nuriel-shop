import { expect, test } from "@playwright/test";
import { hostGet, hostOf, PORT } from "./helpers";
import {
  asPlatform,
  ensureUser,
  expectAccessible,
  loadSession,
  passwordSession,
  sql,
  type SavedSession,
} from "./hospitality-helpers";

// שלב א' 6 — "מתחם שומר שבת": בעל העסק מסמן במסך ההגדרות (נשמר מיד) → באתר: תג עם נרות בכותרת ובתחתית
// העמוד, והודעה בתהליך ההזמנה; מבטל → שום דבר לא מוצג. אתר אחר לא מושפע.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "sh.owner@e2e.test", password: "Sh-Owner-Pass-1!" };
const SLUG = "sh-site";
const HOST = hostOf(SLUG);
const URL_ = (path = "/") => `http://${HOST}:${PORT}${path}`;
let siteId = "";
let owner: SavedSession | null = null;
const FLAGS = [
  "hospitality_backend_enabled",
  "hospitality_management_enabled",
  "hospitality_frontend_enabled",
  "hospitality_booking_enabled",
] as const;

function cleanup() {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${SLUG}')`);
}

test.beforeAll(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "runs once, on the computer");
  cleanup();
  const ownerId = await ensureUser(request, OWNER);
  asPlatform(`SELECT hospitality.admin_open_site('${SLUG}', 'צימרי השבת', '${OWNER.email}')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
       VALUES ('${siteId}', '${ownerId}', '${OWNER.email}', 'sh_owner', 'admin', true) ON CONFLICT DO NOTHING`);
  sql(
    `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`,
  );
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ${FLAGS.map((f) => `('${siteId}', '${f}', true)`).join(", ")}
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  const propertyId = sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status)
       VALUES ('${siteId}', 'צימרי השבת', 'sh-p', 'active') RETURNING id`);
  sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price)
       VALUES ('${siteId}', '${propertyId}', 'unit', 'צימר הזית', 'sh-u1', 4, 2, 700)`);
  await expect
    .poll(async () => (await hostGet(request, HOST, "/stay")).status(), { timeout: 20_000 })
    .toBe(200);
  owner = await passwordSession(request, URL_(""), OWNER);
});

test.afterAll(() => {
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("off by default — no badge, no notice", async ({ page }) => {
  await page.goto(URL_("/stay"));
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByText("המתחם שומר שבת")).toHaveCount(0);
});

test("the owner turns it on in settings — the header and footer show the badge, the booking flow the notice; off again — gone", async ({
  page,
  browser,
}) => {
  await loadSession(page, owner!, "/manage/settings");
  const toggle = page.getByRole("switch", { name: "מתחם שומר שבת" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(() =>
      sql(`SELECT shabbat_observant FROM hospitality.settings WHERE tenant_id = '${siteId}'`),
    )
    .toBe("t");
  await expectAccessible(page, "settings with the shabbat switch");

  const visitor = await browser.newContext();
  const site = await visitor.newPage();
  await site.goto(URL_("/stay"));
  await expect(site.getByTestId("shabbat-badge-header")).toBeVisible();
  await expect(site.getByTestId("shabbat-badge-header")).toHaveText("המתחם שומר שבת");
  await expect(site.getByTestId("shabbat-badge-footer")).toBeVisible();
  await expectAccessible(site, "site with the shabbat badge");
  await site.goto(URL_("/stay/book"));
  await site.getByRole("button", { name: "החודש הבא" }).first().click();
  await site.getByRole("button", { name: "10 — פנוי" }).first().click();
  await site.getByRole("button", { name: "12 — פנוי" }).first().click();
  await expect(
    site.locator('[data-testid="shabbat-notice"] >> visible=true').first(),
  ).toContainText("המתחם שומר שבת");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect
    .poll(() =>
      sql(`SELECT shabbat_observant FROM hospitality.settings WHERE tenant_id = '${siteId}'`),
    )
    .toBe("f");
  await site.goto(URL_("/stay"));
  await expect(site.getByRole("banner")).toBeVisible();
  await expect(site.getByText("המתחם שומר שבת")).toHaveCount(0);
  await visitor.close();
  expect(
    sql(`SELECT string_agg(action, ',' ORDER BY created_at) FROM hospitality.audit_log
          WHERE tenant_id = '${siteId}' AND action LIKE 'settings.shabbat%'`),
  ).toBe("settings.shabbat_on,settings.shabbat_off");
});
