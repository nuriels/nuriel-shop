-- ============================================================
-- SEC-H4 (20261106140000_sec_h4_bucket_mime.sql): הדליים הציבוריים של Ecommerce מקבלים רק
-- raster (ו-branding גם סרטוני באנר) — SVG / HTML עם סקריפט נחסמים ב-storage-api עצמו.
-- ============================================================
SELECT tests.check('SEC-H4: product-images is public and accepts raster images only (no SVG / HTML)',
  $$SELECT public
       AND allowed_mime_types @> ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']
       AND NOT (allowed_mime_types && ARRAY['image/svg+xml', 'text/html', 'application/xhtml+xml', 'text/xml'])
       AND NOT (allowed_mime_types && ARRAY['video/mp4', 'video/webm'])
      FROM storage.buckets WHERE id = 'product-images'$$);
SELECT tests.check('SEC-H4: branding is public and accepts raster images + banner videos only (no SVG / HTML)',
  $$SELECT public
       AND allowed_mime_types @> ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']
       AND NOT (allowed_mime_types && ARRAY['image/svg+xml', 'text/html', 'application/xhtml+xml', 'text/xml'])
      FROM storage.buckets WHERE id = 'branding'$$);
SELECT tests.check('SEC-H4: both buckets have a size limit that fits the app limits (banner image 20MB)',
  $$SELECT bool_and(file_size_limit >= 20 * 1024 * 1024) AND count(*) = 2
      FROM storage.buckets WHERE id IN ('product-images', 'branding')$$);
SELECT tests.check('SEC-H4: no wildcard type that would let SVG back in',
  $$SELECT NOT EXISTS (SELECT 1 FROM storage.buckets, unnest(allowed_mime_types) t
                        WHERE id IN ('product-images', 'branding') AND (t LIKE '%*%' OR t LIKE '%svg%'))$$);
