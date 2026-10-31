// צוות הניהול (Stage 2b.3) — לבעלים בלבד. ההרשאה, מגבלת המקומות והכללים של
// user_roles נאכפים במסד (מיגרציות 7–8); כאן: בדיקת הקלט, הגבלת קצב, ופתיחת
// חשבון (אימייל מאומת, בלי סיסמה) רק כשהמסד כבר אישר שאפשר להוסיף.
// אין מייל הזמנה בשלב הזה (2k); המנהל נכנס בקוד במייל.
import { createServerFn } from "@tanstack/react-start";
import type { ActivityEntry, AddManagerResult, TeamView } from "../types/team";
import { parseAddManager, parseRemoveManager } from "../validation/team";

type RpcAdd = { status: "added" | "already_member" | "needs_account"; user_id?: string };

export const hospitalityTeam = createServerFn({ method: "GET" }).handler(
  async (): Promise<TeamView> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<TeamView>("team_members", {});
  },
);

export const hospitalityTeamActivity = createServerFn({ method: "GET" }).handler(
  async (): Promise<ActivityEntry[]> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<ActivityEntry[]>("team_activity", { _limit: 30 });
  },
);

export const hospitalityAddManager = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseAddManager(input))
  .handler(async ({ data }): Promise<AddManagerResult> => {
    const [{ manageRpc }, { hospitalitySiteId }, { allowAction }, { ensureAccount }] =
      await Promise.all([
        import("../server/manage.server"),
        import("../server/rpc.server"),
        import("@/platform/security/rate-limit.server"),
        import("@/platform/auth/accounts.server"),
      ]);
    const args = { _email: data.email, _display_name: data.displayName };
    let result = await manageRpc<RpcAdd>("team_add_manager", args);
    let created = false;
    if (result.status === "needs_account") {
      // המסד כבר בדק: בעלים, מקום פנוי, מנוי פעיל. הגבלת קצב רק על פתיחת חשבונות
      // (אחרי בדיקת ההרשאה — מנהל לא יכול לנצל את המכסה של הבעלים)
      if (!allowAction(`hosp-team-account:${await hospitalitySiteId()}`, 20, 60 * 60 * 1000)) {
        throw new Error("יותר מדי חשבונות חדשים בזמן קצר. נסו שוב בעוד שעה.");
      }
      created = (await ensureAccount(data.email, { signup_method: "hospitality_manager" })).created;
      result = await manageRpc<RpcAdd>("team_add_manager", args);
    }
    if (result.status === "needs_account" || !result.user_id) {
      throw new Error("פתיחת החשבון נכשלה. נסו שוב.");
    }
    return { status: result.status, user_id: result.user_id, account_created: created };
  });

export const hospitalityRemoveManager = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseRemoveManager(input))
  .handler(async ({ data }): Promise<{ removed: true }> => {
    const { manageRpc } = await import("../server/manage.server");
    await manageRpc<boolean>("team_remove_manager", { _user_id: data.userId });
    return { removed: true };
  });
