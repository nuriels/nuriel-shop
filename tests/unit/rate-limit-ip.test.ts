// SEC-M2: הגבלות הקצב המשותפות (src/lib/rate-limit.server.ts → requestIp) לוקחות את ה-IP רק
// ממקור שהשרת קובע — X-Real-IP, אחרת ההופ האחרון ב-X-Forwarded-For — ולא את ההופ הראשון,
// שהדפדפן שולח וזיופו עוקף כל הגבלה לפי IP.
import { describe, expect, it, vi } from "vitest";

const headersOf = (init: Record<string, string>) => new Headers(init);

let current: Headers | null = null;
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => (current ? { headers: current } : undefined),
}));

describe("requestIp (shared rate limits) — SEC-M2", () => {
  it("ignores a spoofed first X-Forwarded-For hop and uses the hop our proxy added", async () => {
    const { requestIp } = await import("@/lib/rate-limit.server");
    current = headersOf({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" });
    expect(await requestIp()).toBe("203.0.113.9");
  });

  it("prefers X-Real-IP (written by Nginx on every request)", async () => {
    const { requestIp } = await import("@/lib/rate-limit.server");
    current = headersOf({ "x-real-ip": "198.51.100.7", "x-forwarded-for": "1.1.1.1, 198.51.100.7" });
    expect(await requestIp()).toBe("198.51.100.7");
  });

  it("rotating the spoofed hop does not create a new rate-limit identity", async () => {
    const { requestIp } = await import("@/lib/rate-limit.server");
    const seen = new Set<string>();
    for (const fake of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
      current = headersOf({ "x-forwarded-for": `${fake}, 203.0.113.9` });
      seen.add(await requestIp());
    }
    expect([...seen]).toEqual(["203.0.113.9"]);
  });

  it("a garbage header or no request → 'unknown' (never the attacker's string)", async () => {
    const { requestIp } = await import("@/lib/rate-limit.server");
    current = headersOf({ "x-forwarded-for": "1.2.3.4, <script>" });
    expect(await requestIp()).toBe("unknown");
    current = null;
    expect(await requestIp()).toBe("unknown");
  });

  it("Hospitality keeps the same rules (re-export of the platform module)", async () => {
    const hosp = await import("@/engines/hospitality/security/client-ip");
    const platform = await import("@/platform/security/client-ip");
    expect(hosp.clientIp).toBe(platform.clientIp);
  });
});
