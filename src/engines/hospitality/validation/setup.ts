// מדריך ההקמה — בדיקת הקלט לפני המסד (המסד בודק שוב: צעד, פעולה, ואילו פעולות מותרות לאיזה צעד)
import {
  SETUP_ACTIONS,
  SETUP_CONFIRMABLE,
  SETUP_SKIPPABLE,
  SETUP_STEPS,
  type SetupAction,
  type SetupStepKey,
} from "../types/setup";
import { InputError } from "./input";

const has = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

export function parseSetupSave(input: unknown): { step: SetupStepKey; action: SetupAction } {
  const o = (input ?? {}) as Record<string, unknown>;
  if (!has(SETUP_STEPS, o["step"])) throw new InputError("צעד לא מוכר");
  if (!has(SETUP_ACTIONS, o["action"])) throw new InputError("פעולה לא מוכרת");
  const step = o["step"];
  const action = o["action"];
  if ((action === "confirm" || action === "unconfirm") && !has(SETUP_CONFIRMABLE, step))
    throw new InputError("את הצעד הזה משלימים במסך שלו");
  if ((action === "skip" || action === "unskip") && !has(SETUP_SKIPPABLE, step))
    throw new InputError("אי אפשר לדלג על הצעד הזה");
  return { step, action };
}
