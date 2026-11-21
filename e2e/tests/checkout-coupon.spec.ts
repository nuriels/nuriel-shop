import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { A, AUTH, PRODUCTS, STORE_A, supabaseEnv } from "./helpers";
import { sql } from "./hospitality-helpers";

/**
 * הזמנה מלאה עם קופון — מקצה לקצה, כמו לקוח אמיתי (אין סליקה: תשלום מול נציג, ברירת המחדל):
 *   • קופון 10% בחנות; לקוח רשום מוסיף מוצר, מחיל את הקופון בקופה ("הוחל") → השרת (checkCoupon) רושם
 *     אישור קצר-מועד (coupon_grants) — רק אחרי הגבלת הקצב שלו;
 *   • שליחת ההזמנה → במסד: הזמנה אחת, מחיר השורה מהקטלוג (לא מהדפדפן), הקופון וההנחה מחושבים במסד,
 *     הסכום = מה שהקופה הציגה על הכפתור, והאישור נצרך (חד-פעמי);
 *   • קריאה ישירה ל-place_order מהדפדפן של הלקוח (בלי הקופה): מחיר מזויף — נדרס למחיר האמיתי;
 *     קופון בלי אישור — נדחה באותה שגיאה לכל קוד, קיים או לא (אין "אורקל" לניחוש קודים).
 */
const CODE = "E2ESAVE10";
const CUSTOMER = `(SELECT id FROM auth.users WHERE email = 'customer.a@e2e.test')`;
const money = (text: string) => Number(/([\d,]+\.\d{2})/.exec(text)?.[1]?.replace(/,/g, "") ?? NaN);

let stockBefore = "";
let ordersBefore = "";

function clean() {
  sql(`DELETE FROM public.customer_carts WHERE user_id = ${CUSTOMER}`);
  sql(`DELETE FROM public.coupon_grants WHERE user_id = ${CUSTOMER}`);
}

test.beforeAll(() => {
  stockBefore = sql(
    `SELECT stock_quantity FROM public.global_products WHERE id = '${PRODUCTS.a2.id}'`,
  );
  ordersBefore = sql(
    `SELECT COALESCE(max(created_at), 'epoch')::text FROM public.orders WHERE customer_id = ${CUSTOMER}`,
  );
  clean();
  sql(`INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value, is_active, description)
       VALUES ('${STORE_A.id}', '${CODE}', 'percent', 10, true, 'E2E — 10%')
       ON CONFLICT (tenant_id, code) DO UPDATE
         SET discount_type = 'percent', discount_value = 10, is_active = true, min_order_total = NULL,
             max_uses = NULL, starts_at = NULL, expires_at = NULL`);
});

test.afterAll(() => {
  // ההזמנות של הבדיקה (שורות ההזמנה נמחקות איתן — ON DELETE CASCADE) והמלאי כמו שהיה
  sql(
    `DELETE FROM public.orders WHERE customer_id = ${CUSTOMER} AND created_at > '${ordersBefore}'::timestamptz`,
  );
  sql(
    `UPDATE public.global_products SET stock_quantity = ${Number(stockBefore) || 100} WHERE id = '${PRODUCTS.a2.id}'`,
  );
  sql(`DELETE FROM public.coupons WHERE tenant_id = '${STORE_A.id}' AND code = '${CODE}'`);
  clean();
});

/** ההתחברות של הלקוח מהדפדפן (רק בשביל הקריאה הישירה ל-API, כמו שתוקף היה עושה) */
async function accessToken(page: Page): Promise<string> {
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? "";
      if (/^sb-.+-auth-token$/.test(key)) {
        return (
          (JSON.parse(localStorage.getItem(key) ?? "{}") as { access_token?: string })
            .access_token ?? ""
        );
      }
    }
    return "";
  });
}

function placeOrderDirect(request: APIRequestContext, token: string, body: unknown) {
  const { url, anonKey } = supabaseEnv();
  return request.post(`${url}/rest/v1/rpc/place_order`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-tenant-id": STORE_A.id,
    },
    data: body,
  });
}

test("a registered customer orders with a coupon: approved by the server, discount and total computed in the database", async ({
  browser,
}) => {
  test.skip(test.info().project.name === "mobile", "one full order, on the computer");
  const context = await browser.newContext({ storageState: AUTH.customerA });
  const page = await context.newPage();
  try {
    await page.goto(A(`/product/${PRODUCTS.a2.id}`));
    // המחירים של הלקוח נטענו (אין יותר מחיר מוסתר) — ואז מוסיפים לסל
    await expect(page.locator('[data-price="hold"]')).toHaveCount(0, { timeout: 15_000 });
    await page.getByRole("button", { name: "הוספה לסל" }).first().click();
    await expect(page.getByText(`"${PRODUCTS.a2.name}" נוסף לסל`)).toBeVisible();

    await page.goto(A("/checkout"));
    await expect(page.getByText(PRODUCTS.a2.name).first()).toBeVisible({ timeout: 20_000 });
    await page.locator("#co-name").fill("לקוח קופון בדיקה");
    await page.locator("#co-tax").fill("123456782");
    await page.locator("#co-phone").fill("0521234567");
    await page.locator("#co-city").fill("תל אביב");
    await page.locator("#co-address").fill("הרצל 1");
    await page.locator("#co-zip").fill("6100000");

    // הקופון: "יש לך קוד קופון?" → קוד → "החלה" → הוחל
    await page.getByRole("button", { name: "יש לך קוד קופון?" }).click();
    await page.getByPlaceholder("קוד קופון").fill(CODE.toLowerCase());
    await page.getByRole("button", { name: "החלה" }).click();
    await expect(page.getByText(`הקופון ${CODE} הוחל`).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "הסרת הקופון" })).toBeVisible();
    // השרת רשם אישור לקונה הזה ולקוד הזה (שעתיים)
    expect(
      sql(`SELECT count(*) FROM public.coupon_grants
            WHERE user_id = ${CUSTOMER} AND code = '${CODE}' AND expires_at > now()`),
    ).toBe("1");

    await page.locator("#co-terms").check();
    const submit = page.getByRole("button", { name: /אישור ושליחת ההזמנה/ });
    await expect(submit).toBeEnabled();
    const shownTotal = money((await submit.textContent()) ?? "");
    expect(shownTotal).toBeGreaterThan(0);
    await submit.click();
    await expect(page.getByText("מספר הזמנה")).toBeVisible({ timeout: 20_000 });

    const row =
      sql(`SELECT o.order_number || '|' || o.coupon_code || '|' || o.coupon_discount_type || '|' ||
                            o.coupon_discount_value::int || '|' || to_char(o.discount_amount, 'FM999990.00') || '|' ||
                            to_char(o.total, 'FM999990.00') || '|' || to_char(oi.unit_price, 'FM999990.00') || '|' ||
                            oi.quantity
                       FROM public.orders o JOIN public.order_items oi ON oi.order_id = o.id
                      WHERE o.customer_id = ${CUSTOMER} AND o.created_at > '${ordersBefore}'::timestamptz
                        AND NOT oi.is_gift AND NOT oi.is_deposit
                      ORDER BY o.created_at DESC LIMIT 1`);
    const [number, code, type, value, discount, total, unitPrice, quantity] = row.split("|");
    // מספר ההזמנה שהלקוח רואה = ההזמנה במסד
    await expect(page.getByText(number!, { exact: true }).first()).toBeVisible();
    expect([code, type, value]).toEqual([CODE, "percent", "10"]);
    // מחיר השורה — מהקטלוג (מחירון 1 של המוצר), ההנחה — 10% ממנו, מחושבת במסד
    const catalogPrice = Number(
      sql(`SELECT price_tier1 FROM public.global_products WHERE id = '${PRODUCTS.a2.id}'`),
    );
    expect([Number(unitPrice), Number(quantity)]).toEqual([catalogPrice, 1]);
    expect(Number(discount)).toBeCloseTo(catalogPrice * 0.1, 2);
    // הסכום שנשמר במסד = הסכום שהקופה הציגה על הכפתור
    expect(Number(total)).toBeCloseTo(shownTotal, 2);
    // האישור נצרך — חד-פעמי
    expect(
      sql(
        `SELECT count(*) FROM public.coupon_grants WHERE user_id = ${CUSTOMER} AND code = '${CODE}'`,
      ),
    ).toBe("0");
  } finally {
    await context.close();
  }
});

test("calling place_order directly: a forged browser price is replaced by the real price; a coupon without the server's approval is refused like any code", async ({
  browser,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "API check — once");
  const context = await browser.newContext({ storageState: AUTH.customerA });
  const page = await context.newPage();
  try {
    await page.goto(A("/"));
    const token = await accessToken(page);
    expect(token.split(".")).toHaveLength(3);
    const method =
      sql(`SELECT id FROM public.shipping_methods WHERE tenant_id = '${STORE_A.id}' AND is_active
                         ORDER BY sort_order NULLS LAST, created_at LIMIT 1`);
    const details = (coupon: string) => ({
      customer_name: "לקוח ישיר בדיקה",
      customer_tax_id: "123456782",
      customer_phone: "0521234567",
      customer_email: "",
      billing_city: "תל אביב",
      billing_address: "הרצל 1",
      billing_zip: "6100000",
      ship_to_different: false,
      shipping_name: "",
      shipping_phone: "",
      shipping_city: "",
      shipping_address: "",
      shipping_zip: "",
      note: "",
      accepted_terms: true,
      shipping_method_id: method,
      coupon_code: coupon,
      payment_method: "offline",
    });
    const forged = [{ product_id: PRODUCTS.a2.id, quantity: 1, unit_price: 0.01 }];

    // 1. קופון בלי אישור מהשרת — אותה שגיאה לקוד קיים ולקוד שלא קיים; שום הזמנה לא נוצרה
    const before = sql(`SELECT count(*) FROM public.orders WHERE customer_id = ${CUSTOMER}`);
    const real = await placeOrderDirect(request, token, {
      _kind: "order",
      _items: forged,
      _vat_rate: 0,
      _prices_include_vat: true,
      _details: details(CODE),
    });
    const fake = await placeOrderDirect(request, token, {
      _kind: "order",
      _items: forged,
      _vat_rate: 0,
      _prices_include_vat: true,
      _details: details("NOSUCHCODE1"),
    });
    expect(real.status(), await real.text()).toBeGreaterThanOrEqual(400);
    expect(fake.status()).toBe(real.status());
    const message = (r: string) => (JSON.parse(r) as { message?: string }).message;
    expect(message(await fake.text())).toBe(message(await real.text()));
    expect(sql(`SELECT count(*) FROM public.orders WHERE customer_id = ${CUSTOMER}`)).toBe(before);

    // 2. בלי קופון, מחיר מזויף (0.01) — ההזמנה נוצרת במחיר האמיתי מהקטלוג
    const ok = await placeOrderDirect(request, token, {
      _kind: "order",
      _items: forged,
      _vat_rate: 0,
      _prices_include_vat: true,
      _details: details(""),
    });
    expect(ok.status(), await ok.text()).toBe(200);
    const id = ((await ok.json()) as { id: string }[])[0]?.id ?? "";
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const catalogPrice = sql(
      `SELECT to_char(price_tier1, 'FM999990.00') FROM public.global_products WHERE id = '${PRODUCTS.a2.id}'`,
    );
    expect(
      sql(`SELECT to_char(oi.unit_price, 'FM999990.00') || '|' || (o.coupon_code IS NULL) || '|' ||
                  (o.total >= oi.unit_price)
             FROM public.orders o JOIN public.order_items oi ON oi.order_id = o.id
            WHERE o.id = '${id}' AND NOT oi.is_gift AND NOT oi.is_deposit`),
    ).toBe(`${catalogPrice}|true|true`);
  } finally {
    await context.close();
  }
});
