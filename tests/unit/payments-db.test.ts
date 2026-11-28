// MAX/Hyp DEMO — src/platform/payments/server/db.ts: the one service-role adapter of the payments code.
// The client is faked: no network, no database.
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const getUserById = vi.fn();

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdminUnscoped: { rpc, auth: { admin: { getUserById } } },
  // the store-scoped client must never be used by the payments adapter
  supabaseAdmin: new Proxy(
    {},
    {
      get() {
        throw new Error("supabaseAdmin used");
      },
    },
  ),
}));

const { accountEmail, paymentsRpc, stepupRpc } = await import("@/platform/payments/server/db");

beforeEach(() => {
  rpc.mockReset();
  getUserById.mockReset();
});

describe("payments DB adapter", () => {
  it("calls a migration-208 function through the unscoped client with the given arguments", async () => {
    rpc.mockResolvedValue({ data: { result: "received" }, error: null });
    const out = await paymentsRpc("max_attempt_record_return", {
      _host_tenant: "7e2e0000-0000-0000-0000-00000000000b",
      _reference: "0".repeat(32),
      _payload_sha256: "a".repeat(64),
      _ccode: "0",
      _txn_id: "123",
      _amount_minor: 1000,
      _installments: null,
    });
    expect(out).toEqual({ data: { result: "received" }, error: null });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe("max_attempt_record_return");
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ _amount_minor: 1000, _installments: null });
  });

  it("functions without arguments take none", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    expect(await paymentsRpc("max_attempts_expire")).toEqual({ data: 3, error: null });
    expect(rpc).toHaveBeenCalledWith("max_attempts_expire", undefined);
  });

  it("refuses every function outside the payments API, without a call", async () => {
    for (const fn of [
      "platform_delete_tenant",
      "expire_unpaid_orders",
      "is_platform_admin",
      "max",
      "",
    ]) {
      const out = await (paymentsRpc as (f: string, a?: object) => Promise<unknown>)(fn, {});
      expect(out, fn).toEqual({
        data: null,
        error: { message: "payments: function not allowed", code: null },
      });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers DB errors as { message, code } and never throws", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "order not found", code: "P0002" } });
    expect(await paymentsRpc("max_attempts_expire")).toEqual({
      data: null,
      error: { message: "order not found", code: "P0002" },
    });
    rpc.mockRejectedValue(new Error("fetch failed: secret-looking text"));
    expect(await paymentsRpc("platform_attempts_expire")).toEqual({
      data: null,
      error: { message: "payments: database unavailable", code: null },
    });
  });

  it("the step-up DB caller has the StepupRpc shape (names come from stepup.ts)", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(stepupRpc("platform_stepup_consume", { _actor: "x" })).resolves.toEqual({
      data: { ok: true },
      error: null,
    });
    expect(rpc).toHaveBeenCalledWith("platform_stepup_consume", { _actor: "x" });
  });

  it("accountEmail reads one account's sign-in address, and nothing for a bad id or an error", async () => {
    getUserById.mockResolvedValue({ data: { user: { email: "Platform@E2E.test " } }, error: null });
    expect(await accountEmail("e2e00000-0000-0000-0000-0000000000f0")).toBe("platform@e2e.test");
    expect(await accountEmail("not-a-uuid")).toBeNull();
    getUserById.mockResolvedValue({ data: { user: null }, error: { message: "x" } });
    expect(await accountEmail("e2e00000-0000-0000-0000-0000000000f0")).toBeNull();
    getUserById.mockRejectedValue(new Error("network"));
    expect(await accountEmail("e2e00000-0000-0000-0000-0000000000f0")).toBeNull();
    expect(getUserById).toHaveBeenCalledTimes(3);
  });
});
