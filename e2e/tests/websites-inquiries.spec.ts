import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fromJSON } from "seroval";
import { hostGet, hostOf, PORT } from "./helpers";
import {
  accessToken,
  asPlatform,
  callServerFn,
  ensureUser,
  enterViaHandoffTo,
  sql,
} from "./hospitality-helpers";

// Nuriel Websites — "פניות מלקוחות" (migration 196) end to end, on the LOCAL test database and the e-mail mock:
//   1. a valid submission on a live site → confirmation; 2. saved in the DB (its own site); 3. shown in the
//   owner's inbox; 4. the notification e-mail arrives (name, phone, e-mail, message, link to the inbox);
//   5. the e-mail service is down → the inquiry is still saved, the failure is shown, a secure retry sends it;
//   6. double submit → one inquiry; 7. status + internal note (+ audit); 8. two businesses are separated;
//   9. the floating WhatsApp button (desktop + phone); 10. accessibility (axe + keyboard);
//   11. the accessibility statement and its footer link; plus the bot trap, rate limit and preview (test) inquiries.

test.describe.configure({ mode: "serial" });

const FN = "src/engines/business-profile/api/inquiries.functions.ts";
const STUDIO_FN = "src/engines/business-profile/api/studio.functions.ts";
const MOCK = "http://127.0.0.1:4010";
const WA_MESSAGE = "שלום, הגעתי דרך האתר ואשמח לקבל פרטים נוספים";

let A = "inq-a";
let B = "inq-b";
const OWNER_A = { email: "inquiries.owner.a@e2e.test", password: "Inq-Owner-A-2026!" };
const OWNER_B = { email: "inquiries.owner.b@e2e.test", password: "Inq-Owner-B-2026!" };
let NOTIFY_A = "efrat.notify@e2e.test";
const ids: Record<string, string> = {};
const url = (slug: string, path = "") => `http://${hostOf(slug)}:${PORT}${path}`;
/** every test sends from its own address (in-memory + DB rate limits are per IP) */
let ipCounter = 10;
// a fresh range on every run (the server's in-memory counters outlive a test run)
const RUN = 20 + Math.floor(Math.random() * 200);
const nextIp = () => `10.${RUN}.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

function documentFor(name: string, published = true) {
  return JSON.stringify({
    schema: 1,
    template: "elegant",
    locales: ["he"],
    theme: { chrome: { header: "bar", footer: "full", floatingWhatsapp: true } },
    business: {
      name: { he: name },
      whatsapp: "972501234567",
      whatsappMessage: { he: WA_MESSAGE },
      phone: "050-1234567",
      email: "hello@e2e.test",
    },
    accessibility: {
      updatedOn: "2026-11-16",
      contactName: { he: `${name} — נגישות` },
      contactEmail: "a11y@e2e.test",
      auditStatus: "not_audited",
      limitations: { he: "ליקוי ידוע לבדיקה." },
    },
    pages: [
      {
        id: "home",
        slug: "",
        blocks: [
          { id: "hero", type: "hero", v: 1, props: { title: { he: name } } },
          {
            id: "lead",
            type: "form",
            v: 1,
            props: { title: { he: "השאירו פרטים ונחזור אליכם" }, kind: "consultation" },
          },
          {
            id: "contact",
            type: "contact",
            v: 1,
            props: { title: { he: "יצירת קשר" }, form: false },
          },
        ],
      },
    ],
    ...(published ? {} : {}),
  });
}

/** opens a site with an owner; publish = approved first publish + public flag (like after the platform approval) */
function openSite(slug: string, name: string, ownerEmail: string, publish: boolean): string {
  asPlatform(
    `SELECT public.platform_bp_open_site('${slug}', '${name}', '${ownerEmail}', '${documentFor(name)}'::jsonb)`,
  );
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
  if (publish) {
    sql(`WITH v AS (INSERT INTO business_profile.site_versions (tenant_id, state, version, template, document)
                    SELECT tenant_id, 'published', 1, template, document FROM business_profile.site_versions
                     WHERE tenant_id = '${id}' AND state = 'draft' RETURNING id)
         UPDATE business_profile.sites SET live_version_id = (SELECT id FROM v), first_approved_at = now()
          WHERE tenant_id = '${id}';
         INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled)
         VALUES ('${id}', 'business_profile_public', true)`);
  }
  return id;
}

function cleanup() {
  for (const slug of [A, B]) {
    const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
    if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${slug}')`);
  }
}

/** a server function's answer: a refusal comes back as HTTP 200 with a serialized Error */
async function outcome<T>(
  res: APIResponse,
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  const text = await res.text();
  if (res.status() !== 200) return { ok: false, error: `${res.status()} ${text.slice(0, 300)}` };
  if (text.includes('"$TSR/Error"')) {
    const m = /"message":\{"t":1,"s":("(?:[^"\\]|\\.)*")\}/.exec(text);
    return { ok: false, error: m ? (JSON.parse(m[1]!) as string) : text.slice(0, 300) };
  }
  const d = fromJSON({ t: JSON.parse(text), f: 127, m: [] } as unknown as Parameters<
    typeof fromJSON
  >[0]) as { result: T };
  return { ok: true, result: d.result };
}
async function value<T>(res: APIResponse): Promise<T> {
  const o = await outcome<T>(res);
  if (!o.ok) throw new Error(`expected success, got: ${o.error}`);
  return o.result;
}

type Submit =
  | { ok: true; reference: string; test: boolean }
  | { ok: false; error?: string; errors?: Record<string, string> };
function submit(
  request: APIRequestContext,
  slug: string,
  data: Record<string, unknown>,
  ip = nextIp(),
  token?: string,
) {
  return callServerFn(request, {
    host: hostOf(slug),
    file: FN,
    name: "submitInquiry",
    data: {
      clientKey: crypto.randomUUID(),
      kind: "consultation",
      formTitle: "השאירו פרטים",
      pagePath: "/",
      name: "לקוחה לבדיקה",
      phone: "052-1112233",
      email: "",
      message: "",
      website: "",
      startedAt: Date.now() - 10_000,
      preview: false,
      ...data,
    },
    headers: { "x-real-ip": ip },
    token,
  });
}

/** the e-mails the mock received for an address since `since` */
async function mailsTo(request: APIRequestContext, address: string, since: number) {
  const calls = (await (await request.get(`${MOCK}/__calls`)).json()) as {
    url: string;
    body: string;
    at: number;
  }[];
  return calls
    .filter((c) => c.url.startsWith("/emails") && c.at >= since)
    .map(
      (c) =>
        JSON.parse(c.body) as { to: string[]; subject: string; html: string; reply_to?: string },
    )
    .filter((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes(address));
}

function notifyStatus(clientName: string, site: string): string {
  return sql(
    `SELECT notify_status FROM business_profile.inquiries WHERE tenant_id = '${site}' AND full_name = '${clientName}' ORDER BY created_at DESC LIMIT 1`,
  );
}

async function fillForm(
  page: Page,
  form: string,
  v: { name?: string; email?: string; phone?: string; message?: string },
) {
  const f = page.locator(`#${form}`);
  if (v.name !== undefined) await f.getByLabel(/שם/).fill(v.name);
  if (v.email !== undefined) await f.getByLabel(/אימייל/).fill(v.email);
  if (v.phone !== undefined) await f.getByLabel(/טלפון/).fill(v.phone);
  if (v.message !== undefined) await f.getByLabel(/במה אוכל לעזור|הודעה/).fill(v.message);
  // a person takes more than a second to fill a form (the server's time trap is 0.8s)
  await page.waitForTimeout(900);
}

test.beforeAll(async ({ request }, testInfo) => {
  if (testInfo.project.name === "mobile") {
    A = "inq-a-m";
    B = "inq-b-m";
    NOTIFY_A = "efrat.notify.m@e2e.test";
  }
  cleanup();
  await ensureUser(request, OWNER_A);
  await ensureUser(request, OWNER_B);
  asPlatform(`SELECT public.platform_set_flag('business_profile_enabled', true),
                     public.platform_set_flag('business_profile_public', true)`);
  ids["a"] = openSite(A, "האתר של בדיקה א", OWNER_A.email, true);
  ids["b"] = openSite(B, "האתר של בדיקה ב", OWNER_B.email, false);
  // the notification address of site A (in the private settings, not in the public site)
  const tokenA = await accessToken(request, OWNER_A);
  await value(
    await callServerFn(request, {
      host: hostOf(A),
      file: FN,
      name: "studioInquirySettingsSave",
      data: { notifyEmail: NOTIFY_A, notifyEnabled: true, retentionDays: 365 },
      token: tokenA,
    }),
  );
});

test.afterAll(() => cleanup());

// ------------------------------------------------------------------------------------------------
test("1–4: a valid submission on the live site → confirmation, saved on its site, e-mail with the details and the inbox link @mobile", async ({
  page,
  request,
}) => {
  await page.setExtraHTTPHeaders({ "x-real-ip": nextIp() });
  await page.goto(url(A));
  const since = Date.now();
  await fillForm(page, "lead", {
    name: "דנה לוי",
    email: "dana.levi@e2e.test",
    phone: "050-7654321",
    message: "אשמח לשיחת ייעוץ",
  });
  await page.locator("#lead").getByRole("button", { name: "שליחה" }).click();
  // 1. the visitor gets a clear confirmation (focus moves to it, screen readers hear it)
  const done = page.locator("#lead .bps-form-done");
  await expect(done).toContainText("תודה! הפנייה התקבלה");
  await expect(done.getByRole("heading", { name: "תודה! הפנייה התקבלה" })).toBeFocused();
  const reference = (await done.locator("bdi").innerText()).trim();
  expect(reference).toMatch(/^[0-9A-F]{8}$/);

  // 2. the DB: the site's own inquiry, normalised; no raw IP (only a hash)
  const row =
    sql(`SELECT tenant_id || '|' || kind || '|' || phone || '|' || email || '|' || message || '|' || status
                        || '|' || is_test || '|' || (ip_hash ~ '^[0-9a-f]{64}$')
                     FROM business_profile.inquiries WHERE full_name = 'דנה לוי' AND tenant_id = '${ids["a"]}'`);
  expect(row).toBe(
    `${ids["a"]}|consultation|0507654321|dana.levi@e2e.test|אשמח לשיחת ייעוץ|new|false|true`,
  );
  const id = sql(
    `SELECT id FROM business_profile.inquiries WHERE full_name = 'דנה לוי' AND tenant_id = '${ids["a"]}'`,
  );
  expect(id.replace(/-/g, "").slice(0, 8).toUpperCase()).toBe(reference);

  // 4. the notification e-mail: to the owner's address, with all the details and the link to the inbox
  await expect.poll(() => notifyStatus("דנה לוי", ids["a"]!), { timeout: 15_000 }).toBe("sent");
  const mails = await mailsTo(request, NOTIFY_A, since);
  expect(mails).toHaveLength(1);
  const mail = mails[0]!;
  expect(mail.subject).toBe("פנייה חדשה מהאתר — דנה לוי");
  expect(mail.reply_to).toBe("dana.levi@e2e.test");
  for (const part of [
    "דנה לוי",
    "0507654321",
    "dana.levi@e2e.test",
    "אשמח לשיחת ייעוץ",
    "שיחת ייעוץ",
    reference,
  ])
    expect(mail.html).toContain(part);
  expect(mail.html).toContain(`${hostOf(A)}/studio/inbox?id=${id}`);
  // the link gives no access by itself — no token in it
  expect(mail.html).not.toMatch(/code=|token=|#t=/);

  // 3. the owner's inbox ("פניות מלקוחות")
  await enterViaHandoffTo(page, url(A), ids["a"]!, OWNER_A.email, /\/studio/);
  await page.goto(url(A, `/studio/inbox?id=${id}`));
  const panel = page.locator("section[aria-labelledby='inbox-detail-title']");
  await expect(panel.getByRole("heading", { name: "דנה לוי" })).toBeVisible();
  for (const text of ["050", "dana.levi@e2e.test", "אשמח לשיחת ייעוץ", "שיחת ייעוץ", "חדשה"])
    await expect(panel).toContainText(text);
  await expect(panel.getByRole("link", { name: /התקשרות/ })).toHaveAttribute(
    "href",
    "tel:0507654321",
  );
  await expect(panel.getByRole("link", { name: /מייל ל-/ })).toHaveAttribute(
    "href",
    "mailto:dana.levi@e2e.test",
  );
  await expect(panel.getByTestId("inquiry-notify-status")).toContainText("נשלחה");
});

test("validation: clear, accessible errors per field; focus on the first one; fixed → sent", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "x-real-ip": nextIp() });
  await page.goto(url(A));
  const form = page.locator("#lead");
  await form.getByRole("button", { name: "שליחה" }).click();
  const name = form.getByLabel(/שם/);
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(form.locator("#lead-name-error")).toHaveText("נא למלא שם (לפחות 2 תווים)");
  await expect(form.getByLabel(/טלפון/)).toHaveAttribute("aria-describedby", /lead-phone-error/);
  await expect(form.locator("#lead-phone-error")).toContainText("טלפון או אימייל");
  await expect(form.getByRole("alert")).toHaveText("יש 2 שדות שצריך לתקן.");
  await fillForm(page, "lead", { name: "יוסי", email: "not-an-email" });
  await form.getByRole("button", { name: "שליחה" }).click();
  await expect(form.getByLabel(/אימייל/)).toBeFocused();
  await expect(form.locator("#lead-email-error")).toContainText("לדוגמה: name@example.com");
  await fillForm(page, "lead", { email: "yossi@e2e.test" });
  await form.getByRole("button", { name: "שליחה" }).click();
  await expect(form.locator(".bps-form-done")).toContainText("הפנייה התקבלה");
});

test("6: double submit — two clicks, and the same key sent twice → one inquiry", async ({
  page,
  request,
}) => {
  await page.setExtraHTTPHeaders({ "x-real-ip": nextIp() });
  await page.goto(url(A));
  await fillForm(page, "lead", { name: "לחיצה כפולה", phone: "0521234567" });
  const button = page.locator("#lead").getByRole("button", { name: "שליחה" });
  await button.dblclick();
  await expect(page.locator("#lead .bps-form-done")).toBeVisible();
  expect(
    sql(
      `SELECT count(*) FROM business_profile.inquiries WHERE tenant_id = '${ids["a"]}' AND full_name = 'לחיצה כפולה'`,
    ),
  ).toBe("1");
  // the same client key twice (a network retry) → the same reference, still one row
  const key = crypto.randomUUID();
  const ip = nextIp();
  const r1 = await value<Submit>(
    await submit(request, A, { clientKey: key, name: "מפתח כפול" }, ip),
  );
  const r2 = await value<Submit>(
    await submit(request, A, { clientKey: key, name: "מפתח כפול" }, ip),
  );
  expect(r1.ok && r2.ok && r1.reference === r2.reference).toBe(true);
  expect(
    sql(
      `SELECT count(*) FROM business_profile.inquiries WHERE tenant_id = '${ids["a"]}' AND full_name = 'מפתח כפול'`,
    ),
  ).toBe("1");
});

test("spam and abuse: the bot trap saves nothing; too fast saves nothing; rate limit per address; cross-site call refused", async ({
  request,
}) => {
  const before = sql(
    `SELECT count(*) FROM business_profile.inquiries WHERE tenant_id = '${ids["a"]}'`,
  );
  const trap = await value<Submit>(
    await submit(request, A, { name: "בוט", website: "http://spam.example" }),
  );
  const fast = await value<Submit>(
    await submit(request, A, { name: "בוט מהיר", startedAt: Date.now() }),
  );
  expect(trap.ok).toBe(true); // the bot is not told it was caught
  // sent faster than a person can fill it: asked to send again (never silently dropped — autofill can be fast)
  expect(!fast.ok && fast.error).toBe("הטופס נשלח מהר מדי. נסו לשלוח שוב.");
  expect(
    sql(`SELECT count(*) FROM business_profile.inquiries WHERE tenant_id = '${ids["a"]}'`),
  ).toBe(before);
  // 5 inquiries from one address in 10 minutes; the 6th is refused with a clear message
  const ip = nextIp();
  for (let i = 0; i < 5; i++)
    expect((await value<Submit>(await submit(request, A, { name: `קצב ${i}` }, ip))).ok).toBe(true);
  const sixth = await value<Submit>(await submit(request, A, { name: "קצב 6" }, ip));
  expect(sixth.ok).toBe(false);
  expect(!sixth.ok && sixth.error).toContain("נסו שוב בעוד כמה דקות");
  // a site that is not live does not take inquiries from visitors
  const notLive = await value<Submit>(await submit(request, B, { name: "לא חי" }));
  expect(notLive.ok).toBe(false);
  // CSRF: the same call from another site is refused by the server-function middleware (nothing saved)
  const cross = await callServerFn(request, {
    host: hostOf(A),
    file: FN,
    name: "submitInquiry",
    data: {
      clientKey: crypto.randomUUID(),
      name: "מאתר זר",
      phone: "0521234567",
      startedAt: Date.now() - 9000,
    },
    headers: {
      "sec-fetch-site": "cross-site",
      origin: "https://evil.example",
      "x-real-ip": nextIp(),
    },
  });
  expect(cross.status()).toBeGreaterThanOrEqual(400);
  expect(
    sql(
      `SELECT count(*) FROM business_profile.inquiries WHERE tenant_id = '${ids["a"]}' AND full_name = 'מאתר זר'`,
    ),
  ).toBe("0");
});

test("5: the e-mail service is down → the inquiry is saved and shown, the failure is recorded, a retry sends it", async ({
  page,
  request,
}) => {
  const token = await accessToken(request, OWNER_A);
  const save = (email: string) =>
    callServerFn(request, {
      host: hostOf(A),
      file: FN,
      name: "studioInquirySettingsSave",
      data: { notifyEmail: email, notifyEnabled: true, retentionDays: 365 },
      token,
    });
  const down = NOTIFY_A.replace("@", "+down@");
  await value(await save(down));
  const r = await value<Submit>(
    await submit(request, A, { name: "בזמן תקלה", email: "c@e2e.test" }),
  );
  expect(r.ok).toBe(true);
  await expect.poll(() => notifyStatus("בזמן תקלה", ids["a"]!), { timeout: 15_000 }).toBe("failed");
  expect(
    sql(`SELECT notify_attempts || '|' || (notify_next_at > now()) || '|' || (notify_error NOT LIKE '%@%')
           FROM business_profile.inquiries WHERE tenant_id = '${ids["a"]}' AND full_name = 'בזמן תקלה'`),
  ).toBe("1|true|true");

  await enterViaHandoffTo(page, url(A), ids["a"]!, OWNER_A.email, /\/studio/);
  await page.goto(url(A, "/studio/inbox"));
  const card = page.getByRole("button", { name: /בזמן תקלה/ });
  await expect(card).toContainText("המייל לא נשלח");
  await card.click();
  const panel = page.locator("section[aria-labelledby='inbox-detail-title']");
  await expect(panel.getByTestId("inquiry-notify-status")).toContainText("השליחה נכשלה");
  await expect(panel).toContainText("ניסיון אוטומטי נוסף");
  // the service is back (a working address) → the owner retries; the e-mail goes out once
  await value(await save(NOTIFY_A));
  const since = Date.now();
  await panel.getByRole("button", { name: "שליחה חוזרת של ההתראה" }).click();
  await expect(panel.getByTestId("inquiry-notify-status")).toContainText("נשלחה");
  expect(await mailsTo(request, NOTIFY_A, since)).toHaveLength(1);
  expect(
    sql(
      `SELECT count(*) FROM business_profile.audit_log WHERE tenant_id = '${ids["a"]}' AND action = 'inquiry.notify_retry'`,
    ),
  ).toBe("1");
});

test("7: status and internal note — saved, in the history, in the audit log (without the content)", async ({
  page,
}) => {
  await enterViaHandoffTo(page, url(A), ids["a"]!, OWNER_A.email, /\/studio/);
  await page.goto(url(A, "/studio/inbox"));
  await expect(page.getByRole("link", { name: /פניות מלקוחות/ })).toContainText(/\d/); // the new-count badge
  await page.getByRole("button", { name: /דנה לוי/ }).click();
  const panel = page.locator("section[aria-labelledby='inbox-detail-title']");
  await panel.getByRole("radio", { name: "בטיפול" }).check();
  await expect(page.getByText("המצב עודכן: בטיפול")).toBeVisible();
  await panel.getByLabel("הערה חדשה").fill("חזרתי אליה, נקבעה שיחה ליום ראשון");
  await panel.getByRole("button", { name: "הוספת הערה" }).click();
  await expect(panel).toContainText("חזרתי אליה, נקבעה שיחה ליום ראשון");
  await page.reload();
  await expect(panel.getByRole("radio", { name: "בטיפול" })).toBeChecked();
  await expect(panel).toContainText("חזרתי אליה");
  await expect(panel).toContainText("שינוי מצב: חדשה ← בטיפול");
  await panel.getByRole("radio", { name: "טופלה" }).check();
  await expect(page.getByText("המצב עודכן: טופלה")).toBeVisible();
  const id = sql(
    `SELECT id FROM business_profile.inquiries WHERE full_name = 'דנה לוי' AND tenant_id = '${ids["a"]}'`,
  );
  expect(
    sql(`SELECT string_agg(action, ',' ORDER BY id) FROM business_profile.audit_log
          WHERE tenant_id = '${ids["a"]}' AND details ->> 'id' = '${id}'`),
  ).toBe("inquiry.status,inquiry.note_added,inquiry.status");
  expect(
    sql(`SELECT count(*) FROM business_profile.audit_log WHERE tenant_id = '${ids["a"]}'
          AND (details::text LIKE '%חזרתי%' OR details::text LIKE '%dana%')`),
  ).toBe("0");
});

test("8: two businesses are separated — B's owner cannot list, read or change A's inquiries; guests get nothing", async ({
  request,
}) => {
  const tokenB = await accessToken(request, OWNER_B);
  const tokenA = await accessToken(request, OWNER_A);
  const idA = sql(
    `SELECT id FROM business_profile.inquiries WHERE full_name = 'דנה לוי' AND tenant_id = '${ids["a"]}'`,
  );
  // on B's own site: A's inquiry does not exist for B
  const get = await outcome(
    await callServerFn(request, {
      host: hostOf(B),
      file: FN,
      name: "studioInquiry",
      data: { id: idA },
      method: "GET",
      token: tokenB,
    }),
  );
  expect(!get.ok && get.error).toContain("הפנייה לא נמצאה");
  const set = await outcome(
    await callServerFn(request, {
      host: hostOf(B),
      file: FN,
      name: "studioInquirySetStatus",
      data: { id: idA, status: "new" },
      token: tokenB,
    }),
  );
  expect(!set.ok && set.error).toContain("הפנייה לא נמצאה");
  const listB = await value<{ items: { id: string }[] }>(
    await callServerFn(request, {
      host: hostOf(B),
      file: FN,
      name: "studioInquiries",
      data: {},
      method: "GET",
      token: tokenB,
    }),
  );
  expect(listB.items.map((i) => i.id)).not.toContain(idA);
  // on A's site: B's owner has no permission at all
  const onA = await outcome(
    await callServerFn(request, {
      host: hostOf(A),
      file: FN,
      name: "studioInquiries",
      data: {},
      method: "GET",
      token: tokenB,
    }),
  );
  expect(!onA.ok && onA.error).toMatch(/אין הרשאה|נדרשת התחברות|Unauthorized/);
  // a guest (no login)
  const guest = await outcome(
    await callServerFn(request, {
      host: hostOf(A),
      file: FN,
      name: "studioInquiries",
      data: {},
      method: "GET",
    }),
  );
  expect(guest.ok).toBe(false);
  // and A's owner sees A's list, with nothing from B
  const listA = await value<{ items: { id: string }[] }>(
    await callServerFn(request, {
      host: hostOf(A),
      file: FN,
      name: "studioInquiries",
      data: {},
      method: "GET",
      token: tokenA,
    }),
  );
  expect(listA.items.map((i) => i.id)).toContain(idA);
  expect(
    sql(`SELECT count(*) FROM business_profile.inquiries i WHERE i.id = ANY('{${listA.items.map((i) => i.id).join(",")}}'::uuid[])
          AND i.tenant_id <> '${ids["a"]}'`),
  ).toBe("0");
});

test("preview: before publishing, the owner's form submission is saved as a test inquiry (and marked so)", async ({
  page,
}) => {
  await enterViaHandoffTo(page, url(B), ids["b"]!, OWNER_B.email, /\/studio/);
  await page.goto(url(B, "/studio/preview"));
  await fillForm(page, "lead", { name: "פנייה מהתצוגה", phone: "0549998877" });
  await page.locator("#lead").getByRole("button", { name: "שליחה" }).click();
  await expect(page.locator("#lead .bps-form-done")).toContainText("פניית בדיקה");
  expect(
    sql(
      `SELECT is_test FROM business_profile.inquiries WHERE tenant_id = '${ids["b"]}' AND full_name = 'פנייה מהתצוגה'`,
    ),
  ).toBe("t");
  await page.goto(url(B, "/studio/inbox"));
  await expect(page.getByRole("button", { name: /פנייה מהתצוגה/ })).toContainText("בדיקה");
  // the settings say why there is no e-mail yet (no address for B)
  await expect(page.getByRole("status").filter({ hasText: "לא הוגדר מייל להתראות" })).toBeVisible();
});

test("9: floating WhatsApp — the number and message from the site details, accessible name, bottom corner, out of the way of forms @mobile", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "x-real-ip": nextIp() });
  await page.goto(url(A));
  const wa = page.getByRole("link", { name: "שליחת הודעה ב-WhatsApp (נפתח בחלון חדש)" });
  await expect(wa).toBeVisible();
  await expect(wa).toHaveAttribute(
    "href",
    `https://wa.me/972501234567?text=${encodeURIComponent(WA_MESSAGE)}`,
  );
  await expect(wa).toHaveAttribute("target", "_blank");
  const vp = page.viewportSize()!;
  const box = (await wa.boundingBox())!;
  // RTL: the end corner is the bottom-left
  expect(box.x).toBeLessThan(vp.width / 2);
  expect(box.y + box.height).toBeGreaterThan(vp.height - 40);
  expect(box.width).toBeGreaterThanOrEqual(44);
  // typing in the form: the button gets out of the way (the phone keyboard)
  await page.locator("#lead").getByLabel(/שם/).focus();
  await expect(wa).toHaveAttribute("data-hidden", "true");
  await page.locator("#lead").getByLabel(/שם/).blur();
  await expect(wa).not.toHaveAttribute("data-hidden", "true");
  // whenever a submit button is under it, it hides; otherwise it never sits on one
  for (const y of [0, 300, 600, 900, 1200, 1600, 2000, 99999]) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(150);
    const covered = await page.evaluate(() => {
      const me = document.querySelector(".bps-wa")!.getBoundingClientRect();
      const hidden = document.querySelector(".bps-wa")!.getAttribute("data-hidden") === "true";
      const hit = [
        ...document.querySelectorAll(".bps-form-submit, .bps-footer a:not(.bps-wa)"),
      ].some((el) => {
        const r = el.getBoundingClientRect();
        return r.left < me.right && r.right > me.left && r.top < me.bottom && r.bottom > me.top;
      });
      return hit && !hidden;
    });
    expect(covered, `scrolled to ${y}`).toBe(false);
  }
  // turned off in the site settings (the draft; published in test 11, which checks that it is gone)
  if (test.info().project.name === "desktop")
    sql(`UPDATE business_profile.site_versions SET document = jsonb_set(document, '{theme,chrome,floatingWhatsapp}', 'false')
          WHERE tenant_id = '${ids["a"]}' AND state = 'draft'`);
});

test("11: the accessibility statement — footer link on every page, contact details, update date, no conformance claim; sitemap; editable in the studio", async ({
  page,
  request,
}) => {
  await page.goto(url(A));
  const link = page.locator("footer").getByRole("link", { name: "הצהרת נגישות" });
  await expect(link).toHaveAttribute("href", "/accessibility");
  await link.click();
  await expect(page).toHaveURL(url(A, "/accessibility"));
  await expect(page).toHaveTitle("הצהרת נגישות | האתר של בדיקה א");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { level: 1, name: "הצהרת נגישות" })).toBeVisible();
  for (const text of [
    'ת"י 5568',
    "עדיין לא נבדק על ידי מורשה נגישות",
    "ליקוי ידוע לבדיקה.",
    "האתר של בדיקה א — נגישות",
    "a11y@e2e.test",
    "ההצהרה עודכנה בתאריך 16.11.2026",
  ])
    await expect(main).toContainText(text);
  await expect(main).not.toContainText("עומד בתקן");
  await expect(main.getByRole("link", { name: "a11y@e2e.test" })).toHaveAttribute(
    "href",
    "mailto:a11y@e2e.test",
  );
  const sitemap = await (await hostGet(request, hostOf(A), "/sitemap.xml")).text();
  expect(sitemap).toContain(`/accessibility</loc>`);

  // the studio: the statement tab, edited and published like any change
  await enterViaHandoffTo(page, url(A), ids["a"]!, OWNER_A.email, /\/studio/);
  await page.goto(url(A, "/studio/editor"));
  await page.getByRole("tab", { name: "הצהרת נגישות" }).click();
  await page.getByLabel("שם איש/אשת הקשר לנגישות").fill("רחל — רכזת השירות");
  await page.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByText("הטיוטה נשמרה").first()).toBeVisible();
  const token = await accessToken(request, OWNER_A);
  const draft = await value<{ revision: number }>(
    await callServerFn(request, {
      host: hostOf(A),
      file: STUDIO_FN,
      name: "studioDraft",
      method: "GET",
      token,
    }),
  );
  await value(
    await callServerFn(request, {
      host: hostOf(A),
      file: STUDIO_FN,
      name: "studioPublish",
      data: { revision: draft.revision },
      token,
    }),
  );
  await expect
    .poll(
      async () =>
        (await (await hostGet(request, hostOf(A), "/accessibility")).text()).includes(
          "רחל — רכזת השירות",
        ),
      {
        timeout: 20_000,
      },
    )
    .toBe(true);
  // the floating WhatsApp was turned off in the draft (test 9) — after publishing it is gone from the site
  await page.goto(url(A));
  await expect(
    page.getByRole("link", { name: "שליחת הודעה ב-WhatsApp (נפתח בחלון חדש)" }),
  ).toHaveCount(0);
});

test("10: accessibility — axe on the site, the statement and the inbox; skip link first; keyboard reaches the form @mobile", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "x-real-ip": nextIp() });
  for (const path of ["", "/accessibility"]) {
    await page.goto(url(A, path));
    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
      path,
    ).toEqual([]);
  }
  await page.goto(url(A));
  await page.keyboard.press("Tab");
  const skip = page.getByTestId("skip-link");
  await expect(skip).toHaveText("דלג לתוכן הראשי");
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main-content")).toBeFocused();
  // the form fields are reachable by keyboard, in order
  const order: string[] = [];
  for (let i = 0; i < 25 && order.length < 5; i++) {
    await page.keyboard.press("Tab");
    const id = await page.evaluate(() => document.activeElement?.id ?? "");
    if (
      id.startsWith("lead-") ||
      (id === "" &&
        (await page.evaluate(() => document.activeElement?.textContent ?? "")) === "שליחה")
    )
      order.push(id || "submit");
  }
  expect(order).toEqual(["lead-name", "lead-email", "lead-phone", "lead-message", "submit"]);

  // the inbox itself
  await enterViaHandoffTo(page, url(A), ids["a"]!, OWNER_A.email, /\/studio/);
  await page.goto(url(A, "/studio/inbox"));
  await page.getByRole("button", { name: /דנה לוי/ }).click();
  await expect(
    page
      .locator("section[aria-labelledby='inbox-detail-title']")
      .getByRole("heading", { name: "דנה לוי" }),
  ).toBeVisible();
  const inbox = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    inbox.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);
});

test("retention and deletion: the owner deletes one inquiry and all test inquiries; logged without content", async ({
  page,
}) => {
  await enterViaHandoffTo(page, url(B), ids["b"]!, OWNER_B.email, /\/studio/);
  await page.goto(url(B, "/studio/inbox"));
  await page.getByRole("button", { name: /פנייה מהתצוגה/ }).click();
  await page.getByRole("button", { name: "מחיקת הפנייה" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "מחיקה" }).click();
  await expect(page.getByText("הפנייה נמחקה")).toBeVisible();
  expect(
    sql(`SELECT count(*) FROM business_profile.inquiries WHERE tenant_id = '${ids["b"]}'`),
  ).toBe("0");
  expect(
    sql(
      `SELECT details ->> 'test' FROM business_profile.audit_log WHERE tenant_id = '${ids["b"]}' AND action = 'inquiry.deleted'`,
    ),
  ).toBe("true");
  // the retention setting is in the studio (default a year)
  await expect(page.getByLabel("כמה זמן לשמור פניות")).toHaveValue("365");
});
