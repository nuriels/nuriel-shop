#!/usr/bin/env python3
"""
Measure the access paths under the real API roles on a scratch DB.

  run-measure.py <dbname> <label> [query-id ...]
      dbname : perf_scratch | perf_scratch_b          (anything else is refused)
      label  : free text used in output file names, e.g. A-orig, A-rewrite, B-orig, B-rewrite

For each query: BEGIN; SET LOCAL ROLE <role>; SET LOCAL request.jwt.claims / request.headers (what PostgREST sets);
EXPLAIN (ANALYZE, BUFFERS, TIMING) <PostgREST-shaped wrapped query>; ROLLBACK.
  * 1 warm-up + up to 3 measured reps (adaptive: slow queries get fewer reps), median reported.
  * a second, EXPLAIN-free execution with track_functions='all' (set as superuser before SET ROLE) gives
    per-function call counts from pg_stat_xact_user_functions (this pass is slower: function timing overhead).
statement_timeout is set to a 240 s safety cap for the measurement only; the 3 s (anon) / 8 s (authenticated)
production limits are applied afterwards by comparing the measured time.
"""
import json, os, re, statistics, subprocess, sys, time

DB = sys.argv[1]
LABEL = sys.argv[2]
ONLY = set(sys.argv[3:])
if DB not in ("perf_scratch", "perf_scratch_b"):
    sys.exit("refusing to touch database " + DB)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out", LABEL)
os.makedirs(OUT, exist_ok=True)
CAP = "240s"


def psql(sql, tuples=True, timeout=1800):
    args = ["psql", "-X", "-q", "-h", "/tmp/pg", "-p", "5499", "-U", "postgres", "-d", DB, "-v", "ON_ERROR_STOP=0"]
    if tuples:
        args += ["-At"]
    p = subprocess.run(args, input=sql, capture_output=True, text=True, timeout=timeout)
    return p.stdout + (("\nSTDERR: " + p.stderr) if p.stderr.strip() else "")


def one(sql):
    return psql(sql).strip().split("\n")[0]


PERSONA = {}
for line in psql("select name||'|'||user_id||'|'||tenant_id from perf.personas").strip().split("\n"):
    n, u, t = line.split("|")
    PERSONA[n] = (u, t)
T1 = PERSONA["t1_admin"][1]
A_ORDER = one(f"select id from public.orders where customer_id='{PERSONA['t1_customer_a'][0]}' order by created_at desc limit 1")
PROD1 = one(f"select id from public.global_products where tenant_id='{T1}' order by sku offset 1499 limit 1")
N_ORD = one(f"select count(*) from public.orders where tenant_id='{T1}'")

# ---- real column lists (src/lib/orders.ts:332-342 with ORDER_CONTACT/SHIPPING/COUPON constants)
ORDER_COLS = ("id, customer_id, agent_id, order_number, status, kind, total, note, vat_rate, prices_include_vat, created_at, "
  "tracking_number, shipping_provider, tracking_url, tracking_updated_at, "
  "delivery_attempts, last_delivery_failure_note, last_delivery_failure_at, shipped_at, delivered_at, "
  "payment_method, payment_status, paid_at, order_source, pos_payment_method, created_by_staff_id, "
  "bit_transaction_id, bit_receipt_url, payment_reported_at, payment_due_at, "
  "grow_asmachta, grow_transaction_id, grow_card, grow_installments, "
  "customer_name, customer_tax_id, customer_phone, customer_email, billing_city, billing_address, billing_zip, "
  "ship_to_different, shipping_name, shipping_phone, shipping_city, shipping_address, shipping_zip, "
  "shipping_method_id, shipping_method_name, shipping_kind, shipping_base_price, shipping_free_threshold, shipping_price, "
  "coupon_code, coupon_discount_type, coupon_discount_value, coupon_min_order, coupon_exclude_sale, discount_amount, "
  "manual_discount_type, manual_discount_value, manual_discount_amount")
ITEM_COLS = ("id, product_id, quantity, unit_price, product_name, product_sku, product_barcode, product_image_url, is_deposit, "
  "is_gift, on_sale, is_digital, item_status, digital_license_key, license_sent_at, license_sent_to, variant_label, "
  "serial_number, warranty_until, serial_required")
PRODUCT_ADMIN_COLS = ("id, sku, name, category, description, image_url, images, colors, barcode, shelf_location, sale_price, "
  "sale_starts_at, sale_ends_at, uniform_price, stock_quantity, is_out_of_stock, is_promo, price_tier1, price_tier2, "
  "price_tier3, cost_price, has_deposit, deposit_price, deposit_units, pack_size, min_order_quantity, sort_order, is_hidden, "
  "out_of_stock_auto, is_order_bump, order_bump_text, is_digital, variant_attributes, seo_title, seo_description, "
  "seo_keywords, show_in_zap, is_featured, sticker_id, sticker_size, sticker_opacity, requires_serial, warranty_months")


def qual(cols, alias):
    return ", ".join(f'{alias}."{c.strip()}"' for c in cols.split(","))


def orders_with_items(where=""):
    # PostgREST (v11/12) shape for orders?select=<cols>,order_items(<cols>)&order=created_at.desc  (+ max-rows 1000)
    return (f'SELECT {qual(ORDER_COLS, "o")}, COALESCE(oi.j, \'[]\') AS "order_items" FROM public.orders o '
            f'LEFT JOIN LATERAL (SELECT json_agg(oi_1) AS j FROM (SELECT {qual(ITEM_COLS, "i")} FROM public.order_items i '
            f'WHERE i.order_id = o.id) oi_1) oi ON TRUE {where} ORDER BY o.created_at DESC LIMIT 1000')


def pgrst(q):
    return ("WITH pgrst_source AS (" + q + ") SELECT null::bigint AS total_result_set, pg_catalog.count(_postgrest_t) AS page_total, "
            "coalesce(json_agg(_postgrest_t), '[]')::character varying AS body FROM (SELECT * FROM pgrst_source) _postgrest_t")


CA = PERSONA["t1_customer_a"][0]
# id : (description, persona, db role, sql)
Q = {
 "a1_cust_orders_nofilter": ("CustomerOrdersTab.tsx:79-82 as written (no customer_id filter), embedded items", "t1_customer_a", "authenticated",
     pgrst(orders_with_items())),
 "a2_cust_orders_filtered": ("same + .eq(customer_id, uid)  (proposed client fix)", "t1_customer_a", "authenticated",
     pgrst(orders_with_items(f"WHERE o.customer_id = '{CA}'"))),
 "b1_agent_orders": ("OrderManagementPanel.tsx:197-205 as agent (is_staff, not admin), limit 1000", "t1_agent", "authenticated",
     pgrst(orders_with_items())),
 "b2_admin_orders": ("OrderManagementPanel.tsx:197-205 as admin, limit 1000", "t1_admin", "authenticated",
     pgrst(orders_with_items())),
 "b3_admin_profiles": ("customer_profiles?select=user_id,business_name as admin", "t1_admin", "authenticated",
     pgrst('SELECT p.user_id, p.business_name FROM public.customer_profiles p')),
 "b4_admin_user_roles": ("user_roles?select=... as admin (OrderManagementPanel admin scope)", "t1_admin", "authenticated",
     pgrst('SELECT r.user_id, r.email, r.username, r.role, r.agent_number, r.display_name FROM public.user_roles r')),
 "b5_cust_profiles": ("customer_profiles select as customer A", "t1_customer_a", "authenticated",
     pgrst('SELECT p.user_id, p.business_name FROM public.customer_profiles p')),
 "c1_catalog_anon": ("SELECT * FROM get_catalog() as anon", "anon", "anon", pgrst("SELECT * FROM public.get_catalog()")),
 "c2_catalog_auth": ("SELECT * FROM get_catalog() as authenticated (customer A)", "t1_customer_a", "authenticated", pgrst("SELECT * FROM public.get_catalog()")),
 "c3_catalog_admin": ("SELECT * FROM get_catalog() as authenticated staff (admin)", "t1_admin", "authenticated", pgrst("SELECT * FROM public.get_catalog()")),
 "c4_catalog_page_anon": ("get_catalog() page 0 as the app pages it (order+range 0-999) as anon", "anon", "anon",
     pgrst("SELECT * FROM public.get_catalog() ORDER BY is_out_of_stock ASC, created_at DESC, id LIMIT 1000 OFFSET 0")),
 "c5_feed_one_anon": ("storefront_feed_products() filtered to 1 id, anon", "anon", "anon",
     pgrst(f"SELECT * FROM public.storefront_feed_products() WHERE id = '{PROD1}' LIMIT 1")),
 "c6_feed_one_auth": ("storefront_feed_products() filtered to 1 id, authenticated", "t1_customer_a", "authenticated",
     pgrst(f"SELECT * FROM public.storefront_feed_products() WHERE id = '{PROD1}' LIMIT 1")),
 "c7_feed_one_service": ("storefront_feed_products() filtered to 1 id as service_role (what seo.functions.ts really uses)", "service", "service_role",
     pgrst(f"SELECT * FROM public.storefront_feed_products() WHERE id = '{PROD1}' LIMIT 1")),
 "d1_admin_products": ("AdminProductsPanel list page 0 (limit 1000) as admin", "t1_admin", "authenticated",
     pgrst(f"SELECT {qual(PRODUCT_ADMIN_COLS, 'g')} FROM public.global_products g ORDER BY g.sort_order ASC NULLS LAST, g.created_at DESC, g.id LIMIT 1000 OFFSET 0")),
 "d2_agent_products": ("AdminProductsPanel list page 0 as agent (is_staff path)", "t1_agent", "authenticated",
     pgrst(f"SELECT {qual(PRODUCT_ADMIN_COLS, 'g')} FROM public.global_products g ORDER BY g.sort_order ASC NULLS LAST, g.created_at DESC, g.id LIMIT 1000 OFFSET 0")),
 "e1_items_one_order": ("order_items?order_id=eq.<own order> as customer A", "t1_customer_a", "authenticated",
     pgrst(f"SELECT {qual(ITEM_COLS, 'i')} FROM public.order_items i WHERE i.order_id = '{A_ORDER}'")),
 "e2_items_count_cust": ("SELECT count(*) FROM order_items as customer A (worst-case scan)", "t1_customer_a", "authenticated",
     pgrst("SELECT count(*) AS c FROM public.order_items")),
 "e3_items_count_admin": ("SELECT count(*) FROM order_items as admin", "t1_admin", "authenticated",
     pgrst("SELECT count(*) AS c FROM public.order_items")),
}


def prelude(persona, role, hdr_tenant=None):
    if role == "anon":
        claims = '{"role":"anon"}'
        hdr = '{"x-tenant-id":"%s"}' % T1
    elif role == "service_role":
        claims = '{"role":"service_role"}'
        hdr = '{"x-tenant-id":"%s"}' % T1
    else:
        u, t = PERSONA[persona]
        claims = '{"sub":"%s","role":"authenticated"}' % u
        hdr = '{"x-tenant-id":"%s"}' % t
    return (f"SET LOCAL ROLE {role};\nSET LOCAL request.jwt.claims = '{claims}';\nSET LOCAL request.headers = '{hdr}';\n")


def num(rx, s, grp=1, flags=0):
    m = re.search(rx, s, flags)
    return float(m.group(grp)) if m else None


def run_query(qid):
    desc, persona, role, sql = Q[qid]
    pre = prelude(persona, role)
    reps = []
    timed_out = False
    raw_all = []
    max_reps = 4
    i = 0
    while i < max_reps:
        script = f"SET statement_timeout = '{CAP}';\nSET jit = off;\nBEGIN;\n{pre}EXPLAIN (ANALYZE, BUFFERS, TIMING) {sql};\nROLLBACK;\n"
        t0 = time.time()
        out = psql(script, tuples=False)
        wall = (time.time() - t0) * 1000
        raw_all.append(f"===== REP {i}  (psql wall {wall:.0f} ms)\n{out}")
        if "canceling statement due to statement timeout" in out or "ERROR" in out and "Execution Time" not in out:
            timed_out = "statement timeout" in out
            reps.append({"error": out.strip()[:300], "wall_ms": wall})
            break
        ex = num(r"Execution Time: ([\d.]+) ms", out)
        pl = num(r"Planning Time: ([\d.]+) ms", out)
        top = re.search(r"actual time=[\d.]+\.\.([\d.]+) rows=(\d+) loops=1", out)
        buf = re.search(r"Buffers: shared (?:hit=(\d+))?(?: read=(\d+))?", out)
        idx = sorted(set(re.findall(r"(?:Index Scan|Index Only Scan|Bitmap Index Scan)(?: Backward)? using (\S+)", out) +
                        re.findall(r"Bitmap Index Scan on (\S+)", out)))
        seq = sorted(set(re.findall(r"Seq Scan on (\S+)", out)))
        reps.append({"exec_ms": ex, "plan_ms": pl, "top_rows": int(top.group(2)) if top else None,
                     "hit": int(buf.group(1) or 0) if buf else None, "read": int(buf.group(2) or 0) if buf else None,
                     "indexes": idx, "seqscans": seq, "wall_ms": wall})
        i += 1
        # adaptive: slow queries get fewer repetitions
        if ex is not None and ex > 30000:
            break
        if ex is not None and ex > 8000 and i >= 2:
            break
    open(os.path.join(OUT, f"{qid}.explain.txt"), "w").write(f"-- {qid}: {desc}\n-- role={role} persona={persona}\n-- db={DB} label={LABEL}\n\n" + "\n".join(raw_all))

    good = [r for r in reps if "exec_ms" in r and r["exec_ms"] is not None]
    meas = good[1:] if len(good) > 1 else good  # drop the warm-up when we have >1
    res = {"qid": qid, "desc": desc, "persona": persona, "role": role, "db": DB, "label": LABEL, "n_reps": len(good),
           "timed_out_cap": timed_out}
    if meas:
        res.update({"exec_ms_median": statistics.median([r["exec_ms"] for r in meas]),
                    "exec_ms_min": min(r["exec_ms"] for r in meas), "exec_ms_max": max(r["exec_ms"] for r in meas),
                    "plan_ms_median": statistics.median([r["plan_ms"] for r in meas]),
                    "rows": meas[-1]["top_rows"], "hit": meas[-1]["hit"], "read": meas[-1]["read"],
                    "indexes": meas[-1]["indexes"], "seqscans": meas[-1]["seqscans"],
                    "first_run_exec_ms": good[0]["exec_ms"]})
    else:
        res["error"] = reps[-1] if reps else "no result"

    # function-call pass (no EXPLAIN; track_functions must be set before SET ROLE)
    if not timed_out and meas and meas[-1]["exec_ms"] < 60000:
        script = (f"SET statement_timeout = '{CAP}';\nSET jit = off;\nBEGIN;\nSET LOCAL track_functions = 'all';\n{pre}"
                  f"SELECT format('RESULT|%s|%s', page_total, length(body)) FROM ({sql}) _q;\n"
                  "SELECT format('%s|%s|%s|%s', funcid::regproc, calls, round(total_time::numeric,1), round(self_time::numeric,1)) "
                  "FROM pg_stat_xact_user_functions WHERE calls > 0 ORDER BY calls DESC;\nROLLBACK;\n")
        out = psql(script)
        calls = []
        for ln in out.strip().split("\n"):
            parts = ln.split("|")
            if parts[0] == "RESULT" and len(parts) == 3:
                res["rows_returned"] = int(parts[1]); res["body_bytes"] = int(parts[2]); continue
            if len(parts) == 4 and parts[1].isdigit():
                calls.append({"fn": parts[0], "calls": int(parts[1]), "total_ms": float(parts[2]), "self_ms": float(parts[3])})
        res["fn_calls"] = calls
        open(os.path.join(OUT, f"{qid}.calls.txt"), "w").write(out)
    return res


if os.environ.get("DUMP_SQL"):
    _d, _persona, _role, _sql = Q[os.environ["DUMP_SQL"]]
    _u, _t = PERSONA.get(_persona, ("", T1))
    print(f"{_role}\n{_u}\n{_t}\n{_sql}")
    sys.exit(0)

results = []
for qid in Q:
    if ONLY and qid not in ONLY:
        continue
    t0 = time.time()
    r = run_query(qid)
    results.append(r)
    em = r.get("exec_ms_median")
    print(f"{LABEL:10s} {qid:26s} exec={em if em is None else round(em,1)} ms plan={r.get('plan_ms_median')} rows={r.get('rows_returned')} bytes={r.get('body_bytes')} "
          f"idx={r.get('indexes')} fn={[(c['fn'], c['calls']) for c in r.get('fn_calls', [])][:4]}  [{time.time()-t0:.0f}s]", flush=True)
    json.dump(results, open(os.path.join(OUT, "results.json"), "w"), indent=1)
