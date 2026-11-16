// deploy/websites-efrat.sh — Efrat's site on production after the deploy (open, files, import, audit, preview checks).
// Run for real against a fake docker / curl (state in files). The full path was also rehearsed against the local
// test stack (real database, app and storage). What must hold here: every step refuses before changing anything
// when a precondition is missing; the site is opened only once, as the platform admin; the preview checks fail when
// the site or the platform is public, when a page is indexable or when the management can be framed.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "deploy/websites-efrat.sh");

const FAKE_DOCKER = String.raw`#!/usr/bin/env bash
S="$STATE"; echo "docker $*" >> "$S/calls"
case "$1" in
  image) exit 1 ;;
  exec)
    shift; stdin=0; [[ "$1" == -i ]] && { stdin=1; shift; }
    shift; shift # container, psql
    if ((stdin)); then
      body=$(cat); echo "$body" >> "$S/stdin_sql"
      if [[ "$body" == *platform_bp_open_site* ]]; then
        echo 11111111-2222-3333-4444-555555555555 > "$S/site_id"
        printf '{"sub" : "x"}\n{"id": "11111111-2222-3333-4444-555555555555", "slug": "efrat"}\n'
      fi
      exit 0
    fi
    sql=""; while (($#)); do [[ "$1" == -tAc ]] && { sql="$2"; break; }; shift; done
    case "$sql" in
      *to_regclass*) cat "$S/regclass" 2>/dev/null || echo t ;;
      *"SELECT enabled FROM public.platform_feature_flags WHERE key = 'business_profile_enabled'"*) echo t ;;
      *"SELECT id FROM public.tenants"*) cat "$S/site_id" 2>/dev/null || true ;;
      *"count(*) FROM public.platform_admins"*) cat "$S/admins" 2>/dev/null || echo 1 ;;
      *"lower(u.email)"*) [[ "$sql" != *admin@nuriel.test* ]] || echo aaaaaaaa-0000-0000-0000-000000000001 ;;
      *"SELECT user_id FROM public.platform_admins"*) echo aaaaaaaa-0000-0000-0000-000000000001 ;;
      *"platform_feature_flags WHERE key = 'business_profile_public')"*) cat "$S/public_state" 2>/dev/null || echo t ;;
      *) echo t ;;
    esac ;;
esac
`;

// fake curl: -o BODY -D HEAD -w '%{http_code}' … URL — canned answers per path, overridable per test
const FAKE_CURL = String.raw`#!/usr/bin/env bash
S="$STATE"; body=/dev/null; head=/dev/null; url=""
while (($#)); do
  case "$1" in -o) body="$2"; shift ;; -D) head="$2"; shift ;; -m|-w|-H) shift ;; http*) url="$1" ;; esac; shift
done
path=$(echo "$url" | sed -E 's#^[a-z]+://[^/]+##'); [[ "$url" == https://* ]] && { printf 000; exit 7; }
key=$(echo "$path" | tr '/.' '__')
if [[ -f "$S/curl$key" ]]; then . "$S/curl$key"; else
  case "$path" in
    /robots.txt) code=200; hdr=""; bdy=$'User-agent: *\nDisallow: /' ;;
    /studio*) code=200; hdr=$'X-Frame-Options: SAMEORIGIN'; bdy='<meta name="robots" content="noindex, nofollow">' ;;
    *) code=404; hdr=$'X-Robots-Tag: noindex, nofollow'; bdy='' ;;
  esac
fi
printf '%s\n' "$hdr" > "$head"; printf '%s\n' "$bdy" > "$body"; printf %s "$code"
`;

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), "ws-efrat-"));
  dirs.push(root);
  const bin = join(root, "bin");
  const state = join(root, "state");
  const app = join(root, "app");
  for (const d of [bin, state, app]) mkdirSync(d);
  writeFileSync(join(bin, "docker"), FAKE_DOCKER);
  writeFileSync(join(bin, "curl"), FAKE_CURL);
  chmodSync(join(bin, "docker"), 0o755);
  chmodSync(join(bin, "curl"), 0o755);
  writeFileSync(
    join(app, ".env"),
    "TENANT_BASE_DOMAIN=nuri1.fit\nSUPABASE_URL=https://db.example.test\nSUPABASE_SERVICE_ROLE_KEY=super-secret-value\n",
  );
  const run = (args: string[], env: Record<string, string> = {}) => {
    const r = spawnSync("bash", [SCRIPT, ...args], {
      encoding: "utf8",
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        STATE: state,
        APP_DIR: app,
        NODE_IMAGE: "x",
        ...env,
      },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const calls = () =>
    existsSync(join(state, "calls")) ? readFileSync(join(state, "calls"), "utf8") : "";
  const sqlSent = () =>
    existsSync(join(state, "stdin_sql")) ? readFileSync(join(state, "stdin_sql"), "utf8") : "";
  return { state, app, run, calls, sqlSent };
}

describe("deploy/websites-efrat.sh", () => {
  it("no step → usage, nothing runs", () => {
    const t = setup();
    const r = t.run([]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("usage:");
    expect(t.calls()).toBe("");
  });

  it("open-site: refuses before migration 198 is applied (nothing opened)", () => {
    const t = setup();
    writeFileSync(join(t.state, "regclass"), "f\n");
    const r = t.run(["open-site"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("migration 198 is not applied");
    expect(t.sqlSent()).not.toContain("platform_bp_open_site");
  });

  it("open-site: several platform admins and no ADMIN_EMAIL → refuses; a wrong ADMIN_EMAIL → refuses", () => {
    const t = setup();
    writeFileSync(join(t.state, "admins"), "2\n");
    let r = t.run(["open-site"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("set ADMIN_EMAIL");
    r = t.run(["open-site"], { ADMIN_EMAIL: "someone@else.test" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("not a platform admin");
    expect(t.sqlSent()).not.toContain("platform_bp_open_site");
  });

  it("open-site: opens as the platform admin (claims set, draft only, no owner), then is a no-op", () => {
    const t = setup();
    const r = t.run(["open-site"], { ADMIN_EMAIL: "admin@nuriel.test" });
    expect(r.code).toBe(0);
    expect(r.out).toContain('"slug": "efrat"');
    expect(r.out).toContain("no owner yet, nothing published, not public");
    const sent = t.sqlSent();
    expect(sent).toContain("'sub', 'aaaaaaaa-0000-0000-0000-000000000001'");
    expect(sent).toContain("public.platform_bp_open_site('efrat', 'אפרת אדיר')");
    const again = t.run(["open-site"], { ADMIN_EMAIL: "admin@nuriel.test" });
    expect(again.code).toBe(0);
    expect(again.out).toContain("already open (nothing changed)");
    expect(t.sqlSent().match(/platform_bp_open_site/g)).toHaveLength(1);
  });

  it("import: refuses without the tools, without ADMIN_EMAIL, or before the site is open", () => {
    const t = setup();
    expect(t.run(["import"]).out).toContain("run first: bash deploy/websites-efrat.sh tools");
    mkdirSync(join(t.app, ".cache/websites-tools/node_modules/seroval"), { recursive: true });
    expect(t.run(["import"]).out).toContain("set ADMIN_EMAIL");
    const r = t.run(["import"], { ADMIN_EMAIL: "admin@nuriel.test" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("is not open");
    expect(t.calls()).not.toContain("docker run");
  });

  it("checks: an unpublished preview passes; no secret from .env is printed", () => {
    const t = setup();
    writeFileSync(join(t.state, "site_id"), "11111111-2222-3333-4444-555555555555\n");
    const r = t.run(["checks"]);
    expect(r.out).toContain("PREVIEW OK");
    expect(r.code).toBe(0);
    expect(r.out).toContain("/studio/invite: 200 noindex frame");
    expect(r.out).not.toContain("super-secret-value");
  });

  it("checks: fails when the site/platform is public, a page is indexable, robots is open or framing is allowed", () => {
    const cases: [string, string | null, string][] = [
      ["public", null, "the site or the platform is set public"],
      ["_", "code=200; hdr=''; bdy='<html>'", "✗ /: 200"],
      ["_robots_txt", "code=200; hdr=''; bdy='User-agent: *'", "✗ /robots.txt"],
      [
        "_studio",
        "code=200; hdr=''; bdy='<meta name=\"robots\" content=\"noindex\">'",
        "✗ /studio: 200",
      ],
    ];
    for (const [key, answer, msg] of cases) {
      const t = setup();
      writeFileSync(join(t.state, "site_id"), "11111111-2222-3333-4444-555555555555\n");
      if (key === "public") writeFileSync(join(t.state, "public_state"), "f\n");
      else writeFileSync(join(t.state, `curl${key}`), `${answer}\n`);
      const r = t.run(["checks"]);
      expect(r.code, key).toBe(1);
      expect(r.out, key).toContain(msg);
      expect(r.out, key).not.toContain("PREVIEW OK");
    }
  });
});
