// ============================================================
// מודול שליחת רישיונות דיגיטליים (פיילוט: חנות אחת) — 13 התרחישים המחייבים, מקצה לקצה:
// הדפדפן (טופס, תצוגה מקדימה, היסטוריה, קבצים, עמוד ההורדה), השרת (קריאות ישירות לפונקציות
// השרת כמו מהדפדפן), המסד, האחסון הפרטי והמייל (Resend מדומה: e2e/scripts/mock-services.mjs).
// קבצי הבדיקה סינתטיים (PDF / EXE מינימליים) — לא קבצים אמיתיים של לקוח.
// ============================================================
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
} from "@playwright/test";
import { fromJSON } from "seroval";
import { A, AUTH, PORT, STORE_A, STORE_B, USERS, hostOf, supabaseEnv } from "./helpers";
import { accessToken, callServerFn, ensureUser, sql } from "./hospitality-helpers";

test.describe.configure({ mode: "serial" });

const FN_FILE = "src/lib/licenses.functions.ts";
const MOCK = "http://127.0.0.1:4010";
const HOST_A = hostOf(STORE_A.slug);
const HOST_B = hostOf(STORE_B.slug);
const RUN = randomBytes(3).toString("hex");
const DISCLAIMER =
  "הרישיון אינו אישי ומיועד להתקנה אחת בלבד. המערכת מזהה התקנות כפולות באופן אוטומטי.";

// ------------------------------------------------------------
// נתוני בדיקה
// ------------------------------------------------------------

const KEY_CHARS = "BCDFGHJKMNPQRTVWXY2346789";
const newKey = () =>
  Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => KEY_CHARS[randomInt(KEY_CHARS.length)]).join(""),
  ).join("-");
const tailOf = (key: string) => key.replace(/-/g, "").slice(-5);
const masked = (key: string) => `•••••-•••••-•••••-•••••-${tailOf(key)}`;

type Customer = { name: string; email: string; phone: string };
// שמות וכתובות ייחודיים לכל הרצה — אפשר להריץ שוב מול אותו מסד מקומי
const customer = (tag: string, name: string): Customer => ({
  name: `${name} ${RUN}`,
  email: `lic-${RUN}-${tag}@e2e.test`,
  phone: "050-123-4567",
});

const pdf = (label: string) =>
  Buffer.from(`%PDF-1.4\n% ${label}\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n`, "latin1");
/** קובץ PE מינימלי (MZ, e_lfanew → "PE\0\0") — לא תוכנה אמיתית */
function exe(label: string): Buffer {
  const b = Buffer.alloc(2048);
  b.write("MZ", 0, "latin1");
  b.writeUInt32LE(0x80, 0x3c);
  b.write("PE\0\0", 0x80, "latin1");
  b.write(`e2e-installer:${label}`, 0x200, "latin1");
  return b;
}
type UploadFile = { name: string; mimeType: string; buffer: Buffer };
// הדפדפן ב-Windows מסמן EXE כ-application/x-msdownload — ההעלאה צריכה לעבוד גם כך
const FILES = {
  officeGuide: {
    name: `Nuriel-Office-Install-Guide-${RUN}.pdf`,
    mimeType: "application/pdf",
    buffer: pdf("office guide"),
  },
  officeV1: {
    name: `NurielOfficeInstaller-${RUN}.exe`,
    mimeType: "application/x-msdownload",
    buffer: exe("office-v1"),
  },
  officeV2: {
    name: `NurielOfficeInstaller-v2-${RUN}.exe`,
    mimeType: "application/x-msdownload",
    buffer: exe("office-v2"),
  },
  windowsGuide: {
    name: `Nuriel-Windows-Install-Guide-${RUN}.pdf`,
    mimeType: "application/pdf",
    buffer: pdf("windows guide"),
  },
  windowsInstaller: {
    name: `NurielWindowsSetup-${RUN}.exe`,
    mimeType: "application/x-msdownload",
    buffer: exe("windows"),
  },
  receipt: {
    name: `receipt-1001-${RUN}.pdf`,
    mimeType: "application/pdf",
    buffer: pdf("receipt 1001"),
  },
  fakeExe: {
    name: `not-really-${RUN}.exe`,
    mimeType: "application/x-msdownload",
    buffer: pdf("a pdf renamed to exe"),
  },
} satisfies Record<string, UploadFile>;

const OFFICE = customer("office", "דנה כהן");
const WINDOWS = customer("windows", "יוסי לוי");
const KEEP = customer("keep", "רות אברהם");
const OFFICE_KEY = newKey();
const WINDOWS_KEY = newKey();
const KEEP_KEY = newKey();

/** מה שנאסף במהלך הבדיקות (רצות לפי הסדר) */
const run = {
  officeToken: "",
  windowsToken: "",
  keepToken: "",
  newOfficeToken: "",
  officeDeliveryId: "",
  officeGuideId: "",
  officeV1Id: "",
  officeV1Path: "",
  keys: [OFFICE_KEY, WINDOWS_KEY, KEEP_KEY] as string[],
};

// ------------------------------------------------------------
// עזרים
// ------------------------------------------------------------

type FnResult<T> = { ok: true; value: T } | { ok: false; message: string };
type SerovalNode = { t: number; s?: { message?: unknown } };
/** צומת seroval בודד (התשובה של השרת היא הצומת עצמו, בלי העטיפה של toJSON) */
const serovalValue = (node: unknown): unknown =>
  fromJSON({ t: node, f: 127, m: [] } as unknown as Parameters<typeof fromJSON>[0]);

/** תשובה של פונקציית שרת (seroval): הערך, או הודעת השגיאה שהשרת זרק */
async function decode<T>(res: APIResponse): Promise<FnResult<T>> {
  const text = await res.text();
  expect(res.status(), text.slice(0, 300)).toBe(200);
  const root = JSON.parse(text) as { p?: { k: string[]; v: SerovalNode[] } };
  const keys = root.p?.k ?? [];
  const error = root.p?.v[keys.indexOf("error")];
  if (error && error.t === 25) {
    const message = error.s?.message;
    return { ok: false, message: message ? String(serovalValue(message)) : "" };
  }
  const decoded = serovalValue(root) as { result: T };
  return { ok: true, value: decoded.result };
}

let ownerA = "";
let ownerB = "";

async function fn<T = unknown>(
  request: APIRequestContext,
  name: string,
  data?: unknown,
  opts: { host?: string; token?: string | null; method?: "GET" | "POST" } = {},
): Promise<FnResult<T>> {
  const token = opts.token === null ? undefined : (opts.token ?? ownerA);
  return decode<T>(
    await callServerFn(request, {
      host: opts.host ?? HOST_A,
      file: FN_FILE,
      name,
      data,
      method: opts.method ?? "POST",
      token,
    }),
  );
}
const ok = <T>(r: FnResult<T>): T => {
  if (!r.ok) throw new Error(`server function failed: ${r.message}`);
  return r.value;
};
const refused = (r: FnResult<unknown>) => (r.ok ? "ok" : r.message);
const moduleState = async (request: APIRequestContext, token: string, host = HOST_A) =>
  ok(
    await fn<{ enabled: boolean; configured?: boolean }>(request, "getLicenseModule", undefined, {
      host,
      token,
      method: "GET",
    }),
  );

type SentEmail = {
  to: string[];
  subject: string;
  html: string;
  attachments?: { filename: string; content: string }[];
};
async function emailsTo(request: APIRequestContext, address: string): Promise<SentEmail[]> {
  const calls = (await (await request.get(`${MOCK}/__calls`)).json()) as {
    method: string;
    url: string;
    body: string;
  }[];
  return calls
    .filter((c) => c.method === "POST" && c.url === "/emails")
    .map((c) => JSON.parse(c.body) as SentEmail)
    .filter((e) => e.to.includes(address));
}
const tokenIn = (html: string) => /\/license-download#([A-Za-z0-9_-]{43})"/.exec(html)?.[1] ?? "";
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const appUrl = (path: string) => `http://127.0.0.1:${PORT}${path}`;
const hostHeaders = (host: string) => ({ host, "x-forwarded-host": host });
async function checkLink(request: APIRequestContext, token: string, host = HOST_A) {
  const res = await request.post(appUrl("/api/license-download/check"), {
    headers: hostHeaders(host),
    data: { token },
  });
  return (await res.json()) as Record<string, unknown>;
}
const downloadFile = (request: APIRequestContext, token: string, host = HOST_A) =>
  request.post(appUrl("/api/license-download/file"), {
    headers: hostHeaders(host),
    form: { token },
    maxRedirects: 0,
  });

async function openPanel(page: Page): Promise<Locator> {
  await page.goto(A("/admin?tab=email"));
  const panel = page.getByTestId("digital-licenses");
  await expect(panel.getByRole("heading", { name: "שליחת רישיון דיגיטלי ללקוח" })).toBeVisible({
    timeout: 20_000,
  });
  return panel;
}

async function fillSendForm(
  page: Page,
  c: Customer,
  key: string,
  opts: { product?: "office" | "windows"; order?: string; business?: string } = {},
) {
  if (opts.product === "windows") await page.locator('label[for="lic-product-windows"]').click();
  await page.locator("#lic-name").fill(c.name);
  await page.locator("#lic-email").fill(c.email);
  await page.locator("#lic-phone").fill(c.phone);
  if (opts.business) await page.locator("#lic-business").fill(opts.business);
  if (opts.order) await page.locator("#lic-order").fill(opts.order);
  // מוקלד כמו שלקוחות שולחים: אותיות קטנות ורווחים — המערכת מסדרת לקבוצות של 5
  await page.locator("#lic-key").fill(key.toLowerCase().replace(/-/g, " "));
}

async function uploadInPanel(panel: Locator, page: Page, inputId: string, file: UploadFile) {
  await page.setInputFiles(`#${inputId}`, file);
  await expect(panel.getByText(file.name, { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
}

/** שליחה דרך השרת (לתרחישים שאינם הטופס עצמו) */
async function sendViaServer(
  request: APIRequestContext,
  c: Customer,
  key: string,
  extra: Record<string, unknown> = {},
) {
  const files = ok(
    await fn<{
      enabled: true;
      files: { id: string; product: string; kind: string; isDefault: boolean }[];
    }>(request, "getLicenseModule", undefined, { method: "GET" }),
  ).files;
  const pick = (kind: string) =>
    files.find((f) => f.product === "office" && f.kind === kind && f.isDefault)?.id ?? null;
  return fn<{ kind: string; deliveryId?: string; status?: string; message?: string }>(
    request,
    "sendLicense",
    {
      idempotencyKey: randomUUID(),
      product: "office",
      customerName: c.name,
      customerEmail: c.email,
      customerPhone: c.phone,
      licenseKey: key,
      guideFileId: pick("guide"),
      installerFileId: pick("installer"),
      ...extra,
    },
  );
}

// ------------------------------------------------------------

test.beforeAll(async ({ request }) => {
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled)
       VALUES ('${STORE_A.id}', 'digital_licenses', true)
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  sql(
    `DELETE FROM public.tenant_feature_flags WHERE tenant_id = '${STORE_B.id}' AND key = 'digital_licenses'`,
  );
  ownerA = await accessToken(request, USERS.ownerA);
  ownerB = await accessToken(request, USERS.ownerB);
  // השרת שומר את מצב הדגל עד 15 שניות
  await expect
    .poll(async () => (await moduleState(request, ownerA)).enabled, {
      timeout: 30_000,
      intervals: [1_000],
    })
    .toBe(true);
});

test.afterAll(() => {
  sql(`UPDATE public.tenant_feature_flags SET enabled = false WHERE key = 'digital_licenses'`);
});

test.describe("digital licenses (pilot)", () => {
  test.use({ storageState: AUTH.ownerA });

  test("#11 pilot + permissions: only the pilot store's admins; staff, customers, other stores and anonymous get nothing", async ({
    request,
  }) => {
    const state = await moduleState(request, ownerA);
    expect(state).toMatchObject({ enabled: true, configured: true });

    // קופאי בחנות הפיילוט — אין הרשאה (רק בעל החנות / מנהל)
    const cashier = { email: `lic-cashier-${RUN}@e2e.test`, password: USERS.ownerA.password };
    await ensureUser(request, cashier);
    sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
         SELECT '${STORE_A.id}', id, email, 'lic_cashier_${RUN}', 'cashier', true
         FROM auth.users WHERE email = '${cashier.email}' ON CONFLICT DO NOTHING`);
    const cashierToken = await accessToken(request, cashier);
    const customerToken = await accessToken(request, USERS.customerA);
    const someId = randomUUID();
    const attempts = (token: string | null, host = HOST_A) => [
      fn(
        request,
        "sendLicense",
        {
          idempotencyKey: randomUUID(),
          product: "office",
          customerName: "x y",
          customerEmail: "x@e2e.test",
          customerPhone: "0501234567",
          licenseKey: newKey(),
        },
        { token, host },
      ),
      fn(request, "listLicenseDeliveries", { page: 0 }, { token, host }),
      fn(request, "revealLicenseKey", { deliveryId: someId }, { token, host }),
      fn(request, "regenerateLicenseLink", { deliveryId: someId }, { token, host }),
      fn(
        request,
        "createLicenseUpload",
        { product: "office", kind: "guide", fileName: "a.pdf", size: 100 },
        { token, host },
      ),
      fn(request, "setDefaultLicenseFile", { fileId: someId }, { token, host }),
    ];

    for (const token of [cashierToken, customerToken]) {
      expect(await moduleState(request, token)).toEqual({ enabled: false });
      for (const r of await Promise.all(attempts(token)))
        expect(refused(r)).toBe("אין לך הרשאה מתאימה");
    }
    // בלי חיבור
    for (const r of await Promise.all(attempts(null))) expect(refused(r)).toMatch(/Unauthorized/);
    // חנות אחרת (הפיילוט כבוי בה) — גם המנהל שלה לא רואה ולא יכול
    expect(await moduleState(request, ownerB, HOST_B)).toEqual({ enabled: false });
    for (const r of await Promise.all(attempts(ownerB, HOST_B))) {
      expect(refused(r)).toBe("הפעולה אינה זמינה בחנות זו");
    }
    // עמוד ההורדה בחנות אחרת — "לא נמצא"
    expect((await checkLink(request, "a".repeat(43), HOST_B))["state"]).toBe("not_found");
  });

  test("files: the owner uploads default files per product; the server checks the real type; storage stays private", async ({
    page,
    request,
  }) => {
    const panel = await openPanel(page);
    await panel.getByRole("tab", { name: "קבצי ברירת מחדל" }).click();
    await uploadInPanel(panel, page, "lic-upload-office-guide", FILES.officeGuide);
    await uploadInPanel(panel, page, "lic-upload-office-installer", FILES.officeV1);
    await uploadInPanel(panel, page, "lic-upload-windows-guide", FILES.windowsGuide);
    await uploadInPanel(panel, page, "lic-upload-windows-installer", FILES.windowsInstaller);
    await expect(panel.getByText("ברירת מחדל", { exact: true })).toHaveCount(4);

    // בדפדפן: קובץ PDF ששמו שונה ל-.exe נדחה לפני העלאה
    await page.setInputFiles("#lic-upload-office-installer", FILES.fakeExe);
    await expect(page.getByText("הקובץ אינו תוכנת Windows (EXE) תקינה").first()).toBeVisible();
    await expect(panel.getByText(FILES.fakeExe.name)).toHaveCount(0);

    // בשרת: גם אם עוקפים את הדפדפן ומעלים ישירות — הרישום בודק את הקובץ האמיתי, מוחק ומתעד
    const upload = ok(
      await fn<{ path: string; token: string; contentType: string }>(
        request,
        "createLicenseUpload",
        {
          product: "office",
          kind: "installer",
          fileName: "bypass.exe",
          size: FILES.fakeExe.buffer.length,
        },
      ),
    );
    expect(upload.path).toMatch(new RegExp(`^${STORE_A.id}/[0-9a-f-]{36}\\.exe$`));
    const { url, anonKey } = supabaseEnv();
    const put = await request.put(
      `${url}/storage/v1/object/upload/sign/license-files/${upload.path}?token=${upload.token}`,
      {
        headers: { apikey: anonKey, "content-type": upload.contentType, "x-upsert": "false" },
        data: FILES.fakeExe.buffer,
      },
    );
    expect(put.ok(), await put.text()).toBe(true);
    const registered = await fn(request, "registerLicenseFile", {
      path: upload.path,
      product: "office",
      kind: "installer",
      fileName: "bypass.exe",
      makeDefault: true,
    });
    expect(refused(registered)).toBe("הקובץ אינו תוכנת Windows (EXE) תקינה");
    expect(
      sql(
        `SELECT count(*) FROM storage.objects WHERE bucket_id = 'license-files' AND name = '${upload.path}'`,
      ),
    ).toBe("0");
    expect(
      Number(
        sql(
          `SELECT count(*) FROM public.license_audit WHERE tenant_id = '${STORE_A.id}' AND action = 'file_rejected'`,
        ),
      ),
    ).toBeGreaterThan(0);
    // נתיב שלא בתיקיית החנות / לא מהסוג הנכון — נדחה
    expect(
      refused(
        await fn(request, "registerLicenseFile", {
          path: `${STORE_B.id}/${randomUUID()}.exe`,
          product: "office",
          kind: "installer",
          fileName: "x.exe",
        }),
      ),
    ).toBe("נתיב קובץ לא תקין");

    // האחסון פרטי: אין גישה ישירה — לא אנונימית, לא עם חיבור של המנהל, לא דרך כתובת ציבורית
    const v1 = sql(
      `SELECT id || '|' || storage_path FROM public.license_files WHERE tenant_id = '${STORE_A.id}' AND file_name = '${FILES.officeV1.name}'`,
    ).split("|");
    run.officeV1Id = v1[0]!;
    run.officeV1Path = v1[1]!;
    run.officeGuideId = sql(
      `SELECT id FROM public.license_files WHERE tenant_id = '${STORE_A.id}' AND file_name = '${FILES.officeGuide.name}'`,
    );
    for (const headers of [
      { apikey: anonKey },
      { apikey: anonKey, authorization: `Bearer ${ownerA}` },
    ]) {
      const direct = await request.get(
        `${url}/storage/v1/object/license-files/${run.officeV1Path}`,
        { headers },
      );
      expect(direct.status(), "private object must not be readable directly").not.toBe(200);
    }
    const pub = await request.get(
      `${url}/storage/v1/object/public/license-files/${run.officeV1Path}`,
    );
    expect(pub.status()).not.toBe(200);
  });

  test("#1 #3 #4 #12 #13 Office from the form: validation, full preview, one email on a double click, PDF guide + receipt attached", async ({
    page,
    request,
  }) => {
    const panel = await openPanel(page);
    const key = page.locator("#lic-key");
    await expect(key).toHaveAttribute("type", "password"); // המפתח מוסתר כברירת מחדל
    await expect(panel.getByText(DISCLAIMER, { exact: true })).toBeVisible();

    // בדיקת תקינות לפני תצוגה מקדימה
    await fillSendForm(page, { ...OFFICE, email: "dana@" }, OFFICE_KEY, {
      order: "E2E-1001",
      business: "123456782",
    });
    await panel.getByRole("button", { name: "תצוגה מקדימה לפני שליחה" }).click();
    await expect(panel.getByText("כתובת האימייל אינה תקינה")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator("#lic-email").fill(OFFICE.email);
    await page.setInputFiles("#lic-receipt", FILES.receipt);
    await expect(panel.getByText(FILES.receipt.name)).toBeVisible();

    await panel.getByRole("button", { name: "תצוגה מקדימה לפני שליחה" }).click();
    const dialog = page.getByRole("dialog", { name: "תצוגה מקדימה — לפני השליחה" });
    await expect(dialog).toBeVisible();
    await expect(key).toHaveValue(OFFICE_KEY); // סודר לקבוצות של 5
    await expect(dialog.getByText(OFFICE.email)).toBeVisible();
    await expect(dialog.getByText(masked(OFFICE_KEY))).toBeVisible();
    await expect(dialog).not.toContainText(OFFICE_KEY);
    await expect(dialog.getByText(`${FILES.officeGuide.name} (`)).toBeVisible();
    await expect(dialog.getByText(`${FILES.receipt.name} (`)).toBeVisible();
    await expect(dialog.getByText("קישור אישי ייווצר בשליחה", { exact: false })).toBeVisible();
    const frame = page.frameLocator('iframe[title="תצוגה מקדימה של מייל הרישיון"]');
    await expect(frame.getByRole("heading", { name: "הרישיון הדיגיטלי שלך מוכן!" })).toBeVisible();
    await expect(frame.getByText(masked(OFFICE_KEY))).toBeVisible();
    await expect(frame.getByText(DISCLAIMER, { exact: false })).toBeVisible();
    await expect(frame.getByText("להורדת תוכנת ההתקנה", { exact: false })).toBeVisible();
    // תצוגת נייד
    await dialog.getByRole("button", { name: "נייד" }).click();
    const iframe = dialog.locator('iframe[data-device="mobile"]');
    await expect(iframe).toBeVisible();
    await expect
      .poll(async () => (await iframe.boundingBox())?.width ?? 0)
      .toBeLessThanOrEqual(376);
    await dialog.getByRole("button", { name: "מחשב" }).click();

    // לחיצה כפולה — מייל אחד בלבד
    await dialog.getByRole("button", { name: "שליחת הרישיון ללקוח" }).dblclick();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    const result = panel.getByRole("status").filter({ hasText: `הרישיון נשלח ל${OFFICE.name}` });
    await expect(result).toBeVisible();
    // סטטוס אמיתי: קודם "התקבל לשליחה"; "נמסר" רק אחרי שהספק אישר מסירה (בדיקה אוטומטית)
    await expect(result.getByText("התקבל לשליחה", { exact: true })).toBeVisible();
    await expect(result.getByText("נמסר", { exact: true })).toBeVisible({ timeout: 25_000 });
    // הטופס התאפס — אין שליחה שנייה בטעות
    await expect(page.locator("#lic-name")).toHaveValue("");
    await expect(page.locator("#lic-key")).toHaveValue("");

    await page.waitForTimeout(1_000);
    const emails = await emailsTo(request, OFFICE.email);
    expect(emails).toHaveLength(1);
    const email = emails[0]!;
    expect(email.subject).toBe("הרישיון הדיגיטלי שלך מוכן! — Microsoft Office");
    expect(email.html).toContain(OFFICE_KEY);
    expect(email.html).toContain(DISCLAIMER);
    expect(email.html).toContain(`שלום ${OFFICE.name}`);
    expect(email.html).toContain("E2E-1001");
    expect(email.html).toContain("&#11015;&#65039; להורדת תוכנת ההתקנה");
    // #3 + #4: מדריך ההתקנה וקבלה מצורפים (התוכן עצמו), תוכנת ההתקנה — לא מצורפת
    const attachments = email.attachments ?? [];
    expect(attachments.map((a) => a.filename)).toEqual([
      FILES.officeGuide.name,
      FILES.receipt.name,
    ]);
    expect(Buffer.from(attachments[0]!.content, "base64").equals(FILES.officeGuide.buffer)).toBe(
      true,
    );
    expect(Buffer.from(attachments[1]!.content, "base64").equals(FILES.receipt.buffer)).toBe(true);
    expect(attachments.some((a) => a.filename.endsWith(".exe"))).toBe(false);
    run.officeToken = tokenIn(email.html);
    expect(run.officeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    run.officeDeliveryId = sql(
      `SELECT id FROM public.license_deliveries WHERE tenant_id = '${STORE_A.id}' AND customer_email = '${OFFICE.email}'`,
    );
    expect(
      sql(
        `SELECT email_status FROM public.license_deliveries WHERE id = '${run.officeDeliveryId}'`,
      ),
    ).toBe("delivered");
  });

  test("#2 #4 Windows from the form, without a receipt", async ({ page, request }) => {
    const panel = await openPanel(page);
    await fillSendForm(page, WINDOWS, WINDOWS_KEY, { product: "windows" });
    await expect(panel.getByText("מפתח מוצר Windows (Product Key)")).toBeVisible();
    await panel.getByRole("button", { name: "תצוגה מקדימה לפני שליחה" }).click();
    const dialog = page.getByRole("dialog", { name: "תצוגה מקדימה — לפני השליחה" });
    await expect(dialog.getByText("Microsoft Windows", { exact: true })).toBeVisible();
    await expect(dialog.getByText(`${FILES.windowsGuide.name} (`)).toBeVisible();
    await dialog.getByRole("button", { name: "שליחת הרישיון ללקוח" }).click();
    await expect(
      panel.getByRole("status").filter({ hasText: `הרישיון נשלח ל${WINDOWS.name}` }),
    ).toBeVisible({
      timeout: 20_000,
    });

    const emails = await emailsTo(request, WINDOWS.email);
    expect(emails).toHaveLength(1);
    expect(emails[0]!.subject).toBe("הרישיון הדיגיטלי שלך מוכן! — Microsoft Windows");
    expect(emails[0]!.html).toContain(WINDOWS_KEY);
    expect((emails[0]!.attachments ?? []).map((a) => a.filename)).toEqual([
      FILES.windowsGuide.name,
    ]);
    run.windowsToken = tokenIn(emails[0]!.html);
    expect(run.windowsToken).not.toBe("");
  });

  test("#5 the customer downloads the installer from the email link", async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext({ acceptDownloads: true }); // הלקוח — בלי חיבור
    const page = await context.newPage();
    await page.goto(A(`/license-download#${run.officeToken}`));
    await expect(page.getByRole("heading", { name: "הורדת תוכנת ההתקנה" })).toBeVisible();
    await expect(page.getByText(FILES.officeV1.name)).toBeVisible();
    await expect(page.getByText("3 מתוך 3")).toBeVisible();
    // ה-Token לא נשאר בשורת הכתובת
    expect(page.url()).not.toContain(run.officeToken);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "להורדת תוכנת ההתקנה" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(FILES.officeV1.name);
    expect(readFileSync(await download.path()).equals(FILES.officeV1.buffer)).toBe(true);
    await expect(page.getByText("2 מתוך 3")).toBeVisible({ timeout: 15_000 });

    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
    await context.close();

    // כותרות ההורדה: קובץ מצורף, בלי מטמון, בלי זיהוי תוכן
    const res = await downloadFile(request, run.officeToken);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain(`filename="${FILES.officeV1.name}"`);
    expect(res.headers()["content-type"]).toBe("application/vnd.microsoft.portable-executable");
    expect(res.headers()["cache-control"]).toContain("no-store");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect((await res.body()).equals(FILES.officeV1.buffer)).toBe(true);
  });

  test("#7 blocked after 3 downloads", async ({ browser, request }) => {
    expect((await downloadFile(request, run.officeToken)).status()).toBe(200); // ההורדה השלישית
    const fourth = await downloadFile(request, run.officeToken);
    expect(fourth.status()).toBe(303);
    expect(fourth.headers()["location"]).toBe("/license-download?e=exhausted");
    expect(await checkLink(request, run.officeToken)).toMatchObject({
      state: "exhausted",
      remaining: 0,
    });
    expect(
      sql(
        `SELECT download_count FROM public.license_download_links WHERE token_hash = '${sha256(run.officeToken)}'`,
      ),
    ).toBe("3");
    expect(
      Number(
        sql(`SELECT count(*) FROM public.license_audit a JOIN public.license_download_links l ON l.id = a.link_id
             WHERE l.token_hash = '${sha256(run.officeToken)}' AND a.action = 'download_denied'`),
      ),
    ).toBeGreaterThan(0);

    const page = await (await browser.newContext()).newPage();
    await page.goto(A(`/license-download#${run.officeToken}`));
    await expect(page.getByText("נוצלו כל ההורדות של הקישור")).toBeVisible();
    await expect(page.getByRole("button", { name: "להורדת תוכנת ההתקנה" })).toHaveCount(0);
    await page.context().close();
  });

  test("#6 blocked after 7 days", async ({ browser, request }) => {
    expect((await checkLink(request, run.windowsToken))["state"]).toBe("valid");
    // שמונה ימים אחרי יצירת הקישור
    sql(`UPDATE public.license_download_links
         SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
         WHERE token_hash = '${sha256(run.windowsToken)}'`);
    expect((await checkLink(request, run.windowsToken))["state"]).toBe("expired");
    const res = await downloadFile(request, run.windowsToken);
    expect(res.status()).toBe(303);
    expect(res.headers()["location"]).toBe("/license-download?e=expired");
    expect(
      sql(
        `SELECT download_count FROM public.license_download_links WHERE token_hash = '${sha256(run.windowsToken)}'`,
      ),
    ).toBe("0");

    const page = await (await browser.newContext()).newPage();
    await page.goto(A(`/license-download#${run.windowsToken}`));
    await expect(page.getByText("תוקף הקישור הסתיים")).toBeVisible();
    await page.context().close();
  });

  test("#8 a new link from the history; replacing the installer does not break links already sent", async ({
    page,
    request,
  }) => {
    // לקוח נוסף מקבל קישור לגרסה 1, ואז מעלים גרסה 2 כברירת מחדל ומסירים את גרסה 1
    ok(await sendViaServer(request, KEEP, KEEP_KEY));
    run.keepToken = tokenIn((await emailsTo(request, KEEP.email))[0]!.html);
    const panel = await openPanel(page);
    await panel.getByRole("tab", { name: "קבצי ברירת מחדל" }).click();
    const filesTab = panel.getByRole("tabpanel", { name: "קבצי ברירת מחדל" });
    await uploadInPanel(filesTab, page, "lic-upload-office-installer", FILES.officeV2);
    const v1Row = filesTab.getByRole("listitem").filter({ hasText: FILES.officeV1.name });
    await v1Row.getByRole("button", { name: "הסרה מהרשימה" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "הסרה" }).click();
    await expect(filesTab.getByText(FILES.officeV1.name)).toHaveCount(0);
    // הקישור שכבר נשלח ממשיך להוריד את הגרסה שנשלחה
    const keep = await downloadFile(request, run.keepToken);
    expect(keep.status()).toBe(200);
    expect((await keep.body()).equals(FILES.officeV1.buffer)).toBe(true);

    // קישור חדש ללקוח שניצל את כל ההורדות — מההיסטוריה
    await panel.getByRole("tab", { name: "היסטוריה" }).click();
    await panel.getByLabel("חיפוש").fill(OFFICE.email);
    await panel
      .getByRole("row")
      .filter({ hasText: OFFICE.name })
      .getByRole("button", { name: "פרטים" })
      .click();
    const details = page.getByRole("dialog", { name: `רישיון Office — ${OFFICE.name}` });
    await expect(details.getByText("נוצלו כל ההורדות", { exact: true }).first()).toBeVisible();
    await details.getByRole("button", { name: "יצירת קישור הורדה חדש" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "יצירת קישור" }).click();
    const box = details.locator("input[readonly]");
    await expect(box).toHaveValue(/\/license-download#[A-Za-z0-9_-]{43}$/);
    run.newOfficeToken = (await box.inputValue()).split("#")[1]!;
    await expect(details.getByText("פעיל", { exact: true })).toBeVisible();

    expect(await checkLink(request, run.newOfficeToken)).toMatchObject({
      state: "valid",
      remaining: 3,
      fileName: FILES.officeV2.name, // הקישור החדש — לגרסה הנוכחית
    });
    expect((await checkLink(request, run.officeToken))["state"]).toBe("revoked");
    const fresh = await downloadFile(request, run.newOfficeToken);
    expect((await fresh.body()).equals(FILES.officeV2.buffer)).toBe(true);
    // קישור חדש מתועד
    expect(
      Number(
        sql(
          `SELECT count(*) FROM public.license_audit WHERE delivery_id = '${run.officeDeliveryId}' AND action = 'link_created'`,
        ),
      ),
    ).toBe(2);

    // שליחה חוזרת במייל (ללקוח שהקישור שלו פג) — קישור חדש, הקודם מבוטל
    const windowsId = sql(
      `SELECT id FROM public.license_deliveries WHERE tenant_id = '${STORE_A.id}' AND customer_email = '${WINDOWS.email}'`,
    );
    expect(
      ok(await fn<{ status: string }>(request, "resendLicenseEmail", { deliveryId: windowsId }))
        .status,
    ).toBe("accepted");
    const windowsEmails = await emailsTo(request, WINDOWS.email);
    expect(windowsEmails).toHaveLength(2);
    const resent = tokenIn(windowsEmails[1]!.html);
    expect((await checkLink(request, resent))["state"]).toBe("valid");
    expect((await checkLink(request, run.windowsToken))["state"]).toBe("revoked");
    expect(windowsEmails[1]!.html).toContain(WINDOWS_KEY);
  });

  test("#9 wrong, malformed and replaced tokens", async ({ browser, request }) => {
    const random = randomBytes(32).toString("base64url");
    expect(await checkLink(request, random)).toMatchObject({ state: "not_found" });
    for (const bad of ["abc", `${"a".repeat(42)}$`, "", "../../etc/passwd"]) {
      expect((await checkLink(request, bad))["state"]).toBe("not_found");
    }
    const res = await downloadFile(request, random);
    expect(res.status()).toBe(303);
    expect(res.headers()["location"]).toBe("/license-download?e=not_found");

    // תשובת הבדיקה לקישור תקין — בלי נתיבים פנימיים ובלי מזהים
    const valid = await checkLink(request, run.newOfficeToken);
    expect(Object.keys(valid).sort()).toEqual(
      [
        "expiresAt",
        "fileName",
        "maxDownloads",
        "product",
        "remaining",
        "sizeBytes",
        "state",
        "store",
      ].sort(),
    );
    const link = sql(
      `SELECT id || '|' || delivery_id || '|' || file_id FROM public.license_download_links WHERE token_hash = '${sha256(run.newOfficeToken)}'`,
    ).split("|");
    for (const internal of [...link, sha256(run.newOfficeToken), "license-files", "storage_path"]) {
      expect(JSON.stringify(valid)).not.toContain(internal);
    }

    // כל מקרה בלשונית חדשה (ה-Token נשמר ב-sessionStorage של הלשונית)
    const context = await browser.newContext();
    for (const [hash, message] of [
      [random, "הקישור אינו תקין"],
      ["short", "הקישור אינו תקין"],
      ["", "הקישור אינו תקין"],
      [run.officeToken, "הקישור הוחלף"],
    ] as const) {
      const page = await context.newPage();
      await page.goto(A(hash ? `/license-download#${hash}` : "/license-download"));
      await expect(page.getByText(message)).toBeVisible();
      await expect(page.getByRole("button", { name: "להורדת תוכנת ההתקנה" })).toHaveCount(0);
      await page.close();
    }
    await context.close();
  });

  test("#10 cross-tenant: another store's host, admin and storage cannot reach this store's licenses", async ({
    request,
  }) => {
    // גם כשהפיילוט פעיל בחנות השנייה
    sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES ('${STORE_B.id}', 'digital_licenses', true)
         ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
    try {
      await expect
        .poll(async () => (await moduleState(request, ownerB, HOST_B)).enabled, {
          timeout: 30_000,
          intervals: [1_000],
        })
        .toBe(true);

      // קישור של חנות A דרך הכתובת של חנות B
      expect((await checkLink(request, run.newOfficeToken, HOST_B))["state"]).toBe("not_found");
      const res = await downloadFile(request, run.newOfficeToken, HOST_B);
      expect(res.status()).toBe(303);
      expect(res.headers()["location"]).toBe("/license-download?e=not_found");
      expect(await checkLink(request, run.newOfficeToken)).toMatchObject({
        state: "valid",
        remaining: 2,
      }); // לא נוצל

      // המנהל של חנות B — לא רואה ולא נוגע
      const list = ok(
        await fn<{ total: number }>(
          request,
          "listLicenseDeliveries",
          { page: 0 },
          { token: ownerB, host: HOST_B },
        ),
      );
      expect(list.total).toBe(0);
      const as = (name: string, data: unknown) =>
        fn(request, name, data, { token: ownerB, host: HOST_B });
      expect(refused(await as("getLicenseDelivery", { id: run.officeDeliveryId }))).toBe(
        "השליחה לא נמצאה",
      );
      expect(refused(await as("revealLicenseKey", { deliveryId: run.officeDeliveryId }))).toBe(
        "השליחה לא נמצאה",
      );
      expect(refused(await as("resendLicenseEmail", { deliveryId: run.officeDeliveryId }))).toBe(
        "השליחה לא נמצאה",
      );
      const linkId = sql(
        `SELECT id FROM public.license_download_links WHERE token_hash = '${sha256(run.newOfficeToken)}'`,
      );
      expect(refused(await as("revokeLicenseLink", { linkId }))).toBe(
        "הקישור לא נמצא או שכבר בוטל",
      );
      expect(refused(await as("archiveLicenseFile", { fileId: run.officeGuideId }))).toBe(
        "הקובץ לא נמצא",
      );
      expect(refused(await as("setDefaultLicenseFile", { fileId: run.officeGuideId }))).not.toBe(
        "ok",
      );
      expect(
        refused(
          await as("sendLicense", {
            idempotencyKey: randomUUID(),
            product: "office",
            customerName: "x y",
            customerEmail: `lic-${RUN}-cross@e2e.test`,
            customerPhone: "0501234567",
            licenseKey: newKey(),
            guideFileId: run.officeGuideId,
          }),
        ),
      ).toMatch(/לא נמצא או אינו מתאים/);
      expect(
        refused(
          await as("registerLicenseFile", {
            path: run.officeV1Path,
            product: "office",
            kind: "installer",
            fileName: "x.exe",
          }),
        ),
      ).toBe("נתיב קובץ לא תקין");
      // המנהל של חנות A בכתובת של חנות B — החשבון שייך לחנות אחרת: נחסם כבר בשכבת ההזדהות
      const crossOwner = await fn<{ enabled: boolean }>(request, "getLicenseModule", undefined, {
        host: HOST_B,
        token: ownerA,
        method: "GET",
      });
      expect(crossOwner.ok ? JSON.stringify(crossOwner.value) : crossOwner.message).toMatch(
        /account belongs to another store|"enabled":false/,
      );

      // האחסון: החיבור של חנות B לא קורא קבצים של חנות A
      const { url, anonKey } = supabaseEnv();
      const direct = await request.get(
        `${url}/storage/v1/object/license-files/${run.officeV1Path}`,
        {
          headers: { apikey: anonKey, authorization: `Bearer ${ownerB}` },
        },
      );
      expect(direct.status()).not.toBe(200);
      expect(
        sql(`SELECT count(*) FROM public.license_deliveries WHERE tenant_id = '${STORE_B.id}'`),
      ).toBe("0");
    } finally {
      sql(
        `UPDATE public.tenant_feature_flags SET enabled = false WHERE tenant_id = '${STORE_B.id}' AND key = 'digital_licenses'`,
      );
    }
  });

  test("#12 double send: the same send is never repeated; a key that was already sent needs confirmation", async ({
    page,
    request,
  }) => {
    // אותה בקשה פעמיים (מפתח idempotency זהה) — מייל אחד, התשובה השנייה "כבר בוצע"
    const twice = customer("twice", "משה ישראלי");
    const twiceKey = newKey();
    run.keys.push(twiceKey);
    const idem = randomUUID();
    const first = ok(await sendViaServer(request, twice, twiceKey, { idempotencyKey: idem }));
    const second = ok(await sendViaServer(request, twice, twiceKey, { idempotencyKey: idem }));
    expect(first.kind).toBe("sent");
    expect(second).toMatchObject({ kind: "replayed", deliveryId: first.deliveryId });
    expect(await emailsTo(request, twice.email)).toHaveLength(1);

    // אותו מפתח ללקוח אחר — נדרש אישור מפורש
    const other = customer("dup", "שרה כהן");
    const dup = ok(await sendViaServer(request, other, twiceKey));
    expect(dup.kind).toBe("duplicate");
    expect(dup.message).toContain("כבר נשלח");
    expect(await emailsTo(request, other.email)).toHaveLength(0);

    // בטופס: חלון אישור; "ביטול" — לא נשלח כלום
    const panel = await openPanel(page);
    await fillSendForm(page, other, twiceKey);
    await panel.getByRole("button", { name: "תצוגה מקדימה לפני שליחה" }).click();
    await page
      .getByRole("dialog", { name: "תצוגה מקדימה — לפני השליחה" })
      .getByRole("button", { name: "שליחת הרישיון ללקוח" })
      .click();
    const confirm = page.getByRole("alertdialog", { name: "המפתח הזה כבר נשלח" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "ביטול" }).click();
    await expect(confirm).toBeHidden();
    expect(await emailsTo(request, other.email)).toHaveLength(0);
    // אישור מפורש — נשלח פעם אחת
    await page
      .getByRole("dialog", { name: "תצוגה מקדימה — לפני השליחה" })
      .getByRole("button", { name: "שליחת הרישיון ללקוח" })
      .click();
    await page
      .getByRole("alertdialog", { name: "המפתח הזה כבר נשלח" })
      .getByRole("button", { name: "כן, לשלוח שוב" })
      .click();
    await expect(
      panel.getByRole("status").filter({ hasText: `הרישיון נשלח ל${other.name}` }),
    ).toBeVisible({ timeout: 20_000 });
    expect(await emailsTo(request, other.email)).toHaveLength(1);
  });

  test("#13 the sent email renders well on desktop and mobile", async ({
    browser,
    request,
  }, testInfo) => {
    const html = (await emailsTo(request, OFFICE.email))[0]!.html;
    for (const [name, viewport] of [
      ["desktop", { width: 1280, height: 900 }],
      ["mobile", { width: 375, height: 812 }],
    ] as const) {
      const context = await browser.newContext({ viewport, isMobile: name === "mobile" });
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: "load" });
      const metrics = await page.evaluate(() => ({
        dir: document.documentElement.dir,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      }));
      expect(metrics.dir).toBe("rtl");
      expect(metrics.overflow, `${name}: no horizontal scroll`).toBeLessThanOrEqual(1);
      for (const target of [
        page.getByText(OFFICE_KEY, { exact: true }),
        page.getByRole("link", { name: /להורדת תוכנת ההתקנה/ }),
        page.getByText(DISCLAIMER, { exact: false }),
      ]) {
        await expect(target).toBeVisible();
        const box = (await target.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      }
      const keySize = await page
        .getByText(OFFICE_KEY, { exact: true })
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(keySize).toBeGreaterThanOrEqual(18);
      await testInfo.attach(`license-email-${name}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
      await context.close();
    }
  });

  test("history: no full keys in lists; revealing a key is audited with who and when; honest statuses", async ({
    page,
    request,
  }) => {
    // הספק דוחה / מחזיר bounce — אף פעם לא "נמסר"
    const rejected = customer("reject", "לקוח נדחה");
    rejected.email = `lic-${RUN}+reject@e2e.test`;
    const bounced = customer("bounce", "לקוח חוזר");
    bounced.email = `lic-${RUN}+bounce@e2e.test`;
    const rejectedKey = newKey();
    const bouncedKey = newKey();
    run.keys.push(rejectedKey, bouncedKey);
    expect(ok(await sendViaServer(request, rejected, rejectedKey))).toMatchObject({
      kind: "sent",
      status: "failed",
    });
    const b = ok(await sendViaServer(request, bounced, bouncedKey));
    expect(b).toMatchObject({ kind: "sent", status: "accepted" });
    expect(
      ok(
        await fn<{ status: string }>(request, "refreshLicenseStatus", { deliveryId: b.deliveryId }),
      ).status,
    ).toBe("failed");

    const listRaw = await (
      await callServerFn(request, {
        host: HOST_A,
        file: FN_FILE,
        name: "listLicenseDeliveries",
        data: { page: 0 },
        token: ownerA,
      })
    ).text();
    for (const key of run.keys) {
      expect(listRaw).not.toContain(key);
      expect(listRaw).not.toContain(key.replace(/-/g, ""));
    }

    const panel = await openPanel(page);
    await panel.getByRole("tab", { name: "היסטוריה" }).click();
    for (const column of [
      "לקוח",
      "אימייל",
      "טלפון",
      "מוצר",
      "הזמנה",
      "תאריך שליחה",
      "סטטוס מייל",
      "קישור",
      "הורדות",
    ]) {
      await expect(panel.getByRole("columnheader", { name: column, exact: true })).toBeVisible();
    }
    const rejectedRow = panel.getByRole("row").filter({ hasText: rejected.name });
    await expect(rejectedRow.getByText("נכשל", { exact: true })).toBeVisible();
    await expect(
      panel.getByRole("row").filter({ hasText: bounced.name }).getByText("נכשל", { exact: true }),
    ).toBeVisible();
    const officeRow = panel.getByRole("row").filter({ hasText: OFFICE.name });
    await expect(officeRow.getByText("נמסר", { exact: true })).toBeVisible();
    await expect(officeRow.getByText("1 / 3")).toBeVisible(); // הקישור החדש: הורדה אחת
    await expect(panel).not.toContainText(OFFICE_KEY);

    await officeRow.getByRole("button", { name: "פרטים" }).click();
    const details = page.getByRole("dialog", { name: `רישיון Office — ${OFFICE.name}` });
    await expect(details.getByText(masked(OFFICE_KEY))).toBeVisible();
    await expect(details).not.toContainText(OFFICE_KEY);
    await details.getByRole("button", { name: "הצגת המפתח המלא" }).click();
    await expect(details.getByText(OFFICE_KEY, { exact: true })).toBeVisible();
    await expect(details.getByText("צפייה במפתח המלא").first()).toBeVisible();
    await expect(details.getByText("owner_a", { exact: false }).first()).toBeVisible();
    expect(
      sql(`SELECT count(*) FROM public.license_audit WHERE delivery_id = '${run.officeDeliveryId}'
           AND action = 'reveal_key' AND actor_id = '${USERS.ownerA.id}'`),
    ).toBe("1");
    await details.getByRole("button", { name: "הסתרה" }).click();
    await expect(details).not.toContainText(OFFICE_KEY);

    // הסמן נשאר על הכפתור שנלחץ — מזיזים אותו כדי למדוד את המצב הרגיל (לא hover)
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    const axe = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
    ).toEqual([]);
  });

  test("@mobile the panel, the full preview and the download page fit a phone screen", async ({
    page,
  }) => {
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const width = page.viewportSize()?.width ?? 0;
    const panel = await openPanel(page);
    expect(await overflow()).toBeLessThanOrEqual(1);

    await fillSendForm(page, customer("mobile", "לקוח נייד"), newKey());
    await panel.getByRole("button", { name: "תצוגה מקדימה לפני שליחה" }).click();
    const dialog = page.getByRole("dialog", { name: "תצוגה מקדימה — לפני השליחה" });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    const frame = page.frameLocator('iframe[title="תצוגה מקדימה של מייל הרישיון"]');
    await expect(frame.getByRole("heading", { name: "הרישיון הדיגיטלי שלך מוכן!" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "שליחת הרישיון ללקוח" })).toBeVisible();
    await dialog.getByRole("button", { name: "חזרה לעריכה" }).click();
    await expect(dialog).toBeHidden();

    await panel.getByRole("tab", { name: "היסטוריה" }).click();
    await expect(panel.getByLabel("חיפוש")).toBeVisible();
    if (width < 768) await expect(panel.getByRole("table")).toBeHidden(); // בנייד — כרטיסים
    expect(await overflow()).toBeLessThanOrEqual(1);

    await page.goto(A(`/license-download#${randomBytes(32).toString("base64url")}`));
    await expect(page.getByText("הקישור אינו תקין")).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(1);
  });

  test("secrets: no license key or download token is stored in plain text anywhere", async ({
    request,
  }) => {
    const tokens = [run.officeToken, run.windowsToken, run.keepToken, run.newOfficeToken];
    for (const email of [OFFICE.email, WINDOWS.email, KEEP.email]) {
      for (const e of await emailsTo(request, email)) tokens.push(tokenIn(e.html));
    }
    const needles = [
      ...run.keys,
      ...run.keys.map((k) => k.replace(/-/g, "")),
      ...tokens.filter(Boolean),
    ];
    expect(needles.length).toBeGreaterThan(10);
    const rows = `SELECT row_to_json(t)::text AS j FROM public.license_deliveries t
        UNION ALL SELECT row_to_json(t)::text FROM public.license_download_links t
        UNION ALL SELECT row_to_json(t)::text FROM public.license_audit t
        UNION ALL SELECT row_to_json(t)::text FROM public.license_files t
        UNION ALL SELECT row_to_json(t)::text FROM public.customer_emails t`;
    expect(Number(sql(`SELECT count(*) FROM (${rows}) x`))).toBeGreaterThan(10);
    const hits = sql(`SELECT count(*) FROM (${rows}) x
        WHERE ${needles.map((n) => `position('${n}' in x.j) > 0`).join(" OR ")}`);
    expect(hits, "no plain license key / download token in any row").toBe("0");
  });
});
