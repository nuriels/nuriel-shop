// מדריך ההקמה (מיגרציה 35): הסטטוס של כל צעד מחושב במסד מהנתונים עצמם; נשמרים רק הצעד האחרון
// (להמשך מאותה נקודה), אישורי "בדקתי" ודילוגים. הרשאת settings ואזור ניהול פעיל — במסד.
import { createServerFn } from "@tanstack/react-start";
import type { SetupGuideView } from "../types/setup";
import { parseSetupSave } from "../validation/setup";

export const hospitalitySetupGuide = createServerFn({ method: "GET" }).handler(
  async (): Promise<SetupGuideView> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<SetupGuideView>("setup_guide", {});
  },
);

export const hospitalitySetupSave = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => parseSetupSave(input))
  .handler(async ({ data }): Promise<SetupGuideView> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<SetupGuideView>("setup_save", { _step: data.step, _action: data.action });
  });
