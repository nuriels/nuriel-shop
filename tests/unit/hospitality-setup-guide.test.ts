// מדריך ההקמה (מיגרציה 35): ההמשך מאותה נקודה, ההתקדמות, הטקסטים (טיוטה ≠ מפורסם), בדיקת הקלט
import { describe, expect, it } from "vitest";
import {
  MILESTONES,
  SETUP_STEP_DEFS,
  editorTab,
  publishText,
  resumeStep,
  setupProgress,
  stepFact,
  stepState,
} from "@/engines/hospitality/management/setup/model";
import { CHECKLIST_STEPS } from "@/engines/hospitality/management/lib/checklist";
import { NAV_ITEMS } from "@/engines/hospitality/management/lib/nav";
import { CHECKLIST_KEYS } from "@/engines/hospitality/types/management";
import { SETUP_STEPS, type SetupGuideView } from "@/engines/hospitality/types/setup";
import { parseSetupSave } from "@/engines/hospitality/validation/setup";

function view(done: Partial<Record<(typeof SETUP_STEPS)[number], boolean>> = {}): SetupGuideView {
  const d = (k: (typeof SETUP_STEPS)[number]) => done[k] === true;
  return {
    steps: {
      details: { done: d("details"), name: d("details"), address: false },
      contact: { done: d("contact"), phone: d("contact"), email: false, whatsapp: false },
      units: { done: d("units"), total: d("units") ? 2 : 0, active: d("units") ? 2 : 0 },
      photos: { done: d("photos"), count: d("photos") ? 3 : 0, units_without: 1 },
      prices: { done: d("prices"), priced: d("prices") ? 1 : 0, active: 2 },
      booking: {
        done: d("booking"),
        confirmed: false,
        mode: "request",
        check_in: "15:00",
        check_out: "11:00",
        approval_hours: 12,
      },
      policy: {
        done: d("policy"),
        confirmed: false,
        reviewed: d("policy"),
        name: "גמישה",
        free_cancel_days: 7,
      },
      payments: {
        done: d("payments"),
        confirmed: false,
        deposit_kind: "none",
        deposit_value: 0,
        deposit_due: "approval",
      },
      template: { done: d("template"), theme: d("template") ? "nature" : null },
      logo: { done: d("logo"), has: d("logo"), skipped: false },
      site: { done: d("site"), edited: d("site") },
      seo: { done: d("seo"), has: d("seo"), skipped: false },
      publish: {
        done: d("publish"),
        published: d("publish"),
        version: d("publish") ? 2 : null,
        published_at: d("publish") ? "2026-11-02T08:00:00Z" : null,
        unpublished: false,
        ready: false,
        site_open: false,
        booking_open: false,
      },
    },
    milestones: { business: false, units: false, photos: false, prices: false, site: false },
    bookable_units: 0,
    state: { current_step: null, confirmed: [], skipped: [], updated_at: null },
  };
}

describe("setup guide: steps and groups", () => {
  it("a definition for every step the database returns, in the same order, each in a group", () => {
    expect(SETUP_STEP_DEFS.map((s) => s.key)).toEqual([...SETUP_STEPS]);
    for (const s of SETUP_STEP_DEFS) {
      expect(["business", "units", "bookings", "site"]).toContain(s.group);
      expect(s.to).toMatch(/^\/manage\//);
    }
  });
  it("each step opens the screen with the same permission the navigation uses", () => {
    for (const s of SETUP_STEP_DEFS) {
      const nav = NAV_ITEMS.find((n) => n.to === s.to);
      expect(nav?.permission, s.key).toBe(s.permission);
    }
  });
  it("confirm only for review steps, skip only for optional ones (same lists as the database)", () => {
    expect(SETUP_STEP_DEFS.filter((s) => s.kind === "review").map((s) => s.key)).toEqual([
      "booking",
      "policy",
      "payments",
    ]);
    expect(SETUP_STEP_DEFS.filter((s) => s.kind === "optional").map((s) => s.key)).toEqual([
      "logo",
      "seo",
    ]);
  });
  it("five milestones, the same as the dashboard checklist", () => {
    expect(MILESTONES.map((m) => m.key)).toEqual([...CHECKLIST_KEYS]);
    expect(CHECKLIST_STEPS.map((s) => s.key)).toEqual([...CHECKLIST_KEYS]);
    expect(CHECKLIST_STEPS.find((s) => s.key === "site")?.to).toBe("/manage/setup");
  });
  it("the guide is in the navigation (account, settings permission)", () => {
    const item = NAV_ITEMS.find((i) => i.key === "setup")!;
    expect(item).toMatchObject({ to: "/manage/setup", group: "account", permission: "settings" });
  });
});

describe("setup guide: resume from the same point", () => {
  it("a new business starts at the first open step", () => {
    expect(resumeStep(view({ details: true, contact: true }))).toBe("units");
  });
  it("the saved step, while it is not done", () => {
    const v = view({ details: true, contact: true });
    v.state.current_step = "seo";
    expect(resumeStep(v)).toBe("seo");
  });
  it("a saved step that is done → the next open step after it, then from the start", () => {
    const v = view({ details: true, contact: true, prices: true });
    v.state.current_step = "prices";
    expect(resumeStep(v)).toBe("booking");
    const w = view({ details: true, contact: true, units: true, publish: true });
    w.state.current_step = "publish";
    expect(resumeStep(w)).toBe("photos");
  });
  it("everything done → nothing to resume", () => {
    const all = Object.fromEntries(SETUP_STEPS.map((k) => [k, true]));
    expect(resumeStep(view(all))).toBeNull();
  });
  it("progress counts the 13 steps", () => {
    expect(setupProgress(view())).toEqual({ done: 0, total: 13, percent: 0 });
    expect(setupProgress(view({ details: true, contact: true, units: true }))).toEqual({
      done: 3,
      total: 13,
      percent: 23,
    });
  });
});

describe("setup guide: states and texts", () => {
  it("done / confirmed / skipped / open", () => {
    const v = view({ booking: true, details: true });
    v.steps.booking.confirmed = true;
    v.steps.logo = { done: true, has: false, skipped: true };
    expect(stepState(v, "booking")).toBe("confirmed");
    expect(stepState(v, "details")).toBe("done");
    expect(stepState(v, "logo")).toBe("skipped");
    expect(stepState(v, "units")).toBe("todo");
  });
  it("facts: counts, prices out of active units, deposit, theme", () => {
    const v = view({ units: true, photos: true, prices: true, template: true });
    expect(stepFact(v, "units")).toBe("2 יחידות פעילות");
    expect(stepFact(v, "photos")).toBe("3 תמונות · יחידה אחת בלי תמונה משלה");
    expect(stepFact(v, "prices")).toBe("מחיר ל-1 מתוך 2 היחידות הפעילות");
    expect(stepFact(v, "template")).toBe('תבנית "טבע"');
    expect(stepFact(v, "payments")).toBe("תשלום בטלפון · בלי מקדמה");
    v.steps.payments = { ...v.steps.payments, deposit_kind: "percent", deposit_value: 30 };
    expect(stepFact(v, "payments")).toBe("תשלום בטלפון · מקדמה 30% באישור ההזמנה");
    // מיגרציה 37: אמצעי התשלום שהוגדרו
    v.steps.payments = { ...v.steps.payments, methods: ["bank", "bit", "phone", "note"] };
    expect(stepFact(v, "payments")).toBe(
      "העברה בנקאית · Bit · תשלום בטלפון · הוראות משלכם · מקדמה 30% באישור ההזמנה",
    );
    expect(stepFact(v, "booking")).toBe("הגעה 15:00 · עזיבה 11:00 · אישור בקשה תוך 12 שעות");
  });
  it("never a draft as published", () => {
    const draft = view({ template: true });
    draft.steps.publish.ready = true;
    expect(publishText(draft).headline).toBe("עוד לא פורסם — מה שבעורך הוא טיוטה");
    expect(publishText(draft).headline).not.toMatch(/פורסמה/);
    expect(publishText(draft).detail).toBe("הכול מוכן לפרסום הראשון.");
    const changed = view({ publish: true });
    changed.steps.publish.unpublished = true;
    expect(publishText(changed).headline).toBe(
      "גרסה 2 פורסמה ב-2026-11-02 · יש שינויים שעוד לא פורסמו",
    );
    expect(publishText(changed).detail).toBe("האורחים רואים את הגרסה שפורסמה, לא את הטיוטה.");
    expect(publishText(view({ publish: true })).tone).toBe("success");
    // פתיחת האתר — של הפלטפורמה
    expect(publishText(view({ publish: true })).open).toMatch(/סגור לגולשים/);
  });
  it("editor tab from the address: only known tabs", () => {
    expect(editorTab("seo")).toBe("seo");
    expect(editorTab("publish")).toBe("publish");
    expect(editorTab("evil")).toBeNull();
    expect(editorTab(3)).toBeNull();
  });
});

describe("setup guide: input before the database", () => {
  it("valid pairs pass", () => {
    expect(parseSetupSave({ step: "prices", action: "visit" })).toEqual({
      step: "prices",
      action: "visit",
    });
    expect(parseSetupSave({ step: "booking", action: "confirm" }).action).toBe("confirm");
    expect(parseSetupSave({ step: "seo", action: "skip" }).step).toBe("seo");
  });
  it("unknown step / action, confirm or skip where they do not fit → refused", () => {
    expect(() => parseSetupSave({ step: "x", action: "visit" })).toThrow("צעד לא מוכר");
    expect(() => parseSetupSave({ step: "units", action: "done" })).toThrow("פעולה לא מוכרת");
    expect(() => parseSetupSave({ step: "units", action: "confirm" })).toThrow("במסך שלו");
    expect(() => parseSetupSave({ step: "publish", action: "skip" })).toThrow("לדלג");
    expect(() => parseSetupSave(null)).toThrow("צעד לא מוכר");
  });
});
