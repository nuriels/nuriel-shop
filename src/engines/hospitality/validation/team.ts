// קלט פונקציות הצוות (המסד בודק שוב, כולל ההרשאה והמקומות)
import { InputError, uuid } from "./input";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function managerEmailError(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return EMAIL.test(s) && s.length <= 254 ? null : "כתובת האימייל לא תקינה";
}

export function managerNameError(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s.length > 60 ? "השם ארוך מדי (עד 60 תווים)" : null;
}

export function parseAddManager(input: Record<string, unknown> | null | undefined): {
  email: string;
  displayName: string | null;
} {
  const email = String((input ?? {})["email"] ?? "")
    .trim()
    .toLowerCase();
  const emailError = managerEmailError(email);
  if (emailError) throw new InputError(emailError);
  const name = String((input ?? {})["displayName"] ?? "").trim();
  const nameError = managerNameError(name);
  if (nameError) throw new InputError(nameError);
  return { email, displayName: name === "" ? null : name };
}

export function parseRemoveManager(input: Record<string, unknown> | null | undefined): {
  userId: string;
} {
  return { userId: uuid((input ?? {})["userId"], "המנהל") };
}
