// אורחים (2j): בדיקת הקלט — אותן הודעות כמו המסד
import { InputError, uuid } from "./input";

type Raw = Record<string, unknown> | null | undefined;

export function parseGuestsQuery(input: Raw): { q: string | null; limit: number; offset: number } {
  const i = input ?? {};
  const q = typeof i["q"] === "string" && i["q"].trim() ? i["q"].trim().slice(0, 100) : null;
  const limit = typeof i["limit"] === "number" ? i["limit"] : 50;
  const offset = typeof i["offset"] === "number" ? i["offset"] : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new InputError("עמוד לא תקין");
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
    throw new InputError("עמוד לא תקין");
  return { q, limit, offset };
}

export const parseGuestId = (input: Raw): { id: string } => ({
  id: uuid((input ?? {})["id"], "האורח"),
});

export function parseGuestNotes(input: Raw): { id: string; notes: string | null } {
  const i = input ?? {};
  const n = i["notes"];
  if (n !== null && n !== undefined && typeof n !== "string")
    throw new InputError("ההערות — ערך לא תקין");
  const notes = typeof n === "string" ? n.trim() : "";
  if (notes.length > 2000) throw new InputError("ההערות ארוכות מדי (עד 2000 תווים)");
  return { id: uuid(i["id"], "האורח"), notes: notes || null };
}
