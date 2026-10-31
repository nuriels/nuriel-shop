// סדר המיגרציות (דרישה מאישור Stage 2a): כל מיגרציה חדשה מקבלת timestamp מאוחר
// מהקודמת, קובץ rollback באותו שם, ומופיעה בבדיקת ה-rollback — האחרונה מוחזרת ראשונה
// ומורצת שוב בסדר. טעות כזו נכשלת ב-CI.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const ROLLBACKS = join(ROOT, "supabase/rollbacks");
/** המיגרציה הראשונה של הפלטפורמה / Hospitality — מכאן כל מיגרציה חייבת rollback */
const BASELINE = "20261101090000";
/** migration 7 (Stage 2a) — כל מיגרציה חדשה אחריה */
const MIGRATION_7 = "20261101150000";

const migrations = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const stamp = (file: string) => file.slice(0, 14);
const name = (file: string) => file.replace(/\.sql$/, "");
const tracked = migrations.filter((f) => stamp(f) >= BASELINE).map(name);
const rollbackScript = readFileSync(join(ROOT, "scripts/db-tests/rollback-check.sh"), "utf8");

describe("migrations: order and rollbacks", () => {
  it("every migration starts with a 14-digit timestamp, and the timestamps are unique", () => {
    for (const f of migrations) expect(f, f).toMatch(/^\d{14}_[\w-]+\.sql$/);
    const stamps = migrations.map(stamp);
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it("the files run in timestamp order (name order = time order)", () => {
    const stamps = migrations.map(stamp);
    expect(stamps).toEqual([...stamps].sort());
  });

  it("migrations since the platform baseline exist, and the newest is later than migration 7", () => {
    expect(tracked.length).toBeGreaterThanOrEqual(8);
    expect(tracked).toContain(`${MIGRATION_7}_hosp_management_foundation`);
    expect(stamp(tracked.at(-1)!) >= MIGRATION_7).toBe(true);
  });

  it("every migration since the baseline has a rollback file with the same name, and no rollback is orphaned", () => {
    for (const m of tracked) expect(existsSync(join(ROLLBACKS, `${m}.down.sql`)), m).toBe(true);
    const rollbacks = readdirSync(ROLLBACKS)
      .filter((f) => f.endsWith(".down.sql"))
      .map((f) => f.replace(/\.down\.sql$/, ""));
    for (const r of rollbacks) expect(migrations.map(name), `orphaned rollback ${r}`).toContain(r);
  });

  it("rollback-check.sh lists every tracked migration, in order (M1 … Mn)", () => {
    const vars = [...rollbackScript.matchAll(/^M(\d+)=(\S+)$/gm)].map((m) => ({
      n: Number(m[1]),
      file: m[2]!,
    }));
    expect(vars.map((v) => v.n)).toEqual(vars.map((_, i) => i + 1));
    expect(vars.map((v) => v.file)).toEqual(tracked);
  });

  it("rollback-check.sh rolls back newest first and re-applies oldest first", () => {
    const downs = [...rollbackScript.matchAll(/^down "\$M(\d+)"$/gm)].map((m) => Number(m[1]));
    const ups = [...rollbackScript.matchAll(/^up "\$M(\d+)"$/gm)].map((m) => Number(m[1]));
    const n = tracked.length;
    expect(downs).toEqual(Array.from({ length: n }, (_, i) => n - i));
    expect(ups).toEqual(Array.from({ length: n }, (_, i) => i + 1));
  });
});
