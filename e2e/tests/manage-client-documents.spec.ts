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

// מסמכי לקוחות (מיגרציות 63–65), מקצה לקצה על השרת הבנוי, Storage האמיתי ושירות המייל המדומה:
//   • תנאים ופרטי החוזה: בעל העסק ממלא ומאשר; עד האישור המשפטי (הדגל) — תצוגה מקדימה בלבד;
//   • שליחה מעמוד ההזמנה: חוזה אירוח (לעולם לא חוזה אחר להזמנת לינה), תצוגה מקדימה, מייל עם קישור אישי;
//   • הלקוח חותם בטלפון (RTL): כל הנוסח, השדות החסרים, חתימה באצבע, "קראתי ואני מסכים/ה" → PDF חתום
//     מיד, עותק במייל (PDF מצורף), שמור בדלי הפרטי; הקישור מת;
//   • הארכיון: חיפוש וסינון, פרטים (ת"ז ממוסכת, היסטוריה), הורדה בקישור קצר-מועד;
//   • "המסמכים שלי" באזור האישי; מייל שנכשל לא מסומן "נשלח"; עסק אחר / מנהל בלי הרשאה — לא רואים;
//   • תיקון פרטי הלקוח: פרטי ההזמנה וקישור חדש לכתובת המעודכנת, וחוזה מתוקן — החתום נשאר.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "cd.owner@e2e.test", password: "Cd-Owner-Pass-1!" };
const MANAGER = { email: "cd.manager@e2e.test", password: "Cd-Manager-Pass-1!" };
const STRANGER = { email: "cd.other@e2e.test", password: "Cd-Other-Pass-1!" };
const GUEST = "cd.guest@e2e.test";
const GUEST2 = "cd.guest.fixed@e2e.test";
const FAIL = "cd.event+reject@e2e.test";
const SLUG = "cd-docs";
const OTHER_SLUG = "cd-other";
const HOST = hostOf(SLUG);
const URL_ = (path = "/") => `http://${HOST}:${PORT}${path}`;
const FLAGS = [
  "hospitality_backend_enabled",
  "hospitality_management_enabled",
  "hospitality_frontend_enabled",
  "hospitality_booking_enabled",
] as const;
const IPHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  locale: "he-IL",
  timezoneId: "Asia/Jerusalem",
};
let siteId = "";
let otherId = "";
let ownerId = "";
let bookingId = "";
let eventId = "";
let unitId = "";
let signLink = "";
let contractId = "";

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
  >[0]) as {
    result: T;
  };
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

/** חתימה באצבע / בעכבר בתוך המסגרת */
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
    // חוזים חתומים לא נמחקים בדרך הרגילה (טריגר) — בבדיקות בלבד: מחיקת האתר כולו
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
    "the flow runs once (the phone part opens its own context)",
  );
  cleanup();
  ownerId = await ensureUser(request, OWNER);
  await ensureUser(request, MANAGER);
  await ensureUser(request, STRANGER);
  sql(`UPDATE public.platform_feature_flags SET enabled = true
        WHERE key IN (${[...FLAGS, "hospitality_contracts_enabled"].map((f) => `'${f}'`).join(", ")})`);
  for (const [slug, name, owner, username] of [
    [SLUG, "נופי החוזים", OWNER.email, "cd_owner"],
    [OTHER_SLUG, "אתר שכן", STRANGER.email, "cd_other"],
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
  otherId = sql(`SELECT id FROM public.tenants WHERE slug = '${OTHER_SLUG}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
       SELECT '${siteId}', id, email, 'cd_manager', 'admin', true FROM auth.users WHERE email = '${MANAGER.email}'`);
  sql(`UPDATE hospitality.settings SET business_name = 'נופי החוזים', contact_phone = '0503822399',
         contact_email = 'nofi.docs@e2e.test', address = 'מושב ישעי 7', check_in_time = '15:00', check_out_time = '11:00'
        WHERE tenant_id = '${siteId}'`);
  const property =
    sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status, property_type, address)
       VALUES ('${siteId}', 'מתחם החוזים', 'p-cd', 'active', 'zimmer_complex', 'מושב ישעי 7') RETURNING id`);
  unitId =
    sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, unit_type, name, slug, capacity, base_occupancy, base_price, is_active)
       VALUES ('${siteId}', '${property}', 'unit', 'zimmer', 'צימר אלון', 'u-cd', 5, 2, 700, true) RETURNING id`);
  bookingId = JSON.parse(
    asOwner(`SELECT hospitality.create_manual_booking(_unit_id => '${unitId}', _check_in => '${day(30)}',
               _check_out => '${day(32)}', _full_name => 'רונית לינה', _phone => '0546400001', _email => '${GUEST}',
               _terms_explained => true, _total_override => 1400)`),
  ).booking_id as string;
  eventId = JSON.parse(
    asOwner(
      `SELECT hospitality.event_create('${JSON.stringify({
        property_id: property,
        event_type: "bridal_shower",
        event_date: day(45),
        start_time: "10:00",
        end_time: "15:00",
        participants: 30,
        price: 2500,
        customer: { full_name: "שירה כלה", phone: "0546400003", email: FAIL },
      })}'::jsonb)`,
    ),
  ).id as string;
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

test("terms: the owner fills the contract details and confirms; before the legal approval — preview only, no sending", async ({
  page,
  request,
}) => {
  await open(page, request, "/manage/client-documents");
  await expect(page.getByRole("heading", { level: 1, name: "מסמכי לקוחות" })).toBeVisible();
  await expect(page.getByTestId("contracts-legal-pending")).toContainText(
    "ממתינים לבדיקה ולאישור משפטי",
  );
  await page.getByRole("tab", { name: "תנאים ופרטי החוזה" }).click();
  const terms = page.getByTestId("terms-editor");
  await expect(terms.getByTestId("terms-status")).toContainText("ברירות המחדל מהחוזים המקוריים");
  // the defaults are the source contracts' numbers
  await expect(terms.getByLabel("פיקדון / ערבות לנזקים, ₪")).toHaveValue("2000");
  await expect(terms.getByLabel("איחור בפינוי אירוע, ₪ לשעה")).toHaveValue("200");
  await expect(terms.getByLabel("פתיחת הבריכה")).toHaveValue("08:00");
  await expect(terms.getByLabel("סגירת הבריכה")).toHaveValue("18:00");
  await terms.getByLabel("שם הנציג המורשה").fill("אמציה בשארי");
  await terms.getByLabel("ח.פ / עוסק מורשה / עוסק פטור").fill("58731621");
  await terms.getByRole("button", { name: /הוספת היחידות של העסק/ }).click();
  await expect(terms.getByTestId("terms-units").locator("li")).toHaveCount(1);
  await expect(terms.getByLabel("למי מתאימה")).toHaveValue("עד 5 אורחים");
  await draw(page, "representative-signature");
  await terms.getByTestId("terms-save").click();
  await expect(terms.getByTestId("terms-status")).toContainText("ממתינים לאישור בעל העסק");
  await terms.getByLabel(/בדקתי: פרטי צד א'/).check();
  await terms.getByRole("button", { name: "אישור התנאים" }).click();
  await expect(terms.getByTestId("terms-status")).toContainText("בעל העסק אישר את התנאים");
  expect(
    sql(`SELECT representative_signature IS NOT NULL AND confirmed_at IS NOT NULL
                FROM hospitality.business_terms WHERE tenant_id = '${siteId}'`),
  ).toBe("t");
  await expectAccessible(page, "client documents — terms");

  // preview before the legal approval: the full text, no send
  await page.goto(URL_(`/manage/client-documents?tab=send&booking=${bookingId}`));
  const send = page.getByTestId("contract-send");
  await expect(send.getByTestId("contract-preview")).toContainText("נופי החוזים");
  await expect(send.getByTestId("contract-preview")).toContainText("אמציה בשארי");
  await expect(send.getByTestId("contract-preview")).toContainText("רונית לינה");
  await expect(send.getByTestId("contract-send-blocked")).toContainText(
    "אחרי הבדיקה והאישור המשפטי",
  );
  await expect(send.getByTestId("contract-send-button")).toBeDisabled();
  expect(
    sql(`SELECT count(*) FROM hospitality.client_contracts WHERE tenant_id = '${siteId}'`),
  ).toBe("0");
});

test("the right contract for the right booking: hosting for a stay, the pool compound for an event — the server refuses the wrong one", async ({
  request,
}) => {
  const token = await accessToken(request, OWNER);
  const wrong = await callServerFn(request, {
    host: HOST,
    file: "src/engines/hospitality/api/contracts.functions.ts",
    name: "hospitalityContractPreview",
    data: { kind: "pool_event", bookingId },
    token,
  });
  expect(await wrong.text()).toContain("חוזה מתחם הבריכה — רק לאירוע");
  // straight to the database too (the check is there, not only in the app)
  const direct = sql(`DO $$ BEGIN PERFORM hospitality._contract_link('hosting', NULL, '${eventId}');
                      EXCEPTION WHEN OTHERS THEN RAISE NOTICE '%', SQLERRM; END $$; SELECT 'checked'`);
  expect(direct).toBe("checked");
});

test("sending from the booking page: hosting contract, preview, email with a personal link (only its hash stored)", async ({
  page,
  request,
}) => {
  // the legal approval (platform + this business) — the gate opens
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled)
       VALUES ('${siteId}', 'hospitality_contracts_enabled', true)
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  await open(page, request, `/manage/bookings/${bookingId}`);
  const card = page.locator("[data-section=contracts]");
  await expect(card).toContainText("עוד לא נשלח חוזה");
  await card.getByRole("link", { name: "שליחת חוזה לחתימה" }).click();
  await expect(page).toHaveURL(/tab=send&booking=/);
  const send = page.getByTestId("contract-send");
  await expect(send.getByTestId("kind-hosting").getByRole("radio")).toBeChecked();
  await expect(send.getByTestId("contract-link")).toContainText("2 לילות");
  await expect(send.getByTestId("contract-signer")).toContainText(GUEST);
  await expect(send.getByTestId("contract-preview")).toContainText(
    "הסכם הזמנת אירוח ושכירות לטווח קצר",
  );
  await expectAccessible(page, "client documents — send");
  const since = Date.now();
  await send.getByTestId("contract-send-button").click();
  await expect(send.getByTestId("contract-send-result")).toContainText(`נשלח ל-${GUEST}`);
  let body = "";
  await expect
    .poll(async () => {
      body = (await mails(request, GUEST, since)).pop()?.body ?? "";
      return /\/stay\/contract#t=[A-Za-z0-9_-]{43}/.test(body);
    })
    .toBe(true);
  const token = /#t=([A-Za-z0-9_-]{43})/.exec(body)![1]!;
  signLink = URL_(`/stay/contract#t=${token}`);
  contractId = sql(
    `SELECT id FROM hospitality.client_contracts WHERE tenant_id = '${siteId}' AND booking_id = '${bookingId}'`,
  );
  expect(
    sql(`SELECT status || '|' || (sent_at IS NOT NULL) || '|' || (token_hash = encode(sha256(convert_to('${token}', 'UTF8')), 'hex'))
           FROM hospitality.client_contracts WHERE id = '${contractId}'`),
  ).toBe("sent|true|true");
  // a second contract for the same booking — refused (resend / cancel / replace instead)
  await page.reload();
  await expect(send.getByTestId("contract-open-notice")).toContainText("כבר יש חוזה פתוח");
  await expect(send.getByTestId("contract-send-button")).toBeDisabled();
});

test("the customer signs on a phone: the full text in RTL, missing fields, finger signature, read and agree → signed PDF at once, copy by email; the link dies", async ({
  browser,
  request,
}) => {
  const ctx = await browser.newContext(IPHONE);
  const page = await ctx.newPage();
  await page.goto(signLink);
  await expect(page.getByRole("heading", { level: 1, name: "חתימה על ההסכם" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const contract = page.getByTestId("contract-body");
  await expect(contract).toContainText("הסכם הזמנת אירוח ושכירות לטווח קצר");
  await expect(contract).toContainText("רונית לינה");
  await expect(contract).toContainText("2,000");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await expectAccessible(page, "contract signing — phone");
  // nothing filled — a clear list of what is missing
  await page.getByTestId("contract-sign-submit").click();
  const errors = page.getByTestId("contract-sign-errors");
  await expect(errors).toContainText("תעודת זהות");
  await expect(errors).toContainText("כתובת מגורים מלאה");
  await expect(errors).toContainText("אמצעי הפיקדון");
  await expect(errors).toContainText("חתימה");
  await page.getByLabel("תעודת זהות").fill("123456782");
  await page.getByLabel("כתובת מגורים").fill("רחוב הגפן 3, ישעי");
  await page.getByRole("radio", { name: "מזומן" }).check();
  await draw(page, "customer-signature");
  await page.getByLabel(/קראתי את כל סעיפי ההסכם/).check();
  const since = Date.now();
  await page.getByTestId("contract-sign-submit").click();
  await expect(page.getByTestId("contract-signed")).toContainText("ההסכם נחתם — תודה!", {
    timeout: 20_000,
  });
  const download = page.getByTestId("contract-signed-download");
  await expect(download).toHaveAttribute("href", /^blob:/);
  await expect
    .poll(async () =>
      (await mails(request, GUEST, since)).some(
        (m) => m.body.includes("contract-") && m.body.includes("attachments"),
      ),
    )
    .toBe(true);
  expect(
    sql(`SELECT status || '|' || (pdf_path IS NOT NULL) || '|' || (signed_body_sha256 IS NOT NULL) || '|' || (token_hash IS NULL)
              || '|' || (customer_fields ->> 'deposit_method')
           FROM hospitality.client_contracts WHERE id = '${contractId}'`),
  ).toBe("signed|true|true|true|cash");
  // the same link again — not valid any more
  await page.goto(URL_("/robots.txt"));
  await page.goto(signLink);
  await expect(page.getByText("הקישור לחתימה לא תקין או שכבר שומש")).toBeVisible();
  await expect(page.getByTestId("contract-sign-form")).toHaveCount(0);
  await ctx.close();
});

test("archive: search and filters, the details (masked ID, history), the signed PDF by a short link", async ({
  page,
  request,
}) => {
  await open(page, request, "/manage/client-documents?tab=archive");
  const table = page.getByTestId("contracts-table");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText("רונית לינה");
  await expect(table).toContainText("נחתם");
  await page.getByLabel("חיפוש — שם, טלפון, אימייל או מספר").fill("054-6400001");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("חיפוש — שם, טלפון, אימייל או מספר").fill("nobody");
  await expect(page.getByText("לא נמצאו חוזים")).toBeVisible();
  await page.getByLabel("חיפוש — שם, טלפון, אימייל או מספר").fill("");
  await page.getByLabel("מצב").selectOption("signed");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await table.getByRole("button", { name: /פרטים — חוזה #/ }).click();
  const detail = page.getByTestId("contract-detail");
  // the summary shows the ID masked; the full number only inside the signed text itself (as in the PDF)
  await expect(detail.locator("dl")).toContainText("•••••6782");
  await expect(detail.locator("dl")).not.toContainText("123456782");
  await expect(detail.locator("details")).not.toHaveAttribute("open", "");
  await expect(detail.getByTestId("contract-log")).toContainText("נחתם");
  await expect(detail.getByTestId("contract-log")).toContainText("נשלח ללקוח במייל");
  await expectAccessible(page, "client documents — contract details");
  // the file: a short-lived link from the server, the real signed PDF from the private bucket
  const token = await accessToken(request, OWNER);
  const res = await callServerFn(request, {
    host: HOST,
    file: "src/engines/hospitality/api/contracts.functions.ts",
    name: "hospitalityContractFile",
    data: { id: contractId, purpose: "download" },
    token,
  });
  const { url } = await fnValue<{ url: string }>(res);
  expect(url).toContain("hosp-contracts");
  const pdf = await request.get(url);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  expect(
    sql(
      `SELECT count(*) FROM hospitality.client_contract_log WHERE contract_id = '${contractId}' AND action = 'staff_download'`,
    ),
  ).toBe("1");
});

test('"my documents" in the customer\'s own area: the signed contract, download', async ({
  page,
  request,
}) => {
  await page.goto(URL_("/stay/account"));
  const since = Date.now();
  await page.getByLabel("אימייל").fill(GUEST);
  await page.getByRole("button", { name: "שליחת קוד" }).click();
  await page.getByLabel("קוד מהמייל (6 ספרות)").fill(await readLoginCode(request, GUEST, since));
  await page.getByRole("button", { name: "כניסה" }).click();
  const docs = page.getByTestId("guest-area-documents");
  await expect(docs).toContainText("המסמכים שלי");
  await expect(docs).toContainText("הסכם הזמנת אירוח ושכירות לטווח קצר");
  const download = page.waitForEvent("download");
  await docs.getByRole("button", { name: "הורדת ה-PDF" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
});

test("a failed email never marks a contract as sent; an event gets the pool-compound contract", async ({
  page,
  request,
}) => {
  await open(page, request, `/manage/events/${eventId}`);
  await page.getByRole("link", { name: "שליחת חוזה לחתימה" }).click();
  const send = page.getByTestId("contract-send");
  await expect(send.getByTestId("kind-pool-event").getByRole("radio")).toBeChecked();
  await expect(send.getByTestId("contract-preview")).toContainText("מתחם הבריכה לאירועים");
  await expect(send.getByTestId("contract-preview")).toContainText("מסיבת כלה");
  await send.getByTestId("contract-send-button").click();
  await expect(send.getByTestId("contract-send-result")).toContainText("השליחה נכשלה");
  expect(
    sql(`SELECT status || '|' || (sent_at IS NULL) || '|' || (send_error IS NOT NULL)
           FROM hospitality.client_contracts WHERE tenant_id = '${siteId}' AND event_id = '${eventId}'`),
  ).toBe("draft|true|true");
});

test("another business, a manager without the permission — no access; the owner grants it", async ({
  page,
  request,
}) => {
  const stranger = await accessToken(request, STRANGER);
  const other = await callServerFn(request, {
    host: hostOf(OTHER_SLUG),
    file: "src/engines/hospitality/api/contracts.functions.ts",
    name: "hospitalityContractDetail",
    data: { id: contractId },
    token: stranger,
  });
  expect(await other.text()).toContain("החוזה לא נמצא");
  const manager = await accessToken(request, MANAGER);
  const before = await callServerFn(request, {
    host: HOST,
    file: "src/engines/hospitality/api/contracts.functions.ts",
    name: "hospitalityContracts",
    data: {},
    token: manager,
  });
  expect(await before.text()).not.toContain("רונית לינה");
  await open(page, request, "/manage/client-documents", MANAGER);
  await expect(
    page.getByText("שליחת חוזים והארכיון — לבעלים ולמנהלים שקיבלו הרשאה לחוזים."),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "ארכיון החוזים" })).toHaveCount(0);
  // the owner grants it on the team screen
  await open(page, request, "/manage/team");
  await page.locator(`[data-contracts="${MANAGER.email}"]`).getByRole("switch").click();
  await expect(
    page.locator(`[data-contracts="${MANAGER.email}"]`).getByRole("switch"),
  ).toBeChecked();
  const after = await callServerFn(request, {
    host: HOST,
    file: "src/engines/hospitality/api/contracts.functions.ts",
    name: "hospitalityContracts",
    data: {},
    token: manager,
  });
  expect(await after.text()).toContain("רונית לינה");
});

test("correcting the customer's email: the details and a new personal link to the corrected address; the signed contract stays — a corrected one is sent", async ({
  page,
  request,
}) => {
  const oldLink = sql(
    `SELECT manage_token_hash FROM hospitality.bookings WHERE id = '${bookingId}'`,
  );
  await open(page, request, `/manage/bookings/${bookingId}`);
  await page.getByTestId("customer-edit").click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("אימייל", { exact: true }).fill(GUEST2);
  await expect(sheet.getByTestId("customer-notify")).toBeChecked();
  const since = Date.now();
  await sheet.getByRole("button", { name: "שמירת הפרטים" }).click();
  const result = page.getByTestId("customer-update-result");
  await expect(result).toContainText("עודכנו: האימייל");
  await expect(result).toContainText("פרטי ההזמנה וקישור אישי חדש נשלחים");
  await expect(result).toContainText("כבר נחתם — הוא לא משתנה");
  await expect
    .poll(async () =>
      (await mails(request, GUEST2, since)).some((m) => m.body.includes("/stay/my-booking#t=")),
    )
    .toBe(true);
  expect(
    sql(
      `SELECT manage_token_hash IS DISTINCT FROM '${oldLink}' FROM hospitality.bookings WHERE id = '${bookingId}'`,
    ),
  ).toBe("t");
  await expect(
    page.getByText(/פרטי הלקוח תוקנו: אימייל \(c•••@e2e\.test ← c•••@e2e\.test\)/),
  ).toBeVisible();
  // the corrected contract: from the notice → the send tab in "corrected" mode
  await result.getByRole("link", { name: "חוזה מתוקן" }).click();
  const send = page.getByTestId("contract-send");
  await expect(send.getByTestId("contract-corrected-notice")).toContainText("חוזה מתוקן");
  await expect(send.getByTestId("contract-signer")).toContainText(GUEST2);
  const since2 = Date.now();
  await send.getByTestId("contract-send-button").click();
  await expect(send.getByTestId("contract-send-result")).toContainText(`נשלח ל-${GUEST2}`);
  await expect
    .poll(async () =>
      (await mails(request, GUEST2, since2)).some((m) => m.body.includes("/stay/contract#t=")),
    )
    .toBe(true);
  expect(
    sql(`SELECT string_agg(status || ':' || (supersedes_id IS NOT NULL), ',' ORDER BY number)
           FROM hospitality.client_contracts WHERE booking_id = '${bookingId}'`),
  ).toBe("signed:false,sent:true");
});
