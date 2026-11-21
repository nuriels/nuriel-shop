-- NURIEL AI SEO ENGINE release — Nofi Dorit before / after (read-only). Every line must be identical after the
-- migrations, after the restart, and after the pilot run: the owner's signature (fingerprint, revision), the units
-- (texts, Google fields, prices), the packages (incl. the bridal package: name, nights, price, text, terms), the
-- jacuzzi note ("רק בחדר מוריה"), the site versions, the signed documents, the bookings count.
-- Run: docker exec -i nuriel-shop-db psql -U postgres -d postgres -X -q -tA < nofi-snapshot.sql
SELECT t.slug, (bt.representative_signature IS NOT NULL) AS has_signature,
       left(md5(bt.representative_signature::text), 8) AS fingerprint, bt.revision, (bt.confirmed_at IS NOT NULL) AS confirmed
  FROM public.tenants t LEFT JOIN hospitality.business_terms bt ON bt.tenant_id = t.id
 WHERE t.slug ILIKE 'nofi%' ORDER BY t.slug;
SELECT 'unit', u.name, coalesce(u.seo_title, '-') AS seo_title, left(md5(coalesce(u.seo_description, '')), 8) AS seo_description_md5,
       left(md5(coalesce(u.description, '')), 8) AS description_md5, u.base_price, u.capacity, u.is_active, u.revision
  FROM hospitality.units u JOIN public.tenants t ON t.id = u.tenant_id
 WHERE t.slug ILIKE 'nofi%' ORDER BY u.sort_order, u.name;
SELECT 'package', p.name, p.nights, p.price, p.is_active, left(md5(coalesce(p.description, '')), 8) AS description_md5,
       left(md5(coalesce(p.terms, '')), 8) AS terms_md5, p.revision
  FROM hospitality.packages p JOIN public.tenants t ON t.id = p.tenant_id
 WHERE t.slug ILIKE 'nofi%' ORDER BY p.created_at, p.name;
SELECT 'amenity', a.name, coalesce(ua.note, '-') AS note, coalesce(u.name, '(the property)') AS unit
  FROM hospitality.unit_amenities ua JOIN hospitality.amenities a ON a.id = ua.amenity_id
  LEFT JOIN hospitality.units u ON u.id = ua.unit_id JOIN public.tenants t ON t.id = ua.tenant_id
 WHERE t.slug ILIKE 'nofi%' AND a.name ~ 'קוזי' ORDER BY 2, 4;
SELECT 'site', v.kind, v.version, v.revision, left(md5(v.document::text), 8) AS document_md5
  FROM hospitality.site_versions v JOIN public.tenants t ON t.id = v.tenant_id
 WHERE t.slug ILIKE 'nofi%' ORDER BY v.kind;
SELECT 'signed', c.number, c.kind, c.status, (c.pdf_path IS NOT NULL) AS pdf_stored, left(c.pdf_sha256, 12) AS pdf_sha256_prefix
  FROM hospitality.client_contracts c JOIN public.tenants t ON t.id = c.tenant_id
 WHERE t.slug ILIKE 'nofi%' AND c.signed_at IS NOT NULL ORDER BY c.signed_at;
SELECT 'bookings', count(*) FROM hospitality.bookings b JOIN public.tenants t ON t.id = b.tenant_id WHERE t.slug ILIKE 'nofi%';
