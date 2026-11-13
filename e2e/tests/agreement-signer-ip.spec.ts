import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { hostOf, STORE_A, USERS } from "./helpers";
import { callServerFn, sql } from "./hospitality-helpers";

// טופס ההסכם (submitAgreement): ה-IP שנשמר כתיעוד החתימה רק ממקור שהשרת קובע (X-Real-IP / ההופ
// האחרון ב-X-Forwarded-For — SEC-M2), לא ההופ הראשון שהדפדפן שולח. לפני התיקון נשמר "6.6.6.6".

test("agreement signature evidence: a spoofed first X-Forwarded-For hop is not stored as the signer IP", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "server flow, once");
  const userId = sql(`SELECT id FROM auth.users WHERE email = '${USERS.customerA.email}'`);
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  sql(`DELETE FROM public.service_agreements WHERE user_id = '${userId}'`);
  sql(`INSERT INTO public.service_agreements (user_id, token_hash, sent_at, token_expires_at, tenant_id)
       VALUES ('${userId}', '${hash}', now(), now() + interval '1 day', '${STORE_A.id}')`);
  try {
    const res = await callServerFn(request, {
      host: hostOf(STORE_A.slug),
      file: "src/lib/agreement.functions.ts",
      name: "submitAgreement",
      data: {
        token,
        signerName: "לקוח בדיקה",
        signatureSvg: '<svg><path d="M10 10 L 120 60 L 200 20"/></svg>',
      },
      headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" },
    });
    expect(await res.text()).toContain("ok");
    expect(
      sql(`SELECT signed_at IS NOT NULL, coalesce(signer_ip::text, 'null')
             FROM public.service_agreements WHERE user_id = '${userId}'`),
    ).toBe("t|203.0.113.9");
  } finally {
    sql(`DELETE FROM public.service_agreements WHERE user_id = '${userId}'`);
  }
});
