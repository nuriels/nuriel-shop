-- ============================================================
-- Hospitality Stage 4 — האתר הציבורי של העסק: קריאה לאורחים (anon)
--
--   • public_site() — כל מה שהאתר מציג, בקריאה אחת: פרטי העסק (שם, טלפון, WhatsApp, אימייל,
--     כתובת, שעות כניסה / יציאה, מטבע), האם אפשר לשלוח בקשת הזמנה עכשיו, המתחמים (תיאור, מיקום,
--     חניה, מידע לאורחים, כללי המקום, מתקנים משותפים, תמונות), היחידות הפעילות (תיאור, אורחים,
--     חדרים, מיטות, מתקנים, תמונות, "החל מ-" ומינימום לילות), גלריית האתר ומדיניות הביטול
--     שבברירת המחדל;
--   • public_availability(unit, from, to) — לילות תפוסים בלבד (בלי מי / למה), עד 120 ימים.
-- לא נחשפים: פרטי אורחים, מידע פרטי להגעה (קודים), הערות, אימיילים של הצוות, כללי מחיר פנימיים.
-- פעיל רק כשהאתר הציבורי של העסק פתוח: המסד + hospitality_frontend_enabled.
-- בלי טבלה או עמודה חדשה. (סוגי חדרים — בהמשך: היחידה נשארת "חדר" שניתן לשייך לסוג.)
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION hospitality._public_site_tenant()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality.request_tenant();
BEGIN
  IF _t IS NULL OR NOT hospitality.flag_for('hospitality_backend_enabled', _t)
     OR NOT hospitality.flag_for('hospitality_frontend_enabled', _t) THEN
    RAISE EXCEPTION 'האתר עדיין לא פתוח' USING ERRCODE = 'feature_not_supported';
  END IF;
  RETURN _t;
END $$;
REVOKE ALL ON FUNCTION hospitality._public_site_tenant() FROM PUBLIC, anon, authenticated;

-- תמונות של בעלים אחד (האתר / מתחם / יחידה) — הראשית קודם, לפי הסדר
CREATE OR REPLACE FUNCTION hospitality._public_media(_t uuid, _kind text, _property uuid, _unit uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id, 'kind', m.kind, 'path', m.storage_path, 'variants', m.variants,
           'embed_provider', m.embed_provider, 'embed_id', m.embed_id,
           'alt', m.alt, 'width', m.width, 'height', m.height, 'is_cover', m.is_cover, 'is_demo', m.is_demo)
           ORDER BY m.is_cover DESC, m.sort_order, m.created_at), '[]'::jsonb)
    FROM hospitality.media m
   WHERE m.tenant_id = _t AND m.owner_kind = _kind
     AND m.property_id IS NOT DISTINCT FROM _property AND m.unit_id IS NOT DISTINCT FROM _unit;
$$;
REVOKE ALL ON FUNCTION hospitality._public_media(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._public_amenities(_t uuid, _property uuid, _unit uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', a.name, 'icon', a.icon, 'category', a.category,
                                               'note', ua.note) ORDER BY a.sort_order, a.name), '[]'::jsonb)
    FROM hospitality.unit_amenities ua
    JOIN hospitality.amenities a ON a.tenant_id = ua.tenant_id AND a.id = ua.amenity_id
   WHERE ua.tenant_id = _t AND ua.property_id IS NOT DISTINCT FROM _property AND ua.unit_id IS NOT DISTINCT FROM _unit;
$$;
REVOKE ALL ON FUNCTION hospitality._public_amenities(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- מדיניות הביטול לאורח: של היחידה (אם הוגדרה ולא בארכיון — כמו בהצעת המחיר), אחרת ברירת המחדל
CREATE OR REPLACE FUNCTION hospitality._public_policy(_t uuid, _policy_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
           'name', p.name, 'free_cancel_days', p.free_cancel_days, 'fee_tiers', p.fee_tiers,
           'no_show_fee', p.no_show_fee, 'no_show_value', p.no_show_value, 'deposit_kind', p.deposit_kind,
           'deposit_value', p.deposit_value, 'guest_text', p.guest_text)
    FROM hospitality.policies p
   WHERE p.tenant_id = _t AND NOT p.is_archived
     AND (p.id = _policy_id OR (p.is_default AND NOT EXISTS (
            SELECT 1 FROM hospitality.policies x
             WHERE x.tenant_id = _t AND x.id = _policy_id AND NOT x.is_archived)))
   ORDER BY (p.id = _policy_id) DESC NULLS LAST
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION hospitality._public_policy(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality.public_site()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_site_tenant();
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
               'bedrooms', u.bedrooms, 'bathrooms', u.bathrooms, 'separate_toilets', u.separate_toilets,
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
REVOKE ALL ON FUNCTION hospitality.public_site() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.public_site() TO anon, authenticated, service_role;

-- לילות תפוסים ליחידה (הזמנה פעילה או חסימה, כולל דרך "כל המתחם"); בקשה שפג החלון שלה — פנויה
CREATE OR REPLACE FUNCTION hospitality.public_availability(_unit_id uuid, _from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_site_tenant();
BEGIN
  IF _from IS NULL OR _to IS NULL OR _to <= _from OR _to - _from > 120 THEN
    RAISE EXCEPTION 'טווח התאריכים לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hospitality.units u JOIN hospitality.properties p
                   ON p.tenant_id = u.tenant_id AND p.id = u.property_id
                  WHERE u.tenant_id = _t AND u.id = _unit_id AND u.is_active AND p.status = 'active') THEN
    RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object(
    'unit_id', _unit_id, 'from', _from, 'to', _to,
    'busy', COALESCE((
      SELECT jsonb_agg(DISTINCT d::date ORDER BY d::date)
        FROM hospitality.unit_occupancy o
        LEFT JOIN hospitality.bookings b ON b.tenant_id = o.tenant_id AND b.id = o.booking_id
        CROSS JOIN LATERAL generate_series(greatest(lower(o.nights), _from), least(upper(o.nights), _to) - 1, interval '1 day') d
       WHERE o.tenant_id = _t AND o.unit_id = _unit_id AND o.nights && daterange(_from, _to)
         AND (o.booking_id IS NULL
              OR NOT (b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at <= now()))), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.public_availability(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.public_availability(uuid, date, date) TO anon, authenticated, service_role;

COMMIT;
