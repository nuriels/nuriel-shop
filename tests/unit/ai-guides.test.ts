// NURIEL AI ASSISTANT — שני קטלוגי המדריכים: שלמות, תוויות מסך שקיימות באמת בקוד של אותו מוצר, הפניות
// ומסכים בתוך אותו מוצר בלבד, הפרדה מלאה בין Ecommerce ל-Hospitality (מזהים, קבצים, סכמת הדגם, חיפוש),
// והתאמה לחבילות במסד (guide_catalog).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ECOMMERCE_GUIDE_CATALOG } from "@/lib/ai/ecommerce-guides";
import { HOSPITALITY_GUIDE_CATALOG } from "@/engines/hospitality/ai/guides";
import {
  extractGuideRefs,
  extractUiLabels,
  GUIDE_ID,
  guideTexts,
  type GuideCatalog,
} from "@/platform/ai/guides/types";
import { searchGuides } from "@/platform/ai/guides/search";
import { detectBlockedRequest, redactSensitive } from "@/platform/ai/logic";
import { buildRouterPrompt, routerOutputSchema } from "@/platform/ai/router.server";

function sourceText(roots: string[], exclude: (file: string) => boolean): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(tsx?|json)$/.test(name) && !exclude(path)) out.push(readFileSync(path, "utf8"));
    }
  };
  for (const root of roots) walk(root);
  return out.join("\n");
}

const ECOMMERCE_SOURCE = sourceText(["src/components", "src/routes", "src/lib"], (f) =>
  f.startsWith(join("src", "lib", "ai")),
);
const HOSPITALITY_SOURCE = sourceText(["src/engines/hospitality"], (f) =>
  f.startsWith(join("src", "engines", "hospitality", "ai")),
);

const CATALOGS: [string, GuideCatalog, string, string][] = [
  ["Ecommerce", ECOMMERCE_GUIDE_CATALOG, ECOMMERCE_SOURCE, "src/lib/ai/ecommerce-guides.ts"],
  [
    "Hospitality",
    HOSPITALITY_GUIDE_CATALOG,
    HOSPITALITY_SOURCE,
    "src/engines/hospitality/ai/guides.ts",
  ],
];

const MIGRATION = readFileSync("supabase/migrations/20261110100000_ai_assistant.sql", "utf8");
/** כל הנתיבים האמיתיים של האפליקציה (עץ הנתיבים שנוצר) */
const ROUTES = new Set(
  [...readFileSync("src/routeTree.gen.ts", "utf8").matchAll(/fullPath: '([^']+)'/g)].map(
    (m) => m[1],
  ),
);
/** הלשוניות האמיתיות של פאנל הניהול של החנות (?tab=) */
const ADMIN_TABS = new Set(
  [...readFileSync("src/components/AdminNav.tsx", "utf8").matchAll(/value: "([a-z-]+)"/g)].map(
    (m) => m[1],
  ),
);

describe.each(CATALOGS)("%s catalog", (_name, catalog, source) => {
  const ids = catalog.guides.map((g) => g.id);
  it("identity matches the package in the database (product, catalog id, name)", () => {
    expect(MIGRATION).toContain(
      `'nuriel_ai_${catalog.product}', '${catalog.product}', '${catalog.assistantName}', 15000, '${catalog.catalogId}'`,
    );
  });
  it("ids: stable format, unique; every category is known and has guides", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(GUIDE_ID);
    for (const guide of catalog.guides)
      expect(Object.keys(catalog.categories)).toContain(guide.category);
    for (const category of Object.keys(catalog.categories)) {
      expect(
        catalog.guides.some((g) => g.category === category),
        category,
      ).toBe(true);
    }
  });
  it("every guide is complete: title, keywords, summary, 2–8 steps", () => {
    for (const guide of catalog.guides) {
      expect(guide.title.trim().length, guide.id).toBeGreaterThan(3);
      expect(guide.keywords.length, guide.id).toBeGreaterThanOrEqual(3);
      expect(guide.summary.trim().length, guide.id).toBeGreaterThan(10);
      expect(guide.steps.length, guide.id).toBeGreaterThanOrEqual(2);
      expect(guide.steps.length, guide.id).toBeLessThanOrEqual(8);
    }
  });
  it("cross-references and screens stay inside the same product", () => {
    for (const guide of catalog.guides) {
      for (const text of guideTexts(guide)) {
        for (const ref of extractGuideRefs(text))
          expect(ids, `${guide.id} → ${ref}`).toContain(ref);
      }
      for (const step of guide.steps) {
        if (step.go)
          expect(step.go.startsWith(catalog.pathPrefix), `${guide.id}: ${step.go}`).toBe(true);
      }
    }
    for (const id of catalog.popular) expect(ids).toContain(id);
    for (const id of catalog.connectionTest.expectGuides) expect(ids).toContain(id);
  });
  it("every screen link is a real page of this product (and a real admin tab)", () => {
    for (const guide of catalog.guides) {
      for (const step of guide.steps) {
        if (!step.go) continue;
        const url = new URL(step.go, "http://x");
        expect(ROUTES.has(url.pathname), `${guide.id}: ${step.go}`).toBe(true);
        if (catalog.product === "ecommerce") {
          expect(url.pathname, guide.id).toBe("/admin");
          expect(ADMIN_TABS.has(url.searchParams.get("tab") ?? ""), `${guide.id}: ${step.go}`).toBe(
            true,
          );
        }
      }
    }
  });
  it("every «screen label» exists verbatim in this product's own code", () => {
    const missing: string[] = [];
    for (const guide of catalog.guides) {
      for (const text of guideTexts(guide)) {
        for (const label of extractUiLabels(text))
          if (!source.includes(label)) missing.push(`${guide.id}: «${label}»`);
      }
    }
    expect(missing).toEqual([]);
  });
  it("no guide text is blocked or redacted by mistake (guides are what managers really ask)", () => {
    for (const guide of catalog.guides) {
      for (const phrase of [guide.title, ...guide.keywords]) {
        expect(detectBlockedRequest(phrase), `${guide.id}: ${phrase}`).toBe(false);
        expect(redactSensitive(phrase), `${guide.id}: ${phrase}`).toBe(phrase);
      }
    }
  });
  it("the model's closed schema lists exactly this catalog's ids", () => {
    expect(routerOutputSchema(catalog).properties.guides.items.enum).toEqual(ids);
    const prompt = buildRouterPrompt(catalog);
    for (const id of ids) expect(prompt).toContain(`${id} |`);
  });
  it("keyword search finds the guide by its own keywords (only inside this catalog)", () => {
    let found = 0;
    for (const guide of catalog.guides) {
      const hits = searchGuides(guide.keywords[0] ?? guide.title, catalog.guides).map(
        (h) => h.guide.id,
      );
      if (hits.includes(guide.id)) found += 1;
      for (const id of hits) expect(ids).toContain(id);
    }
    expect(found / catalog.guides.length).toBeGreaterThan(0.8);
  });
});

describe("the two products are separate", () => {
  it("no shared guide id; Hospitality ids are prefixed", () => {
    const ecom = new Set(ECOMMERCE_GUIDE_CATALOG.guides.map((g) => g.id));
    for (const guide of HOSPITALITY_GUIDE_CATALOG.guides) {
      expect(ecom.has(guide.id), guide.id).toBe(false);
      expect(guide.id.startsWith("hosp-"), guide.id).toBe(true);
    }
    for (const id of ecom) expect(id.startsWith("hosp-")).toBe(false);
  });
  it("different products, catalog ids and screens", () => {
    expect(ECOMMERCE_GUIDE_CATALOG.product).toBe("ecommerce");
    expect(HOSPITALITY_GUIDE_CATALOG.product).toBe("hospitality");
    expect(ECOMMERCE_GUIDE_CATALOG.catalogId).toBe("ecommerce-v1");
    expect(HOSPITALITY_GUIDE_CATALOG.catalogId).toBe("hospitality-v1");
    expect(ECOMMERCE_GUIDE_CATALOG.pathPrefix).toBe("/admin");
    expect(HOSPITALITY_GUIDE_CATALOG.pathPrefix).toBe("/manage");
  });
  it("the catalog files do not import each other (or the other product's code)", () => {
    const ecom = readFileSync("src/lib/ai/ecommerce-guides.ts", "utf8");
    const hosp = readFileSync("src/engines/hospitality/ai/guides.ts", "utf8");
    expect(ecom).not.toMatch(/engines\/hospitality|hospitality\/ai/);
    expect(hosp).not.toMatch(/@\/lib|@\/components|ecommerce-guides/);
  });
  it("searching a Hospitality question in the Ecommerce catalog never returns a Hospitality guide", () => {
    for (const guide of HOSPITALITY_GUIDE_CATALOG.guides) {
      const hits = searchGuides(guide.keywords[0] ?? guide.title, ECOMMERCE_GUIDE_CATALOG.guides);
      for (const hit of hits) expect(hit.guide.id.startsWith("hosp-")).toBe(false);
    }
  });
  it("the mounts: the store admin uses the Ecommerce catalog; the zimmer management the Hospitality one", () => {
    const ecomMount = readFileSync("src/components/ai/EcommerceAssistant.tsx", "utf8");
    const hospMount = readFileSync(
      "src/engines/hospitality/management/ai/HospitalityAssistant.tsx",
      "utf8",
    );
    expect(ecomMount).toContain("ECOMMERCE_GUIDE_CATALOG");
    expect(ecomMount).not.toMatch(/HOSPITALITY_GUIDE_CATALOG|hospitality/);
    expect(hospMount).toContain("HOSPITALITY_GUIDE_CATALOG");
    expect(hospMount).not.toMatch(/ECOMMERCE_GUIDE_CATALOG|ecommerce/);
  });
});
