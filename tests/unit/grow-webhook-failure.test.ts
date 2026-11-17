// Grow webhook: a failure to MARK the order as paid must not be answered with 200.
// Grow stops retrying after a 2xx; the order then expires after 2 hours and the stock is released
// although the customer was charged (audit finding B-1, docs/audit/BUGS-AND-FIXES.md).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdminUnscoped: { rpc } }));
vi.mock("@/lib/platform-files.server", () => ({ recordPlatformAudit: vi.fn() }));
vi.mock("@/lib/grow.server", () => ({
  parseGrowWebhook: vi.fn(async () => ({
    processId: "p1",
    processToken: "t1",
    sum: 10,
    statusCode: "2",
    asmachta: "a1",
    transactionId: "tx1",
    cardBrand: "visa",
    cardSuffix: "1234",
    paymentsNum: 1,
  })),
  sha256Hex: (value: string) => `hash(${value})`,
  loadGrowCredentials: vi.fn(),
  approveGrowTransaction: vi.fn(),
}));

import { growWebhookStatus, processGrowWebhook } from "@/lib/grow-webhook.server";

beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("Grow webhook — answering Grow", () => {
  it("a database error while marking paid is an error outcome → HTTP 500 (Grow can retry)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "connection terminated" } });
    const outcome = await processGrowWebhook(
      new Request("https://x/api/webhooks/grow", { method: "POST" }),
    );
    expect(outcome).toBe("error");
    expect(growWebhookStatus(outcome)).toBe(500);
  });

  it("malformed → 400; every handled outcome stays 200 (nothing is revealed to a sender)", () => {
    expect(growWebhookStatus("malformed")).toBe(400);
    for (const outcome of ["paid", "already_paid", "paid_late", "rejected", "ignored"] as const) {
      expect(growWebhookStatus(outcome)).toBe(200);
    }
  });

  it("an unknown process (a result, not an error) is still ignored with 200", async () => {
    rpc.mockResolvedValue({ data: { result: "unknown" }, error: null });
    const outcome = await processGrowWebhook(
      new Request("https://x/api/webhooks/grow", { method: "POST" }),
    );
    expect(outcome).toBe("ignored");
    expect(rpc).toHaveBeenCalledTimes(2); // production, then sandbox
  });
});
