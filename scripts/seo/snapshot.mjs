#!/usr/bin/env node
// ============================================================
// Snapshot של SEO לאתר אחד — קריאה בלבד (GET), בלי לשנות כלום בשרת.
// מצלם: robots.txt ו-sitemap.xml במלואם, ההפניות של "/" ו-"/stay/", ולכל כתובת ב-sitemap — קוד
// תגובה, הפניה, X-Robots-Tag, ה-head (כותרת, תיאור, robots, canonical, אימות Google, JSON-LD, H1)
// והאם robots.txt מתיר אותה; ובנוסף ה-favicon, ה-manifest ותמונת השיתוף של דף הבית.
//
// שימוש:
//   node scripts/seo/snapshot.mjs https://nofi-dorit.nuri1.fit --out baseline.json
//   node scripts/seo/snapshot.mjs http://demo-zimmer.shop.localhost:3100 --connect 127.0.0.1:3100 --out local.json
// השוואה: node scripts/seo/compare.mjs before.json after.json
// מאחורי פרוקסי (HTTPS_PROXY) הבקשות עוברות דרכו; לתעודת הפרוקסי — NODE_EXTRA_CA_CERTS.
// ============================================================
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { writeFileSync } from "node:fs";
import { parseHead, parseRobots, parseSitemap, robotsAllows } from "./lib.mjs";

const VERSION = 1;
const MAX_BODY = 5_000_000;
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = args.find((a) => /^https?:\/\//.test(a));
if (!base) {
  console.error(
    "שימוש: node scripts/seo/snapshot.mjs <https://site> [--out file.json] [--connect host:port]",
  );
  process.exit(2);
}
const origin = new URL(base).origin;
const connect = opt("--connect");
const delayMs = Number(opt("--delay-ms") ?? 250);
const maxPages = Number(opt("--max") ?? 200);
const UA = "NurielSeoSnapshot/1 (read-only)";

function proxyFor(url) {
  const p = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!p || url.protocol !== "https:") return null;
  const skip = (process.env.NO_PROXY || process.env.no_proxy || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (skip.some((h) => h === url.hostname || (h.startsWith(".") && url.hostname.endsWith(h))))
    return null;
  return new URL(p);
}

/** GET בלי לעקוב אחרי הפניות — כדי לצלם גם את ההפניה עצמה */
function get(urlStr) {
  const url = new URL(urlStr);
  const headers = {
    "User-Agent": UA,
    Accept: "text/html,application/xml;q=0.9,*/*;q=0.8",
    Host: url.host,
  };
  return new Promise((resolve) => {
    const fail = (e) =>
      resolve({ status: 0, error: String(e?.message ?? e), headers: {}, body: "" });
    const onResponse = (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size <= MAX_BODY) chunks.push(c);
      });
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
      res.on("error", fail);
    };
    const send = (mod, options) => {
      const req = mod.request(options, onResponse);
      req.on("error", fail);
      req.setTimeout(30_000, () => req.destroy(new Error("timeout")));
      req.end();
    };
    const path = url.pathname + url.search;
    if (connect) {
      const [host, port] = connect.split(":");
      return send(http, { host, port: Number(port), path, method: "GET", headers });
    }
    const proxy = proxyFor(url);
    if (!proxy)
      return send(url.protocol === "https:" ? https : http, {
        hostname: url.hostname,
        port: url.port || undefined,
        path,
        method: "GET",
        headers,
      });
    const target = `${url.hostname}:${url.port || 443}`;
    const tunnel = http.request({
      host: proxy.hostname,
      port: Number(proxy.port || 80),
      method: "CONNECT",
      path: target,
      headers: { Host: target },
    });
    tunnel.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return fail(new Error(`proxy CONNECT ${res.statusCode}`));
      }
      send(https, {
        hostname: url.hostname,
        path,
        method: "GET",
        headers,
        createConnection: () => tls.connect({ socket, servername: url.hostname }),
      });
    });
    tunnel.on("error", fail);
    tunnel.setTimeout(30_000, () => tunnel.destroy(new Error("timeout")));
    tunnel.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const header = (res, name) => {
  const v = res.headers?.[name];
  return v === undefined ? null : Array.isArray(v) ? v.join(", ") : String(v);
};
/** כתובת מה-sitemap → נתיב באתר שאנחנו מצלמים (ב---connect הדומיין בקובץ יכול להיות אחר) */
const pathOf = (loc) => {
  const u = new URL(loc, origin);
  return u.pathname + u.search;
};

const snapshot = {
  tool: "scripts/seo/snapshot.mjs",
  version: VERSION,
  origin,
  capturedAt: new Date().toISOString(),
};

const robotsRes = await get(`${origin}/robots.txt`);
snapshot.robots = {
  status: robotsRes.status,
  contentType: header(robotsRes, "content-type"),
  body: robotsRes.status === 200 ? robotsRes.body : null,
};
const robots = parseRobots(snapshot.robots.body ?? "");

await sleep(delayMs);
const sitemapRes = await get(`${origin}/sitemap.xml`);
snapshot.sitemap = {
  status: sitemapRes.status,
  contentType: header(sitemapRes, "content-type"),
  xRobotsTag: header(sitemapRes, "x-robots-tag"),
  body: sitemapRes.status === 200 ? sitemapRes.body : null,
  urls: sitemapRes.status === 200 ? parseSitemap(sitemapRes.body) : [],
};

snapshot.redirects = [];
for (const path of ["/", "/stay/"]) {
  await sleep(delayMs);
  const res = await get(`${origin}${path}`);
  snapshot.redirects.push({ path, status: res.status, location: header(res, "location") });
}

snapshot.pages = [];
for (const { loc } of snapshot.sitemap.urls.slice(0, maxPages)) {
  await sleep(delayMs);
  const path = pathOf(loc);
  const res = await get(`${origin}${path}`);
  const isHtml = /text\/html/i.test(header(res, "content-type") ?? "");
  snapshot.pages.push({
    url: loc,
    status: res.status,
    location: header(res, "location"),
    xRobotsTag: header(res, "x-robots-tag"),
    robotsAllowed: robotsAllows(robots, path),
    head: isHtml ? parseHead(res.body) : null,
    error: res.error ?? null,
  });
}

// דף הבית (הכתובת הראשונה ב-sitemap): האייקונים, ה-manifest ותמונת השיתוף — קוד תגובה והאם robots.txt מתיר
const home = snapshot.pages[0]?.head;
const assetPaths = new Set();
for (const href of [...(home?.icons ?? []), home?.manifest, home?.ogImage]) {
  if (!href) continue;
  const u = new URL(href, origin);
  if (u.origin === origin || (connect && u.hostname === new URL(snapshot.pages[0].url).hostname))
    assetPaths.add(u.pathname + u.search);
}
snapshot.assets = [];
for (const path of [...assetPaths].sort()) {
  await sleep(delayMs);
  const res = await get(`${origin}${path}`);
  snapshot.assets.push({
    path,
    status: res.status,
    contentType: header(res, "content-type"),
    robotsAllowed: robotsAllows(robots, path.split("?")[0]),
  });
}
snapshot.homeLinks = (home?.internalLinks ?? []).map((path) => ({
  path,
  robotsAllowed: robotsAllows(robots, path),
}));

const json = `${JSON.stringify(snapshot, null, 1)}\n`;
const out = opt("--out");
if (out) writeFileSync(out, json);
const blocked =
  snapshot.pages.filter((p) => !p.robotsAllowed).length +
  snapshot.assets.filter((a) => !a.robotsAllowed).length;
console.log(
  `${origin}: robots ${snapshot.robots.status} · sitemap ${snapshot.sitemap.status} (${snapshot.sitemap.urls.length} URLs) · ` +
    `pages ${snapshot.pages.map((p) => p.status).join(",") || "-"} · assets ${snapshot.assets.map((a) => a.status).join(",") || "-"} · ` +
    `blocked by robots.txt: ${blocked}${out ? ` → ${out}` : ""}`,
);
if (!out) process.stdout.write(json);
