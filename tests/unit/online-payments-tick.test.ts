// MAX/Hyp DEMO — the 5-minute tick and the store review alerts (contract §7.1 X-17, X-19). Only the database client,
// the store context and the e-mail service are fakes: no network, no database, no Hyp call.
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: [] as string[],
  rpcAnswer: new Map<string, { data: unknown; error: { message: string; code: string } | null }>(),
  inserts: [] as { table: string; rows: unknown }[],
  insertError: null as { message: string } | null,
  admins: [] as { user_id: string; email: string | null }[],
  mails: [] as { to: string[]; subject: string; template: string }[],
  mailThrows: false,
}));

vi.mock("@/integrations/supabase/client.server", () => {
  const query = (table: string) => {
    const result = () =>
      table === "user_roles"
        ? { data: h.admins, error: null }
        : table === "orders"
          ? { data: { order_number: "1042" }, error: null }
          : { data: null, error: null };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => result(),
      insert: async (rows: unknown) => {
        h.inserts.push({ table, rows });
        return { data: null, error: h.insertError };
      },
      then: (resolve: (v: unknown) => unknown) => resolve(result()),
    };
    return chain;
  };
  return {
    supabaseAdminUnscoped: {
      rpc: async (fn: string) => {
        h.rpc.push(fn);
        return h.rpcAnswer.get(fn) ?? { data: fn === "expire_unpaid_orders" ? 0 : [], error: null };
      },
      from: query,
    },
  };
});
vi.mock("@/integrations/supabase/tenant.server", () => ({
  maybeCurrentTenant: () => null,
  loadTenantById: async (id: string) => ({ id, slug: "store-b", domain: null }),
  runWithTenant: async (_host: string, _tenant: unknown, work: () => Promise<void>) => work(),
}));
vi.mock("@/server/services/notifications", () => ({
  sendNotificationEmail: vi.fn(
    async (input: { to: string[]; subject: string; template: string }) => {
      if (h.mailThrows) throw new Error("mail down");
      h.mails.push({ to: input.to, subject: input.subject, template: input.template });
      return { sent: true, provider: "platform", fellBack: false };
    },
  ),
}));
vi.mock("@/lib/email.server", () => ({
  renderEmailHtml: async (title: string, body: string) => `<h1>${title}</h1>${body}`,
  escapeHtml: (v: string) => v,
}));

const STORE_B = "7e2e0000-0000-0000-0000-00000000000b";
const ORDER = "11111111-2222-4333-8444-555555555555";
const ATTEMPT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ADMIN = "e2e00000-0000-0000-0000-0000000000f0";

const saved = { ...process.env };
beforeAll(() => {
  process.env["PAYMENTS_ENV"] = "demo";
  process.env["PLATFORM_ADMIN_HOST"] = "platform.shop.localhost";
  process.env["PAYMENTS_SECRETS_KEY"] = randomBytes(32).toString("hex");
  process.env["PLATFORM_TERMINAL_SECRETS_KEY"] = randomBytes(32).toString("hex");
  delete process.env["PAYMENTS_JOBS"];
});
afterAll(() => {
  for (const name of [
    "PAYMENTS_ENV",
    "PLATFORM_ADMIN_HOST",
    "PAYMENTS_SECRETS_KEY",
    "PLATFORM_TERMINAL_SECRETS_KEY",
    "PAYMENTS_JOBS",
  ]) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});
let quiet: { mockRestore(): void }[] = [];
beforeEach(() => {
  h.rpc.length = 0;
  h.rpcAnswer.clear();
  h.inserts.length = 0;
  h.insertError = null;
  h.admins = [{ user_id: ADMIN, email: "owner@store-b.example" }];
  h.mails.length = 0;
  h.mailThrows = false;
  quiet = [
    vi.spyOn(console, "log").mockImplementation(() => undefined),
    vi.spyOn(console, "warn").mockImplementation(() => undefined),
  ];
});
afterEach(() => {
  for (const spy of quiet) spy.mockRestore();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const alertLines = (spy: { mock: { calls: unknown[][] } }): string[] =>
  spy.mock.calls.map((c) => String(c[0])).filter((line) => line.includes("ALERT"));

describe("X-19: the 5-minute tick", () => {
  it("R2-9: expire_unpaid_orders runs first; PAYMENTS_JOBS=off → nothing else", async () => {
    const { paymentsTick } = await import("@/server/services/payment-expiry");
    process.env["PAYMENTS_JOBS"] = "off";
    try {
      await paymentsTick();
    } finally {
      delete process.env["PAYMENTS_JOBS"];
    }
    expect(h.rpc).toEqual(["expire_unpaid_orders"]);
  });

  it("R2-2: jobs on but payments not ready → no VERIFY list, the DB-only steps and the alert claim still run", async () => {
    const { paymentsTick } = await import("@/server/services/payment-expiry");
    process.env["PAYMENTS_SECRETS_KEY"] = "";
    try {
      await paymentsTick();
    } finally {
      process.env["PAYMENTS_SECRETS_KEY"] = randomBytes(32).toString("hex");
    }
    expect(h.rpc).toEqual([
      "expire_unpaid_orders",
      "max_attempts_expire",
      "platform_payment_returns_purge",
      "max_review_alerts_claim",
    ]);
  });

  it("ready: expiry first, then VERIFY retries, sweep, purge, claim — and a claimed review rings once", async () => {
    const { paymentsTick } = await import("@/server/services/payment-expiry");
    h.rpcAnswer.set("max_review_alerts_claim", {
      data: [
        {
          attempt_id: ATTEMPT,
          tenant_id: STORE_B,
          order_id: ORDER,
          review_reason: "verify_exhausted",
        },
      ],
      error: null,
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await paymentsTick();
      expect(alertLines(errors)).toEqual([
        "[pay:tenant] ALERT needs_review attempt=aaaaaaaa reason=verify_exhausted",
      ]);
    } finally {
      errors.mockRestore();
    }
    expect(h.rpc).toEqual([
      "expire_unpaid_orders",
      "max_attempts_pending_verify",
      "max_attempts_expire",
      "platform_payment_returns_purge",
      "max_review_alerts_claim",
    ]);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]?.table).toBe("staff_notifications");
    expect(h.mails).toEqual([
      {
        to: ["owner@store-b.example"],
        subject: "תשלום מקוון לבדיקה — 1042",
        template: "order_staff",
      },
    ]);
  });
});

describe("X-17: a claimed review → bell + e-mail; a failure is an ALERT, never silent", () => {
  const item = { tenantId: STORE_B, attemptId: ATTEMPT, orderId: ORDER, reason: "amount_mismatch" };

  it("sends the store bell and the e-mail to the store's admins", async () => {
    const { actOnTenantOutcomes } = await import("@/lib/online-payments.server");
    await actOnTenantOutcomes({ paid: [], review: [item] });
    const rows = h.inserts[0]?.rows as { body: string; tenant_id: string; user_id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant_id: STORE_B, user_id: ADMIN });
    expect(rows[0]?.body).toContain("1042");
    expect(h.mails).toHaveLength(1);
  });

  it("the bell cannot be written / the e-mail fails → an ALERT line with the attempt's short id", async () => {
    const { actOnTenantOutcomes } = await import("@/lib/online-payments.server");
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      h.insertError = { message: "down" };
      await actOnTenantOutcomes({ paid: [], review: [item] });
      h.insertError = null;
      h.mailThrows = true;
      await actOnTenantOutcomes({ paid: [], review: [item] });
      expect(alertLines(errors)).toEqual([
        "[pay:tenant] ALERT review_alert_failed attempt=aaaaaaaa",
        "[pay:tenant] ALERT review_alert_failed attempt=aaaaaaaa",
      ]);
    } finally {
      errors.mockRestore();
    }
  });
});
