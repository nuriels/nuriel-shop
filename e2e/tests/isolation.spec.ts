import { expect, test, type APIRequestContext } from "@playwright/test";
import { A, B, hostGet, hostOf, PRODUCTS, STORE_A, STORE_B, supabaseEnv, USERS } from "./helpers";

/** טוקן של משתמש (Auth API המקומי — לא עובר במסך ההתחברות ולא במגבלת הניסיונות שלו) */
async function tokenFor(request: APIRequestContext, user: { email: string; password: string }) {
  const { url, anonKey } = supabaseEnv();
  const res = await request.post(`${url}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anonKey },
    data: { email: user.email, password: user.password },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** קריאה ישירה ל-API של המסד (PostgREST) בשם המשתמש, באתר של חנות מסוימת */
async function restProducts(request: APIRequestContext, token: string | null, tenantId: string) {
  const { url, anonKey } = supabaseEnv();
  const res = await request.get(`${url}/rest/v1/global_products?select=id,tenant_id`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token ?? anonKey}`,
      "x-tenant-id": tenantId,
    },
  });
  return {
    status: res.status(),
    rows: res.ok() ? ((await res.json()) as { id: string; tenant_id: string }[]) : [],
  };
}

test.describe("tenant isolation", () => {
  test("each store shows only its own products", async ({ page }) => {
    await page.goto(A());
    await expect(page.getByText(PRODUCTS.a1.name).first()).toBeVisible();
    await expect(page.getByText(PRODUCTS.b1.name)).toHaveCount(0);

    await page.goto(B());
    await expect(page.getByText(PRODUCTS.b1.name).first()).toBeVisible();
    await expect(page.getByText(PRODUCTS.a1.name)).toHaveCount(0);
  });

  test("a product of store B is not reachable from store A", async ({ page }) => {
    await page.goto(A(`/product/${PRODUCTS.b1.id}`));
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(PRODUCTS.b1.name)).toHaveCount(0);
  });

  test("API: the owner of store A cannot read store B data", async ({ request }) => {
    const token = await tokenFor(request, USERS.ownerA);
    const own = await restProducts(request, token, STORE_A.id);
    expect(own.rows.length).toBeGreaterThan(0);
    expect(own.rows.every((r) => r.tenant_id === STORE_A.id)).toBe(true);

    const other = await restProducts(request, token, STORE_B.id);
    expect(other.rows.filter((r) => r.tenant_id === STORE_B.id)).toEqual([]);
  });

  test("API: guests see only the store of the requested site", async ({ request }) => {
    const a = await restProducts(request, null, STORE_A.id);
    expect(a.rows.every((r) => r.tenant_id === STORE_A.id)).toBe(true);
    const b = await restProducts(request, null, STORE_B.id);
    expect(b.rows.every((r) => r.tenant_id === STORE_B.id)).toBe(true);
  });

  test("sitemaps do not leak products between stores", async ({ request }) => {
    const a = await (await hostGet(request, hostOf(STORE_A.slug), "/sitemap.xml")).text();
    const b = await (await hostGet(request, hostOf(STORE_B.slug), "/sitemap.xml")).text();
    expect(a).toContain(PRODUCTS.a1.id);
    expect(a).not.toContain(PRODUCTS.b1.id);
    expect(b).toContain(PRODUCTS.b1.id);
    expect(b).not.toContain(PRODUCTS.a1.id);
  });
});
