// NURIEL AI SEO ENGINE — the app server's own calls (service role) to the database functions that are open to the
// server only (the queue, audits, ideas, Search Console storage, proposals add). The business is always passed
// explicitly by the worker (it comes from the queued job, never from a browser) and is checked again in the
// database. Same REST endpoint and key the rest of the app uses — no new credentials.
import { serviceHeaders, supabaseUrl } from "../supabase/env.server";

export class SeoDbError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "SeoDbError";
  }
}

export async function seoServiceRpc<T>(
  fn: string,
  args: Record<string, unknown>,
  opts: { schema?: "public" | "hospitality"; tenantId?: string | null } = {},
): Promise<T> {
  const schema = opts.schema ?? "public";
  const headers: Record<string, string> = {
    ...serviceHeaders(),
    "Content-Profile": schema,
    "Accept-Profile": schema,
  };
  if (opts.tenantId) headers["x-tenant-id"] = opts.tenantId;
  const res = await fetch(`${supabaseUrl()}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let error: { message?: string; code?: string } = {};
    try {
      error = JSON.parse(text) as typeof error;
    } catch {
      error = {};
    }
    throw new SeoDbError(
      String(error.message ?? `http ${res.status}`).slice(0, 300),
      res.status,
      error.code ?? null,
    );
  }
  return (text ? JSON.parse(text) : null) as T;
}
