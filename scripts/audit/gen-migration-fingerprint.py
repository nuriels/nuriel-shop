#!/usr/bin/env python3
"""
Generates scripts/audit/prod-migration-fingerprint.sql — a READ-ONLY check to run on production.

What it proves: that the objects defined by the 9 migrations that were amended after they were first added
(8, 21, 23, 33, 61, 64, 67, 68, 73) exist in production in their FINAL form. Expected values come from a reference
database built from migrations <= 199 (the state production should be in), NOT from production.

For every object these 9 files define it records one fingerprint:
  F  function   -> md5 of (body text, SECURITY DEFINER, volatility, SET options)   [stable across PG versions]
  C  column     -> md5 of (type, nullability)
  K  constraint -> exists on that table with that name and kind
  T  trigger    -> exists on that table with that name
  P  policy     -> exists on that table with that name and command
  I  index      -> exists with that name
The production script prints ONLY the rows that are missing or different, and a summary. It runs in a read-only
transaction and never prints any customer data.

Usage (on a machine that has the reference DB):  python3 scripts/audit/gen-migration-fingerprint.py <refdb>
"""
import re, subprocess, sys, os

REF = sys.argv[1] if len(sys.argv) > 1 else "fp_ref"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIG = {
    "08 hosp_settings_team": "20261101160000_hosp_settings_team",
    "21 hosp_site_design": "20261102150000_hosp_site_design",
    "23 hosp_payments": "20261102170000_hosp_payments",
    "33 hosp_support": "20261105100000_hosp_support",
    "61 ai_assistant": "20261110100000_ai_assistant",
    "64 product_import_sync": "20261110220000_product_import_sync",
    "67 hosp_events": "20261111110000_hosp_events",
    "68 hosp_client_contracts": "20261111120000_hosp_client_contracts",
    "73 billing_agreements": "20261114100000_billing_agreements",
}

def psql(sql):
    r = subprocess.run(["psql", "-X", "-q", "-h", "/tmp/pg", "-p", "5499", "-U", "postgres", "-d", REF, "-tA", "-v", "ON_ERROR_STOP=1", "-c", "SET search_path = pg_catalog; " + sql],
                       capture_output=True, text=True)
    if r.returncode: raise SystemExit(r.stderr)
    return r.stdout

def strip(sql):
    sql = re.sub(r"--[^\n]*", "", sql)
    return sql

q = lambda s: "'" + s.replace("'", "''") + "'"
rows = []   # (migration, kind, object, fingerprint)

fn_re = re.compile(r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w]+\.[\w]+|[\w]+)\s*\(", re.I)
tbl_re = re.compile(r"(?:CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?|ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?)([\w]+\.[\w]+|[\w]+)", re.I)
con_re = re.compile(r"CONSTRAINT\s+([\w]+)", re.I)
trg_re = re.compile(r"CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+([\w]+)", re.I)
pol_re = re.compile(r'CREATE\s+POLICY\s+(?:"([^"]+)"|([\w]+))\s+ON\s+([\w]+\.[\w]+|[\w]+)', re.I)
idx_re = re.compile(r"CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w]+)", re.I)

for label, f in MIG.items():
    sql = strip(open(os.path.join(ROOT, "supabase/migrations", f + ".sql"), encoding="utf-8").read())
    fns = sorted({m.group(1) for m in fn_re.finditer(sql)})
    tbls = sorted({m.group(1) for m in tbl_re.finditer(sql)})
    cons = sorted({m.group(1) for m in con_re.finditer(sql)})
    trgs = sorted({m.group(1) for m in trg_re.finditer(sql)})
    pols = sorted({((m.group(1) or m.group(2)), m.group(3)) for m in pol_re.finditer(sql)})
    idxs = sorted({m.group(1) for m in idx_re.finditer(sql)})
    qual = lambda n: n if "." in n else "public." + n
    # functions: every overload with that schema.name in the reference DB
    for fn in fns:
        s, n = qual(fn).split(".")
        out = psql(f"""SELECT format('%s(%s)', p.oid::regprocedure::text, '') , md5(p.prosrc || '|' || p.prosecdef::text || '|' || p.provolatile::text || '|' || coalesce(p.proconfig::text, ''))
                       FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = {q(s)} AND p.proname = {q(n)} ORDER BY 1""")
        for line in out.strip().splitlines():
            obj, fp = line.rsplit("|", 1)
            rows.append((label, "F", obj.replace("()", "", 1) if obj.endswith("()()") else obj.rstrip("()") if False else obj[:-2] if obj.endswith("()") and "(" in obj[:-2] else obj, fp))
    # columns of the tables these files create or alter
    for t in tbls:
        s, n = qual(t).split(".")
        out = psql(f"""SELECT {q(s + '.' + n)} || '.' || column_name, md5(data_type || '|' || is_nullable)
                       FROM information_schema.columns WHERE table_schema = {q(s)} AND table_name = {q(n)} ORDER BY column_name""")
        for line in out.strip().splitlines():
            if line: obj, fp = line.rsplit("|", 1); rows.append((label, "C", obj, fp))
    for c in cons:
        out = psql(f"""SELECT conrelid::regclass::text || '.' || conname, contype::text FROM pg_constraint WHERE conname = {q(c)}""")
        for line in out.strip().splitlines():
            if line: obj, fp = line.rsplit("|", 1); rows.append((label, "K", obj, fp))
    for t in trgs:
        out = psql(f"""SELECT tgrelid::regclass::text || '.' || tgname, 'y' FROM pg_trigger WHERE tgname = {q(t)} AND NOT tgisinternal""")
        for line in out.strip().splitlines():
            if line: obj, fp = line.rsplit("|", 1); rows.append((label, "T", obj, fp))
    for (pn, pt) in pols:
        s, n = qual(pt).split(".")
        out = psql(f"""SELECT schemaname || '.' || tablename || '.' || policyname, cmd FROM pg_policies WHERE policyname = {q(pn)} AND schemaname = {q(s)} AND tablename = {q(n)}""")
        for line in out.strip().splitlines():
            if line: obj, fp = line.rsplit("|", 1); rows.append((label, "P", obj, fp))
    for i in idxs:
        out = psql(f"""SELECT schemaname || '.' || indexname, 'y' FROM pg_indexes WHERE indexname = {q(i)}""")
        for line in out.strip().splitlines():
            if line: obj, fp = line.rsplit("|", 1); rows.append((label, "I", obj, fp))

# de-duplicate (an object defined by two of the files is attributed to the first)
seen, uniq = set(), []
for r in rows:
    if (r[1], r[2]) in seen: continue
    seen.add((r[1], r[2])); uniq.append(r)

values = ",\n".join("  (%s, %s, %s, %s)" % tuple(q(x) for x in r) for r in uniq)
sql = f"""-- ============================================================
-- READ-ONLY production check: the 9 amended migrations are in production in their FINAL form.
-- Generated by scripts/audit/gen-migration-fingerprint.py from a reference DB built from migrations <= 199.
-- Pure SELECTs inside a READ ONLY transaction: it creates nothing (no temp tables either), writes nothing.
-- Prints only catalog metadata (object names) and counts. It never reads or prints customer data.
-- ============================================================
\\set ON_ERROR_STOP on
BEGIN READ ONLY;
-- object names are printed fully schema-qualified, whatever the role's search_path is
SET LOCAL search_path = pg_catalog;

\\echo '--- 1. migration files recorded as applied (counts only)'
SELECT count(*) AS applied_total,
       count(*) FILTER (WHERE filename IN ('20261101160000_hosp_settings_team.sql', '20261102150000_hosp_site_design.sql',
              '20261102170000_hosp_payments.sql', '20261105100000_hosp_support.sql', '20261110100000_ai_assistant.sql',
              '20261110220000_product_import_sync.sql', '20261111110000_hosp_events.sql',
              '20261111120000_hosp_client_contracts.sql', '20261114100000_billing_agreements.sql')) AS the_nine_recorded_of_9
  FROM public._migrations_applied;

WITH expected(migration, kind, object, fp) AS (VALUES
{values}
), actual AS (
  SELECT 'F' AS kind, p.oid::regprocedure::text AS object,
         md5(p.prosrc || '|' || p.prosecdef::text || '|' || p.provolatile::text || '|' || coalesce(p.proconfig::text, '')) AS fp
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname IN ('public', 'hospitality', 'business_profile', 'billing')
  UNION ALL
  SELECT 'C', table_schema || '.' || table_name || '.' || column_name, md5(data_type || '|' || is_nullable)
    FROM information_schema.columns WHERE table_schema IN ('public', 'hospitality', 'business_profile', 'billing')
  UNION ALL SELECT 'K', conrelid::regclass::text || '.' || conname, contype::text FROM pg_constraint
  UNION ALL SELECT 'T', tgrelid::regclass::text || '.' || tgname, 'y' FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL SELECT 'P', schemaname || '.' || tablename || '.' || policyname, cmd FROM pg_policies
  UNION ALL SELECT 'I', schemaname || '.' || indexname, 'y' FROM pg_indexes
), joined AS (
  SELECT e.migration, e.kind, e.object, a.object AS found, (a.fp IS NOT DISTINCT FROM e.fp) AS same
    FROM expected e LEFT JOIN actual a ON a.kind = e.kind AND a.object = e.object
)
SELECT '2. MISSING or DIFFERENT (no rows below = everything identical)' AS section, migration, kind, object,
       CASE WHEN found IS NULL THEN 'MISSING' ELSE 'DIFFERENT' END AS problem
  FROM joined WHERE found IS NULL OR NOT same
UNION ALL
SELECT '3. summary', migration, 'total=' || count(*), 'identical=' || count(*) FILTER (WHERE same),
       'missing=' || count(*) FILTER (WHERE found IS NULL) || ' different=' || count(*) FILTER (WHERE found IS NOT NULL AND NOT same)
  FROM joined GROUP BY migration
ORDER BY 1, 2, 3, 4;
ROLLBACK;
"""
out = os.path.join(ROOT, "scripts/audit/prod-migration-fingerprint.sql")
open(out, "w", encoding="utf-8").write(sql)
from collections import Counter
print("wrote", out, "-", len(uniq), "expected rows;", dict(Counter(r[1] for r in uniq)))
