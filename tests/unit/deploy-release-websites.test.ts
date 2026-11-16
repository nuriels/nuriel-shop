// deploy/release-websites.sh — the Nuriel Websites deploy (migrations 193–198), run for real against a fake docker /
// curl (state in files), a real temporary git repository (origin + the server's clone) and a real storage folder.
// What must hold: --check changes nothing; the database AND the storage are backed up before anything changes;
// every failure stops by itself in the right place; a failure after the restart brings the previous version back
// automatically (code, image and the one .env line); no secret from .env is printed; nothing is published.
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

const SCRIPT = join(process.cwd(), "deploy/release-websites.sh");
const NEW = [
  "20261116090000_bp_engine",
  "20261116100000_bp_media",
  "20261116110000_bp_site_fonts",
  "20261116120000_bp_inquiries",
  "20261117090000_bp_site_address",
  "20261117100000_bp_owner_invites",
];

const FAKE_DOCKER = String.raw`#!/usr/bin/env bash
# fake docker: just enough of the CLI for deploy/release-websites.sh, state in $STATE
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
      printenv) [[ -f "$S/engine_off" ]] || echo on ;;
      pg_dump) printf 'PGDMP fake dump' ;;
      pg_restore) cat > /dev/null ;;
      psql)
        sql=""; while (($#)); do [[ "$1" == -tAc || "$1" == -qc || "$1" == -c ]] && { sql="$2"; break; }; shift; done
        if [[ -z "$sql" ]]; then # a migration file (or a smoke script) on stdin
          body=$(cat)
          if [[ "$body" == "-- smoke"* ]]; then
            echo "$body" | head -n 1 >> "$S/smoke_run"
            if [[ -f "$S/smoke_fail" ]] || [[ -f "$S/smoke_fail_after_migrations" && -f "$S/migrated" ]]; then echo f; else echo t; fi
            exit 0
          fi
          if [[ -f "$S/fail_migration" ]] && grep -q "$(cat "$S/fail_migration")" <<<"$body"; then echo "ERROR: boom" >&2; exit 3; fi
          echo "$body" | head -n 1 >> "$S/migrations_run"; touch "$S/migrated"; exit 0
        fi
        case "$sql" in
          *"count(*) FROM public._migrations_applied"*) grep -c . "$S/ledger" || true ;;
          *"SELECT filename FROM public._migrations_applied"*) cat "$S/ledger" ;;
          *"INSERT INTO public._migrations_applied"*) sed -E "s/.*VALUES \('([^']+)'\).*/\1/" <<<"$sql" >> "$S/ledger" ;;
          *"SELECT slug FROM public.tenants"*) printf 'kobi\nnofi-dorit\n' ;;
          *"deploy.smoke@invalid.test"*|*"FROM business_profile.owner_invites) + (SELECT count(*) FROM public.tenant_host_redirects)"*) echo 0 ;;
          *"SELECT md5(concat_ws"*) [[ -f "$S/data_changed" && -f "$S/migrated" ]] && echo changed || echo same ;;
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

/** origin (bare) with release/next = A (running) and websites/engine = B (the target) */
function setup(env = "") {
  root = mkdtempSync(join(tmpdir(), "deploy-ws-"));
  const origin = join(root, "origin.git");
  const app = join(root, "app");
  const state = join(root, "state");
  const bin = join(root, "bin");
  for (const d of [state, bin, join(root, "backups")]) mkdirSync(d, { recursive: true });
  execFileSync("git", ["init", "-q", "--bare", origin]);
  execFileSync("git", ["init", "-q", "-b", "release/next", app]);
  const storage = join(root, "storage");
  mkdirSync(join(storage, "stub/product-images"), { recursive: true });
  for (let i = 0; i < 5; i++)
    writeFileSync(join(storage, `stub/product-images/p${i}.webp`), `img ${i}`);
  sh(app, "remote", "add", "origin", origin);
  mkdirSync(join(app, "supabase/migrations"), { recursive: true });
  mkdirSync(join(app, "supabase/rollbacks"), { recursive: true });
  writeFileSync(join(app, "supabase/migrations/001_a.sql"), "-- a\n");
  writeFileSync(join(app, "supabase/migrations/002_b.sql"), "-- b\n");
  writeFileSync(
    join(app, "docker-compose.yml"),
    "services:\n  app:\n    environment:\n      HOSPITALITY_ENGINE: ${HOSPITALITY_ENGINE:-}\n",
  );
  sh(app, "add", "-A");
  sh(app, "commit", "-qm", "A");
  const A = sh(app, "rev-parse", "HEAD");
  sh(app, "push", "-q", "origin", "release/next");
  sh(app, "checkout", "-q", "-b", "websites/engine");
  writeFileSync(
    join(app, "docker-compose.yml"),
    "services:\n  app:\n    environment:\n      HOSPITALITY_ENGINE: ${HOSPITALITY_ENGINE:-}\n      BUSINESS_PROFILE_ENGINE: ${BUSINESS_PROFILE_ENGINE:-}\n",
  );
  for (const f of NEW) {
    writeFileSync(join(app, `supabase/migrations/${f}.sql`), `-- up ${f}\nBEGIN; COMMIT;\n`);
    writeFileSync(join(app, `supabase/rollbacks/${f}.down.sql`), `-- down ${f}\n`);
  }
  sh(app, "add", "-A");
  sh(app, "commit", "-qm", "B");
  const B = sh(app, "rev-parse", "HEAD");
  sh(app, "push", "-q", "origin", "websites/engine");
  sh(app, "checkout", "-q", "release/next");
  sh(app, "branch", "-q", "-D", "websites/engine");
  writeFileSync(
    join(app, ".env"),
    `TENANT_BASE_DOMAIN=example.test\nPLATFORM_ADMIN_HOST=platform.example.test\nRESEND_API_KEY=re_super_secret_value\n${env}`,
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
        STORAGE_DIR_FALLBACK: storage,
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
  const envFile = () => readFileSync(join(app, ".env"), "utf8");
  return { app, state, A, B, run, ledger, head, running, latest, calls, backups, envFile };
}

describe("deploy/release-websites.sh", () => {
  it("--check: every preflight passes and nothing changes (no backup, no build, no migration, same code)", () => {
    const t = setup();
    const r = t.run("--check");
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("PREFLIGHT OK");
    expect(r.out).toContain(
      "applied: 2 = every migration of the target except 193 + 194 + 195 + 196 + 197 + 198",
    );
    expect(r.out).toContain("order creation works now");
    expect(t.head()).toBe(t.A);
    expect(t.ledger()).toEqual(["001_a.sql", "002_b.sql"]);
    expect(t.backups()).toEqual([]);
    expect(t.calls()).not.toMatch(/compose|pg_dump|docker tag/);
    expect(r.out).toContain("the target's docker-compose.yml passes BUSINESS_PROFILE_ENGINE");
    expect(r.out).toContain("email service: RESEND_API_KEY is set");
    expect(r.out).not.toContain("re_super_secret_value");
    expect(t.envFile()).not.toContain("BUSINESS_PROFILE_ENGINE");
  });

  it("--check stops when .env sets DNS_TEST_FIXTURES (tests only)", () => {
    const t = setup("DNS_TEST_FIXTURES=/tmp/x.json\n");
    const r = t.run("--check");
    expect(r.code).toBe(1);
    expect(r.out).toContain("DNS_TEST_FIXTURES");
    expect(r.out).toContain("nothing was changed");
  });

  it("--deploy: backup (db + storage), code, .env switch, build, 193 → 198, flags, restart, health — DEPLOY OK; no secret printed", () => {
    const t = setup();
    const r = t.run("--deploy");
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("DEPLOY OK");
    expect(t.head()).toBe(t.B);
    expect(t.ledger()).toEqual(["001_a.sql", "002_b.sql", ...NEW.map((f) => `${f}.sql`)]);
    expect(t.running()).toBe("sha256:new1");
    const [b] = t.backups();
    expect(b).toMatch(/^before-websites-\d{8}-\d{6}$/);
    const files = readdirSync(join(t.app, "..", "backups", b!));
    for (const f of [
      "db.dump",
      "applied-before.txt",
      "previous-code.txt",
      "build.log",
      "deploy.log",
      "storage.tar.gz",
      "engine-switch-before.txt",
      ...NEW.map((n) => `${n}.down.sql`),
    ])
      expect(files, f).toContain(f);
    expect(readFileSync(join(t.state, `img_${b}`), "utf8").trim()).toBe("sha256:old"); // the rollback image
    expect(r.out).toContain("kobi.example.test/: 200");
    expect(r.out).toContain("nofi-dorit.example.test/manage/login: 200");
    expect(r.out).not.toContain("re_super_secret_value");
    expect(r.out).toContain("migrations 193 + 194 + 195 + 196 + 197 + 198 applied");
    expect(r.out).toContain(
      "existing sites, roles, store VAT settings, orders, payments, subscriptions and zimmer bookings: unchanged",
    );
    expect(r.out).toContain("storage backup: 5 files");
    expect(r.out).toContain("business_profile_enabled = on, business_profile_public = off");
    expect(r.out).toContain("the app sees BUSINESS_PROFILE_ENGINE=on");
    expect(r.out).toContain("platform.example.test/platform/websites");
    expect(r.out).toContain("no business site, invite or redirect yet");
    expect(r.out).toContain("order creation: a test order works exactly as before");
    expect(t.envFile()).toMatch(/^BUSINESS_PROFILE_ENGINE=on$/m);
    // the storage backup really holds the files
    const listed = execFileSync(
      "tar",
      ["-tzf", join(t.app, "..", "backups", b!, "storage.tar.gz")],
      {
        encoding: "utf8",
      },
    );
    expect(listed).toContain("stub/product-images/p4.webp");
    expect(r.out).toContain("no test order kept");
    expect(files).toContain("customer-data-checksum-before.txt");
    // the order test runs before (current schema) and after (new schema), both rolled back
    expect(readFileSync(join(t.state, "smoke_run"), "utf8").trim().split("\n")).toEqual([
      "-- smoke: order before",
      "-- smoke: order after",
    ]);
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

  it("stops before anything for a commit that is not on origin/websites/engine, or a dirty code folder", () => {
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

  it("a failed build: the site keeps the old version; code, image tag and the .env line restored; no migration", () => {
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
    expect(t.envFile()).not.toContain("BUSINESS_PROFILE_ENGINE");
  });

  it("migration 195 fails: 193 + 194 stay, nothing restarts, code back, DB rollback printed (not run)", () => {
    const t = setup();
    writeFileSync(join(t.state, "fail_migration"), "up 20261116110000_bp_site_fonts");
    const r = t.run("--deploy");
    expect(r.code).toBe(1);
    expect(r.out).toContain("phase: migrations");
    expect(r.out).toContain("migration 195");
    expect(t.ledger()).toEqual(["001_a.sql", "002_b.sql", `${NEW[0]}.sql`, `${NEW[1]}.sql`]);
    expect(t.running()).toBe("sha256:old");
    expect(t.latest()).toBe("sha256:old");
    expect(t.head()).toBe(t.A);
    expect(t.calls()).not.toContain("compose up");
    expect(r.out).toContain(`${NEW[0]}.down.sql`);
    expect(r.out).toContain(`${NEW[1]}.down.sql`);
    // newest first
    expect(r.out.indexOf(`${NEW[1]}.down.sql`)).toBeLessThan(r.out.indexOf(`${NEW[0]}.down.sql`));
  });

  it("existing customer data changed during the migrations: stop, the site stays on the previous version", () => {
    const t = setup();
    writeFileSync(join(t.state, "data_changed"), "");
    const r = t.run("--deploy");
    expect(r.code).toBe(1);
    expect(r.out).toContain("existing customer data changed");
    expect(r.out).toContain("phase: migrations");
    expect(t.running()).toBe("sha256:old");
    expect(t.head()).toBe(t.A);
    expect(t.calls()).not.toContain("compose up");
  });

  it("the order test fails after the restart: automatic app rollback", () => {
    const t = setup();
    // passes before the deploy, fails after it
    writeFileSync(join(t.state, "smoke_run"), "");
    const r1 = t.run("--check");
    expect(r1.out).toContain("order creation works now");
    // make the "after" run fail: the fake fails smoke scripts once the migrations ran
    writeFileSync(join(t.state, "smoke_fail_after_migrations"), "");
    const r = t.run("--deploy");
    expect(r.code).toBe(1);
    expect(r.out).toContain("a new order does not work as before");
    expect(r.out).toContain("ROLLED BACK");
    expect(t.running()).toBe("sha256:old");
  });

  it("when the order test cannot run on the store setup, it is skipped (not a failure)", () => {
    const t = setup();
    writeFileSync(join(t.state, "smoke_fail"), "");
    const r = t.run("--deploy");
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("the order test cannot run on this store setup");
    expect(r.out).not.toContain("order creation: a test order works");
    expect(r.out).toContain("DEPLOY OK");
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
    expect(t.ledger()).toHaveLength(8); // 193–198 stay (the DB is never rolled back automatically)
    expect(t.envFile()).not.toContain("BUSINESS_PROFILE_ENGINE"); // the .env line is restored with the app
  });

  it("the app does not see the engine switch after the restart: automatic app rollback", () => {
    const t = setup();
    writeFileSync(join(t.state, "engine_off"), "");
    const r = t.run("--deploy");
    expect(r.code).toBe(1);
    expect(r.out).toContain("the app does not see BUSINESS_PROFILE_ENGINE=on");
    expect(r.out).toContain("ROLLED BACK");
    expect(t.running()).toBe("sha256:old");
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
