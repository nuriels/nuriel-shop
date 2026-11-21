-- NURIEL AI SEO ENGINE — the Nofi Dorit pilot (production; the platform team; ONE transaction):
--   • the 7 target phrases given for the pilot → keyword IDEAS for the business: source "owner" (typed by a person),
--     NO numbers (the database refuses numbers on them), status "new" — the owner chooses them in "SEO וגוגל";
--   • the initial run, queued NOW: the worker checks the site (read-only, up to 30 public pages) and prepares basic
--     proposals for EMPTY Google fields only — every one waits for the owner's approval; nothing on the site changes.
--   gate (before anything changes): exactly one Hospitality business "nofi-dorit"; migrations 203 + 204 applied; its
--   initial run did not run yet.
-- Run: docker exec -i nuriel-shop-db psql -U postgres -d postgres -X -q -tA -v ON_ERROR_STOP=1 < pilot.sql
BEGIN;
DO $g$
DECLARE
  _n integer;
BEGIN
  SELECT count(*) INTO _n FROM public.tenants WHERE slug = 'nofi-dorit' AND site_type = 'hospitality';
  IF _n <> 1 THEN
    RAISE EXCEPTION 'gate: expected exactly one hospitality business nofi-dorit, found % - nothing changed', _n;
  END IF;
  IF (SELECT count(*) FROM public._migrations_applied
       WHERE filename IN ('20261122100000_seo_engine.sql', '20261122110000_hosp_seo_engine.sql')) <> 2 THEN
    RAISE EXCEPTION 'gate: migrations 203 + 204 are not both applied - nothing changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.seo_settings s JOIN public.tenants t ON t.id = s.tenant_id
              WHERE t.slug = 'nofi-dorit' AND s.initial_done_at IS NOT NULL) THEN
    RAISE EXCEPTION 'gate: the initial run of nofi-dorit already ran - nothing changed';
  END IF;
END $g$;
SELECT 'keyword ideas added', public.seo_keyword_ideas_add(t.id, $j$[
  {"phrase": "נופי דורית", "kind": "brand", "intent": "navigational", "source": "owner", "reason": "ביטוי יעד לפיילוט (רשימת צוות Nuriel) — רעיון בלי נתוני חיפוש עד ש-Search Console יחובר"},
  {"phrase": "צימר נופי דורית", "kind": "brand", "intent": "navigational", "source": "owner", "reason": "ביטוי יעד לפיילוט (רשימת צוות Nuriel) — רעיון בלי נתוני חיפוש עד ש-Search Console יחובר"},
  {"phrase": "נופי דורית חוויה בכפר", "kind": "brand", "intent": "navigational", "source": "owner", "reason": "ביטוי יעד לפיילוט (רשימת צוות Nuriel) — רעיון בלי נתוני חיפוש עד ש-Search Console יחובר"},
  {"phrase": "צימרים ליד בית שמש", "kind": "local", "intent": "local", "source": "owner", "reason": "ביטוי יעד לפיילוט (רשימת צוות Nuriel) — רעיון בלי נתוני חיפוש עד ש-Search Console יחובר"},
  {"phrase": "צימר לכלה ליד בית שמש", "kind": "local", "intent": "local", "source": "owner", "reason": "ביטוי יעד לפיילוט (רשימת צוות Nuriel) — רעיון בלי נתוני חיפוש עד ש-Search Console יחובר"},
  {"phrase": "מקום להתארגנות כלה", "kind": "primary", "intent": "commercial", "source": "owner", "reason": "ביטוי יעד לפיילוט (רשימת צוות Nuriel) — רעיון בלי נתוני חיפוש עד ש-Search Console יחובר"},
  {"phrase": "מתחם אירוח למשפחות באזור בית שמש", "kind": "local", "intent": "local", "source": "owner", "reason": "ביטוי יעד לפיילוט (רשימת צוות Nuriel) — רעיון בלי נתוני חיפוש עד ש-Search Console יחובר"}
]$j$::jsonb) ->> 'added' FROM public.tenants t WHERE t.slug = 'nofi-dorit';
SELECT 'initial run queued', public.seo_jobs_enqueue(t.id, 'initial', NULL) FROM public.tenants t WHERE t.slug = 'nofi-dorit';
COMMIT;
