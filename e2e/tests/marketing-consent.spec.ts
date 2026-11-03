// SEC-H5 — דיוור באישור כפול (double opt-in), מקצה לקצה: האפליקציה + Supabase המקומי + שרת
// המיילים המדומה. הצטרפות מ"החשבון שלי" → מייל אישור אחד (לא פרסומת) → עד הלחיצה לא מנוי →
// הלחיצה מאשרת → הקישור חד-פעמי → הסרה מיידית.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { A, AUTH, USERS } from "./helpers";

const MOCK = "http://127.0.0.1:4010";
type MockCall = { url: string; body: string };
type Mail = { to: string[]; subject: string; html: string };

/** "החשבון שלי" → לשונית "הפרטים שלי" (שם כרטיס הדיוור) */
async function openAccountDetails(page: Page) {
  await page.goto(A("/account"));
  await page.getByRole("tab", { name: "הפרטים שלי" }).click();
}

async function mailsTo(request: APIRequestContext, email: string): Promise<Mail[]> {
  const calls = (await (await request.get(`${MOCK}/__calls`)).json()) as MockCall[];
  return calls
    .filter((c) => c.url.startsWith("/emails"))
    .map((c) => JSON.parse(c.body) as { to: string[] | string; subject?: string; html?: string })
    .map((m) => ({ to: ([] as string[]).concat(m.to), subject: m.subject ?? "", html: m.html ?? "" }))
    .filter((m) => m.to.includes(email));
}

test.describe("marketing double opt-in (SEC-H5)", () => {
  test.use({ storageState: AUTH.customerA });

  test("opting in sends one confirmation email; only its link subscribes; the link works once", async ({
    page,
    request,
  }) => {
    const email = USERS.customerA.email;
    const before = (await mailsTo(request, email)).length;

    await openAccountDetails(page);
    const toggle = page.getByTestId("account-marketing-switch");
    await expect(toggle).toBeEnabled();
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(page.getByTestId("account-marketing-pending")).toBeVisible();
    await expect(toggle).not.toBeChecked();

    // exactly one new email — the confirmation request, not an advertisement
    let latest: Mail | undefined;
    await expect
      .poll(async () => {
        const mails = await mailsTo(request, email);
        latest = mails[mails.length - 1];
        return mails.length - before;
      })
      .toBe(1);
    expect(latest!.subject).toContain("אישור הצטרפות לדיוור");
    expect(latest!.subject.startsWith("פרסומת")).toBe(false);
    const token = /\/marketing\/confirm\/([0-9a-f]{64})/.exec(latest!.html)?.[1];
    expect(token, "the confirmation link carries a 64-hex one-time token").toBeTruthy();

    // before the click — still not subscribed
    await openAccountDetails(page);
    await expect(page.getByTestId("account-marketing-switch")).toBeEnabled();
    await expect(page.getByTestId("account-marketing-switch")).not.toBeChecked();

    // the click confirms
    await page.goto(A(`/marketing/confirm/${token}`));
    await expect(page.getByTestId("marketing-confirm-result")).toHaveAttribute("data-state", "done");
    await openAccountDetails(page);
    await expect(page.getByTestId("account-marketing-switch")).toBeChecked();

    // the link works only once
    await page.goto(A(`/marketing/confirm/${token}`));
    await expect(page.getByTestId("marketing-confirm-result")).toHaveAttribute(
      "data-state",
      "missing",
    );

    // a forged / unknown token confirms nothing
    await page.goto(A(`/marketing/confirm/${"f".repeat(64)}`));
    await expect(page.getByTestId("marketing-confirm-result")).toHaveAttribute(
      "data-state",
      "missing",
    );

    // opting out is immediate (and leaves the test re-runnable)
    await openAccountDetails(page);
    await expect(page.getByTestId("account-marketing-switch")).toBeChecked();
    await page.getByTestId("account-marketing-switch").click();
    await expect(page.getByTestId("account-marketing-switch")).not.toBeChecked();
    await openAccountDetails(page);
    await expect(page.getByTestId("account-marketing-switch")).toBeEnabled();
    await expect(page.getByTestId("account-marketing-switch")).not.toBeChecked();
  });
});
