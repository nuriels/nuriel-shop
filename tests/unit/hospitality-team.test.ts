// Hospitality Stage 2b.3 — צוות הניהול: קלט הפונקציות, טקסט הפעילות והמקומות.
// ההרשאות והמגבלות נאכפות במסד (hospitality-settings-team.test.sql); המסך — e2e.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAddManager, parseRemoveManager } from "@/engines/hospitality/validation/team";
import { activityText, seatsText } from "@/engines/hospitality/management/team/activity";
import { formatDateTime } from "@/engines/hospitality/management/lib/format";
import type { ActivityEntry } from "@/engines/hospitality/types/team";

const entry = (e: Partial<ActivityEntry>): ActivityEntry => ({
  at: "2026-11-01T10:00:00Z",
  actor_role: "owner",
  actor: "דנה",
  action: "team.manager_added",
  target: "נועה",
  changes: {},
  ...e,
});

describe("team input", () => {
  it("normalises the email and the optional name", () => {
    expect(parseAddManager({ email: "  Noa@Test.CO ", displayName: " נועה " })).toEqual({
      email: "noa@test.co",
      displayName: "נועה",
    });
    expect(parseAddManager({ email: "a@b.co", displayName: "" })).toEqual({
      email: "a@b.co",
      displayName: null,
    });
  });
  it("refuses a bad email, a long name and a bad member id", () => {
    expect(() => parseAddManager({ email: "nope" })).toThrow("כתובת האימייל לא תקינה");
    expect(() => parseAddManager({ email: "a@b.co", displayName: "x".repeat(61) })).toThrow(
      "השם ארוך מדי",
    );
    expect(() => parseRemoveManager({ userId: "x" })).toThrow("המנהל לא תקין");
    expect(parseRemoveManager({ userId: "A0000000-0000-0000-0000-000000000001" })).toEqual({
      userId: "a0000000-0000-0000-0000-000000000001",
    });
  });
});

describe("activity in plain Hebrew", () => {
  it("team changes and settings changes", () => {
    expect(activityText(entry({}))).toBe("דנה הוסיף/ה את נועה לצוות הניהול");
    expect(activityText(entry({ action: "team.manager_removed" }))).toBe(
      "דנה הסיר/ה את נועה מצוות הניהול",
    );
    expect(
      activityText(
        entry({
          action: "settings.updated",
          actor: null,
          actor_role: "manager",
          changes: { address: {}, check_in_time: {} },
        }),
      ),
    ).toBe("מנהל/ת עדכן/ה את ההגדרות: כתובת העסק, שעת הגעה");
  });
  it("every action the database writes to the log has a sentence (no raw codes on the team screen)", () => {
    const dir = "supabase/migrations";
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
      .join("\n");
    // _audit(_t, 'x.y', …) and the CASE WHEN … THEN 'x.y' ELSE 'x.z' END forms
    const codes = new Set<string>();
    for (const m of sql.matchAll(/_audit\([^,]+,\s*(CASE[^,]*?END|'[a-z_.]+')/g))
      for (const c of m[1]!.matchAll(/'([a-z_]+\.[a-z_]+)'/g)) codes.add(c[1]!);
    // 'setup.' || _action (migration 35)
    for (const a of ["confirm", "unconfirm", "skip", "unskip"]) codes.add(`setup.${a}`);
    expect(codes.size).toBeGreaterThan(50);
    for (const action of codes) {
      const text = activityText(entry({ action, target: "יעד", changes: { step: "prices" } }));
      expect(text, action).not.toContain(action);
    }
    expect(activityText(entry({ action: "setup.skip", changes: { step: "seo" } }))).toBe(
      'דנה דילג/ה במדריך ההקמה על "גוגל ושיתוף"',
    );
    expect(activityText(entry({ action: "team.finance_granted", target: "נועה" }))).toBe(
      "דנה נתן/ה לנועה גישה לנתונים הכספיים",
    );
  });
  it("dates in the business timezone", () => {
    expect(formatDateTime("2026-11-01T10:05:00Z")).toBe("01.11.2026, 12:05");
  });
});

describe("seats", () => {
  it("used / limit, full, unlimited", () => {
    expect(seatsText({ used: 2, limit: 3 })).toEqual({
      text: "2 מתוך 3 מקומות בשימוש",
      full: false,
    });
    expect(seatsText({ used: 3, limit: 3 }).full).toBe(true);
    expect(seatsText({ used: 7, limit: null })).toEqual({
      text: "7 מנהלים (ללא הגבלה)",
      full: false,
    });
  });
});
