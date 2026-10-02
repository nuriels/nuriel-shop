/** איך מציגים עובד: השם המלא בעברית, ואם עוד לא הוזן — שם המשתמש או האימייל */
export type StaffIdentity = {
  display_name?: string | null;
  username?: string | null;
  email?: string | null;
  agent_number?: string | null;
};

export function staffName(person: StaffIdentity): string {
  return person.display_name?.trim() || person.username?.trim() || person.email?.trim() || "עובד";
}

/** "S-001 · יוסי כהן" לסוכן עם מספר, אחרת רק השם */
export function staffLabel(person: StaffIdentity): string {
  const name = staffName(person);
  return person.agent_number ? `${person.agent_number} · ${name}` : name;
}
