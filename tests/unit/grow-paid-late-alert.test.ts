// A card payment that arrives after the order expired / was cancelled used to be recorded only in the platform
// audit log — nobody in the store knew a customer had been charged (audit finding F2 / R-2). Now the store's
// admins get a notification.
import { beforeEach, describe, expect, it, vi } from "vitest";

const inserted: { table: string; rows: Record<string, unknown>[] }[] = [];
let admins: { user_id: string }[] = [];
let failInsert = false;

function builder(table: string) {
  const b: Record<string, unknown> = {};
  const result = () => ({
    data: table === "user_roles" ? admins : [{ order_number: "SH260000123" }],
    error: null,
  });
  b["eq"] = () => b;
  b["maybeSingle"] = async () => ({ data: { order_number: "SH260000123" }, error: null });
  b["then"] = (resolve: (v: unknown) => unknown) => resolve(result());
  return b;
}
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdminUnscoped: {
    rpc: vi.fn(),
    from: (table: string) => ({
      select: () => builder(table),
      insert: async (rows: Record<string, unknown>[]) => {
        if (failInsert) throw new Error("db down");
        inserted.push({ table, rows });
        return { error: null };
      },
    }),
  },
}));
vi.mock("@/lib/platform-files.server", () => ({ recordPlatformAudit: vi.fn() }));
vi.mock("@/lib/grow.server", () => ({
  parseGrowWebhook: vi.fn(),
  sha256Hex: (v: string) => v,
  loadGrowCredentials: vi.fn(),
  approveGrowTransaction: vi.fn(),
}));

import { alertStaffPaidLate } from "@/lib/grow-webhook.server";

beforeEach(() => {
  inserted.length = 0;
  admins = [{ user_id: "u1" }, { user_id: "u2" }];
  failInsert = false;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("Grow — payment after the order expired", () => {
  it("every admin of THAT store gets a notification naming the order, and nothing else is touched", async () => {
    await alertStaffPaidLate("tenant-1", "order-1");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.table).toBe("staff_notifications");
    const rows = inserted[0]!.rows;
    expect(rows.map((r) => r["user_id"])).toEqual(["u1", "u2"]);
    expect(new Set(rows.map((r) => r["tenant_id"]))).toEqual(new Set(["tenant-1"]));
    expect(String(rows[0]!["body"])).toContain("SH260000123");
    expect(String(rows[0]!["body"])).toContain("החזר");
  });

  it("no tenant, or no admins: nothing is written and nothing throws", async () => {
    await alertStaffPaidLate(null, "order-1");
    admins = [];
    await alertStaffPaidLate("tenant-1", "order-1");
    expect(inserted).toHaveLength(0);
  });

  it("a failure to notify never breaks the webhook answer", async () => {
    failInsert = true;
    await expect(alertStaffPaidLate("tenant-1", "order-1")).resolves.toBeUndefined();
  });
});
