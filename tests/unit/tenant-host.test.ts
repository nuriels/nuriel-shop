import { describe, expect, it } from "vitest";
import { requestHost } from "@/integrations/supabase/tenant.server";

describe("request host (input to tenant resolution by domain)", () => {
  const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

  it("uses the first x-forwarded-host, lowercase, without a port", () => {
    expect(
      requestHost(
        req("http://internal:3000/", { "x-forwarded-host": "Shop.Example.COM:443, proxy.local" }),
      ),
    ).toBe("shop.example.com");
  });

  it("falls back to the Host header and then to the URL", () => {
    expect(requestHost(req("http://internal:3000/", { host: "kobi.nuri1.fit:8080" }))).toBe(
      "kobi.nuri1.fit",
    );
    expect(requestHost(req("http://store-b.nuri1.fit/x"))).toBe("store-b.nuri1.fit");
  });
});
