// מחירים, כללי מחיר ומדיניות ביטול (Stage 2f). כל כתיבה רק דרך פונקציות המסד (מיגרציה 13)
// עם הטוקן של המשתמש. המחיר מחושב רק בשרת — תצוגת המחיר היא ה-quote של מנוע ההזמנות,
// והדוגמה של המדיניות — לוח הזמנים של המנוע עצמו (policy_preview).
import { createServerFn } from "@tanstack/react-start";
import type {
  Policy,
  PolicyPreview,
  PolicyVersion,
  PriceQuote,
  PricingSaveResult,
  PricingView,
  RateRule,
} from "../types/pricing";
import { uuid } from "../validation/input";
import {
  parsePolicySave,
  parsePreview,
  parseQuoteInput,
  parseRuleSave,
  parseUnitPrices,
} from "../validation/pricing";

const view = async () => {
  const { manageRpc } = await import("../server/manage.server");
  return manageRpc<PricingView>("pricing_view", {});
};

/** שמירה; "עודכן בינתיים" (HS409) → הנתונים העדכניים, לא שגיאה */
async function saving<T>(fn: string, args: Record<string, unknown>): Promise<PricingSaveResult<T>> {
  const [{ manageRpc }, { HospitalityError }] = await Promise.all([
    import("../server/manage.server"),
    import("../server/rpc.server"),
  ]);
  try {
    return { status: "saved", value: await manageRpc<T>(fn, args) };
  } catch (error) {
    if (error instanceof HospitalityError && error.code === "HS409")
      return { status: "conflict", message: error.message, view: await view() };
    throw error;
  }
}

export const hospitalityPricing = createServerFn({ method: "GET" }).handler(() => view());

export const hospitalitySetUnitPrices = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseUnitPrices(input))
  .handler(({ data }) =>
    saving<{ id: string; revision: number }>("unit_prices_set", {
      _id: data.id,
      _changes: data.changes,
      _expected_revision: data.revision,
    }),
  );

export const hospitalitySaveRule = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseRuleSave(input))
  .handler(async ({ data }): Promise<RateRule> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<RateRule>("rate_rule_save", { _id: data.id, _data: data.data });
  });

export const hospitalityDeleteRule = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({ id: uuid((input ?? {})["id"], "הכלל") }))
  .handler(async ({ data }): Promise<{ id: string }> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<{ id: string }>("rate_rule_delete", { _id: data.id });
  });

export const hospitalitySavePolicy = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parsePolicySave(input))
  .handler(({ data }) =>
    saving<Policy>("policy_save", {
      _id: data.id,
      _data: data.data,
      _expected_version: data.version,
    }),
  );

export const hospitalitySetDefaultPolicy = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({
    id: uuid((input ?? {})["id"], "המדיניות"),
  }))
  .handler(async ({ data }) => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<{ id: string }>("policy_set_default", { _id: data.id });
  });

export const hospitalityArchivePolicy = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({
    id: uuid((input ?? {})["id"], "המדיניות"),
  }))
  .handler(async ({ data }) => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<{ id: string; units: number }>("policy_archive", { _id: data.id });
  });

export const hospitalityPolicyHistory = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({
    id: uuid((input ?? {})["id"], "המדיניות"),
  }))
  .handler(async ({ data }): Promise<PolicyVersion[]> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<PolicyVersion[]>("policy_history", { _id: data.id });
  });

export const hospitalityPolicyPreview = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parsePreview(input))
  .handler(async ({ data }): Promise<PolicyPreview> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<PolicyPreview>("policy_preview", {
      _rules: data.rules,
      _total: data.total,
      _check_in: data.checkIn,
    });
  });

/** תצוגת מחיר לצוות (הרשאת pricing): ה-_quote של מנוע ההזמנות, גם כשההזמנות באתר סגורות */
export const hospitalityPriceQuote = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseQuoteInput(input))
  .handler(async ({ data }): Promise<PriceQuote> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<PriceQuote>("price_preview", {
      _unit_id: data.unitId,
      _check_in: data.checkIn,
      _check_out: data.checkOut,
      _adults: data.adults,
      _children: data.children,
    });
  });
