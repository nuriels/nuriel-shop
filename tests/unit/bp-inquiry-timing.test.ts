// Website inquiry form: the "sent too fast" bot check must not depend on the visitor's device clock
// (audit finding B-2). The old check compared the browser's Date.now() with the server's.
import { describe, expect, it } from "vitest";
import { MIN_FILL_MS, submittedTooFast } from "@/engines/business-profile/inquiries/logic";

const NOW = 1_800_000_000_000;

describe("inquiry form — too-fast check", () => {
  it("a bot answering instantly is refused (elapsed time sent by the client)", () => {
    expect(submittedTooFast({ elapsedMs: 50, startedAt: 0 }, NOW)).toBe(true);
    expect(submittedTooFast({ elapsedMs: MIN_FILL_MS - 1, startedAt: 0 }, NOW)).toBe(true);
  });

  it("a person who took a few seconds is accepted, whatever the device clock says", () => {
    expect(submittedTooFast({ elapsedMs: 4_000, startedAt: 0 }, NOW)).toBe(false);
    // the old client field: a device whose clock runs 10 minutes ahead (start is in the server's future)
    expect(submittedTooFast({ elapsedMs: null, startedAt: NOW + 600_000 }, NOW)).toBe(false);
    // and a device that is behind
    expect(submittedTooFast({ elapsedMs: null, startedAt: NOW - 600_000 }, NOW)).toBe(false);
  });

  it("old cached clients (startedAt only): still refused when the start is just now on the server's clock", () => {
    expect(submittedTooFast({ elapsedMs: null, startedAt: NOW - 100 }, NOW)).toBe(true);
    expect(submittedTooFast({ elapsedMs: null, startedAt: NOW - 5_000 }, NOW)).toBe(false);
  });

  it("no timing information at all is not a refusal (the other limits still apply)", () => {
    expect(submittedTooFast({ elapsedMs: null, startedAt: 0 }, NOW)).toBe(false);
  });

  it("a negative or absurd elapsed value is treated as missing, not as a bot", () => {
    expect(submittedTooFast({ elapsedMs: -5, startedAt: 0 }, NOW)).toBe(false);
    expect(submittedTooFast({ elapsedMs: Number.NaN, startedAt: 0 }, NOW)).toBe(false);
  });
});
