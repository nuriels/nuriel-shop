// SEC-H2: כתובת ה-handoff חייבת להיות תמיד על תת-הדומיין של הפלטפורמה — לעולם לא דומיין מותאם
// (קוד כניסה חד-פעמי שנוחת על דומיין שבעל-חנות מכוון את ה-DNS שלו = גניבת סשן חוצת-עסקים).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { originForTenant, slugOriginForTenant } from "@/integrations/supabase/tenant.server";

const BASE = "shop.example.com";
const SITE = "https://portal.example.com";

describe("slugOriginForTenant (SEC-H2)", () => {
  beforeEach(() => {
    process.env["TENANT_BASE_DOMAIN"] = BASE;
    process.env["PUBLIC_SITE_URL"] = SITE;
  });
  afterEach(() => {
    delete process.env["TENANT_BASE_DOMAIN"];
    delete process.env["PUBLIC_SITE_URL"];
  });

  it("returns the platform sub-domain for a normal store", () => {
    expect(slugOriginForTenant({ slug: "acme", is_default: false })).toBe(`https://acme.${BASE}`);
  });

  it("returns the main site URL for the default store", () => {
    expect(slugOriginForTenant({ slug: "root", is_default: true })).toBe(SITE);
  });

  it("ignores any active custom domain the store set (unlike originForTenant)", () => {
    const tenant = {
      slug: "acme",
      domain: "acme.co.il",
      is_default: false,
      custom_domain: "attacker-points-dns-here.co.il",
      custom_domain_status: "active",
    };
    expect(originForTenant(tenant)).toBe("https://acme.co.il");
    expect(slugOriginForTenant(tenant)).toBe(`https://acme.${BASE}`);
    expect(slugOriginForTenant(tenant)).not.toContain("attacker-points-dns-here");
    expect(slugOriginForTenant(tenant)).not.toContain("acme.co.il");
  });
});
