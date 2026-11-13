// תור המיילים של Hospitality (outbox/worker.server.ts): כל שלב בסבב עומד בפני עצמו. לפני התיקון כל
// הסבב היה ב-try אחד — כשל ב-expire_holds (השלב הראשון) דילג על שליחת המיילים בכל סבב, וכשל
// בסנכרון היומנים דילג על השלמת החוזים. כאן: כל השלבים שמסביב נכשלים, והמייל עדיין יוצא ומסומן.
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendBusinessEmail = vi.fn(async (input: { to: string; idempotencyKey: string }) => ({
  sent: true,
  skipped: false,
  id: `msg-${input.idempotencyKey}`,
  reason: null,
}));
const runContractPendingWork = vi.fn(async () => undefined);
const checkPendingVideos = vi.fn(async () => undefined);
const runDueChannelSyncs = vi.fn(async () => {
  throw new Error("channels down");
});

vi.mock("@tanstack/react-start", () => ({
  createServerOnlyFn: <T extends (...a: never[]) => unknown>(fn: T) => fn,
}));
vi.mock("@/platform/email/send.server", () => ({
  sendBusinessEmail,
  escapeHtml: (v: string) => v.replace(/[&<>"']/g, ""),
}));
vi.mock("@/platform/supabase/env.server", () => ({
  supabaseUrl: () => "http://db.test",
  serviceHeaders: () => ({ apikey: "k", Authorization: "Bearer k" }),
}));
vi.mock("@/platform/tenancy/current-site.server", () => ({
  siteOrigin: async () => "https://demo.example.test",
}));
vi.mock("@/engines/hospitality/channels/import.server", () => ({ runDueChannelSyncs }));
vi.mock("@/engines/hospitality/server/video-check.server", () => ({ checkPendingVideos }));
vi.mock("@/engines/hospitality/server/contracts.server", () => ({ runContractPendingWork }));

const TENANT = "11111111-1111-4111-8111-111111111111";
const NOTIFICATION = {
  id: "22222222-2222-4222-8222-222222222222",
  tenant_id: TENANT,
  booking_id: null,
  event: "request_received",
  recipient_kind: "guest",
  recipient_email: "guest@example.test",
  payload: { booking_number: "1001", unit_name: "סוויטה", check_in: "2026-12-01" },
};

let calls: { name: string; body: unknown }[] = [];
let claimed = false;
let failing = new Set<string>();

function respond(status: number, body: unknown): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), { status });
}

beforeEach(() => {
  calls = [];
  claimed = false;
  failing = new Set(["expire_holds", "open_dates_remind", "apply_retention", "rate_sweep"]);
  sendBusinessEmail.mockClear();
  runContractPendingWork.mockClear();
  checkPendingVideos.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      const u = new URL(url);
      const rpc = u.pathname.match(/\/rest\/v1\/rpc\/(\w+)$/)?.[1];
      const name = rpc ?? u.pathname.split("/").pop() ?? "";
      calls.push({ name, body: init?.body ? JSON.parse(init.body) : null });
      if (failing.has(name)) return respond(500, { message: `${name} broke` });
      if (name === "claim_notifications") {
        if (claimed) return respond(200, []);
        claimed = true;
        return respond(200, [NOTIFICATION]);
      }
      if (name === "settings") return respond(200, [{ business_name: "נופי בדיקה" }]);
      if (name === "tenants") return respond(200, [{ slug: "demo", domain: null, name: "Demo" }]);
      if (name === "email_payment_methods") return respond(200, ["phone"]);
      return respond(200, null);
    }),
  );
});

describe("hospitality outbox worker — one failing step does not stop the emails", () => {
  it("expire_holds and the other maintenance steps fail; the queued email is still sent and marked", async () => {
    const { outboxTickNow } = await import("@/engines/hospitality/outbox/worker.server");
    await outboxTickNow();

    expect(sendBusinessEmail).toHaveBeenCalledTimes(1);
    expect(sendBusinessEmail.mock.calls[0]![0]).toMatchObject({
      to: "guest@example.test",
      idempotencyKey: `hosp-${NOTIFICATION.id}`,
    });
    const mark = calls.find((c) => c.name === "mark_notification");
    expect(mark?.body).toMatchObject({ _id: NOTIFICATION.id, _ok: true, _error: null });

    // השלבים שאחרי התקלה בסנכרון היומנים עדיין רצו
    expect(runContractPendingWork).toHaveBeenCalledTimes(1);
    expect(checkPendingVideos).toHaveBeenCalledTimes(1);
    const order = calls.map((c) => c.name);
    expect(order.indexOf("expire_holds")).toBeLessThan(order.indexOf("claim_notifications"));
    expect(order).toContain("rate_sweep");
  });

  it("a failing queue claim is logged and the round still finishes (the next round can try again)", async () => {
    failing.add("claim_notifications");
    const { outboxTickNow } = await import("@/engines/hospitality/outbox/worker.server");
    await expect(outboxTickNow()).resolves.toBeUndefined();
    expect(sendBusinessEmail).not.toHaveBeenCalled();
    // a second round is not blocked by the "running" flag of the first one
    failing.delete("claim_notifications");
    await outboxTickNow();
    expect(sendBusinessEmail).toHaveBeenCalledTimes(1);
  });
});
