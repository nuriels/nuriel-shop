// Hospitality Stage 2b.3 — צוות הניהול: קלט הפונקציות, טקסט הפעילות והמקומות.
// ההרשאות והמגבלות נאכפות במסד (hospitality-settings-team.test.sql); המסך — e2e.
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
