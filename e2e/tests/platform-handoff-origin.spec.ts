import { expect, test } from "@playwright/test";
import { STORE_B, USERS } from "./helpers";
import { accessToken, callServerFn, sql } from "./hospitality-helpers";

// SEC-H2 (השלמה): "כניסה לניהול" של מנהל הפלטפורמה (createStoreAdminHandoff — מטבלת החנויות וממסך
// אתרי האירוח) מחזירה קישור עם קוד חד-פעמי שנותן חיבור של מנהל-על. הקישור תמיד על <slug>.<base>,
// לעולם לא על הדומיין של החנות: את ה-DNS שלו בעל החנות מפנה לשרת שלו, והסקריפט שם קורא את ה-#code.
// לפני התיקון רק הפורטל ומחליף החנויות עברו ל-slugOriginForTenant; המסלול הזה נשאר על originForTenant.

test("platform admin 'enter store': the one-time code goes to the slug host even when the store has its own domain", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "server flow, once");
  const before = sql(`SELECT coalesce(domain, '') FROM public.tenants WHERE id = '${STORE_B.id}'`);
  sql(`UPDATE public.tenants SET domain = 'store-owned.example.test' WHERE id = '${STORE_B.id}'`);
  try {
    const token = await accessToken(request, USERS.platform);
    const res = await callServerFn(request, {
      host: "platform.shop.localhost",
      file: "src/lib/handoff.functions.ts",
      name: "createStoreAdminHandoff",
      token,
      data: { tenantId: STORE_B.id },
    });
    const text = await res.text();
    const url = /https?:\/\/[^"\\]+\/admin-handoff#code=[A-Za-z0-9_-]+/.exec(text)?.[0] ?? "";
    expect(url, text).not.toBe("");
    expect(new URL(url).host).toBe(`${STORE_B.slug}.shop.localhost`);
    expect(url).not.toContain("store-owned.example.test");
  } finally {
    sql(
      `UPDATE public.tenants SET domain = ${before ? `'${before}'` : "NULL"} WHERE id = '${STORE_B.id}'`,
    );
  }
});

// אותו כלל לקישור איפוס הסיסמה / קישור הכניסה במייל (requestPasswordReset → reset-link.server): חשבון
// ההתחברות משותף לכל החנויות של המשתמש, וקישור שנפתח בדומיין שבעל החנות שולט בו נותן לו את הטוקן.
test("password reset email: the link is on the slug host even when the store has its own domain", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "server flow, once");
  const before = sql(`SELECT coalesce(domain, '') FROM public.tenants WHERE id = '${STORE_B.id}'`);
  sql(`UPDATE public.tenants SET domain = 'store-owned.example.test' WHERE id = '${STORE_B.id}'`);
  try {
    const since = Date.now();
    const res = await callServerFn(request, {
      host: `${STORE_B.slug}.shop.localhost`,
      file: "src/lib/password.functions.ts",
      name: "requestPasswordReset",
      data: { identifier: USERS.ownerB.email },
    });
    expect(res.status()).toBe(200);
    let link = "";
    await expect
      .poll(
        async () => {
          const calls = (await (await request.get("http://127.0.0.1:4010/__calls")).json()) as {
            url: string;
            body: string;
            at: number;
          }[];
          const mail = calls
            .filter(
              (c) =>
                c.url.startsWith("/emails") && c.at >= since && c.body.includes(USERS.ownerB.email),
            )
            .pop();
          link =
            /https?:\/\/[^"\\\s]+\/reset-password\?token=[^"\\\s&]+/.exec(mail?.body ?? "")?.[0] ??
            "";
          return link;
        },
        { timeout: 15_000 },
      )
      .not.toBe("");
    expect(new URL(link).host).toBe(`${STORE_B.slug}.shop.localhost`);
    expect(link).not.toContain("store-owned.example.test");
  } finally {
    sql(
      `UPDATE public.tenants SET domain = ${before ? `'${before}'` : "NULL"} WHERE id = '${STORE_B.id}'`,
    );
  }
});
