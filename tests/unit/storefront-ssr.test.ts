import { describe, expect, it } from "vitest";
import type { CatalogItem } from "@/lib/catalog";
import { serverRichContentHtml } from "@/lib/rich-text";
import { SEED_DESCRIPTION_MAX, trimSeedDescription } from "@/lib/storefront-seed.functions";

const item = (description: string | null): CatalogItem =>
  ({ id: "p1", name: "מוצר", description }) as unknown as CatalogItem;

describe("storefront SSR seed", () => {
  it("keeps short descriptions and trims long ones (the browser loads the full text right after)", () => {
    const short = item("תיאור קצר");
    expect(trimSeedDescription(short)).toBe(short);
    expect(trimSeedDescription(item(null)).description).toBeNull();
    const long = item("א".repeat(SEED_DESCRIPTION_MAX + 50));
    const trimmed = trimSeedDescription(long);
    expect(trimmed.description).toHaveLength(SEED_DESCRIPTION_MAX);
    // לא משנה את האובייקט המקורי (הקטלוג במטמון)
    expect(long.description).toHaveLength(SEED_DESCRIPTION_MAX + 50);
  });
});

describe("rich content on the server and in the first browser render", () => {
  it("is plain escaped text in paragraphs — the same in both, so hydration matches", () => {
    const html = serverRichContentHtml(
      '<p>שורה <b>מודגשת</b></p><ul><li>אחד</li><li>שניים</li></ul><script>alert(1)</script><img src=x onerror="alert(2)">',
    );
    expect(html).not.toMatch(/<(b|ul|li|script|img)\b/);
    expect(html).not.toContain("onerror");
    expect(html).toContain("שורה מודגשת");
    expect(html).toContain("אחד");
    expect(html.startsWith("<p>")).toBe(true);
  });

  it("escapes text that looks like markup", () => {
    expect(serverRichContentHtml("1 < 2 & 3 > 2")).toBe("<p>1 &lt; 2 &amp; 3 &gt; 2</p>");
  });

  it("empty content renders nothing", () => {
    expect(serverRichContentHtml("")).toBe("");
    expect(serverRichContentHtml(null)).toBe("");
  });
});
