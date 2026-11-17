// Every environment variable the server code reads must reach the container: docker-compose.yml passes an
// explicit list (no env_file), so a variable that is only in the server's .env never arrives (audit finding C-2:
// SUPPORT_NOTIFY_EMAIL, BUSINESS_PROFILE_SECRET, ... were documented as operator settings but silently ignored).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });

/** Test hooks only: they redirect network calls or clocks, so they must NOT be forwarded to production */
const TEST_ONLY = new Set([
  "DNS_TEST_FIXTURES",
  "GROW_SANDBOX_URL",
  "RESEND_API_URL",
  "SITEMAP_TTL_MS",
]);

const used = new Set<string>();
for (const file of walk(join(process.cwd(), "src"))) {
  for (const m of readFileSync(file, "utf8").matchAll(
    /process\.env(?:\["([A-Z0-9_]+)"\]|\.([A-Z0-9_]+))/g,
  )) {
    used.add((m[1] ?? m[2])!);
  }
}
const compose = readFileSync(join(process.cwd(), "docker-compose.yml"), "utf8");
const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");
const inCompose = (name: string) => new RegExp(`^\\s+${name}:`, "m").test(compose);
const inExample = (name: string) => new RegExp(`^#?\\s*${name}=`, "m").test(example);

describe("environment variables reach the container", () => {
  it("every variable read in src/ is in docker-compose.yml (or is a documented test-only hook)", () => {
    const missing = [...used].filter((n) => !inCompose(n) && !TEST_ONLY.has(n)).sort();
    expect(missing).toEqual([]);
  });

  it("every variable compose passes is explained in .env.example (NODE_ENV and PORT are set by compose itself)", () => {
    const passed = [...compose.matchAll(/^\s{6}([A-Z0-9_]+):/gm)].map((m) => m[1]!);
    const unexplained = passed.filter((n) => !["NODE_ENV", "PORT"].includes(n) && !inExample(n));
    expect(unexplained.sort()).toEqual([]);
  });

  it("test-only hooks are not forwarded to production", () => {
    for (const name of TEST_ONLY) expect(inCompose(name), name).toBe(false);
  });
});
