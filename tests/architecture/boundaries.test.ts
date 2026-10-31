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

/** מתאמי הנתיבים של Hospitality (src/routes/manage*.tsx): קוד של המנוע במקום שהמסגרת דורשת */
const HOSPITALITY_ROUTE = /^src\/routes\/manage(_?\.[^/]+)?\.tsx?$/;
/** קבצי כניסה: מגיעים למנועים רק דרך שורש ההרכבה (ה-root של הנתבים — מ-Stage 2a) */
const ENTRY_FILES = ["src/start.ts", "src/server.ts", "src/routes/__root.tsx"];
/** עץ הנתיבים שנוצר אוטומטית — מייבא כל קובץ נתיב, גם את מתאמי Hospitality */
const ROUTE_TREE = "src/routeTree.gen.ts";

function layerOf(rel: string): Layer {
  if (rel.startsWith("src/app/")) return "app";
  if (rel.startsWith("src/platform/")) return "platform";
  if (rel.startsWith("src/engines/hospitality/") || HOSPITALITY_ROUTE.test(rel))
    return "hospitality";
  if (rel.startsWith("src/engines/ecommerce/")) return "ecommerce-engine";
  if (ENTRY_FILES.includes(rel.replace(/\.ts$/, ".tsx")) || ENTRY_FILES.includes(rel))
    return "entry";
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

/**
 * מתאמי הפלטפורמה — רשימה סגורה: כל קובץ מתאם, ובדיוק המודולים הקיימים שהוא עוטף.
 * כל ייבוא אחר של קוד מוצר מהפלטפורמה — הפרה.
 */
const PLATFORM_ADAPTERS: [adapter: string, wraps: (target: string) => boolean][] = [
  [
    "src/platform/tenancy/current-site.server.ts",
    (t) => t === "src/integrations/supabase/tenant.server",
  ],
  [
    "src/platform/ui/index.ts",
    (t) =>
      /^src\/components\/ui\/[\w-]+$/.test(t) ||
      t === "src/lib/utils" ||
      t === "src/hooks/use-mobile",
  ],
  ["src/platform/auth/browser-session.ts", (t) => t === "src/integrations/supabase/client"],
  ["src/platform/auth/accounts.server.ts", (t) => t === "src/integrations/supabase/client.server"],
  ["src/platform/security/rate-limit.server.ts", (t) => t === "src/lib/rate-limit.server"],
  [
    "src/platform/auth/login.ts",
    (t) => t === "src/lib/auth.functions" || t === "src/lib/login-code.functions",
  ],
];
const adapterAllows = (from: string, target: string) =>
  PLATFORM_ADAPTERS.some(([file, wraps]) => file === from && wraps(target));

function violation(from: string, target: string): string | null {
  const fromLayer = layerOf(from);
  const toLayer = layerOf(`${target}.ts`);
  const bad = `${from} → ${target}`;
  switch (fromLayer) {
    case "platform":
      return toLayer === "platform" || adapterAllows(from, target) ? null : bad;
    case "hospitality":
      return toLayer === "hospitality" || toLayer === "platform" ? null : bad;
    case "ecommerce":
    case "ecommerce-engine":
      // החריג היחיד: עץ הנתיבים שנוצר מייבא את מתאמי הנתיבים של Hospitality (ורק אותם)
      if (from === ROUTE_TREE && HOSPITALITY_ROUTE.test(`${target}.tsx`)) return null;
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
    expect(importsOf("src/engines/hospitality/access.server.ts")).toContain(
      "src/platform/feature-flags/flags.server",
    );
    expect(importsOf("src/engines/hospitality/engine.ts")).toEqual(
      expect.arrayContaining([
        "src/platform/engines/contract",
        "src/engines/hospitality/config",
        "src/engines/hospitality/access.server",
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
    expect(importsOf("src/routes/__root.tsx")).toContain("src/app/site-shell");
  });

  it("only the composition root knows both engines", () => {
    const importers = (prefix: string) =>
      FILES.filter(
        (f) =>
          layerOf(f) !== layerOf(`${prefix}x.ts`) && importsOf(f).some((t) => t.startsWith(prefix)),
      );
    expect(importers("src/engines/hospitality/")).toEqual([
      "src/app/engines.ts",
      "src/app/site-routes.ts",
      "src/app/site-shell.tsx",
    ]);
    expect(importers("src/engines/ecommerce/")).toEqual(["src/app/engines.ts"]);
    const both = FILES.filter(
      (f) =>
        importsOf(f).some((t) => t.startsWith("src/engines/hospitality/")) &&
        importsOf(f).some((t) => t.startsWith("src/engines/ecommerce/")),
    );
    expect(both).toEqual(["src/app/engines.ts"]);
  });

  it("Hospitality route adapters are thin: a path, a title and one engine screen", () => {
    const adapters = FILES.filter((f) => HOSPITALITY_ROUTE.test(f));
    expect(adapters).toEqual([
      "src/routes/manage.index.tsx",
      "src/routes/manage.settings.tsx",
      "src/routes/manage.team.tsx",
      "src/routes/manage.tsx",
      "src/routes/manage_.login.tsx",
    ]);
    for (const f of adapters) {
      const code = stripComments(SOURCE.get(f)!);
      // המסך, ולכל היותר שומר הנתיב (קיים רק באתר אירוח)
      expect(importsOf(f).length, f).toBeLessThanOrEqual(2);
      for (const t of importsOf(f))
        expect(t, f).toMatch(/^src\/engines\/hospitality\/management\//);
      expect(code, f).not.toMatch(/createServerFn|useQuery|fetch\(|supabase|process\.env/);
      expect(code.split("\n").filter((l) => l.trim()).length, f).toBeLessThan(15);
    }
  });

  it("Ecommerce code reaches the Hospitality route adapters only through the generated route tree", () => {
    const importers = FILES.filter(
      (f) =>
        layerOf(f) !== "hospitality" &&
        importsOf(f).some((t) => HOSPITALITY_ROUTE.test(`${t}.tsx`)),
    );
    expect(importers).toEqual([ROUTE_TREE]);
  });

  it("every platform adapter wraps only its listed modules, and each listed adapter exists", () => {
    for (const [file] of PLATFORM_ADAPTERS) expect(existsSync(join(ROOT, file)), file).toBe(true);
    expect(violationsFor(["platform"])).toEqual([]);
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

  it("Hospitality server functions live only in src/engines/hospitality/{server,api}", () => {
    const hosp = serverFnFiles.filter((f) => registry.ownerOf(f) === "hospitality");
    expect(hosp.length).toBe(6);
    // api/ = נקראות מהדפדפן (מחוץ ל-server/, import protection); server/ = בלי ממשק עדיין
    for (const f of hosp)
      expect(f).toMatch(/^src\/engines\/hospitality\/(server|api)\/[\w-]+\.functions\.ts$/);
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
    // Stage 2a: adapters wrap only their listed modules; route adapters are Hospitality code;
    // the root route is an entry file
    ["src/platform/ui/index.ts", 'export { useCart } from "@/hooks/useCart";\n'],
    ["src/platform/ui/index.ts", 'export { AdminNav } from "@/components/AdminNav";\n'],
    ["src/platform/auth/login.ts", 'export { createOrder } from "@/lib/orders.functions";\n'],
    ["src/platform/tenancy/x.ts", 'import { Button } from "@/components/ui/button";\n'],
    ["src/routes/manage.tsx", 'import { AdminNav } from "@/components/AdminNav";\n'],
    ["src/routes/manage.index.tsx", 'import { engineRegistry } from "@/app/engines";\n'],
    [
      "src/routes/__root.tsx",
      'import { Dashboard } from "@/engines/hospitality/management/dashboard/Dashboard";\n',
    ],
    [
      "src/routes/admin.tsx",
      'import { ManageLayout } from "@/engines/hospitality/management/shell/ManageLayout";\n',
    ],
    [
      "src/engines/hospitality/management/x.tsx",
      'import { Button } from "@/components/ui/button";\n',
    ],
    ["src/engines/hospitality/management/x.tsx", 'import { useCart } from "@/hooks/useCart";\n'],
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
    ["src/platform/ui/index.ts", 'export { Button } from "@/components/ui/button";\n'],
    ["src/platform/ui/index.ts", 'export { cn } from "@/lib/utils";\n'],
    [
      "src/platform/auth/login.ts",
      'export { verifyLoginCode } from "@/lib/login-code.functions";\n',
    ],
    [
      "src/routes/manage.tsx",
      'import { ManageLayout } from "@/engines/hospitality/management/shell/ManageLayout";\n',
    ],
    ["src/routes/__root.tsx", 'import { EngineSiteShell } from "@/app/site-shell";\n'],
    ["src/engines/hospitality/management/x.tsx", 'import { Button } from "@/platform/ui";\n'],
    [
      "src/engines/hospitality/management/x.tsx",
      'import { manageKeys } from "@/engines/hospitality/management/lib/query-keys";\n',
    ],
  ])("allows %s importing a permitted module", async (file, code) => {
    expect(await restricted(file, code)).toBe(0);
  });
});
