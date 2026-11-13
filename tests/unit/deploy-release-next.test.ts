// deploy/release-next.sh — the one-command deploy, run for real against a fake docker / curl (state in files)
// and a real temporary git repository (origin + the server's clone). No server, no Docker.
// What must hold: --check changes nothing; every failure stops by itself in the right place; a failure
// after the restart brings the previous version back automatically; no secret from .env is printed.
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "deploy/release-next.sh");
const NEW = ["20261112100000_store_owner_guard_unblock", "20261113100000_hosp_business_admin"];

const FAKE_DOCKER = String.raw`#!/usr/bin/env bash
# fake docker: just enough of the CLI for deploy/release-next.sh, state in $STATE
S="$STATE"; echo "docker $*" >> "$S/calls"
cmd="$1"; shift
img_tag() { local r="$1"; echo "@{r##*:}"; }
case "$cmd" in
  inspect)
    fmt="$2"; name="$3"
    case "$fmt" in
      *State.Running*) [[ -f "$S/down_$name" ]] && echo false || echo true ;;
      *State.Health*) id=$(cat "$S/running"); if [[ -f "$S/unhealthy_@{id#sha256:}" ]]; then echo unhealthy; else echo healthy; fi ;;
      *.Image*) cat "$S/running" ;;
    esac ;;
  image) # image inspect -f '{{.Id}}' IMG:TAG
    t=$(img_tag "$4"); [[ -f "$S/img_$t" ]] || exit 1; cat "$S/img_$t" ;;
  tag) cp "$S/img_$(img_tag "$1")" "$S/img_$(img_tag "$2")" ;;
  compose)
    case "$1" in
      build) [[ -f "$S/fail_build" ]] && { echo "build exploded" ; exit 1; }
             n=$(( $(cat "$S/builds" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$S/builds"
             echo "sha256:new$n" > "$S/img_latest" ;;
      up) cp "$S/img_latest" "$S/running" ;;
    esac ;;
  run) echo 4 ;;
  logs) : ;;
  exec)
    [[ "$1" == -i ]] && { stdin=1; shift; }
    shift # container
    prog="$1"; shift
    case "$prog" in
      pg_dump) printf 'PGDMP fake dump' ;;
      pg_restore) cat > /dev/null ;;
      psql)
        sql=""; while (($#)); do [[ "$1" == -tAc || "$1" == -qc || "$1" == -c ]] && { sql="$2"; break; }; shift; done
        if [[ -z "$sql" ]]; then # a migration file on stdin
          body=$(cat)
          if [[ -f "$S/fail_migration" ]] && grep -q "$(cat "$S/fail_migration")" <<<"$body"; then echo "ERROR: boom" >&2; exit 3; fi
          echo "$body" | head -n 1 >> "$S/migrations_run"; exit 0
        fi
        case "$sql" in
          *"count(*) FROM public._migrations_applied"*) grep -c . "$S/ledger" || true ;;
          *"SELECT filename FROM public._migrations_applied"*) cat "$S/ledger" ;;
          *"INSERT INTO public._migrations_applied"*) sed -E "s/.*VALUES \('([^']+)'\).*/\1/" <<<"$sql" >> "$S/ledger" ;;
          *"SELECT slug FROM public.tenants"*) printf 'kobi\nnofi-dorit\n' ;;
          *) [[ -f "$S/check_fail" ]] && echo f || echo t ;;
        esac ;;
    esac ;;
esac
`;

const FAKE_CURL = String.raw`#!/usr/bin/env bash
S="$STATE"; echo "curl $*" >> "$S/calls"
id=$(cat "$S/running"); [[ -f "$S/broken_@{id#sha256:}" ]] && { printf 502; exit 0; }; printf 200
`;

/** the fakes are written with @{…} for bash's \${…} (a JS template would interpolate it) */
const bashScript = (src: string) => src.replaceAll("@{", "${");

let root = "";
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function sh(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  }).trim();
}

/** origin (bare) with hospitality/release = A (running) and release/next = B (the target) */
function setup() {
  root = mkdtempSync(join(tmpdir(), "deploy-rn-"));
  const origin = join(root, "origin.git");
  const app = join(root, "app");
  const state = join(root, "state");
  const bin = join(root, "bin");
  for (const d of [state, bin, join(root, "backups")]) mkdirSync(d, { recursive: true });
  execFileSync("git", ["init", "-q", "--bare", origin]);
  execFileSync("git", ["init", "-q", "-b", "hospitality/release", app]);
  sh(app, "remote", "add", "origin", origin);
  mkdirSync(join(app, "supabase/migrations"), { recursive: true });
  mkdirSync(join(app, "supabase/rollbacks"), { recursive: true });
  writeFileSync(join(app, "supabase/migrations/001_a.sql"), "-- a\n");
  writeFileSync(join(app, "supabase/migrations/002_b.sql"), "-- b\n");
  sh(app, "add", "-A");
  sh(app, "commit", "-qm", "A");
  const A = sh(app, "rev-parse", "HEAD");
  sh(app, "push", "-q", "origin", "hospitality/release");
  sh(app, "checkout", "-q", "-b", "release/next");
  for (const f of NEW) {
    writeFileSync(join(app, `supabase/migrations/${f}.sql`), `-- up ${f}\nBEGIN; COMMIT;\n`);
    writeFileSync(join(app, `supabase/rollbacks/${f}.down.sql`), `-- down ${f}\n`);
  }
  sh(app, "add", "-A");
  sh(app, "commit", "-qm", "B");
  const B = sh(app, "rev-parse", "HEAD");
  sh(app, "push", "-q", "origin", "release/next");
  sh(app, "checkout", "-q", "hospitality/release");
  sh(app, "branch", "-q", "-D", "release/next");
  writeFileSync(
    join(app, ".env"),
    "TENANT_BASE_DOMAIN=example.test\nPLATFORM_ADMIN_HOST=platform.example.test\nRESEND_API_KEY=re_super_secret_value\n",
  );
  writeFileSync(join(state, "ledger"), "001_a.sql\n002_b.sql\n");
  writeFileSync(join(state, "img_latest"), "sha256:old\n");
  writeFileSync(join(state, "running"), "sha256:old\n");
  writeFileSync(join(bin, "docker"), bashScript(FAKE_DOCKER));
  writeFileSync(join(bin, "curl"), bashScript(FAKE_CURL));
  chmodSync(join(bin, "docker"), 0o755);
  chmodSync(join(bin, "curl"), 0o755);
  const run = (mode: "--check" | "--deploy", target = B) => {
    const r = spawnSync("bash", [SCRIPT, mode, target], {
      encoding: "utf8",
      env: {
        PATH: `${bin}:${process.env["PATH"]}`,
        HOME: root,
        STATE: state,
        APP_DIR: app,
        BACKUP_ROOT: join(root, "backups"),
        EXPECTED_BEFORE: "2",
        MIN_FREE_GB: "0",
        WAIT_SECONDS: "0",
        WAIT_STEPS: "8",
      },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const ledger = () => readFileSync(join(state, "ledger"), "utf8").trim().split("\n");
  const head = () => sh(app, "rev-parse", "HEAD");
  const running = () => readFileSync(join(state, "running"), "utf8").trim();
  const latest = () => readFileSync(join(state, "img_latest"), "utf8").trim();
  const calls = () =>
    existsSync(join(state, "calls")) ? readFileSync(join(state, "calls"), "utf8") : "";
  const backups = () => readdirSync(join(root, "backups"));
  return { app, state, A, B, run, ledger, head, running, latest, calls, backups };
}

describe("deploy/release-next.sh", () => {
  it("--check: every preflight passes and nothing changes (no backup, no build, no migration, same code)", () => {
    const t = setup();
    const r = t.run("--check");
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("PREFLIGHT OK");
    expect(r.out).toContain("applied: 2 = every migration of the target except 187 + 188");
    expect(t.head()).toBe(t.A);
    expect(t.ledger()).toEqual(["001_a.sql", "002_b.sql"]);
    expect(t.backups()).toEqual([]);
    expect(t.calls()).not.toMatch(/compose|pg_dump|docker tag/);
  });

  it("--deploy: backup, code, build, 187 then 188, restart, health — DEPLOY OK; no secret printed", () => {
    const t = setup();
    const r = t.run("--deploy");
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("DEPLOY OK");
    expect(t.head()).toBe(t.B);
    expect(t.ledger()).toEqual(["001_a.sql", "002_b.sql", ...NEW.map((f) => `${f}.sql`)]);
    expect(t.running()).toBe("sha256:new1");
    const [b] = t.backups();
    expect(b).toMatch(/^before-release-next-\d{8}-\d{6}$/);
    const files = readdirSync(join(t.app, "..", "backups", b!));
    for (const f of [
      "db.dump",
      "applied-before.txt",
      "previous-code.txt",
      "build.log",
      "deploy.log",
      ...NEW.map((n) => `${n}.down.sql`),
    ])
      expect(files, f).toContain(f);
    expect(readFileSync(join(t.state, `img_${b}`), "utf8").trim()).toBe("sha256:old"); // the rollback image
    expect(r.out).toContain("kobi.example.test/: 200");
    expect(r.out).toContain("nofi-dorit.example.test/manage/login: 200");
    expect(r.out).not.toContain("re_super_secret_value");
    // order: dump → build → migrations → up
    const c = t.calls();
    expect(c.indexOf("pg_dump")).toBeLessThan(c.indexOf("compose build"));
    expect(c.indexOf("compose build")).toBeLessThan(
      c.indexOf("INSERT INTO public._migrations_applied"),
    );
    expect(c.lastIndexOf("INSERT INTO")).toBeLessThan(c.indexOf("compose up"));
  });

  it("stops before anything when the applied list is not what the target expects", () => {
    const t = setup();
    writeFileSync(join(t.state, "ledger"), "001_a.sql\n002_b.sql\n999_unknown.sql\n");
    const r = t.run("--deploy");
    expect(r.code).toBe(1);
    expect(r.out).toContain("applied migrations: 3 (expected 2)");
    expect(r.out).toContain("nothing was changed");
    expect(t.backups()).toEqual([]);
    expect(t.head()).toBe(t.A);
  });

  it("stops before anything for a commit that is not on origin/release/next, or a dirty code folder", () => {
    const t = setup();
    const r1 = t.run(
      "--deploy",
      t.A.replace(/^./, (c) => (c === "a" ? "b" : "a")),
    );
    expect(r1.code).toBe(1);
    expect(r1.out).toContain("not found");
    writeFileSync(join(t.app, "supabase/migrations/001_a.sql"), "-- changed on the server\n");
    const r2 = t.run("--deploy");
    expect(r2.code).toBe(1);
    expect(r2.out).toContain("uncommitted changes");
    expect(t.backups()).toEqual([]);
  });

  it("a failed build: the site keeps the old version; code and image tag restored; no migration", () => {
    const t = setup();
    writeFileSync(join(t.state, "fail_build"), "");
    const r = t.run("--deploy");
    expect(r.code).toBe(1);
    expect(r.out).toContain("phase: build");
    expect(t.head()).toBe(t.A);
    expect(t.latest()).toBe("sha256:old");
    expect(t.running()).toBe("sha256:old");
    expect(t.ledger()).toHaveLength(2);
    expect(t.calls()).not.toContain("compose up");
  });

  it("migration 188 fails: 187 stays (compatible), nothing restarts, code back, DB rollback printed (not run)", () => {
    const t = setup();
    writeFileSync(join(t.state, "fail_migration"), "up 20261113100000_hosp_business_admin");
    const r = t.run("--deploy");
    expect(r.code).toBe(1);
    expect(r.out).toContain("phase: migrations");
    expect(r.out).toContain("migration 188");
    expect(t.ledger()).toEqual(["001_a.sql", "002_b.sql", `${NEW[0]}.sql`]);
    expect(t.running()).toBe("sha256:old");
    expect(t.latest()).toBe("sha256:old");
    expect(t.head()).toBe(t.A);
    expect(t.calls()).not.toContain("compose up");
    expect(r.out).toContain(`${NEW[0]}.down.sql`);
  });

  it("the new version fails the health check: automatic app rollback to the previous image and code", () => {
    const t = setup();
    writeFileSync(join(t.state, "broken_new1"), ""); // the new image answers 502
    const r = t.run("--deploy");
    expect(r.code).toBe(1);
    expect(r.out).toContain("phase: health");
    expect(r.out).toContain("ROLLED BACK");
    expect(t.running()).toBe("sha256:old");
    expect(t.head()).toBe(t.A);
    expect(t.ledger()).toHaveLength(4); // 187 + 188 stay — the previous version works with them
  });

  it("the new version never becomes healthy: automatic app rollback", () => {
    const t = setup();
    writeFileSync(join(t.state, "unhealthy_new1"), "");
    const r = t.run("--deploy");
    expect(r.code).toBe(1);
    expect(r.out).toContain("phase: restart");
    expect(r.out).toContain("ROLLED BACK");
    expect(t.running()).toBe("sha256:old");
    expect(t.head()).toBe(t.A);
  });
});
