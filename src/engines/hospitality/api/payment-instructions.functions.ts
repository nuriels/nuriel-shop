// הוראות תשלום לאורחים (מיגרציה 37): צפייה לצוות (settings), שמירה — בעלי העסק בלבד (המסד אוכף).
// הוראות תשלום אינן אישור שהכסף התקבל — מצב התשלום מתעדכן רק מיומן התשלומים.
import { createServerFn } from "@tanstack/react-start";
import type { PaymentSettingsView } from "../types/payment-instructions";
import { parsePaymentSettingsSave } from "../validation/payment-instructions";

export const hospitalityPaymentSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<PaymentSettingsView> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<PaymentSettingsView>("payment_settings_view", {});
  },
);

export const hospitalitySavePaymentSettings = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => parsePaymentSettingsSave(input))
  .handler(async ({ data }): Promise<PaymentSettingsView> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<PaymentSettingsView>("payment_settings_save", {
      _changes: data.changes,
      _revision: data.revision,
    });
  });
