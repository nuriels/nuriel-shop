-- NURIEL AI SEO ENGINE — the Nofi Dorit pilot, a few minutes after pilot.sql (read-only): the jobs, the technical
-- check, the proposals that wait for the owner (nothing applied), the 7 phrases (ideas, no numbers).
-- Run: docker exec -i nuriel-shop-db psql -U postgres -d postgres -X -q -tA < pilot-check.sql
SELECT 'job', j.kind, coalesce(j.entity_type, '-'), j.status, j.attempts, coalesce(j.last_error, '-')
  FROM public.seo_jobs j JOIN public.tenants t ON t.id = j.tenant_id WHERE t.slug = 'nofi-dorit' ORDER BY j.created_at;
SELECT 'audit', a.score, a.pages_audited, a.counts, a.robots_status, a.sitemap_status
  FROM public.seo_audits a JOIN public.tenants t ON t.id = a.tenant_id WHERE t.slug = 'nofi-dorit'
 ORDER BY a.created_at DESC LIMIT 1;
SELECT 'proposal', s.status, s.source, s.target_kind, coalesce(u.name, k.name, 'האתר') AS target, s.field, s.proposed
  FROM hospitality.seo_proposals s JOIN public.tenants t ON t.id = s.tenant_id
  LEFT JOIN hospitality.units u ON u.id = s.target_id AND s.target_kind = 'unit'
  LEFT JOIN hospitality.packages k ON k.id = s.target_id AND s.target_kind = 'package'
 WHERE t.slug = 'nofi-dorit' AND s.status IN ('pending', 'later') ORDER BY s.target_kind, target, s.field;
SELECT 'applied by the engine (must be 0)', count(*) FROM hospitality.seo_proposals s JOIN public.tenants t ON t.id = s.tenant_id
 WHERE t.slug = 'nofi-dorit' AND (s.status = 'approved' OR s.auto_applied);
SELECT 'phrase', k.phrase, k.kind, k.source, k.status, (k.metrics IS NULL) AS no_numbers
  FROM public.seo_keyword_ideas k JOIN public.tenants t ON t.id = k.tenant_id
 WHERE t.slug = 'nofi-dorit' AND k.source = 'owner' ORDER BY k.phrase;
SELECT 'ideas from the site (no numbers)', count(*) FILTER (WHERE k.source = 'template'), bool_and(k.metrics IS NULL OR k.source IN ('gsc', 'import'))
  FROM public.seo_keyword_ideas k JOIN public.tenants t ON t.id = k.tenant_id WHERE t.slug = 'nofi-dorit';
