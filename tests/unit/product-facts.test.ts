import { describe, expect, it } from "vitest";
import { brandFromName, conditionFromWords, gtinOf, resolveCondition } from "@/lib/product-facts";
import { catalogFactProposals } from "@/lib/seo/store-templates";
import { productJsonLd, type ProductSchemaInput } from "@/lib/structured-data";

// מיגרציה 207 + השוואת iStores: brand היה שם החנות בכל מוצר, itemCondition היה "חדש" לכל מוצר (גם למחודשים),
// וכל 13 ספרות נשלחו כ-gtin13. עכשיו: מותג רק כשידוע, מצב אמיתי, GTIN רק כשהוא GS1 תקין.

const base: ProductSchemaInput = {
  name: "מחשב נייד Lenovo ThinkPad T480",
  description: "i5, 16GB",
  sku: "T480",
  category: "מחשבים ניידים",
  storeName: "נוריאל מחשבים",
  url: "https://shop.example.com/product/1",
  images: ["https://cdn.example.com/1.webp"],
  price: 1490,
  inStock: true,
};
const offer = (ld: Record<string, unknown>) => ld["offers"] as Record<string, unknown>;

describe("Product JSON-LD: brand, condition, GTIN", () => {
  it("never uses the store's name as the product's brand; no brand → no brand property", () => {
    const ld = productJsonLd(base);
    expect(ld).not.toHaveProperty("brand");
    expect(JSON.stringify(ld)).not.toContain('"Brand","name":"נוריאל מחשבים"');
    // the store is still the seller
    expect(offer(ld)["seller"]).toEqual({ "@type": "Organization", name: "נוריאל מחשבים" });
  });

  it("the brand the owner saved (or approved) is the brand", () => {
    expect(productJsonLd({ ...base, brand: " Lenovo " })["brand"]).toEqual({
      "@type": "Brand",
      name: "Lenovo",
    });
  });

  it("condition: what the owner set wins; else the owner's own words (name / category); else new", () => {
    expect(offer(productJsonLd(base))["itemCondition"]).toBe("https://schema.org/NewCondition");
    expect(offer(productJsonLd({ ...base, name: `${base.name} מחודש` }))["itemCondition"]).toBe(
      "https://schema.org/RefurbishedCondition",
    );
    expect(
      offer(productJsonLd({ ...base, category: "מחשבים ניידים מחודשים" }))["itemCondition"],
    ).toBe("https://schema.org/RefurbishedCondition");
    expect(offer(productJsonLd({ ...base, name: "מסך 24 יד שנייה" }))["itemCondition"]).toBe(
      "https://schema.org/UsedCondition",
    );
    expect(
      offer(productJsonLd({ ...base, name: `${base.name} מחודש`, condition: "new" }))[
        "itemCondition"
      ],
    ).toBe("https://schema.org/NewCondition");
    expect(offer(productJsonLd({ ...base, condition: "used" }))["itemCondition"]).toBe(
      "https://schema.org/UsedCondition",
    );
  });

  it("GTIN only for a real GS1 number: valid check digit, not an in-store code", () => {
    expect(productJsonLd({ ...base, barcode: "4006381333931" })["gtin13"]).toBe("4006381333931");
    expect(productJsonLd({ ...base, barcode: "036000291452" })["gtin12"]).toBe("036000291452");
    expect(productJsonLd({ ...base, barcode: "96385074" })["gtin8"]).toBe("96385074");
    // wrong check digit, in-store (2xx) code, an internal SKU, all zeros — no GTIN at all
    for (const barcode of ["4006381333932", "2000000000008", "1001", "0000000000000", "ABC123"]) {
      const ld = productJsonLd({ ...base, barcode });
      expect(
        Object.keys(ld).filter((k) => k.startsWith("gtin")),
        barcode,
      ).toEqual([]);
    }
  });
});

describe("product facts (pure)", () => {
  it("condition words: refurbished before used; Hebrew forms and prefixes; no false hit on 'חודש'", () => {
    expect(conditionFromWords("מחשבים ניידים מחודשים")).toBe("refurbished");
    expect(conditionFromWords("המחודש")).toBe("refurbished");
    expect(conditionFromWords("Refurbished laptop")).toBe("refurbished");
    expect(conditionFromWords("מחשב משומש")).toBe("used");
    expect(conditionFromWords("יד 2")).toBe("used");
    expect(conditionFromWords("יד שניה")).toBe("used");
    expect(conditionFromWords("מחודש, יד שנייה")).toBe("refurbished");
    expect(conditionFromWords("מנוי לחודש")).toBeNull();
    expect(conditionFromWords("סוללה חדשה")).toBeNull();
    expect(conditionFromWords(null, undefined, "")).toBeNull();
  });

  it("resolveCondition ignores an unknown stored value", () => {
    expect(resolveCondition("broken", "מחשב", null)).toBe("new");
    expect(resolveCondition("refurbished", "מחשב", null)).toBe("refurbished");
  });

  it("GTIN: restricted prefixes (in-store, coupons) and RCN-8 are not GTINs", () => {
    expect(gtinOf("2900000000003")).toBeNull(); // 290 — in-store (weighed) item
    expect(gtinOf("9800000000006")).toBeNull(); // 980 — refund receipt
    expect(gtinOf("02345673")).toBeNull(); // RCN-8
    expect(gtinOf("7290011194505")).toEqual({ key: "gtin13", value: "7290011194505" }); // Israel (729)
    expect(gtinOf(" 4006381-333931 ")).toEqual({ key: "gtin13", value: "4006381333931" });
  });

  it("brand from the owner's own product name — only when it is unambiguous", () => {
    expect(brandFromName("מחשב נייד Lenovo ThinkPad T480 מחודש")?.brand).toBe("Lenovo");
    expect(brandFromName("מחשב נייד לנובו")?.brand).toBe("Lenovo");
    expect(brandFromName("WD Blue 1TB")?.brand).toBe("Western Digital");
    expect(brandFromName("קוקה קולה זירו 1.5 ליטר")?.brand).toBe("Coca-Cola");
    expect(brandFromName("מטען מקורי Lenovo 65W")?.brand).toBe("Lenovo");
    expect(brandFromName("עכבר Logitech M185")?.brand).toBe("Logitech");
    // compatibility / an accessory for a device brand / two brands / none → no proposal
    expect(brandFromName("מטען תואם HP")).toBeNull();
    expect(brandFromName("סוללה למחשב נייד HP")).toBeNull();
    expect(brandFromName("כיסוי לאייפון 15")).toBeNull();
    expect(brandFromName("מסך Samsung + מקלדת Logitech")).toBeNull();
    expect(brandFromName("שולחן עץ מלא")).toBeNull();
    // "HP" inside "2HP" is not the brand
    expect(brandFromName("מדחס 2HP")).toBeNull();
  });
});

describe("catalog fact proposals (template, owner approval)", () => {
  const facts = [
    {
      id: "p1",
      name: "מחשב נייד Lenovo ThinkPad מחודש",
      category: "מחשבים",
      brand: null,
      item_condition: null,
    },
    {
      id: "p2",
      name: "מחשב נייד Dell",
      category: "מחשבים ניידים משומשים",
      brand: "Dell",
      item_condition: null,
    },
    { id: "p3", name: "כבל HDMI", category: "כבלים", brand: null, item_condition: null },
    {
      id: "p4",
      name: "מחשב HP מחודש",
      category: "מחשבים",
      brand: null,
      item_condition: null,
      blocked: ["brand"],
    },
  ];

  it("proposes the brand from the name and the condition from the words; never over a value the owner set", () => {
    const items = catalogFactProposals(facts);
    const byKey = new Map(items.map((i) => [`${i.target_id}:${i.field}`, i]));
    expect(byKey.get("p1:brand")?.text).toBe("Lenovo");
    expect(byKey.get("p1:item_condition")?.text).toBe("refurbished");
    expect(byKey.has("p2:brand")).toBe(false); // the owner's brand stays
    expect(byKey.get("p2:item_condition")?.text).toBe("used");
    expect(items.some((i) => i.target_id === "p3")).toBe(false); // nothing to go on → nothing proposed
    expect(byKey.has("p4:brand")).toBe(false); // an open / rejected brand proposal is not proposed again
    expect(byKey.get("p4:item_condition")?.text).toBe("refurbished");
    for (const i of items) {
      expect(i).toMatchObject({ target_kind: "product", source: "template" });
      expect(i.reason.length).toBeLessThanOrEqual(300);
    }
  });

  it("no facts → no proposals", () => {
    expect(catalogFactProposals(undefined)).toEqual([]);
    expect(catalogFactProposals([])).toEqual([]);
  });
});
