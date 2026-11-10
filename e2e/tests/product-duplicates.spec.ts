import { expect, test, type Browser, type Page } from "@playwright/test";
import { A, AUTH, hostGet, hostOf, platformUrl, STORE_A, USERS } from "./helpers";
import { sql } from "./hospitality-helpers";

// מוצרים כפולים — על השרת הבנוי, מול Supabase המקומי ו"דגם" מדומה (mock-services, בלי מפתח אמיתי):
//   • מנהל החנות רואה קבוצה של מוצרים עם אותו שם ואותה תמונה, ממזג (סכום הכמויות) — העותק נמחק, הכמות
//     מתחברת, המוצר שנשאר בקטלוג;
//   • "לא כפול" — הקבוצה לא מוצגת שוב;
//   • בלי התוסף NURIEL AI — לשונית "הצעות AI" מסבירה ולא שולחת כלום;
//   • עם התוסף — "בדיקה עם AI" מציעה מוצרים עם שמות שונים (הדגם המדומה: אותן מילים בסדר אחר), וההחלטה
//     של המנהל.

test.describe.configure({ mode: "serial" });

const FAKE_KEY = `sk-ant-api03-E2E${"DUPLICATESKEY".repeat(3)}Qw7_`;
const P = {
  oldCopy: "e2e0d000-0000-0000-0000-000000000001",
  newCopy: "e2e0d000-0000-0000-0000-000000000002",
  monitorA: "e2e0d000-0000-0000-0000-000000000003",
  monitorB: "e2e0d000-0000-0000-0000-000000000004",
  aiA: "e2e0d000-0000-0000-0000-000000000005",
  aiB: "e2e0d000-0000-0000-0000-000000000006",
};
const ids = Object.values(P)
  .map((id) => `'${id}'`)
  .join(", ");

function seed() {
  sql(
    `INSERT INTO public.categories (tenant_id, name) VALUES ('${STORE_A.id}', 'כפולים E2E') ON CONFLICT DO NOTHING`,
  );
  sql(`INSERT INTO public.global_products (id, tenant_id, created_by, sku, name, category, price_tier1, price_tier2, price_tier3,
         stock_quantity, image_url, created_at) VALUES
       ('${P.oldCopy}', '${STORE_A.id}', '${USERS.ownerA.id}', '97700001', 'אוזניות בדיקה E2E', 'כפולים E2E', 50, 50, 50, 3,
        'https://cdn.test/e2e-dup-headphones.webp', now() - interval '10 days'),
       ('${P.newCopy}', '${STORE_A.id}', '${USERS.ownerA.id}', '97700002', 'אוזניות  בדיקה e2e', 'כפולים E2E', 50, 50, 50, 2,
        'https://cdn.test/e2e-dup-headphones.webp', now()),
       ('${P.monitorA}', '${STORE_A.id}', '${USERS.ownerA.id}', '97700003', 'מסך E2E עם HDMI', 'כפולים E2E', 300, 300, 300, 1,
        'https://cdn.test/e2e-dup-monitor.webp', now() - interval '2 days'),
       ('${P.monitorB}', '${STORE_A.id}', '${USERS.ownerA.id}', '97700004', 'מסך E2E בלי HDMI', 'כפולים E2E', 250, 250, 250, 1,
        'https://cdn.test/e2e-dup-monitor.webp', now() - interval '1 day'),
       ('${P.aiA}', '${STORE_A.id}', '${USERS.ownerA.id}', '97700005', 'מקלדת אלחוטית K380 E2E', 'כפולים E2E', 150, 150, 150, 4,
        NULL, now() - interval '3 days'),
       ('${P.aiB}', '${STORE_A.id}', '${USERS.ownerA.id}', '97700006', 'מקלדת K380 אלחוטית E2E', 'כפולים E2E', 150, 150, 150, 1,
        NULL, now() - interval '4 days')
       ON CONFLICT (id) DO NOTHING`);
}

function cleanup() {
  sql(`DELETE FROM public.product_merges WHERE tenant_id = '${STORE_A.id}'`);
  sql(`DELETE FROM public.product_duplicate_dismissals WHERE tenant_id = '${STORE_A.id}'`);
  sql(`DELETE FROM public.global_products WHERE id IN (${ids})`);
  sql(`DELETE FROM public.categories WHERE tenant_id = '${STORE_A.id}' AND name = 'כפולים E2E'`);
  for (const t of [
    "ai_notifications",
    "ai_subscription_events",
    "ai_subscription_periods",
    "ai_subscriptions",
  ])
    sql(`DELETE FROM public.${t} WHERE tenant_id = '${STORE_A.id}'`);
  sql(`DELETE FROM public.ai_usage_log WHERE tenant_id = '${STORE_A.id}'`);
  sql(
    `UPDATE public.ai_settings SET mode = 'off', api_key_encrypted = NULL, api_key_last4 = NULL, last_error = NULL, last_error_at = NULL`,
  );
}

async function ownerDialog(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ storageState: AUTH.ownerA })).newPage();
  await page.goto(A("/admin?tab=products"));
  await page.getByTestId("open-duplicates").click();
  await expect(page.getByRole("dialog", { name: "מוצרים כפולים" })).toBeVisible({
    timeout: 20_000,
  });
  return page;
}

test.beforeAll(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop flow");
  cleanup();
  seed();
  await expect
    .poll(async () => (await hostGet(request, hostOf(STORE_A.slug), "/admin")).status(), {
      timeout: 20_000,
    })
    .toBeLessThan(500);
});

test.afterAll(() => cleanup());

test("store owner: merges two copies with the same name and image — the copy is deleted, the stock is summed", async ({
  browser,
}) => {
  const page = await ownerDialog(browser);
  const group = page
    .getByTestId("duplicate-group")
    .filter({ hasText: "אוזניות בדיקה E2E" })
    .first();
  await expect(group).toContainText("אותו שם");
  await expect(group).toContainText("אותה תמונה");
  // ברירת המחדל: הוותיק נשאר
  await expect(group.getByRole("radio", { name: /אוזניות בדיקה E2E/ }).first()).toBeChecked();
  await group.getByLabel(/לחבר את הכמויות/).check();
  await expect(group).toContainText("כמות 5");
  await group.getByRole("button", { name: "מיזוג…" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("יימחקו");
  await confirm.getByRole("button", { name: "כן, למזג" }).click();
  await expect(page.getByRole("status").filter({ hasText: "המיזוג הושלם" })).toBeVisible({
    timeout: 20_000,
  });
  expect(sql(`SELECT stock_quantity FROM public.global_products WHERE id = '${P.oldCopy}'`)).toBe(
    "5",
  );
  expect(sql(`SELECT count(*) FROM public.global_products WHERE id = '${P.newCopy}'`)).toBe("0");
  expect(sql(`SELECT count(*) FROM public.product_merges WHERE tenant_id = '${STORE_A.id}'`)).toBe(
    "1",
  );
});

test("store owner: 'not a duplicate' hides the group for good", async ({ browser }) => {
  const page = await ownerDialog(browser);
  const group = page.getByTestId("duplicate-group").filter({ hasText: "מסך E2E עם HDMI" }).first();
  await expect(group).toContainText("אותה תמונה");
  await group.getByRole("button", { name: "לא כפול" }).click();
  await expect(
    page.getByTestId("duplicate-group").filter({ hasText: "מסך E2E עם HDMI" }),
  ).toHaveCount(0);
  expect(
    sql(
      `SELECT count(*) FROM public.product_duplicate_dismissals WHERE tenant_id = '${STORE_A.id}'`,
    ),
  ).toBe("1");
});

test("without the NURIEL AI add-on the AI tab explains it, and nothing is sent to the model", async ({
  browser,
}) => {
  const page = await ownerDialog(browser);
  await page.getByRole("tab", { name: /הצעות AI/ }).click();
  await expect(page.getByTestId("ai-duplicates-off")).toContainText("NURIEL AI");
  await expect(page.getByRole("button", { name: "בדיקה עם AI" })).toHaveCount(0);
  expect(sql(`SELECT count(*) FROM public.ai_usage_log WHERE tenant_id = '${STORE_A.id}'`)).toBe(
    "0",
  );
});

test("with the add-on: the AI suggests products with different names; the owner decides", async ({
  browser,
}) => {
  // מנהל העל: מפתח, מצב פעיל, חבילה לחנות A (כמו ב-ai-assistant.spec.ts)
  const platform = await (await browser.newContext({ storageState: AUTH.platform })).newPage();
  await platform.goto(platformUrl("/platform/ai"));
  await platform.locator("#ai-key").fill(FAKE_KEY);
  await platform.getByRole("button", { name: "שמירת מפתח" }).click();
  await expect(platform.getByTestId("ai-key-status")).toContainText("Qw7_", { timeout: 15_000 });
  await platform.getByTestId("ai-mode-on").click();
  await expect(platform.getByTestId("ai-mode-on")).toHaveAttribute("aria-pressed", "true", {
    timeout: 15_000,
  });
  await platform.getByRole("button", { name: "Ecommerce", exact: true }).click();
  const storeName = sql(`SELECT name FROM public.tenants WHERE id = '${STORE_A.id}'`);
  await platform.getByLabel("חיפוש לפי שם העסק").fill(storeName);
  const row = platform
    .locator("[data-testid=ai-businesses] tbody tr")
    .filter({ hasText: storeName })
    .first();
  await row.getByTestId("ai-activate").click();
  const activate = platform.getByRole("dialog");
  await activate.getByTestId("ai-paid").click();
  await activate.getByTestId("ai-confirm").click();
  await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "active", {
    timeout: 15_000,
  });

  const page = await ownerDialog(browser);
  await page.getByRole("tab", { name: /הצעות AI/ }).click();
  await page.getByRole("button", { name: "בדיקה עם AI" }).click();
  const suggestion = page
    .getByTestId("duplicate-group")
    .filter({ hasText: "מקלדת K380 אלחוטית E2E" });
  await expect(suggestion).toContainText("אותו מוצר בניסוח אחר", { timeout: 20_000 });
  await expect(suggestion).toContainText("מקלדת אלחוטית K380 E2E");
  // ה-AI לא ממזג לבד
  expect(
    sql(`SELECT count(*) FROM public.global_products WHERE id IN ('${P.aiA}', '${P.aiB}')`),
  ).toBe("2");
  expect(
    sql(
      `SELECT count(*) FROM public.ai_usage_log WHERE tenant_id = '${STORE_A.id}' AND 'product-duplicates' = ANY (guides)`,
    ),
  ).toBe("1");
  await suggestion.getByRole("button", { name: "לא כפול" }).click();
  await expect(
    page.getByTestId("duplicate-group").filter({ hasText: "מקלדת K380 אלחוטית E2E" }),
  ).toHaveCount(0);
});
