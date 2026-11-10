import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import { fromJSON } from "seroval";
import { hostGet, hostOf, PORT } from "./helpers";
import {
  accessToken,
  asPlatform,
  callServerFn,
  ensureUser,
  expectAccessible,
  loadSession,
  passwordSession,
  readLoginCode,
  sql,
} from "./hospitality-helpers";

// מסמכים עצמאיים לחתימה (20261111140000), מקצה לקצה על השרת הבנוי, Storage האמיתי, תור המיילים ושירות
// המייל המדומה:
//   • "מסמך חדש לחתימה" (בלי הזמנה): א' — מסמך מדיניות ללקוח חדש (כרטיס נוצר), תצוגה מקדימה, קישור במייל;
//     הלקוח חותם בטלפון (RTL, אצבע) → PDF, עותק במייל עם קישור לאזור האישי; בעל העסק מקבל מייל
//     ("נחתם: …") ותג בניווט, והמסמך מסומן "חדש" ב"מסמכים חתומים" עד שנפתח;
//   • ב' — חוזה אירוח שהלקוח ממלא: קישור להעתקה (מוצג פעם אחת), הלקוח כותב שם / אימייל / טלפון / ת"ז /
//     כתובת וחותם; העותק — לאימייל שהלקוח כתב; "המסמכים שלי" באזור האישי;
//   • "מסמכים חתומים": חיפוש לפי אימייל / שם המסמך, סינון לפי סוג ומקור, קובץ בקישור קצר-מועד;
//   • עסק אחר — לא רואה דבר; קישור של עסק אחד לא נפתח באתר של עסק אחר; החוזים של הזמנות — כמו קודם.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "sd.owner@e2e.test", password: "Sd-Owner-Pass-1!" };
const STRANGER = { email: "sd.other@e2e.test", password: "Sd-Other-Pass-1!" };
const NOTIFY = "sd.docs@e2e.test";
const CUSTOMER_A = "sd.noa@e2e.test";
const CUSTOMER_B = "sd.yael@e2e.test";
const SLUG = "sd-docs";
const OTHER_SLUG = "sd-other";
const HOST = hostOf(SLUG);
const URL_ = (path = "/") => `http://${HOST}:${PORT}${path}`;
const FN = "src/engines/hospitality/api/contracts.functions.ts";
const FLAGS = [
  "hospitality_backend_enabled",
  "hospitality_management_enabled",
  "hospitality_frontend_enabled",
  "hospitality_booking_enabled",
  "hospitality_contracts_enabled",
] as const;
const IPHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  locale: "he-IL",
  timezoneId: "Asia/Jerusalem",
};
const HOUSE_RULES = [
  "## שעות שקט",
  "- בין 22:00 ל-08:00",
  "- בלי מוזיקה בחוץ",
  "אורחים מתבקשים לשמור על הניקיון.",
  "# שורה שנראית כמו כותרת",
].join("\n");
let siteId = "";
let ownerId = "";
let linkA = "";
let linkB = "";

const day = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
const asOwner = (query: string) =>
  sql(`SELECT set_config('request.jwt.claims', json_build_object('sub', '${ownerId}', 'role', 'authenticated')::text, false),
              set_config('request.jwt.claim.sub', '${ownerId}', false),
              set_config('request.headers', json_build_object('x-tenant-id', '${siteId}')::text, false);
       ${query}`)
    .split("\n")
    .pop()!;

/** תשובה של פונקציית שרת (seroval) — הערך */
async function fnValue<T>(res: APIResponse): Promise<T> {
  const text = await res.text();
  expect(res.status(), text.slice(0, 300)).toBe(200);
  const decoded = fromJSON({ t: JSON.parse(text), f: 127, m: [] } as unknown as Parameters<
    typeof fromJSON
  >[0]) as { result: T };
  return decoded.result;
}

type Call = { url: string; body: string; at: number };
async function mails(request: APIRequestContext, to: string, since: number): Promise<Call[]> {
  const calls = (await (await request.get("http://127.0.0.1:4010/__calls")).json()) as Call[];
  return calls.filter((c) => c.url.startsWith("/emails") && c.at >= since && c.body.includes(to));
}

async function open(page: Page, request: APIRequestContext, path: string, user = OWNER) {
  const session = await passwordSession(request, URL_(), user);
  await loadSession(page, session, path);
}

async function draw(page: Page, testId: string) {
  const area = page.getByTestId(`${testId}-area`);
  await area.scrollIntoViewIfNeeded();
  const box = (await area.boundingBox())!;
  const pts: [number, number][] = [
    [0.15, 0.6],
    [0.3, 0.3],
    [0.45, 0.65],
    [0.6, 0.35],
    [0.8, 0.55],
  ];
  await page.mouse.move(box.x + box.width * pts[0]![0], box.y + box.height * pts[0]![1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1))
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 5 });
  await page.mouse.up();
}

function cleanup() {
  for (const slug of [SLUG, OTHER_SLUG]) {
    const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
    if (!id) continue;
    // מסמכים חתומים לא נמחקים בדרך הרגילה (טריגר) — בבדיקות בלבד: מחיקת האתר כולו
    sql(`SET session_replication_role = replica;
         DELETE FROM hospitality.client_contract_log WHERE tenant_id = '${id}';
         DELETE FROM hospitality.client_contracts WHERE tenant_id = '${id}';
         DELETE FROM storage.objects WHERE bucket_id = 'hosp-contracts' AND name LIKE '${id}/%'`);
    asPlatform(`SELECT public.platform_delete_tenant('${id}', '${slug}')`);
  }
}

test.beforeAll(async ({ request }, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile",
    "the flow runs once (the phone parts open their own context)",
  );
  cleanup();
  ownerId = await ensureUser(request, OWNER);
  await ensureUser(request, STRANGER);
  sql(`UPDATE public.platform_feature_flags SET enabled = true
        WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`);
  for (const [slug, name, owner, username] of [
    [SLUG, "נופי המסמכים", OWNER.email, "sd_owner"],
    [OTHER_SLUG, "אתר שכן", STRANGER.email, "sd_other"],
  ] as const) {
    asPlatform(`SELECT hospitality.admin_create_site('${slug}', '${name}')`);
    const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
    sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
         SELECT '${id}', id, email, '${username}', 'admin', true, true FROM auth.users WHERE email = '${owner}'`);
    sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
         ${FLAGS.map((f) => `('${id}', '${f}', true)`).join(", ")}
         ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  }
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  sql(`UPDATE hospitality.settings SET business_name = 'נופי המסמכים', contact_phone = '0503822368',
         contact_email = '${NOTIFY}', address = 'מושב ישעי 68', check_in_time = '15:00', check_out_time = '11:00'
        WHERE tenant_id = '${siteId}'`);
  // the contract terms (party A, the units of section 1) — confirmed by the owner
  asOwner(
    `SELECT hospitality.business_terms_save('${JSON.stringify({
      representative_name: "אורי שליח",
      business_tax_id: "58731621",
      unit_lines: [
        { name: "אלון", description: "מיועד לזוג ועד 2 ילדים" },
        { name: "אורן", description: "מיועד לזוג בלבד" },
      ],
    })}'::jsonb, 0)`,
  );
  asOwner(`SELECT hospitality.business_terms_confirm(1)`);
  // a published site document: the house rules
  const saved = JSON.parse(
    asOwner(
      `SELECT hospitality.site_document_save('house_rules', 'כללי המקום', $doc$${HOUSE_RULES}$doc$)`,
    ),
  ) as { revision: number };
  asOwner(
    `SELECT hospitality.site_document_publish('house_rules', 'כללי המקום', $doc$${HOUSE_RULES}$doc$, ${saved.revision})`,
  );
  await expect
    .poll(async () => (await hostGet(request, HOST, "/manage/client-documents")).status(), {
      timeout: 20_000,
    })
    .toBe(200);
});

test.afterAll(() => {
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("way A: a policy document to a new customer — the new tab, preview of the published text, a personal link by email", async ({
  page,
  request,
}) => {
  await open(page, request, "/manage/client-documents");
  // the default tab: a new document (nothing signed yet)
  await expect(page.getByRole("tab", { name: "מסמך חדש לחתימה" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const form = page.getByTestId("standalone-document");
  await form.getByTestId("sd-kind-policy").click();
  await form.getByTestId("sd-fill-business").click();
  await form.getByTestId("sd-customer-new").click();
  await form.getByLabel("שם מלא").fill("נועה חדשה");
  await form.getByLabel("אימייל (לשם נשלח הקישור)").fill(CUSTOMER_A);
  await expect(form.getByLabel("המסמך לחתימה")).toHaveValue("house_rules");
  const preview = form.getByTestId("sd-preview");
  await expect(preview).toContainText("כללי המקום");
  await expect(preview).toContainText("בלי מוזיקה בחוץ");
  // a site-document line that looks like contract markup stays a plain paragraph, word for word
  await expect(preview).toContainText("# שורה שנראית כמו כותרת");
  await expect(preview).toContainText("נועה חדשה");
  await expectAccessible(page, "client documents — new standalone document");
  const since = Date.now();
  await form.getByTestId("sd-create").click();
  await expect(form.getByTestId("sd-result")).toContainText(`נשלח ל-${CUSTOMER_A}`);
  let body = "";
  await expect
    .poll(async () => {
      body = (await mails(request, CUSTOMER_A, since)).pop()?.body ?? "";
      return /\/stay\/contract#t=[A-Za-z0-9_-]{43}/.test(body);
    })
    .toBe(true);
  expect(body).toContain("לקריאה ולחתימה על המסמך");
  linkA = URL_(`/stay/contract#t=${/#t=([A-Za-z0-9_-]{43})/.exec(body)![1]!}`);
  expect(
    sql(`SELECT origin || '|' || fill_mode || '|' || kind || '|' || status || '|' || (booking_id IS NULL AND event_id IS NULL)
              || '|' || (guest_id IS NOT NULL)
           FROM hospitality.client_contracts WHERE tenant_id = '${siteId}' AND signer_email = '${CUSTOMER_A}'`),
  ).toBe("standalone|business|policy|sent|true|true");
  // a new customer card was made for the new customer
  expect(
    sql(
      `SELECT count(*) FROM hospitality.guests WHERE tenant_id = '${siteId}' AND email_normalized = '${CUSTOMER_A}'`,
    ),
  ).toBe("1");
});

test("way A, the customer on a phone: the document only to read and sign (no ID / address); PDF at once; the copy with the area link; the owner notified", async ({
  browser,
  request,
}) => {
  const ctx = await browser.newContext(IPHONE);
  const page = await ctx.newPage();
  await page.goto(linkA);
  await expect(page.getByRole("heading", { level: 1, name: "חתימה על המסמך" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("contract-body")).toContainText("אורחים מתבקשים לשמור על הניקיון.");
  await expect(page.getByLabel("תעודת זהות")).toHaveCount(0);
  await expect(page.getByLabel("כתובת מגורים")).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await expectAccessible(page, "standalone policy — signing on a phone");
  await page.getByTestId("contract-sign-submit").click();
  await expect(page.getByTestId("contract-sign-errors")).toContainText("חתימה");
  // (the error summary takes the focus and scrolls up — the next steps scroll back down first)
  await page.getByLabel(/קראתי את המסמך במלואו/).check();
  await draw(page, "customer-signature");
  const since = Date.now();
  await page.getByTestId("contract-sign-submit").click();
  await expect(page.getByTestId("contract-signed")).toContainText("המסמך נחתם — תודה!", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("contract-signed-download")).toHaveAttribute("href", /^blob:/);
  // the copy: the PDF attached, and the personal area (code login) — no signing link
  await expect
    .poll(async () =>
      (await mails(request, CUSTOMER_A, since)).some(
        (m) => m.body.includes("attachments") && m.body.includes("/stay/account"),
      ),
    )
    .toBe(true);
  // the owner: an email ("נחתם: …") from the queue, right after the signing
  await expect
    .poll(async () =>
      (await mails(request, NOTIFY, since)).some(
        (m) => m.body.includes("כללי המקום") && m.body.includes("client-documents?tab=signed"),
      ),
    )
    .toBe(true);
  expect(
    sql(`SELECT status || '|' || (pdf_path IS NOT NULL) || '|' || (signed_body_sha256 = encode(sha256(convert_to(signed_body, 'UTF8')), 'hex'))
              || '|' || (token_hash IS NULL) || '|' || (staff_seen_at IS NULL)
           FROM hospitality.client_contracts WHERE tenant_id = '${siteId}' AND signer_email = '${CUSTOMER_A}'`),
  ).toBe("signed|true|true|true|true");
  await page.goto(URL_("/robots.txt"));
  await page.goto(linkA);
  await expect(page.getByText("הקישור לחתימה לא תקין או שכבר שומש")).toBeVisible();
  await ctx.close();
});

test('the owner sees it: the badge in the navigation, the signed documents tab opens by itself, "new" until seen', async ({
  page,
  request,
}) => {
  await open(page, request, "/manage/client-documents");
  await expect(page.getByRole("tab", { name: /מסמכים חתומים/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page).toHaveURL(/tab=signed/);
  const signed = page.getByTestId("signed-documents");
  await expect(signed.getByTestId("signed-new")).toContainText("מסמך אחד נחתם");
  await expect(signed.getByTestId("signed-table")).toContainText("נועה חדשה");
  await expect(signed.getByTestId("signed-table")).toContainText("כללי המקום");
  await expect(signed.getByTestId("signed-table")).toContainText("מסמך עצמאי");
  await expectAccessible(page, "client documents — signed documents");
  // opening the tab marks them seen: the badge goes away
  await expect
    .poll(() =>
      sql(`SELECT count(*) FROM hospitality.client_contracts WHERE tenant_id = '${siteId}'
             AND signed_at IS NOT NULL AND staff_seen_at IS NULL`),
    )
    .toBe("0");
});

test("way B: a hosting contract the customer fills — a link to copy (shown once), no customer details needed", async ({
  page,
  request,
}) => {
  await open(page, request, "/manage/client-documents?tab=new");
  const form = page.getByTestId("standalone-document");
  await form.getByTestId("sd-kind-hosting").click();
  await form.getByTestId("sd-fill-customer").click();
  await form.getByLabel("תאריך כניסה").fill(day(60));
  await form.getByLabel("תאריך יציאה").fill(day(62));
  await form.getByTestId("sd-whole").check();
  await form.getByLabel("המחיר, ₪").fill("2400");
  const preview = form.getByTestId("sd-preview");
  await expect(preview).toContainText("הסכם הזמנת אירוח ושכירות לטווח קצר");
  await expect(preview).toContainText("☒ כל המתחם");
  await expect(preview).toContainText("2,400");
  await form.getByTestId("sd-create").click();
  const box = form.getByTestId("sign-link-box");
  await expect(box).toBeVisible();
  linkB = await box.getByTestId("sign-link-url").inputValue();
  expect(linkB).toMatch(/\/stay\/contract#t=[A-Za-z0-9_-]{43}$/);
  // the business's own public site address (https), never another host
  expect(linkB.startsWith(`https://${HOST}/stay/contract#t=`)).toBe(true);
  await expect(box.getByRole("link", { name: "שליחה בוואטסאפ" })).toHaveAttribute(
    "href",
    /^https:\/\/wa\.me\/\?text=/,
  );
  await expectAccessible(page, "client documents — the link to copy");
  const token = /#t=([A-Za-z0-9_-]{43})/.exec(linkB)![1]!;
  // only the hash is stored; the link itself — nowhere in the database
  expect(
    sql(`SELECT fill_mode || '|' || status || '|' || (signer_name IS NULL) || '|'
              || (token_hash = encode(sha256(convert_to('${token}', 'UTF8')), 'hex'))
           FROM hospitality.client_contracts WHERE tenant_id = '${siteId}' AND kind = 'hosting'`),
  ).toBe("customer|sent|true|true");
  expect(
    sql(`SELECT count(*) FROM hospitality.client_contract_log l, jsonb_each_text(l.details) e
          WHERE l.tenant_id = '${siteId}' AND e.value LIKE '%${token}%'`),
  ).toBe("0");
});

test("way B, the customer on a phone: writes name, email, phone, ID and address, chooses the deposit, signs; the copy to that email", async ({
  browser,
  request,
}) => {
  // the copied link is the site's public https address — locally the same path and token on the test port
  const tokenB = /#t=([A-Za-z0-9_-]{43})/.exec(linkB)![1]!;
  // another business's site — the link does not open there
  const strangerCtx = await browser.newContext(IPHONE);
  const stranger = await strangerCtx.newPage();
  await stranger.goto(`http://${hostOf(OTHER_SLUG)}:${PORT}/stay/contract#t=${tokenB}`);
  await expect(stranger.getByText("הקישור לחתימה לא תקין או שכבר שומש")).toBeVisible();
  await strangerCtx.close();

  const ctx = await browser.newContext(IPHONE);
  const page = await ctx.newPage();
  await page.goto(URL_(`/stay/contract#t=${tokenB}`));
  await expect(page.getByRole("heading", { level: 1, name: "חתימה על ההסכם" })).toBeVisible();
  await expect(page.getByTestId("contract-identity")).toBeVisible();
  await page.getByTestId("contract-sign-submit").click();
  const errors = page.getByTestId("contract-sign-errors");
  await expect(errors).toContainText("שם מלא");
  await expect(errors).toContainText("אימייל תקין");
  await expect(errors).toContainText("תעודת זהות");
  await page.getByLabel("שם מלא").fill("יעל לקוחה");
  await page.getByLabel("אימייל").fill(CUSTOMER_B);
  await page.getByLabel("טלפון (לא חובה)").fill("054-6800002");
  await page.getByLabel("תעודת זהות").fill("123456782");
  await page.getByLabel("כתובת מגורים").fill("רחוב הגפן 3, ישעי");
  await page.getByRole("radio", { name: "צ'ק ביטחון" }).check();
  await draw(page, "customer-signature");
  await page.getByLabel(/קראתי את כל סעיפי ההסכם/).check();
  await expectAccessible(page, "standalone contract — the customer fills, on a phone");
  const since = Date.now();
  await page.getByTestId("contract-sign-submit").click();
  await expect(page.getByTestId("contract-signed")).toContainText("ההסכם נחתם — תודה!", {
    timeout: 20_000,
  });
  await expect
    .poll(async () =>
      (await mails(request, CUSTOMER_B, since)).some((m) => m.body.includes("attachments")),
    )
    .toBe(true);
  expect(
    sql(`SELECT signer_name || '|' || signer_email || '|' || signer_phone || '|' || (customer_fields ->> 'deposit_method')
              || '|' || (signed_body LIKE '%שם מלא: יעל לקוחה%') || '|' || (signed_body LIKE '%תעודת זהות: 123456782%')
           FROM hospitality.client_contracts WHERE tenant_id = '${siteId}' AND kind = 'hosting'`),
  ).toBe(`יעל לקוחה|${CUSTOMER_B}|054-6800002|check|true|true`);
  await ctx.close();
});

test("signed documents: search by email and by document title, kind and origin filters, the PDF by a short link", async ({
  page,
  request,
}) => {
  await open(page, request, "/manage/client-documents?tab=signed");
  const signed = page.getByTestId("signed-documents");
  const rows = signed.getByTestId("signed-table").locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await signed.getByLabel(/חיפוש — שם הלקוח/).fill(CUSTOMER_B);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("יעל לקוחה");
  await signed.getByLabel(/חיפוש — שם הלקוח/).fill("כללי");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("נועה חדשה");
  await signed.getByLabel(/חיפוש — שם הלקוח/).fill("");
  await signed.getByLabel("סוג המסמך").selectOption("hosting");
  await expect(rows).toHaveCount(1);
  await signed.getByLabel("סוג המסמך").selectOption("");
  await signed.getByLabel("מקור").selectOption("linked");
  await expect(signed.getByText("לא נמצאו מסמכים חתומים")).toBeVisible();
  await signed.getByLabel("מקור").selectOption("standalone");
  await expect(rows).toHaveCount(2);
  // the file: a 60-second link from the server, the real signed PDF from the private bucket
  const id = sql(
    `SELECT id FROM hospitality.client_contracts WHERE tenant_id = '${siteId}' AND kind = 'hosting'`,
  );
  const token = await accessToken(request, OWNER);
  const res = await callServerFn(request, {
    host: HOST,
    file: FN,
    name: "hospitalityContractFile",
    data: { id, purpose: "download" },
    token,
  });
  const { url } = await fnValue<{ url: string }>(res);
  expect(url).toContain("hosp-contracts");
  const pdf = await request.get(url);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
});

test('"my documents": the way-B customer (no booking at all) logs in with an email code and sees the signed contract', async ({
  page,
  request,
}) => {
  await page.goto(URL_("/stay/account"));
  const since = Date.now();
  await page.getByLabel("אימייל").fill(CUSTOMER_B);
  await page.getByRole("button", { name: "שליחת קוד" }).click();
  await page
    .getByLabel("קוד מהמייל (6 ספרות)")
    .fill(await readLoginCode(request, CUSTOMER_B, since));
  await page.getByRole("button", { name: "כניסה" }).click();
  const docs = page.getByTestId("guest-area-documents");
  await expect(docs).toContainText("הסכם הזמנת אירוח ושכירות לטווח קצר");
  await expect(docs).not.toContainText("כללי המקום");
  const download = page.waitForEvent("download");
  await docs.getByRole("button", { name: "הורדת ה-PDF" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
});

test("isolation: another business sees none of the signed documents and cannot make a link for them", async ({
  request,
}) => {
  const stranger = await accessToken(request, STRANGER);
  const list = await callServerFn(request, {
    host: hostOf(OTHER_SLUG),
    file: FN,
    name: "hospitalitySignedDocuments",
    data: {},
    token: stranger,
  });
  const body = await list.text();
  expect(list.status(), body.slice(0, 200)).toBe(200);
  expect(body).not.toContain("יעל לקוחה");
  expect(body).not.toContain("נועה חדשה");
  const id = sql(
    `SELECT id FROM hospitality.client_contracts WHERE tenant_id = '${siteId}' AND kind = 'hosting'`,
  );
  const share = await callServerFn(request, {
    host: hostOf(OTHER_SLUG),
    file: FN,
    name: "hospitalityContractShareLink",
    data: { id },
    token: stranger,
  });
  expect(await share.text()).toContain("המסמך לא נמצא");
});
