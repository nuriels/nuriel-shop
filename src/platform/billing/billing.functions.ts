// Billing & Agreements (מיגרציה 189) — פונקציות השרת. פונקציות של הפלטפורמה (src/platform): רצות בכל סוג
// אתר; ההרשאה במסד. עטיפה דקה: בדיקת קלט (שוב במסד), קריאה, וניקוי מטמון אחרי שינוי במנוי.
//   • בעל העסק: הסיכום של העסק שלו, בקשת שינוי חבילה, ביטול הבקשה
//   • מנהל הפלטפורמה (כתובת הפאנל): כרטיס הלקוח, הצעת הפרש, הסכם, רישום / ביטול ביומן, חידוש, בקשות
import { createServerFn } from "@tanstack/react-start";
import {
  parseAgreementInput,
  parseCycle,
  parseEntryInput,
  parseIsoDate,
  parseMethod,
  parseAmount,
  parsePlanCode,
  parseRequestNote,
  parseUuid,
  parseVatRate,
  BillingInputError,
} from "./logic";
import type {
  BillingCard,
  BillingSummary,
  ChangeQuote,
  LegacyOverview,
  SaveAgreementResult,
  SellerBusinessType,
  SellerVatProfile,
  UpgradeRequest,
  VatRatesView,
} from "./types";

const server = () => import("./billing.server");

function str(value: unknown, max: number): string {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

// ---------------------------------------------------------------- בעל העסק

export const myBillingSummary = createServerFn({ method: "POST" }).handler(
  async (): Promise<BillingSummary> =>
    (await server()).ownerRpc<BillingSummary>("my_billing_summary"),
);

export const myBillingRequestUpgrade = createServerFn({ method: "POST" })
  .inputValidator((input: { plan: string; cycle?: string; note?: string }) => ({
    plan: parsePlanCode(input?.plan),
    cycle: parseCycle(input?.cycle),
    note: parseRequestNote(input?.note),
  }))
  .handler(async ({ data }): Promise<UpgradeRequest> =>
    (await server()).ownerRpc<UpgradeRequest>("my_billing_request_upgrade", {
      _plan: data.plan,
      _cycle: data.cycle,
      _note: data.note,
    }),
  );

export const myBillingCancelRequest = createServerFn({ method: "POST" })
  .inputValidator((input: { requestId: string }) => ({
    requestId: parseUuid(input?.requestId, "בקשה"),
  }))
  .handler(async ({ data }): Promise<UpgradeRequest> =>
    (await server()).ownerRpc<UpgradeRequest>("my_billing_cancel_request", {
      _request: data.requestId,
    }),
  );

// ---------------------------------------------------------------- מנהל הפלטפורמה

export const platformBillingCard = createServerFn({ method: "POST" })
  .inputValidator((input: { tenantId: string }) => ({
    tenantId: parseUuid(input?.tenantId, "עסק"),
  }))
  .handler(async ({ data }): Promise<BillingCard> =>
    (await server()).platformRpc<BillingCard>("platform_billing_card", { _tenant: data.tenantId }),
  );

export const platformBillingQuote = createServerFn({ method: "POST" })
  .inputValidator((input: { tenantId: string; agreement: Record<string, unknown> }) => ({
    tenantId: parseUuid(input?.tenantId, "עסק"),
    agreement: parseAgreementInput(input?.agreement),
  }))
  .handler(async ({ data }): Promise<ChangeQuote> =>
    (await server()).platformRpc<ChangeQuote>("platform_billing_quote", {
      _tenant: data.tenantId,
      _input: data.agreement,
    }),
  );

export const platformBillingSaveAgreement = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      tenantId: string;
      agreement: Record<string, unknown>;
      expectedVersion: number;
      applyPlan?: boolean;
      recordDifference?: boolean;
      requestId?: string | null;
      requestMessage?: string;
    }) => {
      const expected = Number(input?.expectedVersion);
      if (!Number.isInteger(expected) || expected < 0)
        throw new BillingInputError("גרסת הסכם לא תקינה");
      return {
        tenantId: parseUuid(input?.tenantId, "עסק"),
        agreement: parseAgreementInput(input?.agreement),
        expectedVersion: expected,
        applyPlan: input?.applyPlan === true,
        recordDifference: input?.recordDifference === true,
        requestId: input?.requestId ? parseUuid(input.requestId, "בקשה") : null,
        requestMessage: str(input?.requestMessage, 500) || null,
      };
    },
  )
  .handler(async ({ data }): Promise<SaveAgreementResult> => {
    const s = await server();
    const result = await s.platformRpc<SaveAgreementResult>("platform_billing_save_agreement", {
      _tenant: data.tenantId,
      _input: data.agreement,
      _expected_version: data.expectedVersion,
      _apply_plan: data.applyPlan,
      _record_difference: data.recordDifference,
      _request: data.requestId,
      _request_message: data.requestMessage,
    });
    if (result.plan?.applied) await s.refreshSite(data.tenantId);
    return result;
  });

export const platformBillingRecordEntry = createServerFn({ method: "POST" })
  .inputValidator((input: { tenantId: string; entry: Record<string, unknown> }) => ({
    tenantId: parseUuid(input?.tenantId, "עסק"),
    entry: parseEntryInput(input?.entry),
  }))
  .handler(async ({ data }): Promise<BillingCard> =>
    (await server()).platformRpc<BillingCard>("platform_billing_record_entry", {
      _tenant: data.tenantId,
      _input: data.entry,
    }),
  );

export const platformBillingReverseEntry = createServerFn({ method: "POST" })
  .inputValidator((input: { entryId: string; reason: string }) => {
    const reason = str(input?.reason, 500);
    if (reason.length < 2) throw new BillingInputError("כתבו את סיבת הביטול");
    return { entryId: parseUuid(input?.entryId, "רישום"), reason };
  })
  .handler(async ({ data }): Promise<BillingCard> =>
    (await server()).platformRpc<BillingCard>("platform_billing_reverse_entry", {
      _entry: data.entryId,
      _reason: data.reason,
    }),
  );

export const platformBillingRenew = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      tenantId: string;
      expectedRenewal: string | null;
      recordPayment?: boolean;
      method?: string;
      reference?: string;
      paidOn?: string;
      amount?: string | number | null;
    }) => {
      const recordPayment = input?.recordPayment === true;
      const method = parseMethod(input?.method);
      if (recordPayment && !method) throw new BillingInputError("בחרו אמצעי תשלום");
      return {
        tenantId: parseUuid(input?.tenantId, "עסק"),
        expectedRenewal: parseIsoDate(input?.expectedRenewal, "תאריך החידוש"),
        payment: {
          record_payment: recordPayment,
          method: recordPayment ? method : null,
          reference: str(input?.reference, 120) || null,
          paid_on: parseIsoDate(input?.paidOn, "תאריך התשלום"),
          amount: recordPayment
            ? parseAmount(input?.amount, "סכום התשלום", { positive: true })
            : null,
        },
      };
    },
  )
  .handler(async ({ data }): Promise<BillingCard> => {
    const s = await server();
    const card = await s.platformRpc<BillingCard>("platform_billing_renew", {
      _tenant: data.tenantId,
      _expected_renewal: data.expectedRenewal,
      _input: data.payment,
    });
    await s.refreshSite(data.tenantId);
    return card;
  });

export const platformBillingRequests = createServerFn({ method: "POST" })
  .inputValidator((input: { status?: string } | undefined) => {
    const status = input?.status ?? "pending";
    if (!["pending", "approved", "rejected", "canceled", "all"].includes(status))
      throw new BillingInputError("סטטוס לא מוכר");
    return { status };
  })
  .handler(async ({ data }): Promise<UpgradeRequest[]> =>
    (await server()).platformRpc<UpgradeRequest[]>("platform_billing_requests", {
      _status: data.status,
    }),
  );

export const platformBillingRejectRequest = createServerFn({ method: "POST" })
  .inputValidator((input: { requestId: string; message?: string }) => ({
    requestId: parseUuid(input?.requestId, "בקשה"),
    message: str(input?.message, 500) || null,
  }))
  .handler(async ({ data }): Promise<UpgradeRequest> =>
    (await server()).platformRpc<UpgradeRequest>("platform_billing_reject_request", {
      _request: data.requestId,
      _message: data.message,
    }),
  );

export const platformBillingSaveSettings = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      sellerBusinessType: SellerBusinessType;
      sellerPricesIncludeVat?: boolean | null;
      allowVatRateOverride?: boolean;
    }) => {
      const type = input?.sellerBusinessType;
      if (type !== "exempt" && type !== "authorized") {
        throw new BillingInputError("סוג העוסק: פטור או מורשה");
      }
      if (type === "authorized" && typeof input.sellerPricesIncludeVat !== "boolean") {
        throw new BillingInputError("עוסק מורשה: יש לבחור אם המחירים כוללים מע״מ");
      }
      return {
        type,
        include: type === "authorized" ? input.sellerPricesIncludeVat === true : false,
        override: type === "authorized" && input.allowVatRateOverride === true,
      };
    },
  )
  .handler(async ({ data }): Promise<SellerVatProfile> =>
    (await server()).platformRpc<SellerVatProfile>("platform_billing_save_settings", {
      _input: {
        seller_business_type: data.type,
        seller_prices_include_vat: data.include,
        allow_vat_rate_override: data.override,
      },
    }),
  );

/** "תעד תשלום" הישן: כל העסקים עם שורות כסף שלא ביומן החדש (קריאה בלבד) */
export const platformBillingLegacyOverview = createServerFn({ method: "POST" }).handler(
  async (): Promise<LegacyOverview> =>
    (await server()).platformRpc<LegacyOverview>("platform_billing_legacy_overview", {}),
);

/** השיעור המרכזי — הצגה, קביעה מראש לתאריך עתידי, ביטול שיעור שעוד לא חל */
export const platformVatRates = createServerFn({ method: "POST" }).handler(
  async (): Promise<VatRatesView> =>
    (await server()).platformRpc<VatRatesView>("platform_vat_rates", {}),
);

export const platformVatRateSchedule = createServerFn({ method: "POST" })
  .inputValidator((input: { rate: number | string; effectiveFrom: string; note?: string }) => {
    const rate = parseVatRate(input?.rate);
    if (rate === null || rate >= 100) throw new BillingInputError("שיעור מע״מ: 0 עד 99.99");
    const from = String(input?.effectiveFrom ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new BillingInputError("תאריך תחילה לא תקין");
    return { rate, from, note: String(input?.note ?? "").slice(0, 300) };
  })
  .handler(async ({ data }): Promise<VatRatesView> =>
    (await server()).platformRpc<VatRatesView>("platform_vat_rate_schedule", {
      _rate: data.rate,
      _effective_from: data.from,
      _note: data.note,
    }),
  );

export const platformVatRateCancel = createServerFn({ method: "POST" })
  .inputValidator((input: { id: number }) => {
    const id = Number(input?.id);
    if (!Number.isInteger(id) || id <= 0) throw new BillingInputError("שיעור לא תקין");
    return { id };
  })
  .handler(async ({ data }): Promise<VatRatesView> =>
    (await server()).platformRpc<VatRatesView>("platform_vat_rate_cancel", { _id: data.id }),
  );
