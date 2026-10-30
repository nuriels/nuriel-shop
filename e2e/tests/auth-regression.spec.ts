import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { A, B, storeUrl, supabaseEnv, USERS } from "./helpers";

// Regression for the shared sign-in infrastructure (Hospitality Stage 1a, plan B15):
// email-code login, store opening through the portal, Google OAuth start and the
// auth server's return-address allow-list. Everything runs against the disposable
// local stack; emails go to the mock server, Google is never contacted.

const MOCK = "http://127.0.0.1:4010";
const PORTAL = storeUrl("nuriel-app2");

/** psql against the local test DB (read-only checks) */
function sql(query: string): string {
  const url = process.env["DB_URL"];
  if (!url) throw new Error("e2e/.env.e2e is not loaded (DB_URL)");
  return execFileSync("psql", [url, "-X", "-tA", "-c", query], { encoding: "utf8" }).trim();
}

/** the 6-digit code from the newest mocked email sent to this address */
async function lastCodeFor(request: APIRequestContext, email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const calls = (await (await request.get(`${MOCK}/__calls`)).json()) as {
      url: string;
      body: string;
    }[];
    for (const call of calls.reverse()) {
      if (!call.url.startsWith("/emails") || !call.body.includes(email)) continue;
      const subject = (JSON.parse(call.body) as { subject?: string }).subject ?? "";
      const match = /(\d{6})/.exec(subject);
      if (match) return match[1]!;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no login code email for ${email}`);
}

test.describe("email-code login (existing mechanism)", () => {
  test("an existing customer logs in with a code from the email", async ({ page, request }) => {
    // a fresh approved customer per run (login codes are capped per email per hour)
    const email = `existing.${Date.now()}@e2e.test`;
    const { url } = supabaseEnv();
    const service = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
    const created = await request.post(`${url}/auth/v1/admin/users`, {
      headers: { apikey: service, Authorization: `Bearer ${service}` },
      data: { email, email_confirm: true },
    });
    expect(created.ok()).toBe(true);
    const userId = ((await created.json()) as { id: string }).id;
    sql(
      `insert into public.user_roles (tenant_id, user_id, email, username, role, is_approved)
       select id, '${userId}', '${email}', 'existing_${Date.now()}', 'customer', true from public.tenants where slug = 'kobi'`,
    );

    await page.goto(A("/login?mode=code"));
    await page.locator("#code-email").fill(email);
    await page.getByRole("button", { name: "שליחת קוד למייל" }).click();
    const code = await lastCodeFor(request, email);
    // the code field submits by itself on the 6th digit (existing behaviour)
    await page.locator("#login-code").fill(code);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
    await expect(page.getByText(email).first()).toBeVisible();
  });

  test("a new email signs up and becomes a pending customer of this store (unchanged rule)", async ({
    page,
    request,
  }) => {
    const email = `new.${Date.now()}@e2e.test`;
    await page.goto(B("/login?mode=code"));
    await page.locator("#code-email").fill(email);
    await page.getByRole("button", { name: "שליחת קוד למייל" }).click();
    const code = await lastCodeFor(request, email);
    // the code field submits by itself on the 6th digit (existing behaviour)
    await page.locator("#login-code").fill(code);
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
    await expect
      .poll(() =>
        sql(
          `select r.role || ':' || r.is_approved || ':' || t.slug from public.user_roles r join public.tenants t on t.id = r.tenant_id where r.email = '${email}'`,
        ),
      )
      .toBe("customer:false:store-b");
  });

  // another user: the same email can request a new code only after 30 s (existing rule)
  test("a wrong code is rejected", async ({ page, request }) => {
    await page.goto(B("/login?mode=code"));
    await page.locator("#code-email").fill(USERS.ownerB.email);
    await page.getByRole("button", { name: "שליחת קוד למייל" }).click();
    const code = await lastCodeFor(request, USERS.ownerB.email);
    await page.locator("#login-code").fill(code === "000000" ? "111111" : "000000");
    await expect(page.getByRole("alert")).toContainText("הקוד שגוי");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("store opening through the portal (existing flow)", () => {
  test("email code → name + address → store, owner and seed rows created", async ({
    page,
    request,
  }) => {
    const stamp = Date.now().toString().slice(-6);
    const email = `owner.${stamp}@e2e.test`;
    const slug = `e2e-open-${stamp}`;
    await page.goto(PORTAL);
    await page.getByRole("button", { name: "התחבר או פתח חנות בחינם" }).first().click();
    await page.locator("#portal-email").fill(email);
    await page.getByRole("button", { name: "שליחת קוד למייל" }).click();
    const code = await lastCodeFor(request, email);
    await page.locator("#portal-code").fill(code);
    // the code field continues by itself on the 6th digit (existing behaviour)
    await page.locator("#portal-store-name").fill(`חנות בדיקה ${stamp}`);
    await page.locator("#portal-store-slug").fill(slug);
    await page.getByRole("button", { name: "צור את החנות שלי" }).click();
    // after creation the portal moves on to the new store (https://<slug>…, not served locally) —
    // the result is checked in the database

    await expect
      .poll(() => sql(`select site_type from public.tenants where slug = '${slug}'`), {
        timeout: 20_000,
      })
      .toBe("ecommerce");
    expect(
      sql(
        `select r.role || ':' || r.is_protected from public.user_roles r join public.tenants t on t.id = r.tenant_id where t.slug = '${slug}' and r.email = '${email}'`,
      ),
    ).toBe("admin:true");
    expect(
      sql(
        `select (select count(*) from public.site_settings s where s.tenant_id = t.id)
              + (select count(*) from public.email_settings e where e.tenant_id = t.id)
              + (select count(*) from public.shipping_methods m where m.tenant_id = t.id)
              + (select count(*) from public.tenant_subscriptions u where u.tenant_id = t.id and u.plan_type = 'trial')
           from public.tenants t where t.slug = '${slug}'`,
      ),
    ).toBe("4");
  });
});

test.describe("Google OAuth (no settings changed)", () => {
  test("the Google button starts OAuth with this store's own address as the return URL", async ({
    page,
  }) => {
    const { url } = supabaseEnv();
    for (const site of [B("/login"), `${PORTAL}/`]) {
      const origin = new URL(site).origin;
      const seen = page.waitForRequest((r) => r.url().startsWith(`${url}/auth/v1/authorize`));
      await page.route(`${url}/auth/v1/authorize**`, (route) => route.abort());
      await page.goto(site);
      if (site.includes("nuriel-app2")) {
        await page.getByRole("button", { name: "התחבר או פתח חנות בחינם" }).first().click();
        await page.getByRole("button", { name: "התחברות עם Google" }).click();
      } else {
        await page.getByRole("button", { name: "המשך עם Google" }).click();
      }
      const params = new URL((await seen).url()).searchParams;
      expect(params.get("provider")).toBe("google");
      expect(new URL(params.get("redirect_to") ?? "").origin).toBe(origin);
      await page.unroute(`${url}/auth/v1/authorize**`);
    }
  });

  // GoTrue validates redirect_to with the same allow-list for every OAuth provider.
  // GitHub (fake credentials) needs no network; Google needs OIDC discovery and is
  // checked where the auth server can reach Google (CI), skipped otherwise.
  for (const provider of ["github", "google"] as const) {
    test(`auth server keeps only allowed return addresses (${provider})`, async ({ request }) => {
      const { url } = supabaseEnv();
      const site = "http://nuriel-app2.shop.localhost:3100"; // local SITE_URL (like production)
      const cases: [string, string][] = [
        [
          "http://kobi.shop.localhost:3100/login?google=1",
          "http://kobi.shop.localhost:3100/login?google=1",
        ],
        [
          "http://store-b.shop.localhost:3100/checkout",
          "http://store-b.shop.localhost:3100/checkout",
        ],
        ["https://evil.example.com/steal", site],
        ["http://kobi.shop.localhost.attacker.com/x", site],
        ["javascript:alert(1)", site],
      ];
      for (const [requested, expected] of cases) {
        const res = await request.get(
          `${url}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(requested)}`,
          { maxRedirects: 0 },
        );
        if (provider === "google" && res.status() === 400) {
          const body = await res.text();
          test.skip(
            /openid-configuration|certificate/.test(body),
            "auth server cannot reach Google here",
          );
        }
        expect(res.status()).toBe(302);
        const state = new URL(res.headers()["location"] ?? "").searchParams.get("state") ?? "";
        expect(state).toMatch(/^[0-9a-f-]{36}$/);
        expect(sql(`select referrer from auth.flow_state where id = '${state}'`)).toBe(expected);
      }
    });
  }
});
