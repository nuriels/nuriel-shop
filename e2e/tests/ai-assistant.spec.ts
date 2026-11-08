import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { ECOMMERCE_GUIDE_CATALOG } from "../../src/lib/ai/ecommerce-guides";
import { HOSPITALITY_GUIDE_CATALOG } from "../../src/engines/hospitality/ai/guides";
import { A, AUTH, hostGet, hostOf, platformUrl, PORT, STORE_A, USERS } from "./helpers";
import {
  accessToken,
  asPlatform,
  callServerFn,
  ensureUser,
  expectAccessible,
  loadSession,
  passwordSession,
  sql,
} from "./hospitality-helpers";

// NURIEL AI ASSISTANT — על השרת הבנוי, מול Supabase המקומי ו"דגם" מדומה (mock-services, בלי מפתח אמיתי
// ובלי קריאה החוצה):
//   • מנהל העל: מפתח (נשמר מוצפן), מצב, בדיקת חיבור, הפעלה לחנות ולמתחם — כל אחד לפי הסוג שלו;
//   • מנהל החנות: העוזר של Ecommerce עם מדריכי Ecommerce בלבד; מנהל המתחם — Hospitality בלבד;
//   • תום החבילה: העוזר נעצר, וגם קריאה ישירה מקבלת subscription_expired; חידוש מחזיר אותו;
//   • התראת חידוש: נשלחת פעם אחת בלבד; אחר כך — הודעה עדינה בחלון;
//   • מנהל עסק לא מגיע לפונקציות של מנהל העל.

test.describe.configure({ mode: "serial" });

const ZIMMER_SLUG = "ai-zimmer";
const ZIMMER_OWNER = { email: "ai.zimmer.owner@e2e.test", password: "Ai-Zimmer-Pass-1!" };
const FAKE_KEY = `sk-ant-api03-E2E${"FAKEKEYONLY".repeat(3)}Qw7_`;
let zimmerId = "";
const zimmerUrl = (path = "") => `http://${hostOf(ZIMMER_SLUG)}:${PORT}${path}`;

const ecomGuide = ECOMMERCE_GUIDE_CATALOG.guides.find((g) =>
  g.keywords.some((k) => k.length >= 6),
)!;
const ecomQuestion = `איך ${ecomGuide.keywords.find((k) => k.length >= 6)!}?`;
const hospGuide = HOSPITALITY_GUIDE_CATALOG.guides.find((g) =>
  g.keywords.some((k) => k.length >= 6),
)!;
const hospQuestion = `איך ${hospGuide.keywords.find((k) => k.length >= 6)!}?`;

function cleanup() {
  for (const t of [
    "ai_notifications",
    "ai_subscription_events",
    "ai_subscription_periods",
    "ai_subscriptions",
  ]) {
    sql(
      `DELETE FROM public.${t} WHERE tenant_id IN ('${STORE_A.id}'${zimmerId ? `, '${zimmerId}'` : ""})`,
    );
  }
  sql(`DELETE FROM public.ai_usage_log`);
  sql(`UPDATE public.ai_settings SET mode = 'off', model = 'claude-haiku-5-5', api_key_encrypted = NULL, api_key_last4 = NULL,
         last_error = NULL, last_error_at = NULL, max_question_chars = 400, tenant_hourly_limit = 60, user_minute_limit = 6`);
  for (const row of sql(
    `SELECT id || '|' || slug FROM public.tenants WHERE slug = '${ZIMMER_SLUG}'`,
  )
    .split("\n")
    .filter(Boolean)) {
    const [id, slug] = row.split("|") as [string, string];
    asPlatform(`SELECT public.platform_delete_tenant('${id}', '${slug}')`);
  }
}

async function platformPage(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ storageState: AUTH.platform })).newPage();
  await page.goto(platformUrl("/platform/ai"));
  await expect(page.getByRole("heading", { name: "ניהול תוסף AI" })).toBeVisible({
    timeout: 20_000,
  });
  return page;
}

async function ownerPage(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext({ storageState: AUTH.ownerA })).newPage();
  await page.goto(A("/admin"));
  return page;
}

async function zimmerPage(browser: Browser, request: APIRequestContext): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await loadSession(page, await passwordSession(request, zimmerUrl(), ZIMMER_OWNER), "/manage");
  return page;
}

async function activateFrom(page: Page, filter: "Ecommerce" | "Hospitality", name: string) {
  await page.getByRole("button", { name: filter, exact: true }).click();
  await page.getByLabel("חיפוש לפי שם העסק").fill(name);
  const row = page
    .locator("[data-testid=ai-businesses] tbody tr")
    .filter({ hasText: name })
    .first();
  await row.getByTestId("ai-activate").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("סוג העוזר")).toBeDisabled();
  await expect(dialog.getByTestId("ai-end-preview")).toContainText("12 חודשים");
  await expect(dialog).toContainText("150 ₪ לשנה");
  await dialog.getByLabel("הערה — למשל אסמכתת תשלום (לא חובה)").fill("E2E — שולם בהעברה");
  await dialog.getByTestId("ai-confirm").click();
  // הוכחת ההפעלה היא הסטטוס בשורה; ההודעה — first(): הודעה מהפעלה קודמת יכולה עוד להיות על המסך
  await expect(page.getByText("החבילה הופעלה").first()).toBeVisible({ timeout: 15_000 });
  await expect(dialog).toBeHidden();
  await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "active");
}

test.beforeAll(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop flow");
  cleanup();
  await ensureUser(request, ZIMMER_OWNER);
  sql(`UPDATE public.platform_feature_flags SET enabled = true
        WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled', 'hospitality_frontend_enabled')`);
  asPlatform(`SELECT hospitality.admin_create_site('${ZIMMER_SLUG}', 'צימר העוזר')`);
  zimmerId = sql(`SELECT id FROM public.tenants WHERE slug = '${ZIMMER_SLUG}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
       SELECT '${zimmerId}', id, email, 'ai_zimmer_owner', 'admin', true, true FROM auth.users WHERE email = '${ZIMMER_OWNER.email}'`);
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ('${zimmerId}', 'hospitality_backend_enabled', true), ('${zimmerId}', 'hospitality_management_enabled', true),
       ('${zimmerId}', 'hospitality_frontend_enabled', true)`);
  await expect
    .poll(async () => (await hostGet(request, hostOf(ZIMMER_SLUG), "/manage")).status(), {
      timeout: 20_000,
    })
    .toBe(200);
});

test.afterAll(() => {
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("platform admin: the key is saved encrypted, the assistant switched on, a store and a zimmer activated by their type", async ({
  browser,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  // יומן הפלטפורמה לא נמחק — סופרים רק את מה שנרשם מתחילת הבדיקה (גם בניסיון חוזר)
  const since = sql(`SELECT now()`);
  const page = await platformPage(browser);
  await expect(page.getByTestId("ai-key-status")).toContainText("אין מפתח שמור");
  await page.locator("#ai-key").fill(FAKE_KEY);
  await page.getByRole("button", { name: "שמירת מפתח" }).click();
  await expect(page.getByTestId("ai-key-status")).toContainText("sk-ant-…Qw7_", {
    timeout: 15_000,
  });
  // במסד: מוצפן בלבד
  expect(
    sql(
      `SELECT api_key_encrypted LIKE 'v1.%' AND position('${FAKE_KEY}' in api_key_encrypted) = 0 FROM public.ai_settings`,
    ),
  ).toBe("t");
  await expect(page.locator("body")).not.toContainText(FAKE_KEY);

  await page.getByTestId("ai-mode-on").click();
  await expect(page.getByTestId("ai-mode-on")).toHaveAttribute("aria-pressed", "true", {
    timeout: 15_000,
  });
  await page.getByTestId("ai-test-connection").click();
  await expect(page.getByTestId("ai-test-result")).toContainText("החיבור תקין", {
    timeout: 20_000,
  });

  await activateFrom(
    page,
    "Ecommerce",
    sql(`SELECT name FROM public.tenants WHERE id = '${STORE_A.id}'`),
  );
  await activateFrom(page, "Hospitality", "צימר העוזר");
  expect(
    sql(`SELECT string_agg(s.product || ':' || p.price_agorot || ':' || (p.ends_on = public.ai_period_end(p.starts_on)), ',' ORDER BY s.product)
           FROM public.ai_subscriptions s JOIN public.ai_subscription_periods p ON p.subscription_id = s.id
          WHERE s.tenant_id IN ('${STORE_A.id}', '${zimmerId}')`),
  ).toBe("ecommerce:15000:true,hospitality:15000:true");
  expect(
    sql(
      `SELECT count(*) FROM public.platform_audit_log WHERE action = 'ai_subscription_activated' AND tenant_id IN ('${STORE_A.id}', '${zimmerId}') AND created_at >= '${since}'`,
    ),
  ).toBe("2");
  await expectAccessible(page, "platform — AI add-on management");
});

test("store owner: the Ecommerce assistant answers with Ecommerce guides only", async ({
  browser,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const since = Date.now();
  const page = await ownerPage(browser);
  await page.getByTestId("ai-open").click();
  const panel = page.getByTestId("ai-panel");
  await expect(panel.getByRole("heading", { name: "NURIEL AI – Ecommerce" })).toBeVisible();
  await panel.getByTestId("ai-question").fill(ecomQuestion);
  await panel.getByRole("button", { name: "שליחת השאלה" }).click();
  const chip = panel.locator(`[data-guide-id="${ecomGuide.id}"]`).last();
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await chip.click();
  await expect(panel.getByTestId("ai-guide")).toContainText(
    ecomGuide.steps[0]!.text.replace(/«|»|\[\[[a-z0-9-]+\]\]/g, "").slice(0, 12),
  );
  await expectAccessible(page, "store admin — the assistant with a guide");

  // מה נשלח ל"דגם": רק המדריכים של Ecommerce, בלי כלים, ובלי "חשיבה" (Haiku 5.5 — disabled)
  const calls = (await (await request.get("http://127.0.0.1:4010/__calls")).json()) as {
    url: string;
    body: string;
    at: number;
  }[];
  const sentToModel = calls.filter((c) => c.url === "/v1/messages" && c.at >= since);
  expect(sentToModel.length).toBeGreaterThan(0);
  const params = JSON.parse(sentToModel.at(-1)!.body) as Record<string, unknown>;
  expect(Object.keys(params).sort()).toEqual([
    "max_tokens",
    "messages",
    "model",
    "output_config",
    "system",
    "thinking",
  ]);
  expect(params["thinking"]).toEqual({ type: "disabled" });
  expect(JSON.stringify(params)).not.toMatch(/"hosp-/);
  expect(JSON.stringify(params)).not.toContain(FAKE_KEY);
});

test("zimmer owner: the Hospitality assistant; the Ecommerce endpoint does not exist on a zimmer site", async ({
  browser,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const page = await zimmerPage(browser, request);
  await page.getByTestId("ai-open").click();
  const panel = page.getByTestId("ai-panel");
  await expect(panel.getByRole("heading", { name: "NURIEL AI – Hospitality" })).toBeVisible();
  await panel.getByTestId("ai-question").fill(hospQuestion);
  await panel.getByRole("button", { name: "שליחת השאלה" }).click();
  await expect(panel.locator(`[data-guide-id="${hospGuide.id}"]`).last()).toBeVisible({
    timeout: 20_000,
  });
  await expect(panel.locator("[data-guide-id]:not([data-guide-id^='hosp-'])")).toHaveCount(0);

  const token = await accessToken(request, ZIMMER_OWNER);
  const viaStoreFn = await callServerFn(request, {
    host: hostOf(ZIMMER_SLUG),
    file: "src/lib/ai-assistant.functions.ts",
    name: "ecommerceAiAsk",
    data: { question: ecomQuestion },
    token,
  });
  expect(viaStoreFn.status()).toBe(404);
});

test("expiry: the assistant stops, a direct API call gets subscription_expired, renewal brings it back", async ({
  browser,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  // התקופה עברה (מנהל המסד מזיז אותה לעבר — 12 חודשים בדיוק, כמו שהמסד דורש)
  sql(`UPDATE public.ai_subscription_periods SET starts_on = public.ai_today() - 400, ends_on = public.ai_period_end(public.ai_today() - 400)
        WHERE tenant_id = '${STORE_A.id}'`);
  const page = await ownerPage(browser);
  await page.getByTestId("ai-open").click();
  const panel = page.getByTestId("ai-panel");
  await expect(panel.getByTestId("ai-unavailable")).toHaveAttribute(
    "data-code",
    "subscription_expired",
  );
  await expect(panel).toContainText("מחיר החידוש: 150 ₪ לשנה");
  await expect(panel.getByRole("button", { name: "פנייה לצוות NURIEL לחידוש" })).toBeVisible();
  await expect(panel.getByTestId("ai-question")).toHaveCount(0);

  const token = await accessToken(request, USERS.ownerA);
  const res = await callServerFn(request, {
    host: hostOf(STORE_A.slug),
    file: "src/lib/ai-assistant.functions.ts",
    name: "ecommerceAiAsk",
    data: {
      question: ecomQuestion,
      tenantId: zimmerId,
      endsOn: "2099-12-31",
      entitled: true,
      status: "active",
    },
    token,
  });
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain("subscription_expired");
  expect(body).not.toContain(ecomGuide.id);

  const admin = await platformPage(browser);
  await admin.getByRole("button", { name: "Ecommerce", exact: true }).click();
  const row = admin
    .locator("[data-testid=ai-businesses] tbody tr")
    .filter({ hasText: STORE_A.slug })
    .first();
  await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "expired");
  await row.getByTestId("ai-renew").click();
  await admin.getByRole("dialog").getByTestId("ai-confirm").click();
  await expect(admin.getByText("החבילה חודשה לשנה נוספת")).toBeVisible({ timeout: 15_000 });
  await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "active");

  await page.reload();
  await page.getByTestId("ai-open").click();
  await expect(page.getByTestId("ai-panel").getByTestId("ai-question")).toBeVisible();
});

test("renewal notice 30 days before the end: sent once, never twice; a gentle notice in the panel", async ({
  browser,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  // החבילה של החנות מסתיימת בעוד 30 יום בדיוק
  sql(`DELETE FROM public.ai_subscription_periods WHERE tenant_id = '${STORE_A.id}'`);
  sql(`INSERT INTO public.ai_subscription_periods (subscription_id, tenant_id, kind, starts_on, ends_on, price_agorot)
       SELECT s.id, s.tenant_id, 'activation', d.start, public.ai_period_end(d.start), 15000
         FROM public.ai_subscriptions s, (SELECT ((public.ai_today() + 31) - interval '12 months')::date AS start) d
        WHERE s.tenant_id = '${STORE_A.id}'`);
  const ownerEmail = sql(`SELECT owner_email FROM public.tenants WHERE id = '${STORE_A.id}'`);
  const since = Date.now();
  const admin = await platformPage(browser);
  await admin.getByTestId("ai-run-renewals").click();
  await expect(admin.getByTestId("ai-renewals-result")).toContainText("נשלחו 1", {
    timeout: 20_000,
  });
  const calls = (await (await request.get("http://127.0.0.1:4010/__calls")).json()) as {
    url: string;
    body: string;
    at: number;
  }[];
  const mails = calls.filter(
    (c) => c.url.startsWith("/emails") && c.at >= since && c.body.includes(ownerEmail),
  );
  expect(mails).toHaveLength(1);
  expect(mails[0]!.body).toContain("חבילת NURIEL AI שלך עומדת להסתיים");
  expect(mails[0]!.body).toContain("מחיר החידוש: 150 ₪ לשנה");

  await admin.getByTestId("ai-run-renewals").click();
  await expect(admin.getByTestId("ai-renewals-result")).toContainText("נשלחו 0", {
    timeout: 20_000,
  });
  expect(
    sql(
      `SELECT kind || ':' || status FROM public.ai_notifications WHERE tenant_id = '${STORE_A.id}'`,
    ),
  ).toBe("d30:sent");

  const page = await ownerPage(browser);
  await expect(page.getByTestId("ai-bubble")).toContainText("מסתיימת בעוד 30 ימים");
  await page.getByTestId("ai-open").click();
  await expect(page.getByTestId("ai-notice")).toContainText("מסתיימת בעוד 30 ימים");
});

test("a store owner cannot reach the platform admin functions (neither on the store nor on the panel host)", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const token = await accessToken(request, USERS.ownerA);
  for (const host of [hostOf(STORE_A.slug), "platform.shop.localhost"]) {
    const res = await callServerFn(request, {
      host,
      file: "src/lib/ai-admin.functions.ts",
      name: "aiAdminActivate",
      data: { tenantId: STORE_A.id, product: "ecommerce", startsOn: "2026-11-08" },
      token,
    });
    const text = await res.text();
    expect(text).toContain("אין הרשאה");
    // בלי נתיבי קבצים / מספרי שורות / מודולים של השרת (stack trace)
    expect(text).not.toMatch(/\bat [\w./-]+:\d+|\.tsx?:\d+|node_modules|\/src\//);
  }
  // והמפתח לא יוצא משום תשובה של מנהל העל
  const platformToken = await accessToken(request, USERS.platform);
  const overview = await callServerFn(request, {
    host: "platform.shop.localhost",
    file: "src/lib/ai-admin.functions.ts",
    name: "aiAdminOverview",
    token: platformToken,
  });
  const text = await overview.text();
  expect(text).toContain("Qw7_");
  expect(text).not.toContain(FAKE_KEY);
  expect(text).not.toContain(sql(`SELECT api_key_encrypted FROM public.ai_settings`));
});
