-- ============================================================
-- Rollback של 20261108120000_hosp_shabbat.sql (מיגרציה 57 — "מתחם שומר שבת")
-- העמודה shabbat_observant נמחקת (הסימון של העסקים — לשמור עותק לפני, אם צריך).
-- _settings_values חוזרת לגרסה של מיגרציה 8, _site_payload — לגרסה של מיגרציה 42, מילה במילה.
-- לפני ה-rollback: האפליקציה חוזרת לגרסה בלי "מתחם שומר שבת".
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

DROP FUNCTION IF EXISTS hospitality.settings_set_shabbat(boolean);

-- הגרסה של מיגרציה 8
CREATE OR REPLACE FUNCTION hospitality._settings_values(s hospitality.settings)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'business_name', s.business_name, 'contact_phone', s.contact_phone, 'contact_email', s.contact_email,
    'whatsapp_phone', s.whatsapp_phone, 'address', s.address,
    'check_in_time', to_char(s.check_in_time, 'HH24:MI'), 'check_out_time', to_char(s.check_out_time, 'HH24:MI'),
    'approval_window_minutes', s.approval_window_minutes, 'approval_reminder_pct', s.approval_reminder_pct,
    'max_open_requests', s.max_open_requests, 'weekend_nights', to_jsonb(s.weekend_nights),
    'notification_emails', to_jsonb(s.notification_emails), 'guest_retention_months', s.guest_retention_months,
    'booking_mode', s.booking_mode, 'currency', s.currency, 'timezone', s.timezone,
    'payment_hold_minutes', s.payment_hold_minutes);
$$;
REVOKE ALL ON FUNCTION hospitality._settings_values(hospitality.settings) FROM PUBLIC, anon, authenticated;


-- הגרסה של מיגרציה 42
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
    -- הלוגואים (מיגרציה 42): לא בגלריה ולא בפתיח — רק לפי המזהה שבמסמך העיצוב
    'brand', hospitality._public_media(_t, 'brand', NULL, NULL),
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


ALTER TABLE hospitality.settings DROP COLUMN IF EXISTS shabbat_observant;

NOTIFY pgrst, 'reload schema';

COMMIT;
