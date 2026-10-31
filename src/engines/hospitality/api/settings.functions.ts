// הגדרות העסק (Stage 2b.2). ההרשאה לכל שדה נאכפת במסד (update_settings, מיגרציה 8);
// כאן בדיקת הקלט, הקריאה עם טוקן המשתמש, ו"עודכן בינתיים" כתשובה ולא כשגיאה.
import { createServerFn } from "@tanstack/react-start";
import type { SettingsSaveResult, SettingsView } from "../types/settings";
import { parseSettingsUpdate } from "../validation/settings";

export const hospitalitySettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<SettingsView> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<SettingsView>("settings_view", {});
  },
);

export const hospitalityUpdateSettings = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseSettingsUpdate(input))
  .handler(async ({ data }): Promise<SettingsSaveResult> => {
    const [{ manageRpc }, { HospitalityError }] = await Promise.all([
      import("../server/manage.server"),
      import("../server/rpc.server"),
    ]);
    try {
      const view = await manageRpc<SettingsView>("update_settings", {
        _changes: data.changes,
        _expected_revision: data.revision,
      });
      return { status: "saved", view };
    } catch (error) {
      // מישהו אחר שמר בינתיים: מחזירים את הערכים העדכניים — המסך ממזג בלי לדרוס
      if (error instanceof HospitalityError && error.code === "HS409") {
        const view = await manageRpc<SettingsView>("settings_view", {});
        return { status: "conflict", view, message: error.message };
      }
      throw error;
    }
  });
