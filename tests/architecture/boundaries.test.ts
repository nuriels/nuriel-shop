// בדיקת הארכיטקטורה (Hospitality Stage 1f, plan B1): הגבולות בין הפלטפורמה,
// המנועים ושורש ההרכבה — על כל קובץ ב-src, כולל import דינמי, יחסי ו-export from.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { ecommerceEngine } from "@/engines/ecommerce/engine";
import { hospitalityEngine } from "@/engines/hospitality/engine";
import { createEngineRegistry } from "@/platform/engines/registry";
import { LEGACY_SHARED_SERVER_FN_FILES } from "@/platform/engines/shared-functions";

const ROOT = process.cwd();
const toRel = (abs: string) => relative(ROOT, abs).split("\\").join("/");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) return walk(abs);
    return /\.(ts|tsx)$/.test(name) ? [toRel(abs)] : [];
  });
}

const FILES = walk(join(ROOT, "src"));
const SOURCE = new Map(FILES.map((f) => [f, readFileSync(join(ROOT, f), "utf8")]));

type Layer = "app" | "platform" | "hospitality" | "ecommerce-engine" | "entry" | "ecommerce";
function layerOf(rel: string): Layer {
  if (rel.startsWith("src/app/")) return "app";
  if (rel.startsWith("src/platform/")) return "platform";
  if (rel.startsWith("src/engines/hospitality/")) return "hospitality";
  if (rel.startsWith("src/engines/ecommerce/")) return "ecommerce-engine";
  if (rel === "src/start.ts" || rel === "src/server.ts") return "entry";
  return "ecommerce";
}

const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

/** כל ה-imports של קובץ, כנתיב יחסי לשורש (בלי סיומת); חבילות חיצוניות — לא */
function importsOf(rel: string): string[] {
  const out: string[] = [];
  for (const m of stripComments(SOURCE.get(rel)!).matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3]!;
    if (spec.startsWith("@/")) out.push(`src/${spec.slice(2)}`);
    else if (spec.startsWith("."))
      out.push(
        normalize(join(dirname(rel), spec))
          .split("\\")
          .join("/"),
      );
  }
  return out;
}

/** מודולים קיימים שהפלטפורמה עוטפת (adapter) — רשימה סגורה */
const PLATFORM_ADAPTERS = new Set(["src/integrations/supabase/tenant.server"]);

function violation(from: string, target: string): string | null {
  const fromLayer = layerOf(from);
  const toLayer = layerOf(`${target}.ts`);
  const bad = `${from} → ${target}`;
  switch (fromLayer) {
    case "platform":
      return toLayer === "platform" || PLATFORM_ADAPTERS.has(target) ? null : bad;
    case "hospitality":
      return toLayer === "hospitality" || toLayer === "platform" ? null : bad;
    case "ecommerce":
    case "ecommerce-engine":
      return toLayer === "hospitality" || toLayer === "app" ? bad : null;
    case "entry":
      return toLayer === "hospitality" || toLayer === "ecommerce-engine" ? bad : null;
    case "app":
      return null;
  }
}

const violationsFor = (layers: Layer[]) =>
  FILES.filter((f) => layers.includes(layerOf(f))).flatMap((f) =>
    importsOf(f)
      .map((t) => violation(f, t))
      .filter((v): v is string => v !== null),
  );

describe("architecture: dependency boundaries", () => {
  it("scans the whole source tree", () => {
    expect(FILES.length).toBeGreaterThan(200);
    expect(FILES.filter((f) => layerOf(f) === "platform").length).toBeGreaterThan(5);
    expect(FILES.filter((f) => layerOf(f) === "hospitality").length).toBeGreaterThan(5);
  });

  it("the import scanner sees static, type, re-export, dynamic and relative imports", () => {
    expect(importsOf("src/app/engines.ts")).toEqual(
      expect.arrayContaining(["src/engines/hospitality/engine", "src/engines/hospitality/server"]),
    );
    expect(importsOf("src/engines/hospitality/engine.ts")).toEqual(
      expect.arrayContaining([
        "src/platform/engines/contract",
        "src/platform/feature-flags/flags.server",
        "src/engines/hospitality/config",
        "src/engines/hospitality/edge/gate",
      ]),
    );
  });

  it("the platform imports no engine, no composition root and no product code (only listed adapters)", () => {
    expect(violationsFor(["platform"])).toEqual([]);
  });

  it("the Hospitality engine imports only its own code and the platform", () => {
    expect(violationsFor(["hospitality"])).toEqual([]);
  });

  it("Ecommerce code (existing code and its engine descriptor) never imports Hospitality or the composition root", () => {
    expect(violationsFor(["ecommerce", "ecommerce-engine"])).toEqual([]);
  });

  it("entry files reach the engines only through the composition root", () => {
    expect(violationsFor(["entry"])).toEqual([]);
    expect(importsOf("src/start.ts")).toContain("src/app/engines");
    expect(importsOf("src/server.ts")).toContain("src/app/engines");
  });

  it("only the composition root knows both engines", () => {
    const importers = (prefix: string) =>
      FILES.filter((f) => !f.startsWith(prefix) && importsOf(f).some((t) => t.startsWith(prefix)));
    expect(importers("src/engines/hospitality/")).toEqual(["src/app/engines.ts"]);
    expect(importers("src/engines/ecommerce/")).toEqual(["src/app/engines.ts"]);
  });

  it("the composition root contains no business logic", () => {
    for (const f of FILES.filter((x) => layerOf(x) === "app")) {
      const code = stripComments(SOURCE.get(f)!);
      expect(code, f).not.toMatch(
        /createServerFn|\.rpc\(|\.from\(|fetch\(|process\.env|supabase|insert|select/i,
      );
      expect(code.split("\n").filter((l) => l.trim()).length, f).toBeLessThan(40);
      for (const t of importsOf(f)) {
        expect(["platform", "hospitality", "ecommerce-engine"], `${f} → ${t}`).toContain(
          layerOf(`${t}.ts`),
        );
      }
    }
  });
});

describe("architecture: server-function ownership", () => {
  const registry = createEngineRegistry([ecommerceEngine, hospitalityEngine]);
  const serverFnFiles = FILES.filter((f) => /createServerFn\s*\(/.test(SOURCE.get(f)!));

  it("finds the server-function files", () => {
    expect(serverFnFiles.length).toBeGreaterThanOrEqual(47);
  });

  it("every server-function file has exactly one owner, matching where it lives", () => {
    for (const f of serverFnFiles) {
      const owner = registry.ownerOf(f);
      if (f.startsWith("src/engines/hospitality/")) expect(owner, f).toBe("hospitality");
      else if (f.startsWith("src/platform/") || LEGACY_SHARED_SERVER_FN_FILES.includes(f))
        expect(owner, f).toBe("platform");
      else expect(owner, f).toBe("ecommerce");
    }
  });

  it("Hospitality server functions live only under src/engines/hospitality/server", () => {
    const hosp = serverFnFiles.filter((f) => registry.ownerOf(f) === "hospitality");
    expect(hosp.length).toBe(3);
    for (const f of hosp)
      expect(f).toMatch(/^src\/engines\/hospitality\/server\/[\w-]+\.functions\.ts$/);
  });

  it("the shared (platform) list names existing files that define server functions", () => {
    for (const f of LEGACY_SHARED_SERVER_FN_FILES) {
      expect(existsSync(join(ROOT, f)), f).toBe(true);
      expect(SOURCE.get(f), f).toMatch(/createServerFn\s*\(/);
    }
  });

  it("absolute build paths resolve to the same owner", () => {
    expect(registry.ownerOf(`${ROOT}/src/engines/hospitality/server/public.functions.ts`)).toBe(
      "hospitality",
    );
    expect(registry.ownerOf(`${ROOT}/src/lib/orders.functions.ts`)).toBe("ecommerce");
    expect(registry.ownerOf("./src/lib/auth.functions.ts")).toBe("platform");
  });
});

describe("architecture: ESLint enforces the same boundaries", () => {
  const eslint = new ESLint({ cwd: ROOT });
  async function restricted(filePath: string, code: string): Promise<number> {
    const [result] = await eslint.lintText(code, { filePath: join(ROOT, filePath) });
    return result!.messages.filter(
      (m) => m.ruleId === "no-restricted-imports" || m.ruleId === "no-restricted-syntax",
    ).length;
  }

  it.each([
    [
      "src/platform/engines/x.ts",
      'import { hospitalityEngine } from "@/engines/hospitality/engine";\n',
    ],
    [
      "src/platform/engines/x.ts",
      'import { ecommerceEngine } from "@/engines/ecommerce/engine";\n',
    ],
    ["src/platform/tenancy/x.ts", 'import { engineRegistry } from "@/app/engines";\n'],
    ["src/platform/tenancy/x.ts", 'import { subscriptionStateFrom } from "@/lib/subscription";\n'],
    ["src/platform/tenancy/x.ts", 'import { x } from "../../lib/subscription";\n'],
    [
      "src/engines/hospitality/server/x.ts",
      'import { subscriptionStateFrom } from "@/lib/subscription";\n',
    ],
    [
      "src/engines/hospitality/server/x.ts",
      'import { ecommerceEngine } from "@/engines/ecommerce/engine";\n',
    ],
    ["src/engines/hospitality/server/x.ts", 'import { engineRegistry } from "@/app/engines";\n'],
    [
      "src/engines/hospitality/server/x.ts",
      'import { supabase } from "@/integrations/supabase/client";\n',
    ],
    ["src/engines/hospitality/x.ts", 'import { ecommerceEngine } from "../ecommerce/engine";\n'],
    ["src/lib/x.ts", 'import { hospitalityEngine } from "@/engines/hospitality/engine";\n'],
    ["src/lib/x.ts", 'import { engineRegistry } from "@/app/engines";\n'],
    ["src/routes/x.tsx", 'const m = await import("@/engines/hospitality/server");\n'],
    [
      "src/engines/ecommerce/x.ts",
      'import { hospitalityEngine } from "@/engines/hospitality/engine";\n',
    ],
    ["src/server.ts", 'import { hospitalityEngine } from "./engines/hospitality/engine";\n'],
  ])("rejects %s importing a forbidden module", async (file, code) => {
    expect(await restricted(file, code)).toBeGreaterThan(0);
  });

  it.each([
    [
      "src/engines/hospitality/server/x.ts",
      'import type { SiteRef } from "@/platform/engines/contract";\n',
    ],
    ["src/engines/hospitality/server/x.ts", 'import { HOSPITALITY_FLAGS } from "../config";\n'],
    ["src/lib/x.ts", 'import type { SiteRef } from "@/platform/engines/contract";\n'],
    ["src/platform/tenancy/x.ts", 'import type { SiteRef } from "../engines/contract";\n'],
    ["src/app/x.ts", 'import { hospitalityEngine } from "@/engines/hospitality/engine";\n'],
  ])("allows %s importing a permitted module", async (file, code) => {
    expect(await restricted(file, code)).toBe(0);
  });
});
