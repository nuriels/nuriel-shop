import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  AUTH,
  hostOf,
  login,
  PORT,
  platformUrl,
  STORE_A,
  STORE_B,
  storeUrl,
  USERS,
} from "./helpers";
import {
  accessToken,
  asPlatform,
  callServerFn,
  ensureUser,
  expectAccessible,
  loadSession,
  saveSession,
  sql,
  type SavedSession,
} from "./hospitality-helpers";

// Billing & Agreements (מיגרציות 189–190), על השרת הבנוי, בשני המנועים:
//   • חנות: מנהל הפלטפורמה קובע בתיק הלקוח הסכם במחיר מיוחד (מע"מ בנפרד) ודמי הקמה, ורושם תשלום חלקי
//     על ההקמה; בעל החנות רואה ב"המנוי שלי" מחיר מחירון מול מוסכם, הקמה (סוכם / התקבל / יתרה) ותשלום
//     "התקבל (נרשם על ידי Nuriel)" — בלי ההערה הפנימית; מנהל (לא בעלים) לא רואה ולא מקבל מהשרת.
//   • צימר: בעל העסק מבקש שדרוג מלוח הבקרה (בלי חיוב ובלי שינוי חבילה); מנהל הפלטפורמה מאשר במחיר
//     מיוחד מ"בקשות שדרוג", ומחדש לתקופה הבאה עם תשלום; בעל העסק רואה את ההסכם המעודכן.
//   • הפרדה: מנהל / בעלים של עסק אחר / בעלים של המנוע השני — השרת מסרב.

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const FN = "src/platform/billing/billing.functions.ts";
const MANAGER_B = { email: "billing.mgr.b@e2e.test", password: "Billing-Mgr-B-1!" };
const OWNER_H = { email: "billing.owner.h@e2e.test", password: "Billing-Owner-H-1!" };
const MANAGER_H = { email: "billing.mgr.h@e2e.test", password: "Billing-Mgr-H-1!" };
const SLUG_H = `bil-e2e-${STAMP}`;
const SITE_NAME = `צימר חיוב ${STAMP}`;
const NOTE = `פנימי-E2E-${STAMP}`;
const siteUrl = (slug: string, path = "") => `http://${hostOf(slug)}:${PORT}${path}`;
let siteH = "";
let ownerH: SavedSession | null = null;
let managerH: SavedSession | null = null;

const summaryCall = async (
  request: Parameters<typeof callServerFn>[0],
  host: string,
  token: string,
) => (await callServerFn(request, { host, file: FN, name: "myBillingSummary", token })).text();

async function platformPage(browser: Browser, path: string): Promise<Page> {
  const ctx = await browser.newContext({ storageState: AUTH.platform });
  const page = await ctx.newPage();
  await page.goto(platformUrl(path));
  return page;
}

async function pickSelect(page: Page, id: string, value: string) {
  await page.locator(`#${id}`).selectOption(value);
}

test.beforeAll(async ({ request, browser }, testInfo) => {
  if (testInfo.project.name === "mobile") return;
  // מיגרציה 191: המע"מ בהסכם לפי Nuriel כמוכרת (ברירת המחדל: עוסק פטור — ללא מע"מ). כאן בודקים את
  // מסלול העוסק המורשה (מע"מ 18%, כולל / לא כולל), עם שדה השיעור פתוח; מוחזר לפטור בסוף
  sql(`UPDATE billing.settings SET seller_business_type = 'authorized', seller_prices_include_vat = false,
              allow_vat_rate_override = true`);
  for (const u of [MANAGER_B, OWNER_H, MANAGER_H]) await ensureUser(request, u);
  // a store manager (not the owner) in store B
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, display_name)
       SELECT '${STORE_B.id}', id, email, 'bil_mgr_b_${STAMP}', 'admin', true, 'מנהלת חיוב'
         FROM auth.users WHERE email = '${MANAGER_B.email}'
       ON CONFLICT DO NOTHING`);
  // a fresh zimmer site: owner (the first admin) + a manager
  sql(`UPDATE public.platform_feature_flags SET enabled = true
        WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled')`);
  asPlatform(`SELECT hospitality.admin_create_site('${SLUG_H}', '${SITE_NAME}')`);
  siteH = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG_H}'`);
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ('${siteH}', 'hospitality_backend_enabled', true), ('${siteH}', 'hospitality_management_enabled', true)`);
  asPlatform(`SELECT hospitality.admin_set_extra_managers('${siteH}', 3)`);
  for (const [email, name] of [
    [OWNER_H.email, "בעלת הצימר"],
    [MANAGER_H.email, "מנהל הצימר"],
  ] as const) {
    sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, display_name)
         SELECT '${siteH}', id, email, 'bil_' || replace(split_part(email, '@', 1), '.', '_') || '_${STAMP}', 'admin', true, '${name}'
           FROM auth.users WHERE email = '${email}'`);
  }
  ownerH = await saveSession(browser, siteUrl(SLUG_H), siteH, OWNER_H.email);
  managerH = await saveSession(browser, siteUrl(SLUG_H), siteH, MANAGER_H.email);
});

test.afterAll(() => {
  if (test.info().project.name === "mobile") return;
  sql(`DELETE FROM public.user_roles WHERE tenant_id = '${STORE_B.id}'
         AND user_id = (SELECT id FROM auth.users WHERE email = '${MANAGER_B.email}')`);
  // the site goes; its billing rows stay (financial records are never deleted with a business)
  if (siteH) asPlatform(`SELECT public.platform_delete_tenant('${siteH}', '${SLUG_H}')`);
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
  sql(`UPDATE billing.settings SET seller_business_type = 'exempt', seller_prices_include_vat = false,
              allow_vat_rate_override = false`);
});

test("store: the platform admin sets a special-price agreement and records a partial setup payment; the owner sees it, a manager does not", async ({
  browser,
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  // 1. the platform admin, customer file → "הסכם ותשלומים"
  const admin = await platformPage(browser, `/platform/customers/${STORE_B.id}`);
  await admin.getByTestId("tab-billing").click();
  const card = admin.getByTestId("billing-card");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByTestId("billing-edit-agreement").click();
  const sheet = admin.getByTestId("billing-agreement-sheet");
  await pickSelect(admin, "ag-plan", "premium");
  await pickSelect(admin, "ag-cycle", "monthly");
  await pickSelect(admin, "ag-vat-mode", "excluded");
  await sheet.locator("#ag-monthly").fill("333");
  await sheet.locator("#ag-yearly").fill("");
  await sheet.locator("#ag-setup").fill("500");
  await sheet.locator("#ag-vat-rate").fill("18");
  await sheet.locator("#ag-terms").fill(`תנאי E2E ${STAMP}`);
  await sheet.locator("#ag-note").fill(NOTE);
  await sheet.getByTestId("billing-quote").click();
  await expect(sheet.getByTestId("billing-quote-result")).toBeVisible();
  await sheet.getByRole("button", { name: /שמירת הסכם/ }).click();
  await expect(sheet).toBeHidden({ timeout: 15_000 });
  await expect(card.getByTestId("billing-card-monthly")).toContainText(
    "₪333 + מע״מ 18% (₪59.94) = ₪392.94",
  );
  await expect(card.getByTestId("billing-card-note")).toContainText(NOTE);
  // the list price did not change
  expect(sql(`SELECT monthly_price FROM public.platform_plans WHERE plan_type = 'premium'`)).toBe(
    "700.00",
  );

  // 2. a partial payment on the setup fee (500 + 18% = 590)
  await card.getByTestId("billing-record-payment").click();
  const entry = admin.getByTestId("billing-entry-sheet");
  await pickSelect(admin, "en-category", "setup");
  await entry.locator("#en-amount").fill("300");
  await pickSelect(admin, "en-method", "bank_transfer");
  await entry.locator("#en-desc").fill(`מקדמה ${STAMP}`);
  await entry.locator("#en-ref").fill(`REF-${STAMP}`);
  await entry.getByRole("button", { name: "רישום", exact: true }).click();
  await expect(entry).toBeHidden({ timeout: 15_000 });
  const setup = card.getByTestId("billing-card-setup");
  await expect(setup.locator('[data-field="due"]')).toHaveText("₪590");
  await expect(setup.locator('[data-field="paid"]')).toHaveText(/₪\d/);
  await admin.context().close();

  // 3. the owner: "המנוי שלי" — list vs agreed, VAT, setup due / received / balance, the payment
  await login(page, storeUrl(STORE_B.slug), USERS.ownerB);
  await page.goto(storeUrl(STORE_B.slug, "/admin?tab=billing"));
  const mine = page.getByTestId("my-billing");
  await expect(mine).toBeVisible({ timeout: 20_000 });
  await expect(mine.getByTestId("my-billing-list")).toContainText("₪700");
  await expect(mine.getByTestId("my-billing-agreed")).toContainText(
    "₪333 + מע״מ 18% (₪59.94) = ₪392.94",
  );
  await expect(mine.getByTestId("my-billing-special")).toBeVisible();
  await expect(mine.getByTestId("my-billing-setup").locator('[data-field="due"]')).toHaveText(
    "₪590",
  );
  await expect(mine.getByTestId("my-billing-terms")).toContainText(`תנאי E2E ${STAMP}`);
  const payment = mine.getByTestId("billing-entry").filter({ hasText: `מקדמה ${STAMP}` });
  await expect(payment).toContainText("התקבל (נרשם על ידי Nuriel)");
  await expect(payment).not.toContainText("אושר");
  await expect(page.getByText(NOTE)).toHaveCount(0);
  await expect(page.getByText(`REF-${STAMP}`)).toHaveCount(0);

  // 4. a manager (not the owner): no card, and the server refuses
  const mgrCtx = await browser.newContext();
  const mgr = await mgrCtx.newPage();
  await login(mgr, storeUrl(STORE_B.slug), MANAGER_B);
  await mgr.goto(storeUrl(STORE_B.slug, "/admin?tab=billing"));
  await expect(mgr.getByTestId("billing-owner-only")).toBeVisible({ timeout: 20_000 });
  await expect(mgr.getByTestId("my-billing")).toHaveCount(0);
  await expect(mgr.getByText(NOTE)).toHaveCount(0);
  await mgrCtx.close();
  expect(
    await summaryCall(request, hostOf(STORE_B.slug), await accessToken(request, MANAGER_B)),
  ).toContain("רק בעל העסק");
  // the owner of another store, on store B
  expect(
    await summaryCall(request, hostOf(STORE_B.slug), await accessToken(request, USERS.ownerA)),
  ).toContain("רק בעל העסק");
  // the owner of store B, on store A
  expect(
    await summaryCall(request, hostOf(STORE_A.slug), await accessToken(request, USERS.ownerB)),
  ).toContain("רק בעל העסק");
});

test("zimmer: the owner requests an upgrade (no charge, no change); the platform admin approves at a special price and renews with payment", async ({
  browser,
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  // 1. the owner requests premium from the dashboard
  await loadSession(page, ownerH!, "/manage");
  const mine = page.getByTestId("my-billing");
  await expect(mine).toBeVisible({ timeout: 20_000 });
  await expect(mine.getByTestId("my-billing-no-agreement")).toBeVisible();
  const form = mine.getByTestId("my-billing-request-form");
  await form.locator("#mb-plan").selectOption("premium");
  await form.locator("#mb-note").fill("רוצים את הפרימיום");
  await form.getByRole("button", { name: "שליחת בקשה" }).click();
  await expect(mine.getByTestId("my-billing-request-pending")).toBeVisible({ timeout: 15_000 });
  expect(sql(`SELECT count(*) FROM billing.ledger WHERE tenant_id = '${siteH}'`)).toBe("0");
  expect(
    sql(
      `SELECT COALESCE((SELECT plan_code FROM hospitality.subscriptions WHERE tenant_id = '${siteH}'), 'trial')`,
    ),
  ).toBe("trial");
  await expectAccessible(page, "zimmer dashboard with the billing card");

  // 2. a manager of the site: no billing section, and the server refuses (also for the request)
  const mgrCtx = await browser.newContext();
  const mgr = await mgrCtx.newPage();
  await loadSession(mgr, managerH!, "/manage");
  await expect(mgr.getByRole("navigation", { name: "ניווט ראשי" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(mgr.getByTestId("my-billing")).toHaveCount(0);
  await mgrCtx.close();
  const mgrToken = await accessToken(request, MANAGER_H);
  expect(await summaryCall(request, hostOf(SLUG_H), mgrToken)).toContain("רק בעל העסק");
  const mgrRequest = await callServerFn(request, {
    host: hostOf(SLUG_H),
    file: FN,
    name: "myBillingRequestUpgrade",
    data: { plan: "basic" },
    token: mgrToken,
  });
  expect(await mgrRequest.text()).toContain("רק בעל העסק");
  // the zimmer owner on a store, and a store owner on the zimmer site
  const ownerToken = await accessToken(request, OWNER_H);
  expect(await summaryCall(request, hostOf(STORE_B.slug), ownerToken)).toContain("רק בעל העסק");
  expect(
    await summaryCall(request, hostOf(SLUG_H), await accessToken(request, USERS.ownerB)),
  ).toContain("רק בעל העסק");
  // an owner cannot call a platform function
  const asOwner = await callServerFn(request, {
    host: "platform.shop.localhost",
    file: FN,
    name: "platformBillingCard",
    data: { tenantId: siteH },
    token: ownerToken,
  });
  expect(await asOwner.text()).toMatch(/רק מנהל הפלטפורמה/);

  // 3. the platform admin: "בקשות שדרוג" → approve with a special price (list 400, agreed 200 incl. VAT)
  const admin = await platformPage(browser, "/platform/upgrades");
  const row = admin.getByTestId("billing-request-row").filter({ hasText: SITE_NAME });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByTestId("billing-request-open").click();
  const card = admin.getByTestId("billing-card");
  await expect(card.getByTestId("billing-card-request")).toBeVisible({ timeout: 20_000 });
  await card.getByTestId("billing-request-approve").click();
  const sheet = admin.getByTestId("billing-agreement-sheet");
  await expect(sheet.locator("#ag-plan")).toHaveValue("premium");
  await pickSelect(admin, "ag-vat-mode", "included");
  await sheet.locator("#ag-monthly").fill("200");
  await sheet.locator("#ag-setup").fill("0");
  await sheet.locator("#ag-vat-rate").fill("18");
  await sheet.locator("#ag-message").fill("אושר במחיר מיוחד");
  await sheet.getByRole("button", { name: "אישור ושמירה" }).click();
  await expect(sheet).toBeHidden({ timeout: 15_000 });
  expect(sql(`SELECT status FROM billing.upgrade_requests WHERE tenant_id = '${siteH}'`)).toBe(
    "approved",
  );
  // in the trial the plan is not switched yet; nothing was charged
  expect(sql(`SELECT count(*) FROM billing.ledger WHERE tenant_id = '${siteH}'`)).toBe("0");

  // 4. renew to the first paid period, the payment received
  const trialEnd = sql(`SELECT billing.engine_state('${siteH}') ->> 'renewal_at'`);
  await card.getByTestId("billing-renew").click();
  const renew = admin.getByTestId("billing-renew-sheet");
  await renew.getByTestId("billing-renew-paid").click();
  await renew.locator("#rn-method").selectOption("bit");
  await renew.getByRole("button", { name: "חידוש", exact: true }).click();
  await expect(renew).toBeHidden({ timeout: 15_000 });
  expect(
    sql(`SELECT plan_code || '|' || status || '|' || (current_period_end = '${trialEnd}'::timestamptz + interval '1 month')
           FROM hospitality.subscriptions WHERE tenant_id = '${siteH}'`),
  ).toBe("premium|active|true");
  await expect(card.getByTestId("billing-card-paid")).toContainText("₪200");
  await admin.context().close();

  // 5. the owner sees the updated agreement and the approval
  await page.reload();
  await expect(mine.getByTestId("my-billing-special")).toBeVisible({ timeout: 20_000 });
  await expect(mine.getByTestId("my-billing-list")).toContainText("₪400");
  await expect(mine.getByTestId("my-billing-agreed")).toContainText("₪200 כולל מע״מ 18%");
  await expect(mine.getByTestId("my-billing-paid")).toContainText("₪200");
  await expect(mine.getByTestId("my-billing-request-last")).toContainText("אושר במחיר מיוחד");
  await expect(
    mine.getByTestId("my-billing-subscription").locator('[data-field="balance"]'),
  ).toHaveText("₪0");
});

test("the owner's billing card fits a phone (no horizontal scroll) @mobile", async ({ page }) => {
  // an agreement for store B through the database function itself (as the platform admin)
  const v =
    sql(`SELECT COALESCE((SELECT version FROM billing.agreements WHERE tenant_id = '${STORE_B.id}'
                                    AND superseded_at IS NULL), 0)`);
  asPlatform(`SELECT public.platform_billing_save_agreement('${STORE_B.id}',
    '{"plan":"premium","billing_cycle":"yearly","agreed_yearly":6000,"setup_fee":1000}', ${v})`);
  await login(page, storeUrl(STORE_B.slug), USERS.ownerB);
  await page.goto(storeUrl(STORE_B.slug, "/admin?tab=billing"));
  const mine = page.getByTestId("my-billing");
  await expect(mine).toBeVisible({ timeout: 20_000 });
  await expect(mine.getByTestId("my-billing-agreed")).toContainText("₪6,000");
  // המע"מ בהסכם לפי Nuriel כמוכרת: פטור (ברירת המחדל, בטלפון) — "ללא מע״מ"; מורשה (במחשב, beforeAll) — 18%
  const seller = sql(`SELECT seller_business_type FROM billing.settings`);
  await expect(mine.getByTestId("my-billing-vat")).toContainText(
    seller === "exempt" ? "ללא מע״מ" : "18%",
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  const box = await mine.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
