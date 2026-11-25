// מיגרציה 206 — ההתראה על מייל שנכשל: "נקרא" / "טופל" / "להחזיר להתראות".
// כאן: מצב ההתראה ומה מותר בכל מצב, בדיקת הקלט של פונקציות השרת, המספר בפעמון / בתפריט / ב"דורש טיפול",
// והטקסט ביומן הפעולות. המסד עצמו (הרשאות, בידוד בין עסקים, שהמייל לא משתנה) —
// scripts/db-tests/hospitality-email-alerts.test.sql; המסך — e2e/tests/hospitality-email-alerts.spec.ts
import { describe, expect, it } from "vitest";
import {
  ALERT_ACTION_LABEL,
  EMAIL_FILTERS,
  alertActions,
  alertState,
  parseEmailsSearch,
} from "@/engines/hospitality/management/emails/model";
import {
  attentionCount,
  isQuietTask,
  sortTasks,
  taskView,
  unseenAlerts,
} from "@/engines/hospitality/management/dashboard/model";
import { navBadges } from "@/engines/hospitality/management/shell/tasks";
import { activityText } from "@/engines/hospitality/management/team/activity";
import {
  EMAIL_ALERT_MAX_IDS,
  InputError,
  parseEmailAlertMark,
  parseEmailAlertMarkAll,
} from "@/engines/hospitality/validation/input";
import type { EmailRow } from "@/engines/hospitality/types/emails";
import type { DashboardTask } from "@/engines/hospitality/types/dashboard";

const ID1 = "a0000000-0000-0000-0000-000000000001";
const ID2 = "a0000000-0000-0000-0000-000000000002";

const row = (over: Partial<EmailRow>): Pick<EmailRow, "status" | "alert"> => ({
  status: "dead",
  alert: { seen: false, handled: false, handled_at: null, cancelled: false },
  ...over,
});

describe("email alert state", () => {
  it("a failed email is an alert: new → seen → handled; cancelled on purpose is never an alert", () => {
    expect(alertState(row({}))).toBe("new");
    expect(alertState(row({ status: "failed" }))).toBe("new");
    expect(
      alertState(
        row({ alert: { seen: true, handled: false, handled_at: null, cancelled: false } }),
      ),
    ).toBe("seen");
    expect(
      alertState(
        row({
          alert: {
            seen: true,
            handled: true,
            handled_at: "2026-11-25T10:00:00Z",
            cancelled: false,
          },
        }),
      ),
    ).toBe("handled");
    // בוטל בכוונה גובר על כל סימון
    expect(
      alertState(row({ alert: { seen: true, handled: true, handled_at: null, cancelled: true } })),
    ).toBe("cancelled");
  });

  it("only failed emails carry an alert; an old server without migration 206 still shows the alert", () => {
    expect(alertState(row({ status: "sent", alert: null }))).toBeNull();
    expect(alertState(row({ status: "queued", alert: null }))).toBeNull();
    expect(alertState(row({ status: "dead", alert: null }))).toBe("new");
  });

  it("what each state allows: resend for any failed email except one cancelled on purpose", () => {
    expect(alertActions("new")).toEqual({ marks: ["seen", "handled"], resend: true });
    expect(alertActions("seen")).toEqual({ marks: ["handled"], resend: true });
    expect(alertActions("handled")).toEqual({ marks: ["reopen"], resend: true });
    expect(alertActions("cancelled")).toEqual({ marks: [], resend: false });
    expect(alertActions(null)).toEqual({ marks: [], resend: false });
    expect(ALERT_ACTION_LABEL).toEqual({
      seen: "סימון כנקרא",
      handled: "סימון כטופל",
      reopen: "החזרה להתראות",
    });
  });

  it('the screen has a "handled" tab, and ?filter=handled opens it', () => {
    expect(EMAIL_FILTERS.map((f) => f.key)).toEqual([
      "failed",
      "handled",
      "waiting",
      "sent",
      "all",
    ]);
    expect(parseEmailsSearch({ filter: "handled" })).toEqual({ filter: "handled" });
    expect(parseEmailsSearch({ filter: "deleted" })).toEqual({});
  });
});

describe("server input for the alert marks", () => {
  it("accepts 1–200 email ids and the three actions; de-duplicates ids", () => {
    expect(parseEmailAlertMark({ ids: [ID1, ID2, ID1.toUpperCase()], action: "seen" })).toEqual({
      ids: [ID1, ID2],
      action: "seen",
    });
    expect(parseEmailAlertMark({ ids: [ID1], action: "handled" }).action).toBe("handled");
    expect(parseEmailAlertMark({ ids: [ID1], action: "reopen" }).action).toBe("reopen");
  });

  it("refuses an empty list, too many ids, a bad id and an unknown action (e.g. delete)", () => {
    expect(() => parseEmailAlertMark({ ids: [], action: "seen" })).toThrow(InputError);
    expect(() => parseEmailAlertMark({ action: "seen" })).toThrow(InputError);
    expect(() => parseEmailAlertMark({ ids: ID1, action: "seen" })).toThrow(InputError);
    const many = Array.from(
      { length: EMAIL_ALERT_MAX_IDS + 1 },
      (_, i) => `a0000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    );
    expect(() => parseEmailAlertMark({ ids: many, action: "seen" })).toThrow(InputError);
    expect(() => parseEmailAlertMark({ ids: ["not-a-uuid"], action: "seen" })).toThrow(InputError);
    expect(() => parseEmailAlertMark({ ids: [ID1], action: "delete" })).toThrow(InputError);
    expect(() => parseEmailAlertMark({ ids: [ID1] })).toThrow(InputError);
  });

  it('"mark all" takes only seen / handled (reopen is per email)', () => {
    expect(parseEmailAlertMarkAll({ action: "seen" })).toEqual({ action: "seen" });
    expect(parseEmailAlertMarkAll({ action: "handled" })).toEqual({ action: "handled" });
    expect(() => parseEmailAlertMarkAll({ action: "reopen" })).toThrow(InputError);
    expect(() => parseEmailAlertMarkAll({})).toThrow(InputError);
  });
});

describe("the number in the bell, the menu and 'needs attention'", () => {
  const emails = (count: number, unseen?: number): DashboardTask => ({
    kind: "emails",
    severity: "medium",
    count,
    ...(unseen === undefined ? {} : { unseen }),
  });
  const pending: DashboardTask = { kind: "pending", severity: "high", count: 1 };

  it("unseen alerts count; once all are read the task stays listed but quiet", () => {
    expect(unseenAlerts(emails(3, 2))).toBe(2);
    expect(unseenAlerts(emails(3))).toBe(3); // שרת ישן — כמו קודם
    expect(isQuietTask(emails(3, 0))).toBe(true);
    expect(isQuietTask(emails(3, 1))).toBe(false);
    expect(isQuietTask(pending)).toBe(false);
    expect(attentionCount([pending, emails(3, 0)])).toBe(1);
    expect(attentionCount([pending, emails(3, 1)])).toBe(2);
    // משימה שקטה — בסוף הרשימה
    expect(
      sortTasks([emails(3, 0), { kind: "site", severity: "low", count: 1 }]).map((t) => t.kind),
    ).toEqual(["site", "emails"]);
  });

  it("the menu badge on 'מיילים' shows only alerts not read yet, and disappears at zero", () => {
    expect(navBadges({ count: 1, items: [emails(3, 2)] })).toEqual({ emails: 2 });
    expect(navBadges({ count: 1, items: [emails(3, 0)] })).toEqual({});
    expect(navBadges({ count: 1, items: [emails(3)] })).toEqual({ emails: 3 });
  });

  it("the task says what is new and what can be done, and still links to the failed emails", () => {
    expect(taskView(emails(2, 2)).detail).toBe("אפשר לשלוח שוב או לסמן כטופל");
    expect(taskView(emails(3, 1)).detail).toBe("אחד חדש · אפשר לשלוח שוב או לסמן כטופל");
    expect(taskView(emails(3, 2)).detail).toBe("2 חדשים · אפשר לשלוח שוב או לסמן כטופל");
    expect(taskView(emails(1, 0)).detail).toBe("נקרא · אפשר לשלוח שוב או לסמן כטופל");
    expect(taskView(emails(2, 0)).detail).toBe("נקראו · אפשר לשלוח שוב או לסמן כטופל");
    expect(taskView(emails(2, 0)).tone).toBe("info");
    expect(taskView(emails(2, 1)).tone).toBe("warning");
    expect(taskView(emails(2, 0)).link).toEqual({
      to: "/manage/emails",
      search: { filter: "failed" },
    });
  });
});

describe("activity log texts", () => {
  const e = (action: string, changes: Record<string, unknown>) =>
    activityText({
      at: "",
      actor: "דנה",
      actor_role: "owner",
      action,
      target: null,
      changes: changes as never,
    });

  it("says who marked how many alerts — never the email itself", () => {
    expect(e("emails.alert_seen", { count: 1 })).toBe("דנה סימן/ה כנקרא התראה על מייל שנכשל");
    expect(e("emails.alert_handled", { count: 3 })).toBe(
      "דנה סימן/ה כטופל 3 התראות על מיילים שנכשלו",
    );
    expect(e("emails.alert_handled", { count: 5, all: true })).toBe(
      "דנה סימן/ה כטופל את כל ההתראות על מיילים שנכשלו (5)",
    );
    expect(e("emails.alert_reopened", { count: 1 })).toBe(
      "דנה החזיר/ה להתראות התראה על מייל שנכשל",
    );
  });
});
