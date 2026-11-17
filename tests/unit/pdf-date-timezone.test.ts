// Order / pick-slip PDFs and the reset-link e-mail must print Israel time, whatever the server's TZ
// (audit finding B-6: the container has no TZ, so dates were printed in UTC — an order placed at 00:30
// Israel time showed the previous day).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdminUnscoped: {} }));

import { formatDocumentDate } from "@/lib/pdf/document.server";

describe("PDF date", () => {
  it("prints Asia/Jerusalem time (winter, UTC+2): 22:30Z is already the next day", () => {
    expect(formatDocumentDate("2026-11-16T22:30:00Z")).toBe("17.11.2026 00:30");
  });

  it("prints Asia/Jerusalem time (summer, UTC+3)", () => {
    expect(formatDocumentDate("2026-07-01T20:59:00Z")).toBe("01.07.2026 23:59");
    expect(formatDocumentDate("2026-07-01T21:00:00Z")).toBe("02.07.2026 00:00");
  });

  it("handles the DST changeover days (spring forward 2026-03-27)", () => {
    expect(formatDocumentDate("2026-03-26T21:59:00Z")).toBe("26.03.2026 23:59");
    expect(formatDocumentDate("2026-03-27T00:30:00Z")).toBe("27.03.2026 03:30");
  });
});
