#!/usr/bin/env python3
"""Checks get_catalog_exp() == get_catalog() (and the feed variant) row-for-row for several personas on perf_scratch_b."""
import subprocess
DB = "perf_scratch_b"
def psql(sql):
    return subprocess.run(["psql", "-X", "-At", "-h", "/tmp/pg", "-p", "5499", "-U", "postgres", "-d", DB, "-c", sql], capture_output=True, text=True).stdout + ""
P = {}
for l in psql("select name||'|'||user_id||'|'||tenant_id from perf.personas").strip().split("\n"):
    n, u, t = l.split("|"); P[n] = (u, t)
T1, T2 = P["t1_admin"][1], P["t2_admin"][1]
cases = [("anon", "anon", None, T1), ("cA", "authenticated", P["t1_customer_a"][0], T1), ("cB", "authenticated", P["t1_customer_b"][0], T1),
         ("agent", "authenticated", P["t1_agent"][0], T1), ("admin", "authenticated", P["t1_admin"][0], T1),
         ("c2on1", "authenticated", P["t2_customer"][0], T1), ("c2", "authenticated", P["t2_customer"][0], T2),
         ("plat1", "authenticated", P["platform_admin"][0], T1), ("anon_T2", "anon", None, T2)]
ok = True
for name, role, uid, tid in cases:
    claims = '{"role":"%s"}' % role if uid is None else '{"sub":"%s","role":"%s"}' % (uid, role)
    sql = (f"BEGIN; SET LOCAL ROLE {role}; SET LOCAL request.jwt.claims = '{claims}'; SET LOCAL request.headers = '{{\"x-tenant-id\":\"{tid}\"}}'; "
           "SELECT (SELECT count(*) FROM public.get_catalog()) || ' ' || (SELECT count(*) FROM public.get_catalog_exp()) || ' ' || "
           "((SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY (t).id)), '-') FROM public.get_catalog() t) = "
           " (SELECT coalesce(md5(string_agg(t::text, '|' ORDER BY (t).id)), '-') FROM public.get_catalog_exp() t))::text; ROLLBACK;")
    out = [l for l in psql(sql).strip().split("\n") if l and l not in ("BEGIN", "SET", "ROLLBACK")]
    res = out[-1] if out else "?"
    good = res.endswith("true"); ok &= good
    print(f"get_catalog  {name:8s} rows(orig exp equal-set) = {res}  {'OK' if good else 'DIFFERENT'}")
sql = ("BEGIN; SET LOCAL ROLE service_role; SET LOCAL request.headers = '{\"x-tenant-id\":\"%s\"}'; "
       "SELECT (SELECT count(*) FROM public.storefront_feed_products()) || ' ' || (SELECT count(*) FROM public.storefront_feed_products_exp()) || ' ' || "
       "((SELECT md5(string_agg(t::text, '|' ORDER BY (t).id)) FROM public.storefront_feed_products() t) = (SELECT md5(string_agg(t::text, '|' ORDER BY (t).id)) FROM public.storefront_feed_products_exp() t))::text; ROLLBACK;")
for tid in (T1, T2):
    out = [l for l in psql(sql % tid).strip().split("\n") if l and l not in ("BEGIN", "SET", "ROLLBACK")]
    good = bool(out) and out[-1].endswith("true"); ok &= good
    print(f"feed         tenant {tid[-1]} rows(orig exp equal-set) = {out[-1] if out else '?'}  {'OK' if good else 'DIFFERENT'}")
print("ALL EQUAL" if ok else "DIFFERENCES FOUND")
