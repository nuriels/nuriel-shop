/**
 * Online payments, tenant scope — a store terminal's status (max_account_status) for the store owner's card and the
 * platform admin's MAX tab. Never a secret: has_* flags and the last 2 digits of the terminal only. The DB
 * authorizes the actor (the store's owner or a platform admin). DEMO: the owner changes nothing (one payment only).
 */
import { paymentsRpc } from "@/platform/payments/server/db";
import type { StoreTerminalView } from "@/platform/payments/tenant-views";
import { asRecord, bool, modeOf, str, unwrap } from "./db";

const ENVIRONMENTS = ["demo", "production"] as const;
const STATUSES = ["unverified", "verified", "failed"] as const;

export function storeTerminalViewOf(data: unknown): StoreTerminalView {
  const r = asRecord(data);
  const environment = str(r?.["environment"]);
  const status = str(r?.["status"]);
  const hint = (str(r?.["terminal_hint"]) ?? "").replace(/[^0-9]/g, "").slice(-2);
  return {
    configured: bool(r?.["configured"]),
    active: bool(r?.["active"]),
    environment: ENVIRONMENTS.find((e) => e === environment) ?? null,
    enabled: bool(r?.["enabled"]),
    mode: modeOf(r?.["mode"]),
    status: STATUSES.find((s) => s === status) ?? null,
    lastVerifiedAt: str(r?.["last_verified_at"]),
    terminalHint: hint.length === 2 ? hint : null,
    hasApiKey: bool(r?.["has_api_key"]),
    hasApiPassword: bool(r?.["has_api_password"]),
    credentialsUpdatedAt: str(r?.["credentials_updated_at"]),
  };
}

export async function storeTerminalStatus(
  actorId: string,
  tenantId: string,
): Promise<StoreTerminalView> {
  return storeTerminalViewOf(
    unwrap(
      "max_account_status",
      await paymentsRpc("max_account_status", { _actor: actorId, _tenant: tenantId }),
    ),
  );
}
