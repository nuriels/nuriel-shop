import { expect, test } from "@playwright/test";
import { hostGet, hostOf, PORT } from "./helpers";
import {
  asPlatform,
  ensureUser,
  expectAccessible,
  loadSession,
  passwordSession,
  sql,
  type SavedSession,
} from "./hospitality-helpers";

// מסמכים ומדיניות האתר (מיגרציה 60), מקצה לקצה:
//   • בעל העסק: שמונה מסמכים לאתר שלו, הערה שאלה טיוטות לבדיקה, פרטי העסק למסמכים, שמירה ופרסום
//     (גרסה 1), מסמך עם פרטים להשלמה — לא מתפרסם עד שהם הושלמו;
//   • הסדרי הנגישות במתחם — רק עם אישור של בעל המתחם; מופיעים בהצהרת הנגישות אחרי פרסום שלה;
//   • באתר: קישורים בפוטר למסמכים שפורסמו (לא לאחרים), עמוד מסמך עם תאריך עדכון וגרסה, מסמך שלא
//     פורסם — 404;
//   • בהזמנה: תיבת האישור לא מסומנת מראש, קישורים למסמכים, הודעה על עסקת מכר מרחוק; במסד — הגרסאות
//     שהאורח אישר עם ההזמנה; בעמוד ההזמנה בניהול — המסמכים והגרסאות.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "docs.owner@e2e.test", password: "Docs-Owner-Pass-1!" };
const SLUG = "docs-site";
const HOST = hostOf(SLUG);
const URL_ = (path = "/") => `http://${HOST}:${PORT}${path}`;
const GUEST = "docs.guest@e2e.test";
let siteId = "";
let propertyId = "";
let owner: SavedSession | null = null;
const FLAGS = [
  "hospitality_backend_enabled",
  "hospitality_management_enabled",
  "hospitality_frontend_enabled",
  "hospitality_booking_enabled",
] as const;

function cleanup() {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  if (!id) return;
  // אישורי המסמכים של אורחים הם ראיה — נמחקים רק עם האתר כולו (בבדיקה)
  asPlatform(`SELECT public.platform_delete_tenant('${id}', '${SLUG}')`);
}

test.beforeAll(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the documents flow runs once, on the computer");
  cleanup();
  const ownerId = await ensureUser(request, OWNER);
  asPlatform(`SELECT hospitality.admin_open_site('${SLUG}', 'נופי המסמכים', '${OWNER.email}')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
       VALUES ('${siteId}', '${ownerId}', '${OWNER.email}', 'docs_owner', 'admin', true) ON CONFLICT DO NOTHING`);
  sql(
    `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`,
  );
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ${FLAGS.map((f) => `('${siteId}', '${f}', true)`).join(", ")}
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  sql(`UPDATE hospitality.settings SET contact_phone = '050-7654321', check_in_time = '15:00',
              check_out_time = '11:00' WHERE tenant_id = '${siteId}'`);
  propertyId = sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status)
       VALUES ('${siteId}', 'נופי המסמכים', 'docs-p', 'active') RETURNING id`);
  sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price,
                                      min_nights, open_until)
       VALUES ('${siteId}', '${propertyId}', 'unit', 'צימר האלה', 'docs-u1', 4, 2, 700, 1, current_date + 365)`);
  await expect
    .poll(async () => (await hostGet(request, HOST, "/stay")).status(), { timeout: 20_000 })
    .toBe(200);
  owner = await passwordSession(request, URL_(""), OWNER);
});

test.afterAll(() => {
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

/** פתיחת מסמך בעורך, שמירה ופרסום */
async function publish(page: import("@playwright/test").Page, kind: string, title: string) {
  await page
    .locator(`[data-document-row="${kind}"]`)
    .getByRole("button", { name: /עריכה/ })
    .click();
  await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
  await page.getByRole("button", { name: "שמירת טיוטה" }).click();
  await expect(page.getByText("הטיוטה נשמרה").last()).toBeVisible();
  const pub = page.getByRole("button", { name: /^פרסום/ });
  await expect(pub).toBeEnabled({ timeout: 10_000 });
  await pub.click();
  await expect(page.getByText(/פורסם באתר — גרסה \d/).last()).toBeVisible();
  await page.getByRole("button", { name: "לכל המסמכים" }).click();
  await expect(page.locator(`[data-document-row="${kind}"]`)).toContainText("באתר — גרסה");
}

test("the owner: eight documents of this site, drafts for review, the business details, publish; details to fill block publishing", async ({
  page,
}) => {
  await loadSession(page, owner!, "/manage/documents");
  await expect(page.getByRole("heading", { level: 1, name: "מסמכים ומדיניות האתר" })).toBeVisible();
  await expect(page.getByTestId("documents-disclaimer")).toContainText("לא אישור שהאתר עומד בתקן");
  await expect(page.locator("[data-document-row]")).toHaveCount(8);
  await expectAccessible(page, "documents screen");

  await page.getByLabel("שם העוסק / החברה").fill('נופי המסמכים בע"מ');
  await page.getByLabel("מספר עוסק / ח.פ").fill("515555555");
  await page.getByRole("button", { name: "שמירת הפרטים" }).click();
  await expect(page.getByText("פרטי העסק למסמכים נשמרו")).toBeVisible();

  await publish(page, "cancellation", "מדיניות ביטולים והחזרים");
  await publish(page, "booking_terms", "תנאי הזמנה");
  await publish(page, "site_terms", "תקנון שימוש באתר");
  await publish(page, "privacy", "מדיניות פרטיות");

  // תשלומים: יש פרט שרק בעל העסק יודע — הפרסום חסום, וההתראה אומרת מה חסר
  await page
    .locator('[data-document-row="payments"]')
    .getByRole("button", { name: /עריכה/ })
    .click();
  await page.getByRole("button", { name: "שמירת טיוטה" }).click();
  await expect(page.getByText("הטיוטה נשמרה").last()).toBeVisible();
  await expect(page.getByTestId("document-missing")).toContainText("פרטים שרק אתם יודעים");
  await expect(page.getByRole("button", { name: /^פרסום/ })).toBeDisabled();
  await expectAccessible(page, "document editor");
  await page.getByRole("button", { name: "לכל המסמכים" }).click();
  await expect(page.locator('[data-document-row="payments"]')).toContainText("לא מוצג באתר");
});

test("accessibility arrangements: only with the owner's confirmation; the statement shows them once published — no compliance claim", async ({
  page,
  browser,
}) => {
  await loadSession(page, owner!, `/manage/properties/${propertyId}`);
  const card = page.locator('[data-section="accessibility"]');
  await expect(card.getByText("הסדרי נגישות במתחם")).toBeVisible({ timeout: 15_000 });
  const parking = card.getByRole("group", { name: "חניית נכים מסומנת" });
  await parking.getByLabel("יש", { exact: true }).check();
  await card.getByLabel("פירוט (לא חובה)").fill("ליד הכניסה");
  const save = card.getByRole("button", { name: "שמירת הסדרי הנגישות" });
  await expect(save).toBeDisabled();
  await card.getByLabel("אני מאשר/ת שהמידע נמסר על ידי המתחם ושהוא נכון").check();
  await save.click();
  await expect(page.getByText(/הסדרי הנגישות נשמרו/)).toBeVisible();
  expect(
    sql(`SELECT items::text FROM hospitality.property_accessibility WHERE tenant_id = '${siteId}'`),
  ).toBe('{"parking": {"answer": "yes", "details": "ליד הכניסה"}}');

  // ההצהרה: הפרטים שרק בעל העסק יודע — נכתבים במקום הסימונים, ואז פרסום
  await page.goto(URL_("/manage/documents"));
  await page
    .locator('[data-document-row="accessibility"]')
    .getByRole("button", { name: /עריכה/ })
    .click();
  const body = page.getByLabel("הטקסט");
  const text = await body.inputValue();
  await body.fill(text.replace(/\[\[[^\]]*\]\]/g, "האתר טרם נבדק על ידי מורשה נגישות שירות."));
  await page.getByRole("button", { name: "שמירת טיוטה" }).click();
  await expect(page.getByText("הטיוטה נשמרה").last()).toBeVisible();
  await expect(page.getByRole("button", { name: /^פרסום/ })).toBeEnabled({ timeout: 10_000 });
  await page.getByRole("button", { name: /^פרסום/ }).click();
  await expect(page.getByText(/פורסם באתר — גרסה 1/).last()).toBeVisible();

  const visitorContext = await browser.newContext({ locale: "he-IL" });
  const visitor = await visitorContext.newPage();
  await visitor.goto(URL_("/stay/accessibility"));
  await expect(visitor.getByRole("heading", { level: 1, name: "הצהרת נגישות" })).toBeVisible();
  const main = visitor.locator("main");
  await expect(main).toContainText("חניית נכים מסומנת: יש — ליד הכניסה");
  await expect(main).toContainText("טרם נבדק על ידי מורשה נגישות שירות");
  await expect(main).not.toContainText("עומד בתקן");
  await expect(visitor.getByTestId("document-updated")).toContainText("עודכן לאחרונה");
  await expectAccessible(visitor, "accessibility statement");
  await visitorContext.close();
});

test("the site: footer links to the published documents only; a document page with its date and version; an unpublished one is 404", async ({
  page,
  request,
}) => {
  await page.goto(URL_("/stay"));
  const footer = page.getByTestId("footer-documents");
  for (const name of [
    "מדיניות ביטולים והחזרים",
    "תנאי הזמנה",
    "תקנון שימוש באתר",
    "מדיניות פרטיות",
    "הצהרת נגישות",
  ])
    await expect(footer.getByRole("link", { name })).toBeVisible();
  await expect(footer.getByRole("link", { name: "תשלומים והעברות בנקאיות" })).toHaveCount(0);
  await footer.getByRole("link", { name: "מדיניות ביטולים והחזרים" }).click();
  await expect(page).toHaveURL(/\/stay\/docs\/cancellation$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "מדיניות ביטולים והחזרים" }),
  ).toBeVisible();
  await expect(page.getByTestId("document-updated")).toContainText("גרסה 1");
  await expect(page.locator("main")).toContainText("עסקת מכר מרחוק");
  await expect(page.locator("main")).toContainText("אינה גורעת");
  await expectAccessible(page, "document page");
  expect((await hostGet(request, HOST, "/stay/docs/payments")).status()).toBe(404);
});

test("a booking: the consent box starts unchecked, links to the documents, the distance-sale notice; the accepted versions are kept with the booking", async ({
  page,
}) => {
  await page.goto(URL_("/stay/book"));
  await page.getByRole("button", { name: "החודש הבא" }).first().click();
  await page.getByRole("button", { name: "10 — פנוי" }).first().click();
  await page.getByRole("button", { name: "12 — פנוי" }).first().click();
  await page.getByRole("button", { name: "המשך לפרטים" }).click();
  await page.getByLabel("שם מלא").fill("אורחת מסמכים");
  await page.getByLabel("טלפון נייד").fill("0521234571");
  await page.getByLabel("אימייל").first().fill(GUEST);
  const accept = page.getByTestId("accept-terms");
  await expect(accept).not.toBeChecked();
  const docs = page.getByTestId("booking-documents");
  for (const name of [
    "תנאי הזמנה",
    "מדיניות ביטולים והחזרים",
    "תקנון שימוש באתר",
    "מדיניות פרטיות",
  ])
    await expect(docs.getByRole("link", { name: new RegExp(name) })).toHaveAttribute(
      "target",
      "_blank",
    );
  await expect(page.getByTestId("distance-notice")).toContainText("עסקת מכר מרחוק");
  await expectAccessible(page, "booking details with the documents");
  // בלי סימון — אי אפשר לשלוח
  await page.getByRole("button", { name: "שליחת בקשת הזמנה" }).click();
  await expect(page.getByText("יש לאשר את תנאי הביטול ואת מסמכי האתר")).toBeVisible();
  await accept.check();
  await page.getByRole("button", { name: "שליחת בקשת הזמנה" }).click();
  await expect(page).toHaveURL(/\/stay\/booking-received/, { timeout: 20_000 });

  const bookingId =
    sql(`SELECT b.id FROM hospitality.bookings b JOIN hospitality.guests g ON g.id = b.guest_id
                          WHERE b.tenant_id = '${siteId}' AND g.email_normalized = '${GUEST}'`);
  expect(
    sql(`SELECT string_agg(kind || ':' || version || ':' || sale_type, ',' ORDER BY kind)
           FROM hospitality.booking_document_acceptances WHERE booking_id = '${bookingId}'`),
  ).toBe(
    "booking_terms:1:distance,cancellation:1:distance,privacy:1:distance,site_terms:1:distance",
  );

  await loadSession(page, owner!, `/manage/bookings/${bookingId}`);
  const card = page.getByTestId("booking-documents");
  await expect(card).toContainText("עסקת מכר מרחוק", { timeout: 15_000 });
  await expect(card).toContainText("תנאי הזמנה — גרסה 1");
  await expect(card).toContainText("מדיניות פרטיות — גרסה 1");
});
