-- ============================================================
-- Rollback של 20261108130000_hosp_platform_separation.sql (מיגרציה 58 — הפרדה בפאנל הפלטפורמה)
-- platform_list_tenants חוזרת לגרסה של מיגרציית החיוב (כל האתרים ברשימה), admin_sites — לגרסה של
-- מיגרציה 15, מילה במילה. בלי שינוי בנתונים.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

CREATE OR REPLACE FUNCTION public.platform_list_tenants()
RETURNS TABLE(id uuid, slug text, name text, domain text, is_default boolean,
              created_at timestamptz, owner_email text, tax_id text, plan text,
              status text, status_changed_at timestamptz,
              admins integer, customers integer, products integer, orders integer,
              ssl_host text, ssl_status text, ssl_issued_at timestamptz,
              ssl_expires_at timestamptz, ssl_error text, ssl_checked_at timestamptz,
              ssl_renew_requested_at timestamptz,
              sub_plan text, sub_status text, sub_trial_ends_at timestamptz,
              sub_period_end timestamptz, sub_ends_at timestamptz, sub_active boolean,
              open_tickets integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.slug, t.name, t.domain, t.is_default, t.created_at,
         t.owner_email, t.tax_id, t.plan, t.status, t.status_changed_at,
         (SELECT count(*)::int FROM public.user_roles ur WHERE ur.tenant_id = t.id AND ur.role = 'admin'),
         (SELECT count(*)::int FROM public.user_roles ur WHERE ur.tenant_id = t.id AND ur.role = 'customer'),
         (SELECT count(*)::int FROM public.global_products gp WHERE gp.tenant_id = t.id),
         (SELECT count(*)::int FROM public.orders o WHERE o.tenant_id = t.id),
         s.host, s.status, s.issued_at, s.expires_at, s.last_error, s.checked_at,
         s.renew_requested_at,
         st ->> 'plan', st ->> 'status',
         (st ->> 'trial_ends_at')::timestamptz, (st ->> 'current_period_end')::timestamptz,
         (st ->> 'ends_at')::timestamptz, (st ->> 'active')::boolean,
         (SELECT count(*)::int FROM public.support_tickets tk
           WHERE tk.tenant_id = t.id AND tk.status = 'open')
    FROM public.tenants t
    LEFT JOIN public.tenant_ssl s ON s.tenant_id = t.id
    CROSS JOIN LATERAL (SELECT public.tenant_subscription_state(t.id) AS st) sub
   WHERE public.is_platform_admin(auth.uid())
   ORDER BY t.is_default DESC, t.created_at;
$$;


CREATE OR REPLACE FUNCTION hospitality.admin_sites()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM hospitality._require_platform_admin();
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', t.id, 'slug', t.slug, 'name', t.name, 'domain', t.domain, 'status', t.status,
             'created_at', hospitality._ts(t.created_at),
             'plan', x.e ->> 'plan', 'plan_name', (SELECT p.name FROM hospitality.plans p WHERE p.code = x.e ->> 'plan'),
             'subscription_status', x.e ->> 'status', 'subscription_active', (x.e ->> 'active')::boolean,
             'trial_ends_at', x.e ->> 'trial_ends_at',
             'units_active', (x.e ->> 'units_used')::integer, 'units_limit', (x.e ->> 'max_units')::integer,
             'extra_units', COALESCE((SELECT s.extra_units FROM hospitality.subscriptions s WHERE s.tenant_id = t.id), 0),
             'properties', (SELECT count(*) FROM hospitality.properties p
                             WHERE p.tenant_id = t.id AND p.status <> 'archived'),
             'bookings_pending', (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = t.id
                                    AND b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at > now()),
             'bookings_upcoming', (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = t.id
                                     AND b.status IN ('confirmed', 'cancel_requested', 'checked_in')
                                     AND b.check_out >= current_date),
             'owner_email', (SELECT ur.email FROM public.user_roles ur
                              WHERE ur.tenant_id = t.id AND ur.role = 'admin' AND ur.is_protected
                              ORDER BY ur.created_at LIMIT 1),
             'managers', (SELECT count(*) FROM public.user_roles ur
                           WHERE ur.tenant_id = t.id AND ur.role = 'admin' AND NOT ur.is_protected),
             'backend_enabled', hospitality.flag_for('hospitality_backend_enabled', t.id),
             'management_enabled', hospitality.flag_for('hospitality_management_enabled', t.id),
             'booking_enabled', hospitality.flag_for('hospitality_booking_enabled', t.id),
             'site_flags', jsonb_build_object(
               'backend', COALESCE((SELECT tf.enabled FROM public.tenant_feature_flags tf
                                     WHERE tf.tenant_id = t.id AND tf.key = 'hospitality_backend_enabled'), false),
               'management', COALESCE((SELECT tf.enabled FROM public.tenant_feature_flags tf
                                        WHERE tf.tenant_id = t.id AND tf.key = 'hospitality_management_enabled'), false),
               'booking', COALESCE((SELECT tf.enabled FROM public.tenant_feature_flags tf
                                     WHERE tf.tenant_id = t.id AND tf.key = 'hospitality_booking_enabled'), false))
           ) ORDER BY t.created_at DESC)
      FROM public.tenants t
      CROSS JOIN LATERAL (SELECT hospitality.entitlements(t.id) AS e) x
     WHERE t.site_type = 'hospitality'), '[]'::jsonb);
END $$;


NOTIFY pgrst, 'reload schema';

COMMIT;
