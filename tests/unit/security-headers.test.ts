// SEC-M1: כותרות אבטחה לכל תגובה של השרת המשותף — רק כותרות שחסרות (עמודי Hospitality שומרים
// את שלהם), מסמכי HTML מקבלים גם הגנת מסגור / Referrer / Permissions / CSP בסיסי.
import { describe, expect, it } from "vitest";
import { missingSecurityHeaders, withSecurityHeaders } from "@/lib/security-headers";

const html = (headers: Record<string, string> = {}) =>
  new Response("<!doctype html><title>x</title>", {
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });

describe("withSecurityHeaders (SEC-M1)", () => {
  it("a store / admin / platform HTML page gets the full set (anti-framing, HSTS, nosniff…)", () => {
    const res = withSecurityHeaders(html());
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    expect(res.headers.get("content-security-policy")).toContain("object-src 'none'");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=15552000");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("keeps the camera for the site itself (barcode scanning at the till / intake / stock count)", () => {
    const policy = withSecurityHeaders(html()).headers.get("permissions-policy") ?? "";
    expect(policy).toContain("camera=(self)");
    expect(policy).toContain("microphone=()");
  });

  it("never overwrites a header the route already set (Hospitality keeps its own values)", () => {
    const res = withSecurityHeaders(
      html({
        "permissions-policy": "camera=(), microphone=()",
        "referrer-policy": "same-origin",
        "cache-control": "private, no-store",
      }),
    );
    expect(res.headers.get("permissions-policy")).toBe("camera=(), microphone=()");
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("non-HTML responses (JSON, images, feeds) get only HSTS + nosniff", () => {
    const res = withSecurityHeaders(
      new Response("{}", { headers: { "content-type": "application/json" } }),
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=15552000");
    expect(res.headers.get("x-frame-options")).toBeNull();
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  it("a response with locked headers is copied — status, body and existing headers kept", async () => {
    const redirect = Response.redirect("https://example.com/next", 302);
    const res = withSecurityHeaders(redirect);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/next");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("nothing to add → the same response object", () => {
    const full = html();
    for (const [name, value] of missingSecurityHeaders(full.headers)) full.headers.set(name, value);
    expect(withSecurityHeaders(full)).toBe(full);
  });
});
