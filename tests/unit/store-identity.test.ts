import { describe, expect, it } from "vitest";
import { DEFAULT_STORE_NAME } from "@/lib/branding";
import { legalVariablesFrom } from "@/lib/legal-content";
import { pageTitle, storeNames } from "@/lib/store-identity";
import { productJsonLd, storeJsonLd } from "@/lib/structured-data";

// זהות החנות (StoreIdentity): מקור אחד לשם החנות בכל מקום
describe("storeNames", () => {
  it("uses the business name first, the display name as the alternate name", () => {
    expect(storeNames({ business_name: "חשמל אלפא בעמ", site_title: "חשמל אלפא" })).toEqual({
      name: "חשמל אלפא בעמ",
      displayName: "חשמל אלפא",
      alternateName: "חשמל אלפא",
      ownName: "חשמל אלפא בעמ",
    });
  });

  it("falls back to the display name when there is no business name", () => {
    expect(storeNames({ business_name: "", site_title: "ספרי בטא" })).toEqual({
      name: "ספרי בטא",
      displayName: "ספרי בטא",
      alternateName: null,
      ownName: "ספרי בטא",
    });
  });

  it("uses the business name for the display too when there is no display name", () => {
    const names = storeNames({ business_name: "ספרי בטא", site_title: "  " });
    expect(names.displayName).toBe("ספרי בטא");
    expect(names.alternateName).toBeNull();
  });

  it("gives the neutral default when both are empty — and no own name", () => {
    for (const fields of [{ business_name: "", site_title: "" }, {}, null, undefined]) {
      expect(storeNames(fields)).toEqual({
        name: DEFAULT_STORE_NAME,
        displayName: DEFAULT_STORE_NAME,
        alternateName: null,
        ownName: null,
      });
    }
    expect(DEFAULT_STORE_NAME).toBe("החנות שלי");
  });

  it("trims, and does not repeat the same name as an alternate name", () => {
    expect(storeNames({ business_name: "  Alpha  ", site_title: "alpha" })).toMatchObject({
      name: "Alpha",
      alternateName: null,
    });
  });

  it("never uses the old column default 'סוכנות המשקאות' of site_title as a name", () => {
    expect(storeNames({ business_name: "", site_title: "סוכנות המשקאות" })).toEqual({
      name: DEFAULT_STORE_NAME,
      displayName: DEFAULT_STORE_NAME,
      alternateName: null,
      ownName: null,
    });
    expect(storeNames({ business_name: "אלפא", site_title: " סוכנות המשקאות " })).toEqual({
      name: "אלפא",
      displayName: "אלפא",
      alternateName: null,
      ownName: "אלפא",
    });
  });

  it("keeps the same text when the owner chose it as the business name", () => {
    expect(storeNames({ business_name: "סוכנות המשקאות", site_title: "" }).name).toBe(
      "סוכנות המשקאות",
    );
  });
});

describe("pageTitle", () => {
  const matches = (siteName: unknown) => [
    { routeId: "__root__", loaderData: { siteName } },
    { routeId: "/about", loaderData: undefined },
  ];
  it("adds the store name from the root data", () => {
    expect(pageTitle("אודות", matches("חשמל אלפא בעמ"))).toBe("אודות | חשמל אלפא בעמ");
  });
  it("keeps only the page name without a store name", () => {
    expect(pageTitle("אודות", matches(""))).toBe("אודות");
    expect(pageTitle("אודות", matches(undefined))).toBe("אודות");
    expect(pageTitle("אודות", [])).toBe("אודות");
  });
});

describe("Schema", () => {
  const store = { name: "חשמל אלפא בעמ", url: "https://alpha.example.com" };
  const graph = (data: Record<string, unknown>) => data["@graph"] as Array<Record<string, unknown>>;

  it("WebSite and Organization carry the store name and the alternate name", () => {
    const nodes = graph(storeJsonLd({ ...store, alternateName: "חשמל אלפא" }));
    expect(nodes.map((node) => [node["@type"], node["name"], node["alternateName"]])).toEqual([
      ["WebSite", "חשמל אלפא בעמ", "חשמל אלפא"],
      ["Organization", "חשמל אלפא בעמ", "חשמל אלפא"],
    ]);
  });

  it("no alternate name when there is none or it is the same name", () => {
    for (const alternateName of [null, "", "חשמל אלפא בעמ"]) {
      for (const node of graph(storeJsonLd({ ...store, alternateName }))) {
        expect(node).not.toHaveProperty("alternateName");
      }
    }
  });

  it("a product has the store as the seller and no made-up brand", () => {
    const product = productJsonLd({
      name: "מוצר",
      description: "תיאור",
      sku: "1",
      category: "קטגוריה",
      storeName: "חשמל אלפא בעמ",
      url: "https://alpha.example.com/product/1",
      images: [],
      price: 10,
      inStock: true,
    });
    expect(product).not.toHaveProperty("brand");
    expect((product["offers"] as Record<string, unknown>)["seller"]).toEqual({
      "@type": "Organization",
      name: "חשמל אלפא בעמ",
    });
  });
});

describe("legal pages {{store_name}}", () => {
  it("is the owner's name, or empty (shown as [שם העסק]) — never a default", () => {
    expect(legalVariablesFrom({ business_name: "אלפא", site_title: "א" }).store_name).toBe("אלפא");
    expect(legalVariablesFrom({ business_name: "", site_title: "ספרי בטא" }).store_name).toBe(
      "ספרי בטא",
    );
    expect(legalVariablesFrom({ business_name: "", site_title: "" }).store_name).toBe("");
    expect(legalVariablesFrom({ business_name: "", site_title: "סוכנות המשקאות" }).store_name).toBe(
      "",
    );
  });
});
