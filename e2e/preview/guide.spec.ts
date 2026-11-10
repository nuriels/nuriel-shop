import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { hostGet, hostOf, PORT } from "../tests/helpers";
import {
  asPlatform,
  ensureUser,
  loadSession,
  passwordSession,
  sql,
  type SavedSession,
} from "../tests/hospitality-helpers";

// סרטון מדריך לבעלי אתרי אירוח: "מסמכי לקוחות" (מסמך מדיניות / חוזה לחתימה — במייל או בקישור,
// חתימה באצבע בטלפון, "מסמכים חתומים") ו"אירועים". מול Supabase המקומי, עם עסק ולקוחות לדוגמה
// בלבד. שלושה קטעים (מחשב · טלפון · מחשב) עם כיתוב בעברית על המסך; ffmpeg מחבר אותם לסרטון אחד.

const OUT = fileURLToPath(new URL("./out/guide/", import.meta.url));
mkdirSync(OUT, { recursive: true });
// GUIDE_SHOTS=1: במקום סרטון — צילומי מסך חדים (×2) בכל נקודת כיתוב, בלי הכיתוב (למסמך PDF ללקוח)
const SHOTS = process.env["GUIDE_SHOTS"] === "1";
let shot = 0;
if (SHOTS) mkdirSync(`${OUT}shots`, { recursive: true });
const SLUG = "guide-demo";
const HOST = hostOf(SLUG);
const URL_ = (path = "/") => `http://${HOST}:${PORT}${path}`;
const OWNER = { email: "guide.owner@demo.test", password: "Guide-Owner-Pass-1!" };
const FLAGS = [
  "hospitality_backend_enabled",
  "hospitality_management_enabled",
  "hospitality_frontend_enabled",
  "hospitality_contracts_enabled",
] as const;
const RULES = [
  "## שעות שקט",
  "- בין 22:00 ל-08:00",
  "- בלי מוזיקה בחוץ",
  "## בריכה וג'קוזי",
  "- השימוש באחריות האורחים, ילדים בהשגחת מבוגר",
  "## ניקיון",
  "- אורחים מתבקשים לשמור על הניקיון ולהשאיר את המקום כפי שקיבלו אותו.",
].join("\n");
const day = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });

let siteId = "";
let ownerId = "";
let session: SavedSession | null = null;
const asOwner = (query: string) =>
  sql(`SELECT set_config('request.jwt.claims', json_build_object('sub', '${ownerId}', 'role', 'authenticated')::text, false),
              set_config('request.jwt.claim.sub', '${ownerId}', false),
              set_config('request.headers', json_build_object('x-tenant-id', '${siteId}')::text, false);
       ${query}`)
    .split("\n")
    .pop()!;

/** הכיתוב בתחתית המסך — נשאר גם במעבר עמוד, וחוזר אם React החליף את ה-body */
const CAPTION_JS = `(() => {
  const KEY = "__guide_caption";
  const ensure = () => {
    let el = document.getElementById("guide-caption");
    if (!el && document.body) {
      el = document.createElement("div");
      el.id = "guide-caption";
      el.setAttribute("dir", "rtl");
      el.style.cssText = "position:fixed;left:50%;bottom:" + (window.innerWidth < 600 ? "92px" : "22px") + ";transform:translateX(-50%);z-index:2147483647;" +
        "width:max-content;max-width:90%;background:rgba(15,23,42,.93);color:#fff;" +
        "font:600 clamp(15px,3.9vw,25px)/1.4 Heebo,Rubik,Arial,sans-serif;padding:12px 24px;border-radius:14px;" +
        "box-shadow:0 10px 30px rgba(0,0,0,.35);text-align:center;pointer-events:none;transition:opacity .3s";
      document.body.appendChild(el);
    }
    return el;
  };
  const show = (t) => {
    try { sessionStorage.setItem(KEY, t || ""); } catch {}
    const el = ensure();
    if (!el) return;
    el.textContent = t || "";
    el.style.opacity = t ? "1" : "0";
  };
  window.__cap = show;
  setInterval(() => {
    let t = "";
    try { t = sessionStorage.getItem(KEY) || ""; } catch {}
    const el = document.getElementById("guide-caption");
    if (t && (!el || el.textContent !== t)) show(t);
  }, 300);
})();`;

async function cap(page: Page, text: string, ms = 3600) {
  if (SHOTS) {
    await page.waitForTimeout(700);
    shot += 1;
    await page.screenshot({ path: `${OUT}shots/${String(shot).padStart(2, "0")}.png` });
    return;
  }
  await page.evaluate((t) => (window as unknown as { __cap: (s: string) => void }).__cap(t), text);
  await page.waitForTimeout(ms);
}

async function recorded(browser: Browser, phone = false): Promise<BrowserContext> {
  const size = phone ? { width: 390, height: 844 } : { width: 1280, height: 800 };
  const ctx = await browser.newContext({
    viewport: size,
    ...(phone ? { isMobile: true, hasTouch: true } : {}),
    deviceScaleFactor: SHOTS ? 2 : 1,
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    ...(SHOTS ? {} : { recordVideo: { dir: `${OUT}raw`, size } }),
  });
  if (!SHOTS) await ctx.addInitScript(CAPTION_JS);
  return ctx;
}

async function keep(ctx: BrowserContext, page: Page, name: string) {
  await ctx.close();
  if (SHOTS) return;
  await page.video()!.saveAs(`${OUT}${name}.webm`);
}

async function mailBody(request: APIRequestContext, to: string, since: number): Promise<string> {
  const calls = (await (await request.get("http://127.0.0.1:4010/__calls")).json()) as {
    url: string;
    body: string;
    at: number;
  }[];
  return (
    calls.filter((c) => c.url.startsWith("/emails") && c.at >= since && c.body.includes(to)).pop()
      ?.body ?? ""
  );
}

async function draw(page: Page, testId: string) {
  const area = page.getByTestId(`${testId}-area`);
  await area.scrollIntoViewIfNeeded();
  const box = (await area.boundingBox())!;
  const pts: [number, number][] = [
    [0.12, 0.65],
    [0.22, 0.3],
    [0.32, 0.62],
    [0.45, 0.28],
    [0.55, 0.6],
    [0.7, 0.35],
    [0.86, 0.55],
  ];
  await page.mouse.move(box.x + box.width * pts[0]![0], box.y + box.height * pts[0]![1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1))
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 8 });
  await page.mouse.up();
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

test.beforeAll(async ({ request }) => {
  cleanup();
  ownerId = await ensureUser(request, OWNER);
  sql(
    `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`,
  );
  asPlatform(`SELECT hospitality.admin_create_site('${SLUG}', 'צימרים לדוגמה')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
       SELECT '${siteId}', id, email, 'guide_owner', 'admin', true, true FROM auth.users WHERE email = '${OWNER.email}'`);
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ${FLAGS.map((f) => `('${siteId}', '${f}', true)`).join(", ")}
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  sql(`UPDATE hospitality.settings SET business_name = 'צימרים לדוגמה', contact_phone = '0500000000',
         contact_email = 'office@example.com', address = 'הגליל העליון', check_in_time = '15:00', check_out_time = '11:00'
        WHERE tenant_id = '${siteId}'`);
  const propertyId =
    sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status, property_type)
       VALUES ('${siteId}', 'מתחם הבריכה', 'guide-p', 'active', 'zimmer_complex') RETURNING id`);
  for (const [name, slug] of [
    ["צימר האלון", "guide-alon"],
    ["צימר האורן", "guide-oren"],
  ] as const)
    sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, unit_type, name, slug, capacity, base_occupancy, base_price, is_active)
         VALUES ('${siteId}', '${propertyId}', 'unit', 'zimmer', '${name}', '${slug}', 4, 2, 750, true)`);
  asOwner(
    `SELECT hospitality.business_terms_save('${JSON.stringify({
      representative_name: "ישראל ישראלי",
      business_tax_id: "000000000",
      unit_lines: [
        { name: "האלון", description: "מיועד לזוג ועד 2 ילדים" },
        { name: "האורן", description: "מיועד לזוג בלבד" },
      ],
    })}'::jsonb, 0)`,
  );
  asOwner(`SELECT hospitality.business_terms_confirm(1)`);
  const saved = JSON.parse(
    asOwner(
      `SELECT hospitality.site_document_save('house_rules', 'כללי המקום', $doc$${RULES}$doc$)`,
    ),
  ) as { revision: number };
  asOwner(
    `SELECT hospitality.site_document_publish('house_rules', 'כללי המקום', $doc$${RULES}$doc$, ${saved.revision})`,
  );
  // an event already in the calendar (to show that overlaps are blocked)
  asOwner(
    `SELECT hospitality.event_create('${JSON.stringify({
      property_id: propertyId,
      event_type: "birthday",
      event_date: day(30),
      start_time: "10:00",
      end_time: "14:00",
      participants: 25,
      price: 1800,
      status: "confirmed",
      customer: { full_name: "משפחת כהן", phone: "0500000001", email: "cohen@example.com" },
    })}'::jsonb)`,
  );
  await expect
    .poll(async () => (await hostGet(request, HOST, "/manage/client-documents")).status(), {
      timeout: 30_000,
    })
    .toBe(200);
  session = await passwordSession(request, URL_(), OWNER);
});

test.afterAll(() => {
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("guide: documents for signing (email and link), signing on a phone, signed documents, events", async ({
  browser,
  request,
}) => {
  // ---------- 1. the owner, on the computer ----------
  const c1 = await recorded(browser);
  const p1 = await c1.newPage();
  await loadSession(p1, session!, "/manage/client-documents");
  await expect(p1.getByRole("heading", { level: 1 })).toBeVisible();
  await cap(p1, "מה חדש בניהול האתר — מדריך קצר", 3000);
  await cap(p1, "חדש: „מסמכי לקוחות” — שולחים ללקוח מסמך לחתימה, גם בלי הזמנה", 4200);
  const form = p1.getByTestId("standalone-document");
  await form.getByTestId("sd-kind-policy").click();
  await cap(p1, "בוחרים מסמך מהאתר — תקנון, מדיניות ביטול, כללי המקום — או חוזה", 4200);
  await form.getByTestId("sd-fill-business").click();
  await form.getByTestId("sd-customer-new").click();
  await cap(p1, "דרך 1: כותבים שם ואימייל — והמערכת שולחת ללקוח קישור אישי במייל", 3000);
  await form.getByLabel("שם מלא").pressSequentially("נועה לוי", { delay: 70 });
  await form
    .getByLabel("אימייל (לשם נשלח הקישור)")
    .pressSequentially("noa@example.com", { delay: 45 });
  await form.getByTestId("sd-preview").scrollIntoViewIfNeeded();
  await cap(p1, "רואים מראש בדיוק את מה שהלקוח יקבל", 4000);
  const since = Date.now();
  await form.getByTestId("sd-create").scrollIntoViewIfNeeded();
  await form.getByTestId("sd-create").click();
  await expect(form.getByTestId("sd-result")).toContainText("נשלח ל-");
  await cap(p1, "נשלח ✓ הקישור אישי, חד-פעמי ובתוקף 14 יום", 3800);
  let body = "";
  await expect
    .poll(async () => {
      body = await mailBody(request, "noa@example.com", since);
      return /#t=[A-Za-z0-9_-]{43}/.test(body);
    })
    .toBe(true);
  const linkA = URL_(`/stay/contract#t=${/#t=([A-Za-z0-9_-]{43})/.exec(body)![1]!}`);

  await p1.goto(URL_("/manage/client-documents?tab=new"));
  await form.getByTestId("sd-kind-hosting").click();
  await form.getByTestId("sd-fill-customer").click();
  await cap(p1, "דרך 2: יוצרים קישור — והלקוח ממלא בעצמו את הפרטים שלו וחותם", 3600);
  await form.getByLabel("תאריך כניסה").fill(day(45));
  await form.getByLabel("תאריך יציאה").fill(day(47));
  await form.getByTestId("sd-whole").check();
  await form.getByLabel("המחיר, ₪").fill("2400");
  await form.getByTestId("sd-preview").scrollIntoViewIfNeeded();
  await cap(p1, "החוזה נבנה לבד מהפרטים: תאריכים, יחידות ומחיר", 3600);
  await form.getByTestId("sd-create").scrollIntoViewIfNeeded();
  await form.getByTestId("sd-create").click();
  const box = form.getByTestId("sign-link-box");
  await expect(box).toBeVisible();
  await box.scrollIntoViewIfNeeded();
  await cap(p1, "מעתיקים את הקישור — או שולחים אותו ישר בוואטסאפ", 4200);
  await keep(c1, p1, "1-owner");

  // ---------- 2. the customer, on a phone ----------
  const c2 = await recorded(browser, true);
  const p2 = await c2.newPage();
  await p2.goto(linkA);
  await expect(p2.getByRole("heading", { level: 1 })).toBeVisible();
  await cap(p2, "כך זה נראה אצל הלקוח בטלפון", 3200);
  await p2.getByTestId("contract-body").scrollIntoViewIfNeeded();
  await p2.mouse.wheel(0, 500);
  await cap(p2, "הלקוח קורא את המסמך המלא", 2800);
  await p2.getByLabel(/קראתי את המסמך במלואו/).check();
  await cap(p2, "מאשר שקרא — וחותם באצבע", 2400);
  await draw(p2, "customer-signature");
  await p2.waitForTimeout(800);
  await p2.getByTestId("contract-sign-submit").click();
  await expect(p2.getByTestId("contract-signed")).toBeVisible({ timeout: 30_000 });
  await cap(p2, "נחתם ✓ הלקוח מקבל עותק PDF במייל — ואתם מקבלים התראה", 4500);
  await keep(c2, p2, "2-customer");

  // ---------- 3. back to the owner ----------
  const c3 = await recorded(browser);
  const p3 = await c3.newPage();
  await loadSession(p3, session!, "/manage/client-documents");
  const signed = p3.getByTestId("signed-documents");
  await expect(signed).toBeVisible();
  await cap(p3, "כל המסמכים החתומים במקום אחד — עם PDF וחיפוש לפי שם, טלפון או אימייל", 4200);
  await signed.getByLabel(/חיפוש — שם הלקוח/).pressSequentially("נועה", { delay: 90 });
  await p3.waitForTimeout(1500);

  await p3.goto(URL_("/manage/events"));
  await expect(p3.getByRole("heading", { level: 1, name: "אירועים" })).toBeVisible();
  await cap(p3, "חדש: אירועים במתחם — מסיבת כלה, בר מצווה, יום הולדת (בלי לינה)", 4200);
  await p3.getByRole("link", { name: "אירוע חדש" }).click();
  await expect(p3).toHaveURL(/\/manage\/events\/new/);
  await p3.getByRole("radio", { name: "לקוח חדש" }).click();
  await p3.getByLabel("שם מלא").pressSequentially("שירה אברהם", { delay: 60 });
  await p3.getByLabel("טלפון").fill("0500000002");
  await p3.getByLabel("תאריך").fill(day(30));
  await p3.getByLabel("משעה", { exact: true }).fill("12:00");
  await p3.getByLabel("עד שעה", { exact: true }).fill("16:00");
  await p3.getByLabel("מספר משתתפים").fill("60");
  await p3.getByTestId("event-conflicts").scrollIntoViewIfNeeded();
  await cap(p3, "המערכת שומרת עליכם: עד 50 משתתפים, ואין שני אירועים באותו זמן", 4600);
  await p3.getByLabel("תאריך").fill(day(33));
  await p3.getByLabel("מספר משתתפים").fill("35");
  await cap(p3, "מתקנים — ושומרים. אחר כך אפשר לשלוח עליו חוזה לחתימה", 4000);
  await cap(p3, "שאלות? אנחנו כאן בשבילכם — Nuriel", 3500);
  await keep(c3, p3, "3-owner");
});
