// deploy/release-seo-sitelinks.sh — the release of migration 206 + the SEO structure engine, run for real against a
// fake docker / curl (state in files) and a real temporary git repository (origin + the server's clone).
// What must hold: --check changes nothing; every failure stops by itself at the right place; the migration is one
// transaction (a failure leaves the database as it was); a failure after the restart brings the previous version
// back automatically; a second run continues after a stop; the DB rollback refuses while the release runs; no
// secret from .env is printed.
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "deploy/release-seo-sitelinks.sh");
const MIG = "20261125100000_hosp_email_alerts";
const BRANCH = "hospitality/seo-sitelinks-engine";
const MIG_TEXT = `-- 206 fixture\nBEGIN;\nALTER TABLE x ADD COLUMN alert_seen_at timestamptz;\nNOTIFY pgrst, 'reload schema';\nCOMMIT;\n`;
const DOWN_TEXT = `-- 206 down fixture\nBEGIN;\nALTER TABLE x DROP COLUMN alert_seen_at;\nCOMMIT;\n`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const FAKE_DOCKER = String.raw`#!/usr/bin/env bash
# fake docker: just enough of the CLI for deploy/release-seo-sitelinks.sh, state in $STATE
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
  image) t=$(img_tag "$4"); [[ -f "$S/img_$t" ]] || exit 1; cat "$S/img_$t" ;;
  tag) cp "$S/img_$(img_tag "$1")" "$S/img_$(img_tag "$2")" ;;
  compose)
    case "$1" in
      build) [[ -f "$S/fail_build" ]] && { echo "build exploded"; exit 1; }
             n=$(( $(cat "$S/builds" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$S/builds"
             echo "sha256:new$n" > "$S/img_latest" ;;
      up) cp "$S/img_latest" "$S/running" ;;
    esac ;;
  run) [[ -f "$S/no_marks" ]] && echo 0 || echo 4 ;;
  logs) [[ -f "$S/no_worker" ]] || echo "[seo] worker started: every 2 minutes (background AI off)" ;;
  exec)
    [[ "$1" == -i ]] && shift
    shift # container
    prog="$1"; shift
    case "$prog" in
      pg_dump) printf 'PGDMP fake dump' ;;
      pg_restore) cat > /dev/null ;;
      psql)
        sql=""; while (($#)); do [[ "$1" == -tAc ]] && { sql="$2"; break; }; shift; done
        if [[ -z "$sql" ]]; then # a script on stdin
          body=$(cat)
          case "$body" in
            *"BEGIN ISOLATION LEVEL REPEATABLE READ"*"INSERT INTO public._migrations_applied"*)
              echo "migration" >> "$S/tx_runs"
              [[ -f "$S/fail_migration" ]] && { echo "ERROR: guard: boom" >&2; exit 3; }
              printf '%s\n' "$body" > "$S/last_migration.sql"
              echo "${MIG}.sql" >> "$S/ledger"; touch "$S/migrated" ;;
            *"BEGIN ISOLATION LEVEL REPEATABLE READ"*"DELETE FROM public._migrations_applied"*)
              echo "rollback" >> "$S/tx_runs"
              grep -v "${MIG}" "$S/ledger" > "$S/ledger.new" || true; mv "$S/ledger.new" "$S/ledger"; rm -f "$S/migrated" ;;
            *representative_signature*)
              echo "nofi-dorit|t|abcd1234|3|t"; echo "amenity|ג׳קוזי|רק בחדר מוריה|(the property)"
              [[ -f "$S/nofi_changed" && -f "$S/migrated" ]] && echo "package|changed" ;;
            *) echo "unexpected stdin" >&2; exit 9 ;;
          esac
          exit 0
        fi
        case "$sql" in
          *"SELECT filename FROM public._migrations_applied"*) cat "$S/ledger" ;;
          *"SELECT CASE WHEN is_default"*) printf 'store kobi\nhospitality nofi-dorit\nbusiness_profile efrat\n' ;;
          *"hospitality.notifications n JOIN public.tenants"*) echo "nofi-dorit: 2" ;;
          *"alert\\_%"*) [[ -f "$S/migrated" ]] && echo f || echo t ;;
          *"information_schema.columns"*) [[ -f "$S/migrated" && ! -f "$S/post_check_fail" ]] && echo t || echo f ;;
          *) echo "unexpected sql" >&2; exit 9 ;;
        esac ;;
    esac ;;
esac
`;

// pages: what the old / the new image send (the new one has WebSite, category links, "page | store" titles)
const FAKE_CURL = String.raw`#!/usr/bin/env bash
S="$STATE"; echo "curl $*" >> "$S/calls"
id=$(cat "$S/running"); new=no; [[ "$id" == sha256:new* ]] && new=yes
code=no; host=""; url=""
while (($#)); do
  case "$1" in
    -w) code=yes; shift ;;
    -H) [[ "$2" == Host:* ]] && host="@{2#Host: }"; shift ;;
    http*) url="$1" ;;
  esac
  shift
done
if [[ "$code" == yes ]]; then
  [[ -f "$S/broken_@{id#sha256:}" ]] && { printf 502; exit 0; }; printf 200; exit 0
fi
path="/@{url#http://*/}"; [[ "$url" == */ ]] && path=/
[[ "$path" == "/http"* ]] && path=/
case "$path" in
  /stay)
    printf '<title>נופי דורית</title><meta name="description" content="צימרים">'
    [[ "$new" == yes && ! -f "$S/no_website_ld" ]] && printf '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"נופי דורית"}</script>' ;;
  /sitemap.xml) printf '<urlset><url><loc>https://kobi.example.test/?category=%%D7%%90</loc></url></urlset>' ;;
  /about) [[ "$new" == yes ]] && printf '<title>אודות | החנות</title>' || printf '<title>אודות</title>' ;;
  /)
    if [[ "$new" == yes && -f "$S/title_changed" ]]; then printf '<title>אחר</title>'; else printf '<title>החנות</title>'; fi
    printf '<meta name="description" content="החנות שלנו">'
    [[ "$new" == yes ]] && printf '<a href="/?category=%%D7%%90">א</a>' || printf '<button>א</button>' ;;
esac
`;

/** the fakes are written with @{…} for bash's \${…} (a JS template would interpolate it) */
const bashScript = (src: string) => src.replaceAll("@{", "${").replaceAll("${MIG}", MIG);

let root = "";
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function git(cwd: string, ...args: string[]) {
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

/** origin (bare): hospitality/tracking-settings = A (what runs), the release branch = B (the target) */
function setup() {
  root = mkdtempSync(join(tmpdir(), "deploy-seo-"));
  const origin = join(root, "origin.git");
  const app = join(root, "app");
  const state = join(root, "state");
  const bin = join(root, "bin");
  for (const d of [state, bin, join(root, "backups")]) mkdirSync(d, { recursive: true });
  execFileSync("git", ["init", "-q", "--bare", origin]);
  execFileSync("git", ["init", "-q", "-b", "hospitality/tracking-settings", app]);
  git(app, "remote", "add", "origin", origin);
  for (const d of ["supabase/migrations", "supabase/rollbacks", "deploy/seo-engine"])
    mkdirSync(join(app, d), { recursive: true });
  writeFileSync(join(app, "supabase/migrations/001_a.sql"), "-- a\n");
  writeFileSync(join(app, "supabase/migrations/002_b.sql"), "-- b\n");
  writeFileSync(
    join(app, "deploy/seo-engine/guard-tx.sql"),
    "-- guard\nSELECT md5('customers');\n",
  );
  writeFileSync(
    join(app, "deploy/seo-engine/nofi-snapshot.sql"),
    "SELECT representative_signature FROM x;\n",
  );
  git(app, "add", "-A");
  git(app, "commit", "-qm", "A");
  const A = git(app, "rev-parse", "HEAD");
  git(app, "push", "-q", "origin", "hospitality/tracking-settings");
  git(app, "checkout", "-q", "-b", BRANCH);
  writeFileSync(join(app, `supabase/migrations/${MIG}.sql`), MIG_TEXT);
  writeFileSync(join(app, `supabase/rollbacks/${MIG}.down.sql`), DOWN_TEXT);
  git(app, "add", "-A");
  git(app, "commit", "-qm", "B");
  const B = git(app, "rev-parse", "HEAD");
  git(app, "push", "-q", "origin", BRANCH);
  git(app, "checkout", "-q", "hospitality/tracking-settings");
  git(app, "branch", "-q", "-D", BRANCH);
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
  const run = (mode: string, target = B, extra: Record<string, string> = {}) => {
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
        MIG_SHA: sha(MIG_TEXT),
        DOWN_SHA: sha(DOWN_TEXT),
        ...extra,
      },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}`, stdout: r.stdout };
  };
  const read = (f: string) =>
    existsSync(join(state, f)) ? readFileSync(join(state, f), "utf8") : "";
  const flag = (f: string) => writeFileSync(join(state, f), "");
  return {
    app,
    state,
    A,
    B,
    run,
    flag,
    ledger: () => read("ledger").trim().split("\n"),
    head: () => git(app, "rev-parse", "HEAD"),
    branch: () => git(app, "rev-parse", "--abbrev-ref", "HEAD"),
    running: () => read("running").trim(),
    latest: () => read("img_latest").trim(),
    calls: () => read("calls"),
    txRuns: () => read("tx_runs").trim().split("\n").filter(Boolean),
    backups: () => readdirSync(join(root, "backups")),
  };
}

describe("deploy/release-seo-sitelinks.sh", () => {
  it("--check: every preflight passes and nothing changes (no backup, no build, no migration, same code)", () => {
    const t = setup();
    const r = t.run("--check");
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("PREFLIGHT OK");
    expect(r.out).toContain("applied: 2 = every migration of the target except 206");
    expect(r.out).toContain(
      "206 and its rollback: in the target, pinned fingerprints, one transaction each",
    );
    expect(r.out).toContain("nofi-dorit: 2"); // the failed-email alerts per business, read only
    expect(t.head()).toBe(t.A);
    expect(t.ledger()).toEqual(["001_a.sql", "002_b.sql"]);
    expect(t.backups()).toEqual([]);
    expect(t.calls()).not.toMatch(/compose|pg_dump|docker tag/);
    expect(t.txRuns()).toEqual([]);
  });

  it("--deploy: backup, code, build, 206 in one transaction, restart, checks — DEPLOY OK; no secret printed", () => {
    const t = setup();
    const r = t.run("--deploy");
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("DEPLOY OK");
    expect(t.head()).toBe(t.B);
    expect(t.branch()).toBe(BRANCH);
    expect(t.ledger()).toEqual(["001_a.sql", "002_b.sql", `${MIG}.sql`]);
    expect(t.txRuns()).toEqual(["migration"]);
    expect(t.running()).toBe("sha256:new1");
    const [b] = t.backups();
    expect(b).toMatch(/^before-seo-sitelinks-\d{8}-\d{6}(-\d+)?$/);
    const dir = join(t.app, "..", "backups", b!);
    const files = readdirSync(dir);
    for (const f of [
      "db.dump",
      "db.dump.sha256",
      "applied-before.txt",
      "previous-code.txt",
      "image-id.txt",
      "nofi-before.txt",
      "nofi-after.txt",
      "titles-before.txt",
      "titles-after.txt",
      "migration-206.sql",
      "build.log",
      "deploy.log",
      "release",
    ])
      expect(files, f).toContain(f);
    expect(readdirSync(join(dir, "release/supabase/rollbacks"))).toEqual([`${MIG}.down.sql`]);
    expect(readFileSync(join(t.state, `img_${b}`), "utf8").trim()).toBe("sha256:old"); // the rollback image
    expect(readFileSync(join(dir, "previous-code.txt"), "utf8")).toBe(
      `${t.A} hospitality/tracking-settings\n`,
    );
    expect(r.out).not.toContain("re_super_secret_value");
    expect(r.out).toContain("kobi.example.test/: 200");
    expect(r.out).toContain("nofi-dorit.example.test/manage/login: 200");
    expect(r.out).toContain("nofi-dorit.example.test/stay: WebSite structured data");
    expect(r.out).toContain("kobi.example.test/: 1 categories are real links in the server HTML");
    expect(r.out).toContain('kobi.example.test/about: "page | store name" title');
    expect(r.out).toContain("Nofi Dorit unchanged");
    expect(r.out).toContain("titles and descriptions of the home pages unchanged");
    expect(r.out).toContain("SEO worker started");
    expect(r.out).toContain(`--rollback-db ${t.B}`);
  });

  it("the migration SQL: gate, REPEATABLE READ, the body without its own BEGIN / COMMIT, registration, guards, checks", () => {
    const t = setup();
    const r = t.run("--print-migration-sql");
    expect(r.code, r.out).toBe(0);
    const sql = r.stdout;
    expect(sql.startsWith("BEGIN ISOLATION LEVEL REPEATABLE READ;\n")).toBe(true);
    expect(sql).toContain("SET LOCAL lock_timeout = '10s';");
    expect(sql).toContain(
      "CREATE TEMP TABLE _release_guard ON COMMIT DROP AS SELECT (SELECT md5('customers'))",
    );
    expect(sql).toContain(
      "expected 2 applied migrations and 20261125100000_hosp_email_alerts not applied",
    );
    expect(sql).toContain("ALTER TABLE x ADD COLUMN alert_seen_at timestamptz;");
    expect(sql).toContain("NOTIFY pgrst, 'reload schema';");
    expect(sql).toContain(
      `INSERT INTO public._migrations_applied (filename) VALUES ('${MIG}.sql');`,
    );
    expect(sql).toContain("guard: the customers data would change");
    expect(sql).toContain("guard: the email history would change");
    expect(sql.match(/^BEGIN/gm)).toHaveLength(1); // the migration's own BEGIN is gone
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(t.txRuns()).toEqual([]);
    expect(t.calls()).not.toMatch(/compose|pg_dump|docker tag|docker exec -i/);
  });

  it("stops in preflight when a fingerprint differs, the target is not on the branch, or the count is wrong", () => {
    const t = setup();
    let r = t.run("--deploy", t.B, { MIG_SHA: "0".repeat(64) });
    expect(r.code).toBe(1);
    expect(r.out).toContain("fingerprint differs from the pinned one");
    expect(r.out).toContain("nothing was changed");
    // a commit from before the release (on the branch, but without 206)
    r = t.run("--deploy", t.A);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`supabase/migrations/${MIG}.sql is missing in the target`);
    r = t.run("--deploy", "0123456789abcdef0123456789abcdef01234567");
    expect(r.code).toBe(1);
    expect(r.out).toContain("not found after fetch");
    writeFileSync(join(t.state, "ledger"), "001_a.sql\n");
    r = t.run("--deploy");
    expect(r.code).toBe(1);
    expect(r.out).toContain("applied migrations: 1 (expected 2)");
    expect(t.backups()).toEqual([]);
    expect(t.head()).toBe(t.A);
    expect(t.txRuns()).toEqual([]);
  });

  it("a failed build: the site keeps the previous version, code and tag restored, the database untouched", () => {
    const t = setup();
    t.flag("fail_build");
    const r = t.run("--deploy");
    expect(r.code).toBe(1);
    expect(r.out).toContain("STOPPED — phase: build");
    expect(t.head()).toBe(t.A);
    expect(t.branch()).toBe("hospitality/tracking-settings");
    expect(t.running()).toBe("sha256:old");
    expect(t.txRuns()).toEqual([]);
    expect(t.ledger()).toEqual(["001_a.sql", "002_b.sql"]);
  });

  it("a failed migration transaction: nothing changed in the database, the site keeps the previous version", () => {
    const t = setup();
    t.flag("fail_migration");
    const r = t.run("--deploy");
    expect(r.code).toBe(1);
    expect(r.out).toContain("STOPPED — phase: migration");
    expect(r.out).toContain("rolled back inside its");
    expect(t.ledger()).toEqual(["001_a.sql", "002_b.sql"]);
    expect(t.head()).toBe(t.A);
    expect(t.latest()).toBe("sha256:old"); // the tag points back at the previous image
    expect(t.running()).toBe("sha256:old");
    expect(t.calls()).not.toMatch(/compose up/);
  });

  it.each([
    ["the new version does not answer", "broken_new1"],
    ["no WebSite structured data on a zimmer home page", "no_website_ld"],
    ["a home page title changed", "title_changed"],
    ["Nofi Dorit changed", "nofi_changed"],
    ["the SEO worker did not start", "no_worker"],
  ])(
    "after the restart — %s: automatic app rollback, the DB rollback is only printed",
    (_name, f) => {
      const t = setup();
      t.flag(f);
      const r = t.run("--deploy");
      expect(r.code).toBe(1);
      expect(r.out).toContain("automatic application rollback");
      expect(r.out).toContain("ROLLED BACK — the previous version runs again and answers.");
      expect(t.running()).toBe("sha256:old");
      expect(t.head()).toBe(t.A);
      expect(t.branch()).toBe("hospitality/tracking-settings");
      // 206 stays (the previous version works with it); its rollback only with approval
      expect(t.ledger()).toContain(`${MIG}.sql`);
      expect(r.out).toContain(`--rollback-db ${t.B}`);
      expect(t.txRuns()).toEqual(["migration"]);
    },
  );

  it("a second run after a stop continues: 206 already in → skipped, the rest runs", () => {
    const t = setup();
    t.flag("no_worker");
    expect(t.run("--deploy").code).toBe(1);
    rmSync(join(t.state, "no_worker"));
    const r = t.run("--deploy");
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("206 already in (a previous run) and checked — it will be skipped");
    expect(r.out).toContain("206 already applied and checked (a previous run) — skipped");
    expect(r.out).toContain("DEPLOY OK");
    expect(t.txRuns()).toEqual(["migration"]); // not twice
    expect(t.ledger()).toEqual(["001_a.sql", "002_b.sql", `${MIG}.sql`]);
  });

  it("--rollback-db refuses while the release runs; after the app rollback it removes 206 in one transaction", () => {
    const t = setup();
    expect(t.run("--deploy").code).toBe(0);
    let r = t.run("--rollback-db");
    expect(r.code).toBe(1);
    expect(r.out).toContain("roll the app back first");
    expect(t.ledger()).toContain(`${MIG}.sql`);
    // the app rollback (as printed by DEPLOY OK)
    git(t.app, "checkout", "-q", "-B", "hospitality/tracking-settings", t.A);
    r = t.run("--rollback-db");
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("DB ROLLBACK OK");
    expect(t.ledger()).toEqual(["001_a.sql", "002_b.sql"]);
    expect(t.txRuns()).toEqual(["migration", "rollback"]);
  });
});
