-- NURIEL AI SEO ENGINE release (migrations 203 + 204) — the customers' data that the release must NOT change, as ONE
-- checksum: units, packages (incl. the bridal package), bookings, site versions, image texts, amenities (incl. the
-- Moriah jacuzzi note), the existing Hospitality SEO proposals, store products / categories / settings, orders,
-- businesses. Only columns that exist BEFORE the release — so the value before and after must be identical.
-- Read-only. Run: docker exec -i nuriel-shop-db psql -U postgres -d postgres -X -q -tA < guard.sql
SELECT md5(concat_ws('|',
  (SELECT string_agg(concat_ws(',', u.id, u.name, u.description, u.seo_title, u.seo_description, u.base_price, u.capacity, u.is_active, u.revision), ';' ORDER BY u.id) FROM hospitality.units u),
  (SELECT string_agg(concat_ws(',', p.id, p.name, p.description, p.terms, p.nights, p.price, p.is_active, p.revision), ';' ORDER BY p.id) FROM hospitality.packages p),
  (SELECT string_agg(concat_ws(',', b.id, b.status, b.total, b.check_in, b.check_out, b.revision), ';' ORDER BY b.id) FROM hospitality.bookings b),
  (SELECT string_agg(concat_ws(',', v.id, v.kind, v.revision, md5(v.document::text)), ';' ORDER BY v.id) FROM hospitality.site_versions v),
  (SELECT string_agg(concat_ws(',', m.id, m.alt), ';' ORDER BY m.id) FROM hospitality.media m),
  (SELECT string_agg(concat_ws(',', a.id, a.note), ';' ORDER BY a.id) FROM hospitality.unit_amenities a),
  (SELECT string_agg(concat_ws(',', s.id, s.target_kind, s.target_id, s.field, s.status, md5(s.proposed)), ';' ORDER BY s.id) FROM hospitality.seo_proposals s),
  (SELECT string_agg(concat_ws(',', g.id, g.name, g.price_tier1, g.sale_price, g.seo_title, g.seo_description, g.seo_keywords), ';' ORDER BY g.id) FROM public.global_products g),
  (SELECT string_agg(concat_ws(',', c.id, c.name), ';' ORDER BY c.id) FROM public.categories c),
  (SELECT string_agg(concat_ws(',', s.tenant_id, s.seo_title, s.seo_description, s.seo_keywords), ';' ORDER BY s.tenant_id) FROM public.site_settings s),
  (SELECT string_agg(concat_ws(',', o.id, o.total, o.status), ';' ORDER BY o.id) FROM public.orders o),
  (SELECT string_agg(concat_ws(',', t.id, t.slug, t.status), ';' ORDER BY t.id) FROM public.tenants t)));
