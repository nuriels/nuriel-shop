import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContextOptions,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { hostGet, hostOf, PORT } from "./helpers";
import {
  asPlatform,
  ensureUser,
  expectAccessible,
  loadSession,
  passwordSession,
  sql,
} from "./hospitality-helpers";

// חתימה על מסמך עצמאי — בכל מכשיר, מקצה לקצה (השרת הבנוי, Storage האמיתי, תור המיילים והמייל המדומה):
//   • מחשב: בעל העסק — חוזה אירוח ללקוח קיים, במייל; הלקוח חותם במחשב בעכבר;
//   • טלפון קטן (360 פיקסלים): בעל העסק מגיע מלוח הבקרה ("מסמך לחתימה") ומ"+ חדש", כל הלשוניות גלויות,
//     חוזה אירוע שהלקוח ממלא — ללקוח קיים (הפרטים ממולאים מראש), בדיקת המסמך במסך מלא, יצירת קישור
//     מהשורה הקבועה, קישור לשיתוף / חתימה במכשיר הזה;
//   • הלקוח בטלפון: פותח את הקישור, לוח חתימה גדול, חתימה באצבע אמיתית (אירועי מגע) בלי שהעמוד זז,
//     בלי שורת ההזמנה של האתר;
//   • בכל חתימה: ה-PDF מכיל את פרטי החוזה והחתימה, נשמר בדלי הפרטי (הטביעה במסד = הקובץ שהלקוח הוריד =
//     הקובץ שצורף למייל), ומופיע ב"מסמכים חתומים" — גם בטלפון, עם קישור קצר-מועד לקובץ.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "sg.owner@e2e.test", password: "Sg-Owner-Pass-1!" };
const NOTIFY = "sg.docs@e2e.test";
const DANI = "sg.dani@e2e.test";
const SHIRA = "sg.shira@e2e.test";
const SLUG = "sg-docs";
const HOST = hostOf(SLUG);
const URL_ = (path = "/") => `http://${HOST}:${PORT}${path}`;
const FLAGS = [
  "hospitality_backend_enabled",
  "hospitality_management_enabled",
  "hospitality_frontend_enabled",
  "hospitality_booking_enabled",
  "hospitality_contracts_enabled",
] as const;
const SMALL_PHONE: BrowserContextOptions = {
  viewport: { width: 360, height: 740 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: "he-IL",
  timezoneId: "Asia/Jerusalem",
};
let siteId = "";
let ownerId = "";
let linkB = "";
/** SIGN_SHOTS=<dir>: screenshots of the phone screens (for a report); off by default */
const SHOTS = process.env["SIGN_SHOTS"];
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const day = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
const asOwner = (query: string) =>
  sql(`SELECT set_config('request.jwt.claims', json_build_object('sub', '${ownerId}', 'role', 'authenticated')::text, false),
              set_config('request.jwt.claim.sub', '${ownerId}', false),
              set_config('request.headers', json_build_object('x-tenant-id', '${siteId}')::text, false);
       ${query}`)
    .split("\n")
    .pop()!;
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

type Call = { url: string; body: string; at: number };
async function mails(request: APIRequestContext, to: string, since: number): Promise<Call[]> {
  const calls = (await (await request.get("http://127.0.0.1:4010/__calls")).json()) as Call[];
  return calls.filter((c) => c.url.startsWith("/emails") && c.at >= since && c.body.includes(to));
}

async function mouseDraw(page: Page, testId: string) {
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
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 6 });
  await page.mouse.up();
}

/** אצבע אמיתית: אירועי מגע דרך DevTools (pointerType "touch") — לא עכבר */
async function fingerDraw(page: Page, testId: string): Promise<number> {
  const area = page.getByTestId(`${testId}-area`);
  await area.scrollIntoViewIfNeeded();
  const box = (await area.boundingBox())!;
  const before = await page.evaluate(() => window.scrollY);
  const cdp = await page.context().newCDPSession(page);
  const at = (x: number, y: number) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
  const pts: [number, number][] = [
    [0.1, 0.75],
    [0.25, 0.2],
    [0.4, 0.75],
    [0.55, 0.25],
    [0.75, 0.65],
    [0.9, 0.3],
  ];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at(...pts[0]!)] });
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    for (let s = 1; s <= 6; s++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [at(ax + ((bx - ax) * s) / 6, ay + ((by - ay) * s) / 6)],
      });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  return (await page.evaluate(() => window.scrollY)) - before;
}

/** ה-PDF שהלקוח מוריד מיד אחרי החתימה: הטקסט שלו והטביעה */
async function downloadedPdf(page: Page, info: TestInfo, name: string) {
  const href = await page.getByTestId("contract-signed-download").getAttribute("href");
  const b64 = await page.evaluate(async (u) => {
    const buf = new Uint8Array(await (await fetch(u!)).arrayBuffer());
    let s = "";
    for (const b of buf) s += String.fromCharCode(b);
    return btoa(s);
  }, href);
  const bytes = Buffer.from(b64, "base64");
  const file = info.outputPath(`${name}.pdf`);
  mkdirSync(info.outputDir, { recursive: true });
  writeFileSync(file, bytes);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  return {
    // (pdftotext wraps punctuation inside Hebrew runs with bidi marks — removed for the comparison)
    text: execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" }).replace(
      /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
      "",
    ),
    sha: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** הקובץ שצורף למייל ללקוח — אותו קובץ בדיוק */
async function attachedSha(request: APIRequestContext, to: string, since: number) {
  let sha = "";
  await expect
    .poll(async () => {
      const m = (await mails(request, to, since)).find((x) => x.body.includes("attachments"));
      if (!m) return false;
      const a = (JSON.parse(m.body) as { attachments: { content: string }[] }).attachments[0]!;
      sha = createHash("sha256").update(Buffer.from(a.content, "base64")).digest("hex");
      return true;
    })
    .toBe(true);
  return sha;
}

function cleanup() {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  if (!id) return;
  sql(`SET session_replication_role = replica;
       DELETE FROM hospitality.client_contract_log WHERE tenant_id = '${id}';
       DELETE FROM hospitality.client_contracts WHERE tenant_id = '${id}';
       DELETE FROM storage.objects WHERE bucket_id = 'hosp-contracts' AND name LIKE '${id}/%'`);
  asPlatform(`SELECT public.platform_delete_tenant('${id}', '${SLUG}')`);
}

test.beforeAll(async ({ request }, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile",
    "the phone parts open their own small-phone context",
  );
  cleanup();
  ownerId = await ensureUser(request, OWNER);
  sql(`UPDATE public.platform_feature_flags SET enabled = true
        WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`);
  asPlatform(`SELECT hospitality.admin_create_site('${SLUG}', 'נופי החתימות')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
       SELECT '${siteId}', id, email, 'sg_owner', 'admin', true, true FROM auth.users WHERE email = '${OWNER.email}'`);
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ${FLAGS.map((f) => `('${siteId}', '${f}', true)`).join(", ")}
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  sql(`UPDATE hospitality.settings SET business_name = 'נופי החתימות', contact_phone = '0503822368',
         contact_email = '${NOTIFY}', address = 'מושב ישעי 68', check_in_time = '15:00', check_out_time = '11:00'
        WHERE tenant_id = '${siteId}'`);
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
  // two existing customers (customer cards)
  sql(`INSERT INTO hospitality.guests (tenant_id, full_name, email, phone) VALUES
       ('${siteId}', 'דני קיים', '${DANI}', '0541234567'),
       ('${siteId}', 'שירה חוגגת', '${SHIRA}', '0529876543')`);
  await expect
    .poll(async () => (await hostGet(request, HOST, "/manage/client-documents")).status(), {
      timeout: 20_000,
    })
    .toBe(200);
});

test.afterAll(() => cleanup());

test("desktop: the owner sends a hosting contract to an existing customer by email; the customer signs with a mouse; full PDF stored, attached and listed", async ({
  page,
  request,
}, testInfo) => {
  const session = await passwordSession(request, URL_(), OWNER);
  await loadSession(page, session, "/manage");
  // the entry from "+ new"
  await page.getByRole("button", { name: "חדש" }).click();
  await page.getByRole("menuitem", { name: "מסמך לחתימה" }).click();
  await expect(page).toHaveURL(/\/manage\/client-documents\?tab=new/);
  const form = page.getByTestId("standalone-document");
  await form.getByTestId("sd-kind-hosting").click();
  await form.getByTestId("sd-customer-existing").click();
  await form.getByLabel("חיפוש לקוח — שם, טלפון או אימייל").fill("דני");
  await form.getByRole("button", { name: /דני קיים/ }).click();
  await form.getByLabel("תאריך כניסה").fill(day(20));
  await form.getByLabel("תאריך יציאה").fill(day(22));
  await form.getByText("אלון", { exact: true }).click();
  await form.getByLabel("המחיר, ₪").fill("1800");
  await expect(form.getByTestId("sd-preview")).toContainText("דני קיים");
  // the phone bar does not show on a desktop
  await expect(page.getByTestId("sd-mobile-bar")).toBeHidden();
  const since = Date.now();
  await form.getByTestId("sd-create").click();
  await expect(form.getByTestId("sd-result")).toContainText(`נשלח ל-${DANI}`);
  let body = "";
  await expect
    .poll(async () => {
      body = (await mails(request, DANI, since)).map((m) => m.body).join("\n");
      return /#t=[A-Za-z0-9_-]{43}/.test(body);
    })
    .toBe(true);
  const token = /#t=([A-Za-z0-9_-]{43})/.exec(body)![1]!;

  // the customer, on a desktop, with a mouse
  const ctx = await page
    .context()
    .browser()!
    .newContext({ viewport: { width: 1280, height: 900 }, locale: "he-IL" });
  const c = await ctx.newPage();
  await c.goto(URL_(`/stay/contract#t=${token}`));
  await expect(c.getByRole("heading", { level: 1, name: "חתימה על ההסכם" })).toBeVisible();
  await c.getByLabel("תעודת זהות").fill("123456782");
  await c.getByLabel("כתובת מגורים").fill("רחוב התאנה 5, חיפה");
  await c.getByRole("radio", { name: "מזומן" }).check();
  const pad = (await c.getByTestId("customer-signature-area").boundingBox())!;
  expect(Math.round(pad.width / pad.height)).toBe(3); // a desktop pad keeps 3:1
  await mouseDraw(c, "customer-signature");
  await c.getByLabel(/קראתי את כל סעיפי ההסכם/).check();
  const since2 = Date.now();
  await c.getByTestId("contract-sign-submit").click();
  await expect(c.getByTestId("contract-signed")).toContainText("ההסכם נחתם — תודה!", {
    timeout: 30_000,
  });
  const pdf = await downloadedPdf(c, testInfo, "desktop-signed");
  for (const part of [
    "דני קיים",
    "123456782",
    // (a number next to a comma comes out of the visual-order PDF text reversed — "‎,5" — so in parts)
    "רחוב התאנה",
    "חיפה",
    DANI,
    "אלון",
    "1,800",
    "ציור באצבע",
    "תיעוד החתימה האלקטרונית",
  ])
    expect(pdf.text, part).toContain(part);
  const [status, stored] =
    sql(`SELECT status || '|' || coalesce(pdf_sha256, '') FROM hospitality.client_contracts
                                 WHERE tenant_id = '${siteId}' AND signer_email = '${DANI}'`).split(
      "|",
    );
  expect(status).toBe("signed");
  expect(stored).toBe(pdf.sha);
  expect(await attachedSha(request, DANI, since2)).toBe(pdf.sha);
  await ctx.close();

  // the owner's signed documents list, on a desktop
  await page.goto(URL_("/manage/client-documents?tab=signed"));
  const signed = page.getByTestId("signed-documents");
  await expect(signed).toContainText("דני קיים");
});

test('small phone, the owner: dashboard and "+ new" lead to it, all tabs visible, an event contract the customer fills (existing customer), full-screen review, a link from the bottom bar', async ({
  browser,
  request,
}) => {
  const ctx = await browser.newContext(SMALL_PHONE);
  const page = await ctx.newPage();
  const session = await passwordSession(request, URL_(), OWNER);
  await loadSession(page, session, "/manage");
  // "+ new" has it on the phone too
  await page.getByRole("button", { name: "חדש" }).click();
  await expect(page.getByRole("menuitem", { name: "מסמך לחתימה" })).toBeVisible();
  await page.keyboard.press("Escape");
  // the dashboard quick action
  await shot(page, "1-dashboard");
  const quick = page.getByRole("navigation", { name: "פעולות מהירות" });
  await quick.getByRole("link", { name: /מסמך לחתימה/ }).click();
  await expect(page).toHaveURL(/\/manage\/client-documents\?tab=new/);
  const tabs = page.getByRole("tablist", { name: "מסמכי לקוחות" });
  await expect(tabs.getByRole("tab")).toHaveCount(5);
  const visible = await tabs.getByRole("tab").evaluateAll((els) =>
    els.every((e) => {
      const r = e.getBoundingClientRect();
      return r.left >= 0 && r.right <= window.innerWidth;
    }),
  );
  expect(visible, "every tab inside the screen").toBe(true);
  await shot(page, "2-documents-tabs");
  expect(await noOverflow(page)).toBe(true);

  const form = page.getByTestId("standalone-document");
  await form.getByTestId("sd-kind-pool-event").click();
  await form.getByTestId("sd-fill-customer").click();
  await form.getByTestId("sd-customer-existing").click();
  await form.getByLabel("חיפוש לקוח — שם, טלפון או אימייל").fill("שירה");
  await form.getByRole("button", { name: /שירה חוגגת/ }).click();
  // the phone bar says what is missing, and cannot create yet
  const bar = page.getByTestId("sd-mobile-bar");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("מלאו את פרטי החוזה");
  await expect(page.getByTestId("sd-mobile-create")).toBeDisabled();
  await form.getByLabel("תאריך האירוע").fill(day(40));
  await form.getByLabel("שעת התחלה").fill("12:00");
  await form.getByLabel("שעת סיום").fill("16:00");
  await form.locator("#sd-type").selectOption({ index: 1 });
  expect(await form.locator("#sd-type").evaluate((e) => getComputedStyle(e).fontSize)).toBe("16px");
  await form.getByLabel("מספר משתתפים").fill("30");
  await expect(form.getByLabel("מספר משתתפים")).toHaveAttribute("inputmode", "numeric");
  await form.getByLabel("המחיר, ₪").fill("2500");
  await expect(bar).toContainText("מוכן", { timeout: 15_000 });
  await shot(page, "3-ready-bar");
  // review the whole contract before sending — full screen
  await page.getByTestId("sd-mobile-review").click();
  const full = page.getByTestId("sd-full");
  await expect(full).toBeVisible();
  await expect(full.getByTestId("contract-body")).toContainText("שירה חוגגת");
  await expect(full.getByTestId("contract-body")).toContainText("2,500");
  await shot(page, "4-full-review");
  await expectAccessible(page, "standalone document — full-screen review on a phone");
  await full.getByRole("button", { name: "חזרה לעריכה" }).click();
  await expect(full).toBeHidden();
  // create the link from the bottom bar
  await page.getByTestId("sd-mobile-create").click();
  const box = form.getByTestId("sign-link-box");
  await expect(box).toBeInViewport({ timeout: 15_000 });
  await expect(bar).toBeHidden();
  await expect(box.getByRole("link", { name: "שליחה בוואטסאפ" })).toHaveAttribute(
    "href",
    /wa\.me\/972529876543/,
  );
  await expect(box.getByTestId("sign-link-here")).toBeVisible();
  await shot(page, "5-link-box");
  linkB = await box.getByTestId("sign-link-url").inputValue();
  expect(await noOverflow(page)).toBe(true);
  expect(
    sql(`SELECT kind || '|' || fill_mode || '|' || coalesce(signer_name, '') || '|' || (guest_id IS NOT NULL)
           FROM hospitality.client_contracts WHERE tenant_id = '${siteId}' AND kind = 'pool_event'`),
  ).toBe("pool_event|customer|שירה חוגגת|true");
  await ctx.close();
});

test("small phone, the customer: opens the link, a big pad, signs with a real finger, PDF and email copy; the owner sees it on the phone", async ({
  browser,
  request,
}, testInfo) => {
  const token = /#t=([A-Za-z0-9_-]{43})/.exec(linkB)![1]!;
  const ctx = await browser.newContext(SMALL_PHONE);
  const page = await ctx.newPage();
  await page.goto(URL_(`/stay/contract#t=${token}`));
  await expect(page.getByRole("heading", { level: 1, name: "חתימה על ההסכם" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  // the site's booking bar is not on the signing page
  await expect(page.locator("[data-action-bar]")).toHaveCount(0);
  expect(await noOverflow(page)).toBe(true);
  // prefilled from the customer card — and can be corrected
  await expect(page.getByLabel("שם מלא")).toHaveValue("שירה חוגגת");
  await expect(page.getByLabel("אימייל")).toHaveValue(SHIRA);
  await expect(page.getByLabel("אימייל")).toHaveAttribute("type", "email");
  await expect(page.getByLabel("טלפון (לא חובה)")).toHaveAttribute("type", "tel");
  await expect(page.getByLabel("תעודת זהות")).toHaveAttribute("inputmode", "numeric");
  await page.getByLabel("תעודת זהות").fill("123456782");
  await page.getByLabel("כתובת מגורים").fill("שדרות הים 1, נתניה");
  const pad = (await page.getByTestId("customer-signature-area").boundingBox())!;
  expect(pad.height, "a pad big enough for a finger").toBeGreaterThanOrEqual(180);
  expect(pad.width).toBeGreaterThanOrEqual(280);
  expect(await fingerDraw(page, "customer-signature"), "the page stays put while signing").toBe(0);
  await shot(page, "6-customer-signed-pad");
  await page.getByLabel(/קראתי את כל סעיפי ההסכם/).check();
  const submit = page.getByTestId("contract-sign-submit");
  const sb = (await submit.boundingBox())!;
  expect(sb.width, "a full-width sign button").toBeGreaterThan(300);
  await expectAccessible(page, "standalone contract — signing on a small phone");
  const since = Date.now();
  await submit.click();
  await expect(page.getByTestId("contract-signed")).toContainText("ההסכם נחתם — תודה!", {
    timeout: 30_000,
  });
  await shot(page, "7-customer-done");
  const pdf = await downloadedPdf(page, testInfo, "phone-signed");
  for (const part of [
    "שירה חוגגת",
    "123456782",
    "שדרות הים",
    "נתניה",
    SHIRA,
    "2,500",
    "ציור באצבע",
    "תיעוד החתימה האלקטרונית",
  ])
    expect(pdf.text, part).toContain(part);
  // the drawn signature is in the PDF, proportional (a taller phone pad still fits the 600×200 box)
  const paths = JSON.parse(
    sql(`SELECT signature -> 'paths' FROM hospitality.client_contracts
          WHERE tenant_id = '${siteId}' AND kind = 'pool_event'`),
  ) as string[];
  expect(paths.length).toBeGreaterThan(0);
  // …and only inside the band the signer saw on the taller phone pad (no hidden ink at the sides)
  const [w, h] = [pad.width - 4, pad.height - 4]; // inside the 2px border
  const k = Math.min(600 / w, 200 / h);
  const [left, right] = [(600 - w * k) / 2, (600 + w * k) / 2];
  expect(left, "a taller pad shows a centered band").toBeGreaterThan(50);
  for (const p of paths)
    for (const [, x, y] of p.matchAll(/([0-9]+),([0-9]+)/g)) {
      expect(Number(x)).toBeGreaterThanOrEqual(Math.floor(left) - 1);
      expect(Number(x)).toBeLessThanOrEqual(Math.ceil(right) + 1);
      expect(Number(y)).toBeLessThanOrEqual(200);
    }
  const [status, stored] =
    sql(`SELECT status || '|' || coalesce(pdf_sha256, '') FROM hospitality.client_contracts
                                 WHERE tenant_id = '${siteId}' AND kind = 'pool_event'`).split("|");
  expect(status).toBe("signed");
  expect(stored).toBe(pdf.sha);
  expect(await attachedSha(request, SHIRA, since)).toBe(pdf.sha);
  await ctx.close();

  // the owner, on the phone: both signed documents, and the file opens
  const octx = await browser.newContext(SMALL_PHONE);
  const owner = await octx.newPage();
  const session = await passwordSession(request, URL_(), OWNER);
  await loadSession(owner, session, "/manage/client-documents?tab=signed");
  const signed = owner.getByTestId("signed-documents");
  await expect(signed).toContainText("שירה חוגגת");
  await expect(signed).toContainText("דני קיים");
  expect(await noOverflow(owner)).toBe(true);
  await shot(owner, "8-owner-signed-list");
  // the stored file, downloaded from the phone (a 60-second link from the private bucket)
  const [download] = await Promise.all([
    owner.waitForEvent("download"),
    signed.getByRole("button", { name: "הורדה" }).first().click(),
  ]);
  const file = readFileSync((await download.path())!);
  expect(file.subarray(0, 5).toString()).toBe("%PDF-");
  const shas = sql(`SELECT string_agg(pdf_sha256, ',') FROM hospitality.client_contracts
                     WHERE tenant_id = '${siteId}' AND status = 'signed'`).split(",");
  expect(shas).toContain(createHash("sha256").update(file).digest("hex"));
  await octx.close();
});
