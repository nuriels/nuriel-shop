import { expect, test } from "@playwright/test";
import { A, AUTH, PRODUCTS, platformUrl, STORE_A, STORE_B } from "./helpers";
import { expectAccessible, sql } from "./hospitality-helpers";

// מע"מ לפי סוג העוסק (מיגרציה 191), על השרת הבנוי:
//   • בעל החנות רואה בקשה לאשר את סוג העוסק (חנות קיימת), בוחר "עוסק פטור" — הלקוח רואה "לא מתווסף
//     מע״מ", בלי שורת מע״מ בקופה, והסה"כ הוא המחיר.
//   • עוסק מורשה, מחירים לפני מע"מ — "+ מע״מ" ליד המחיר, בקופה שורת מע״מ 18%, והסה"כ בקופה הוא בדיוק
//     הסכום שהשרת יחייב (order_gross).
//   • בפאנל הפלטפורמה: השיעור המרכזי (18%), סוג העוסק של Nuriel, ואזהרה על רישומי "תעד תשלום" הישן
//     שלא ביומן החדש.

test.describe.configure({ mode: "serial" });

let original = "";

test.beforeAll(() => {
  if (test.info().project.name === "mobile") return;
  original = sql(
    `SELECT business_type || ',' || prices_include_vat FROM public.site_settings WHERE tenant_id = '${STORE_A.id}'`,
  );
  // חנות קיימת: ההגדרה עוד לא אושרה בידי בעל העסק
  sql(`UPDATE public.site_settings SET vat_settings_confirmed_at = NULL, vat_settings_confirmed_by = NULL
        WHERE tenant_id = '${STORE_A.id}'`);
});

test.afterAll(() => {
  if (test.info().project.name === "mobile" || !original) return;
  const [type, incl] = original.split(",");
  sql(`UPDATE public.site_settings SET business_type = '${type}', prices_include_vat = ${incl === "t"},
              vat_settings_confirmed_at = NULL, vat_settings_confirmed_by = NULL
        WHERE tenant_id = '${STORE_A.id}'`);
  sql(`UPDATE billing.settings SET seller_business_type = 'exempt', seller_prices_include_vat = false,
              allow_vat_rate_override = false`);
  sql(`SET session_replication_role = replica;
       DELETE FROM public.billing_history WHERE note = 'vat-e2e-legacy'`);
});

async function saveVat(
  page: import("@playwright/test").Page,
  type: "exempt" | "authorized",
  included?: boolean,
) {
  await page.goto(A("/admin?tab=site"));
  const card = page.getByTestId("vat-settings");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole("radio", { name: type === "exempt" ? /עוסק פטור/ : /עוסק מורשה/ }).click();
  if (type === "authorized") {
    await card
      .getByRole("radio", { name: included ? /כן — המחירים כוללים/ : /לא — המחירים לפני/ })
      .click();
  }
  await card.getByTestId("vat-settings-save").click();
  await expect(page.getByText("הגדרות המע״מ נשמרו")).toBeVisible({ timeout: 15_000 });
}

test("an existing store: the owner is asked to confirm, chooses exempt — the customer sees no VAT", async ({
  browser,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const owner = await (await browser.newContext({ storageState: AUTH.ownerA })).newPage();
  await owner.goto(A("/admin?tab=site"));
  const card = owner.getByTestId("vat-settings");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.locator("[data-vat-unconfirmed]")).toBeVisible();
  await expect(card).toContainText("שיעור המע״מ: 18%");
  await expectAccessible(owner, "vat settings card");

  await saveVat(owner, "exempt");
  expect(
    sql(`SELECT business_type || ',' || vat_rate::text || ',' || prices_include_vat || ',' || (vat_settings_confirmed_at IS NOT NULL)
           FROM public.site_settings WHERE tenant_id = '${STORE_A.id}'`),
  ).toBe("exempt,0.00,true,true");
  await expect(owner.getByTestId("vat-settings").locator("[data-vat-unconfirmed]")).toHaveCount(0);

  const customer = await (await browser.newContext({ storageState: AUTH.customerA })).newPage();
  await customer.goto(A(`/product/${PRODUCTS.a2.id}`));
  await customer.getByRole("button", { name: "הוספה לסל" }).first().click();
  await customer.goto(A("/checkout"));
  await expect(customer.getByText(PRODUCTS.a2.name).first()).toBeVisible({ timeout: 20_000 });
  await expect(customer.locator("[data-vat-caption]")).toContainText("עוסק פטור — ללא מע״מ");
  await expect(customer.locator("[data-vat-line]")).toHaveCount(0);
  await customer.context().close();
  await owner.context().close();
});

test("authorized, prices before VAT: '+ מע״מ' next to the price, a VAT line, and the checkout total = what the server charges", async ({
  browser,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const owner = await (await browser.newContext({ storageState: AUTH.ownerA })).newPage();
  await saveVat(owner, "authorized", false);
  expect(
    sql(`SELECT business_type || ',' || vat_rate::text || ',' || prices_include_vat
           FROM public.site_settings WHERE tenant_id = '${STORE_A.id}'`),
  ).toBe("authorized,18.00,false");
  await owner.context().close();

  const customer = await (await browser.newContext({ storageState: AUTH.customerA })).newPage();
  await customer.goto(A(`/product/${PRODUCTS.a2.id}`));
  await expect(customer.getByText("+ מע״מ").first()).toBeVisible({ timeout: 20_000 });
  await customer.getByRole("button", { name: "הוספה לסל" }).first().click();
  await customer.goto(A("/checkout"));
  await expect(customer.getByText(PRODUCTS.a2.name).first()).toBeVisible({ timeout: 20_000 });
  const line = customer.locator("[data-vat-line]");
  await expect(line).toContainText("מע״מ 18%");
  // the server's own calculation for the same amount (order_gross — the amount charged)
  const net = Number(
    sql(`SELECT price_tier1 FROM public.global_products WHERE id = '${PRODUCTS.a2.id}'`),
  );
  const serverGross = sql(
    `SELECT to_char(public.order_gross(${net}, false, (public.tenant_vat_profile('${STORE_A.id}') ->> 'vat_rate')::numeric), 'FM999999990.00')`,
  );
  await expect(customer.getByText(serverGross).first()).toBeVisible();
  await customer.context().close();
});

test("the platform panel: the central rate, Nuriel's dealer type, and the old 'record payment' rows not in the new ledger", async ({
  browser,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  sql(`INSERT INTO public.billing_history (tenant_id, kind, plan_type, amount, payment_status, note)
       VALUES ('${STORE_B.id}', 'payment', 'premium', 77, 'due', 'vat-e2e-legacy')`);
  const admin = await (await browser.newContext({ storageState: AUTH.platform })).newPage();
  await admin.goto(platformUrl("/platform/upgrades"));
  const panel = admin.getByTestId("billing-vat-panel");
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel).toContainText("שיעור המע״מ המרכזי: 18%");
  await expect(panel.locator("#vat-seller-type")).toHaveValue("exempt");
  await expect(panel.getByTestId("billing-legacy-overview")).toContainText("ממתינים");

  // the customer file of store B: the warning, and an exempt agreement has no VAT choice
  await admin.goto(platformUrl(`/platform/customers/${STORE_B.id}`));
  await admin.getByTestId("tab-billing").click();
  const card = admin.getByTestId("billing-card");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByTestId("billing-legacy-warning")).toContainText("לא נספרים");
  await card.getByTestId("billing-edit-agreement").click();
  const sheet = admin.getByTestId("billing-agreement-sheet");
  await expect(sheet.getByTestId("billing-vat-exempt")).toBeVisible();
  await expect(sheet.locator("#ag-vat-mode")).toHaveCount(0);
  await expect(sheet.locator("#ag-vat-rate")).toHaveCount(0);
  await admin.context().close();
});
