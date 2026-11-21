// NURIEL AI SEO ENGINE — fetching a business's OWN public pages for the technical audit.
// Same protections as the image import (src/server/services/image-fetch.ts, via the platform adapter): http/https
// only, our own DNS resolution with internal / loopback / link-local / metadata addresses blocked and the
// connection pinned to the checked address, a timeout, a size cap, and every redirect re-checked. On top of that,
// the crawler only ever asks for hosts the caller allowed (the business's own domain) — never an arbitrary URL.
import http from "node:http";
import https from "node:https";
import { assertFetchableUrl, safeLookup } from "@/platform/media/remote-image.server";

export interface FetchedText {
  status: number;
  headers: Record<string, string>;
  body: string | null;
  finalUrl: string | null;
}

export type Fetcher = (url: string, opts: { timeoutMs: number; userAgent: string }) => Promise<FetchedText>;

export const AUDIT_USER_AGENT = "NurielSEOAudit/1.0 (+https://nuri1.fit; site owner audit)";
const MAX_BODY = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TEXT_TYPES = ["text/html", "application/xhtml+xml", "application/xml", "text/xml", "text/plain"];

export class AuditFetchError extends Error {}

function once(url: URL, timeoutMs: number, userAgent: string): Promise<FetchedText & { location: string | null }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    let settled = false;
    const done = (err: unknown, value?: FetchedText & { location: string | null }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else if (value) resolve(value);
    };
    const req = client.request(
      url,
      {
        method: "GET",
        headers: { "user-agent": userAgent, accept: "text/html,application/xml;q=0.9,*/*;q=0.5" },
        lookup: safeLookup,
        agent: false,
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          done(null, { status, headers, body: null, finalUrl: null, location: res.headers.location });
          req.destroy();
          return;
        }
        const type = (headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
        if (!TEXT_TYPES.includes(type)) {
          res.resume();
          done(null, { status, headers, body: null, finalUrl: null, location: null });
          req.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BODY) {
            req.destroy();
            done(new AuditFetchError("the page is larger than 2MB"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => done(null, { status, headers, body: Buffer.concat(chunks).toString("utf8"), finalUrl: null, location: null }));
        res.on("error", (e) => done(e));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      done(new AuditFetchError("timeout"));
    }, timeoutMs + 500);
    req.on("timeout", () => {
      req.destroy();
      done(new AuditFetchError("timeout"));
    });
    req.on("error", (e) => done(e));
    req.end();
  });
}

/** a GET that follows up to 3 redirects, each one re-checked and kept inside the allowed hosts */
export function makeSafeFetcher(allowedHosts: string[]): Fetcher {
  const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()));
  return async (raw, { timeoutMs, userAgent }) => {
    let url = assertFetchableUrl(raw);
    if (!allowed.has(url.host.toLowerCase())) throw new AuditFetchError("host is not the business's own domain");
    let redirected = false;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const r = await once(url, timeoutMs, userAgent);
      if (!r.location) return { status: r.status, headers: r.headers, body: r.body, finalUrl: redirected ? url.toString() : null };
      const next = assertFetchableUrl(new URL(r.location, url).toString());
      if (!allowed.has(next.host.toLowerCase())) {
        return { status: r.status, headers: r.headers, body: null, finalUrl: next.toString() };
      }
      url = next;
      redirected = true;
    }
    throw new AuditFetchError("too many redirects");
  };
}
