// Deleting a store/business must remove its files from EVERY tenant-scoped storage bucket
// (audit finding B-5: signed contracts, payment proofs, support files and site media were left behind).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdminUnscoped: {} }));

import { TENANT_BUCKETS, removeTenantStorage, type BucketApi } from "@/lib/platform.server";

/** Buckets that are NOT tenant folders: platform-level documents (path = platform file id, not a tenant id) */
const NOT_TENANT_SCOPED = new Set(["platform-documents"]);

function bucketsCreatedByMigrations(): string[] {
  const dir = join(process.cwd(), "supabase", "migrations");
  const ids = new Set<string>();
  for (const file of readdirSync(dir)) {
    const sql = readFileSync(join(dir, file), "utf8");
    for (const m of sql.matchAll(
      /INSERT\s+INTO\s+storage\.buckets[^;]*?VALUES\s*\(\s*'([a-z0-9-]+)'/gis,
    )) {
      ids.add(m[1]!);
    }
  }
  return [...ids].sort();
}

describe("tenant deletion — storage", () => {
  it("every tenant-scoped bucket created by a migration is cleaned", () => {
    const missing = bucketsCreatedByMigrations().filter(
      (id) => !NOT_TENANT_SCOPED.has(id) && !(TENANT_BUCKETS as readonly string[]).includes(id),
    );
    expect(missing).toEqual([]);
  });

  it("the Hospitality and Websites buckets are on the list", () => {
    for (const id of [
      "hosp-contracts",
      "hosp-payment-proofs",
      "hosp-support",
      "hosp-media",
      "bp-media",
    ]) {
      expect(TENANT_BUCKETS as readonly string[]).toContain(id);
    }
  });

  it("removes only the tenant's folder, in every bucket, and reports the count", async () => {
    const tenant = "11111111-2222-3333-4444-555555555555";
    const removed: Record<string, string[]> = {};
    const api = (name: string): BucketApi => ({
      list: async (path) => ({
        data:
          path === tenant
            ? [
                { name: "a.pdf", id: "1" },
                { name: "b.pdf", id: "2" },
              ]
            : [],
        error: null,
      }),
      remove: async (paths) => {
        removed[name] = [...(removed[name] ?? []), ...paths];
        return { error: null };
      },
    });
    const result = await removeTenantStorage(tenant, api);
    expect(result.errors).toEqual([]);
    expect(result.files).toBe(2 * TENANT_BUCKETS.length);
    for (const name of TENANT_BUCKETS) {
      expect(removed[name]).toEqual([`${tenant}/a.pdf`, `${tenant}/b.pdf`]);
    }
  });

  it("refuses an invalid id (an empty prefix would mean every store's files)", async () => {
    await expect(removeTenantStorage("", () => ({}) as BucketApi)).rejects.toThrow();
    await expect(removeTenantStorage("../x", () => ({}) as BucketApi)).rejects.toThrow();
  });
});
