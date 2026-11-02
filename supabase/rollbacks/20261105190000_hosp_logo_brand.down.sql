-- ============================================================
-- Rollback — מיגרציה 42 (20261105190000_hosp_logo_brand.sql)
-- מחזיר את _media_owner ו-_media_ensure_cover כפי שהיו במיגרציה 12 (20261101200000_hosp_media.sql),
-- את _public_media כפי שהייתה במיגרציה 38 (20261105150000_hosp_unit_photos_public.sql) ואת
-- _site_payload כפי שהייתה במיגרציה 41 (20261105180000_hosp_unit_size.sql) — מילה במילה — ואת ה-CHECK-ים
-- של הטבלה כפי שהיו בהגדרה שלה (20261101110000_hosp_schema.sql).
-- מה קורה: הלוגואים חוזרים לגלריית האתר (בלי לגעת בתמונה הראשית שלה), והאפליקציה הקודמת מוצאת אותם
-- שם כמו קודם.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

UPDATE hospitality.media SET owner_kind = 'site', is_cover = false, updated_at = now() WHERE owner_kind = 'brand';

ALTER TABLE hospitality.media DROP CONSTRAINT IF EXISTS media_owner_check;
ALTER TABLE hospitality.media DROP CONSTRAINT IF EXISTS media_check;
ALTER TABLE hospitality.media ADD CONSTRAINT media_check
  CHECK (CASE owner_kind
           WHEN 'site' THEN property_id IS NULL AND unit_id IS NULL
           WHEN 'property' THEN property_id IS NOT NULL AND unit_id IS NULL
           ELSE unit_id IS NOT NULL AND property_id IS NULL END);
ALTER TABLE hospitality.media DROP CONSTRAINT IF EXISTS media_owner_kind_check;
ALTER TABLE hospitality.media ADD CONSTRAINT media_owner_kind_check
  CHECK (owner_kind IN ('site', 'property', 'unit'));

CREATE OR REPLACE FUNCTION hospitality._media_owner(_t uuid, _owner_kind text, _owner_id uuid,
                                                    OUT property_id uuid, OUT unit_id uuid, OUT label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _kind text;
BEGIN
  CASE _owner_kind
    WHEN 'site' THEN
      IF _owner_id IS NOT NULL THEN
        RAISE EXCEPTION 'הגלריה לא נמצאה' USING ERRCODE = 'no_data_found';
      END IF;
      label := 'גלריית האתר';
    WHEN 'property' THEN
      SELECT p.id, p.name INTO property_id, label FROM hospitality.properties p
       WHERE p.tenant_id = _t AND p.id = _owner_id;
      IF property_id IS NULL THEN
        RAISE EXCEPTION 'המתחם לא נמצא' USING ERRCODE = 'no_data_found';
      END IF;
    WHEN 'unit' THEN
      SELECT u.id, u.name, u.kind INTO unit_id, label, _kind FROM hospitality.units u
       WHERE u.tenant_id = _t AND u.id = _owner_id;
      IF unit_id IS NULL THEN
        RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
      END IF;
      IF _kind = 'whole_property' THEN
        RAISE EXCEPTION 'התמונות של "כל המתחם" — בגלריה של המתחם' USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      RAISE EXCEPTION 'הגלריה לא נמצאה' USING ERRCODE = 'no_data_found';
  END CASE;
END $$;
REVOKE ALL ON FUNCTION hospitality._media_owner(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._media_ensure_cover(_t uuid, _owner_kind text, _property uuid, _unit uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hospitality.media m WHERE m.tenant_id = _t AND m.is_cover
                    AND hospitality._media_in_gallery(m, _owner_kind, _property, _unit)) THEN
    UPDATE hospitality.media x SET is_cover = true
     WHERE x.id = (SELECT m.id FROM hospitality.media m
                    WHERE m.tenant_id = _t AND m.kind = 'image'
                      AND hospitality._media_in_gallery(m, _owner_kind, _property, _unit)
                    ORDER BY m.sort_order, m.created_at LIMIT 1);
  END IF;
END $$;
REVOKE ALL ON FUNCTION hospitality._media_ensure_cover(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._public_media(_t uuid, _kind text, _property uuid, _unit uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id, 'kind', m.kind, 'path', m.storage_path, 'variants', m.variants,
           'embed_provider', m.embed_provider, 'embed_id', m.embed_id,
           'alt', m.alt, 'width', m.width, 'height', m.height, 'is_cover', m.is_cover, 'is_demo', m.is_demo)
           ORDER BY m.is_cover DESC, m.sort_order, m.created_at), '[]'::jsonb)
    FROM hospitality.media m
   WHERE m.tenant_id = _t AND m.owner_kind = _kind
     AND CASE _kind
           WHEN 'site' THEN m.property_id IS NULL AND m.unit_id IS NULL
           WHEN 'property' THEN m.property_id = _property
           WHEN 'unit' THEN m.unit_id = _unit
           ELSE false
         END;
$$;
REVOKE ALL ON FUNCTION hospitality._public_media(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._site_payload(_t uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s hospitality.settings;
  _name text;
BEGIN
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;
  SELECT COALESCE(NULLIF(btrim(s.business_name), ''), t.name) INTO _name FROM public.tenants t WHERE t.id = _t;
  RETURN jsonb_build_object(
    'business', jsonb_build_object(
      'name', _name, 'phone', s.contact_phone, 'whatsapp', s.whatsapp_phone, 'email', s.contact_email,
      'address', s.address, 'check_in_time', to_char(s.check_in_time, 'HH24:MI'),
      'check_out_time', to_char(s.check_out_time, 'HH24:MI'), 'currency', s.currency, 'timezone', s.timezone,
      'booking_mode', s.booking_mode, 'approval_hours', round(COALESCE(s.approval_window_minutes, 720) / 60.0)),
    'today', (now() AT TIME ZONE COALESCE(s.timezone, 'Asia/Jerusalem'))::date,
    -- אפשר לשלוח בקשה מהאתר: דגל ההזמנות + מנוי פעיל
    'booking_open', hospitality.flag_for('hospitality_booking_enabled', _t)
                    AND COALESCE((hospitality.entitlements(_t) ->> 'active')::boolean, false),
    'gallery', hospitality._public_media(_t, 'site', NULL, NULL),
    'policy', hospitality._public_policy(_t, NULL),
    'properties', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'slug', p.slug, 'name', p.name, 'property_type', p.property_type,
               'description', p.description, 'address', p.address,
               'location', CASE WHEN p.latitude IS NULL THEN NULL
                                ELSE jsonb_build_object('lat', p.latitude, 'lng', p.longitude) END,
               'parking', p.parking, 'parking_type', p.parking_type, 'parking_spaces', p.parking_spaces,
               'parking_fee_note', p.parking_fee_note, 'parking_instructions', p.parking_instructions,
               'guest_info', p.guest_info,
               'rules', jsonb_build_object('smoking', p.rules_smoking, 'pets', p.rules_pets,
                                           'pets_note', p.rules_pets_note, 'events', p.rules_events,
                                           'quiet_from', to_char(p.quiet_from, 'HH24:MI'),
                                           'quiet_to', to_char(p.quiet_to, 'HH24:MI'), 'custom', p.rules_custom),
               'amenities', hospitality._public_amenities(_t, p.id, NULL),
               'media', hospitality._public_media(_t, 'property', p.id, NULL)) ORDER BY p.sort_order, p.created_at)
        FROM hospitality.properties p
       WHERE p.tenant_id = _t AND p.status = 'active'
         AND EXISTS (SELECT 1 FROM hospitality.units u WHERE u.tenant_id = _t AND u.property_id = p.id AND u.is_active)), '[]'::jsonb),
    'units', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', u.id, 'slug', u.slug, 'name', u.name, 'property_id', u.property_id,
               'kind', u.kind, 'unit_type', u.unit_type, 'description', u.description,
               'capacity', u.capacity, 'base_occupancy', u.base_occupancy,
               'max_adults', u.max_adults, 'max_children', u.max_children, 'child_age_limit', u.child_age_limit,
               'seo_title', u.seo_title, 'seo_description', u.seo_description,
               'bedrooms', u.bedrooms, 'bathrooms', u.bathrooms, 'separate_toilets', u.separate_toilets, 'size_sqm', u.size_sqm,
               'base_price', u.base_price, 'min_nights', u.min_nights,
               'policy', CASE WHEN u.policy_id IS NULL THEN NULL ELSE hospitality._public_policy(_t, u.policy_id) END,
               'member_ids', (SELECT jsonb_agg(m.member_unit_id) FROM hospitality.unit_members m
                               WHERE m.tenant_id = _t AND m.parent_unit_id = u.id),
               'beds', COALESCE((SELECT jsonb_agg(jsonb_build_object('bed_type', b.bed_type, 'quantity', b.quantity,
                                                                     'room_label', b.room_label) ORDER BY b.sort_order)
                                   FROM hospitality.unit_beds b WHERE b.tenant_id = _t AND b.unit_id = u.id), '[]'::jsonb),
               'amenities', hospitality._public_amenities(_t, NULL, u.id),
               'media', hospitality._public_media(_t, 'unit', u.property_id, u.id)) ORDER BY p.sort_order, u.sort_order, u.created_at)
        FROM hospitality.units u
        JOIN hospitality.properties p ON p.tenant_id = u.tenant_id AND p.id = u.property_id
       WHERE u.tenant_id = _t AND u.is_active AND p.status = 'active'), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality._site_payload(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
