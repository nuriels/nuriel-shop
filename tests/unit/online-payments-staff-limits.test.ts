import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// E2E BUG-A: the orders screen reads one online-payment status per order card; those reads must not use up the
// budget of the staff actions (cancel / resolve). Reads and actions therefore use separate rate-limit buckets.
describe("online-payments staff rate limits (E2E BUG-A)", () => {
  const src = readFileSync("src/lib/online-payments-staff.functions.ts", "utf8");

  it("reads and actions use separate buckets", () => {
    expect(src).toContain("pay-staff-${kind}:${userId}");
    expect(src).not.toMatch(/`pay-staff:\$\{userId\}`/);
  });

  it("the status read is a read; cancel and resolve are actions", () => {
    const calls = [...src.matchAll(/staffContext\(context\.userId, (\d+), "(read|write)"\)/g)].map(
      (m) => [Number(m[1]), m[2]],
    );
    expect(calls).toEqual([
      [240, "read"],
      [30, "write"],
      [30, "write"],
    ]);
  });
});
