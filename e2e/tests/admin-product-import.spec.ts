// STORE-2: ייבוא שמזהה מוצרים קיימים — אותו קובץ פעמיים לא יוצר כפולים; הייבוא השני מעדכן מלאי
// (גם ל-0), הדוח נכון (גם בהורדה), וביטול מחזיר בדיוק את מה שהיה. בסוף הבדיקה החנות חוזרת למצבה
// (ביטול של שני היבואים מוחק את המוצרים שהבדיקה הוסיפה).
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { A, AUTH, STORE_A } from "./helpers";
import { expectAccessible, sql } from "./hospitality-helpers";

const TAG = `${Date.now()}`.slice(-7);
const NAMES = [`מוצר ייבוא א ${TAG}`, `מוצר ייבוא ב ${TAG}`, `מוצר ייבוא ג ${TAG}`] as const;
const BARCODE = `729${TAG}001`;
const SUPPLIER_SKU = `SUP-A-${TAG}`;

function csv(stocks: [number, number, number]): string {
  return [
    // כמו שאקסל שומר: תא עם מירכאות — בתוך מירכאות, והמירכאות כפולות
    'שם המוצר,מחיר,"מק""ט",ברקוד,מלאי',
    `${NAMES[0]},10,${SUPPLIER_SKU},,${stocks[0]}`,
    `${NAMES[1]},20,,${BARCODE},${stocks[1]}`,
    `${NAMES[2]},30,,,${stocks[2]}`,
  ].join("\r\n");
}

/** המלאי של מוצרי הבדיקה בחנות A, לפי השם — וכמה עותקים יש מכל שם */
function storeState() {
  const rows = sql(
    `SELECT name || '|' || count(*) || '|' || string_agg(stock_quantity::text || ':' || is_out_of_stock::text, ',')
       FROM public.global_products
      WHERE tenant_id = '${STORE_A.id}' AND name LIKE 'מוצר ייבוא % ${TAG}'
      GROUP BY name ORDER BY name`,
  );
  return Object.fromEntries(
    rows
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, copies, stock] = line.split("|");
        return [name!, { copies: Number(copies), stock: stock! }];
      }),
  );
}

async function openImport(page: Page) {
  await page.goto(A("/admin?tab=products"));
  await page.getByRole("button", { name: "ייבא מ-CSV" }).click();
  await expect(page.getByRole("dialog", { name: "ייבוא מוצרים מקובץ CSV" })).toBeVisible();
}

async function chooseFile(page: Page, name: string, content: string) {
  await page
    .getByRole("dialog")
    .locator('input[type="file"]')
    .setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(content, "utf8") });
  await expect(page.getByText("העמודות שזוהו")).toBeVisible();
}

async function checkAndRun(page: Page, existing: RegExp) {
  await page.locator("[data-import-check]").click();
  await expect(page.locator("[data-import-review]")).toBeVisible({ timeout: 20_000 });
  // בלי בחירה למוצרים קיימים — אי אפשר לייבא
  await page.locator("[data-import-run]").click();
  await expect(page.getByText("בחרו מה לעשות במוצרים שכבר בחנות.")).toBeVisible();
  await page.getByRole("radio", { name: existing }).check();
  await page.locator("[data-import-run]").click();
  await expect(page.locator("[data-import-report]")).toBeVisible({ timeout: 60_000 });
}

test.describe("product import that matches existing products (STORE-2)", () => {
  test.use({ storageState: AUTH.ownerA });
  test.describe.configure({ mode: "serial" });
  // שאריות של ריצה שנכשלה באמצע (לפני הביטול) — כדי שבדיקות אחרות של חנות A (צילומי מסך) לא ייפגעו
  const cleanup = () => {
    sql(`DELETE FROM public.global_products g
          WHERE g.tenant_id = '${STORE_A.id}' AND g.name LIKE 'מוצר ייבוא %'
            AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.product_id = g.id)`);
    sql(`DELETE FROM public.categories c
          WHERE c.tenant_id = '${STORE_A.id}' AND c.name = 'כללי'
            AND NOT EXISTS (SELECT 1 FROM public.global_products g WHERE g.tenant_id = c.tenant_id AND g.category = c.name)
            AND NOT EXISTS (SELECT 1 FROM public.product_categories pc WHERE pc.category_id = c.id)
            AND NOT EXISTS (SELECT 1 FROM public.categories ch WHERE ch.tenant_id = c.tenant_id AND ch.parent_name = c.name)`);
  };
  test.beforeAll(cleanup);
  test.afterAll(cleanup);

  test("the same file twice: no duplicates, stock updated (incl. 0), report, undo", async ({
    page,
  }) => {
    // 1) הקובץ הראשון: שלושה מוצרים חדשים
    await openImport(page);
    await chooseFile(page, "catalog-1.csv", csv([5, 3, 0]));
    await page.locator("[data-import-check]").click();
    await expect(page.locator('[data-review-card="new"]')).toContainText("3");
    await expect(page.locator('[data-review-card="matched"]')).toContainText("0");
    await page.getByRole("radio", { name: /לעדכן את כמות המלאי/ }).check();
    await page.locator("[data-import-run]").click();
    const report = page.locator("[data-import-report]");
    await expect(report).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("[data-import-stats]")).toContainText("3");
    expect(storeState()).toEqual({
      [NAMES[0]]: { copies: 1, stock: "5:false" },
      [NAMES[1]]: { copies: 1, stock: "3:false" },
      [NAMES[2]]: { copies: 1, stock: "0:true" },
    });

    // 2) אותו קובץ עם כמויות אחרות: הכול מזוהה כקיים, רק המלאי מתעדכן
    await page.getByRole("button", { name: "ייבוא קובץ נוסף" }).click();
    await chooseFile(page, "catalog-2.csv", csv([0, 7, 2]));
    await page.locator("[data-import-check]").click();
    await expect(page.locator('[data-review-card="matched"]')).toContainText("3");
    await expect(page.locator('[data-review-card="new"]')).toContainText("0");
    await expect(page.getByText(/זוהו לפי:.*ברקוד 1.*מק"ט ספק 1.*שם 1/)).toBeVisible();
    await page.mouse.move(0, 0);
    await expectAccessible(page, "import review");
    await page.locator("[data-import-run]").click();
    await expect(page.getByText("בחרו מה לעשות במוצרים שכבר בחנות.")).toBeVisible();
    await page.getByRole("radio", { name: /לעדכן את כמות המלאי/ }).check();
    await expect(page.getByRole("radio", { name: /לעדכן את כמות המלאי/ })).toBeChecked();
    await page.locator("[data-import-run]").click();
    await expect(report).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("[data-import-to-zero]")).toContainText("1");
    expect(storeState()).toEqual({
      [NAMES[0]]: { copies: 1, stock: "0:true" },
      [NAMES[1]]: { copies: 1, stock: "7:false" },
      [NAMES[2]]: { copies: 1, stock: "2:false" },
    });
    await page.mouse.move(0, 0);
    await expectAccessible(page, "import report");

    // 3) הדוח להורדה: כותרות בעברית, לפני → אחרי והפרש
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "הורדת דוח (CSV)" }).click();
    const download = await downloadPromise;
    const text = readFileSync(await download.path(), "utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('"מלאי לפני","מלאי אחרי","שינוי במלאי"');
    expect(text).toContain(`"${NAMES[0]}"`);
    expect(text).toContain('"5","0","-5"');
    expect(text).toContain('"3","7","+4"');

    // 4) ביטול היבוא השני: המלאי חוזר
    await page.getByRole("button", { name: "ביטול היבוא הזה" }).click();
    await page.getByRole("button", { name: "כן, לבטל את היבוא" }).click();
    await expect(page.getByText(/היבוא בוטל:/)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-import-report="undone"]')).toBeVisible();
    expect(storeState()).toEqual({
      [NAMES[0]]: { copies: 1, stock: "5:false" },
      [NAMES[1]]: { copies: 1, stock: "3:false" },
      [NAMES[2]]: { copies: 1, stock: "0:true" },
    });

    // 5) היבואים האחרונים: הדוח של היבוא הראשון → ביטול (המוצרים שהבדיקה הוסיפה נמחקים)
    await page.getByRole("button", { name: "ייבוא קובץ נוסף" }).click();
    const recent = page.locator("[data-recent-imports]");
    await expect(recent).toBeVisible();
    await recent
      .getByRole("listitem")
      .filter({ hasText: "catalog-1.csv" })
      .first()
      .getByRole("button")
      .click();
    await expect(report).toBeVisible();
    await page.getByRole("button", { name: "ביטול היבוא הזה" }).click();
    await page.getByRole("button", { name: "כן, לבטל את היבוא" }).click();
    await expect(page.getByText(/היבוא בוטל: 3 נמחקו/)).toBeVisible({ timeout: 20_000 });
    expect(storeState()).toEqual({});
  });

  test("an existing product is never created twice even when the file says it is new @mobile", async ({
    page,
  }) => {
    // מוצר שכבר בחנות (מה-seed) בשם זהה — מזוהה לפי השם ומתעדכן; שורה חדשה כפולה בקובץ — מדלגים
    const existing = sql(
      `SELECT name || '|' || stock_quantity FROM public.global_products
        WHERE tenant_id = '${STORE_A.id}' AND sku = '90000002'`,
    ).split("|");
    const [name, stock] = [existing[0]!, Number(existing[1])];
    await openImport(page);
    await chooseFile(
      page,
      "mixed.csv",
      [
        "שם המוצר,מחיר,מלאי",
        `${name},10,${stock + 1}`,
        `${NAMES[0]},10,1`,
        `${NAMES[0]},10,2`,
      ].join("\r\n"),
    );
    await page.locator("[data-import-check]").click();
    await expect(page.locator('[data-review-card="matched"]')).toContainText("1");
    await expect(page.locator('[data-review-card="duplicates"]')).toContainText("1");
    await page.getByRole("radio", { name: /לעדכן את כמות המלאי/ }).check();
    await page.locator("[data-import-run]").click();
    await expect(page.locator("[data-import-report]")).toBeVisible({ timeout: 60_000 });
    expect(
      Number(
        sql(
          `SELECT count(*) FROM public.global_products WHERE tenant_id = '${STORE_A.id}' AND name = '${name.replace(/'/g, "''")}'`,
        ),
      ),
    ).toBe(1);
    expect(storeState()).toEqual({ [NAMES[0]]: { copies: 1, stock: "1:false" } });
    // ביטול — החנות חוזרת למצבה
    await page.getByRole("button", { name: "ביטול היבוא הזה" }).click();
    await page.getByRole("button", { name: "כן, לבטל את היבוא" }).click();
    await expect(page.getByText(/היבוא בוטל:/)).toBeVisible({ timeout: 20_000 });
    expect(storeState()).toEqual({});
    expect(
      Number(
        sql(
          `SELECT stock_quantity FROM public.global_products WHERE tenant_id = '${STORE_A.id}' AND sku = '90000002'`,
        ),
      ),
    ).toBe(stock);
  });
});
