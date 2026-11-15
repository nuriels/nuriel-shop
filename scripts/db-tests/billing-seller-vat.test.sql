-- ============================================================
-- Billing VAT follows Nuriel as the SELLER — never the customer's own dealer type (round 3, item 5)
--   • structure: billing.vat_profile() has no customer argument; no billing function reads a customer's
--     VAT settings (tenant_vat_profile, site_settings) or the customer's billing profile
--   • behaviour: two customer stores with opposite dealer types (one authorized "before VAT", one exempt),
--     and opposite billing profiles, get exactly the same VAT in agreements and in the ledger:
--     0% while Nuriel is exempt, the central 18% once Nuriel is authorized
--   • flipping the customers' own settings changes nothing in billing; switching Nuriel changes nothing
--     in the customers' own settings
-- Runs after billing-agreements.test.sql (Nuriel is exempt there at the end); restores exempt at the end.
-- ============================================================
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set SV_AUTH '''b1930000-0000-0000-0000-00000000a0a1'''
\set SV_EXEMPT '''b1930000-0000-0000-0000-00000000a0e1'''

CREATE OR REPLACE FUNCTION pg_temp.plat(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  SET LOCAL ROLE authenticated;
  EXECUTE _sql INTO r;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
-- the VAT columns billing stored for a customer (latest agreement / a ledger row by description)
CREATE OR REPLACE FUNCTION pg_temp.agreement_vat(_tenant uuid) RETURNS text LANGUAGE sql AS $f$
  SELECT a.vat_business_type || '|' || a.vat_mode || '|' || a.vat_rate::text
    FROM billing.agreements a WHERE a.tenant_id = _tenant ORDER BY a.version DESC LIMIT 1;
$f$;
CREATE OR REPLACE FUNCTION pg_temp.entry_vat(_tenant uuid, _description text) RETURNS text LANGUAGE sql AS $f$
  SELECT l.vat_business_type || '|' || l.vat_rate::text || '|' || l.vat_amount::text || '|' || l.net_amount::text
    FROM billing.ledger l WHERE l.tenant_id = _tenant AND l.description = _description;
$f$;

-- ---------- fixtures: two customer stores with opposite VAT settings and opposite billing profiles ----------
INSERT INTO public.tenants (id, slug, name, owner_email) VALUES
  (:SV_AUTH, 'sv-store-authorized', 'חנות מורשית', 'sv.auth@test.local'),
  (:SV_EXEMPT, 'sv-store-exempt', 'חנות פטורה', 'sv.exempt@test.local');
UPDATE public.site_settings SET business_type = 'authorized', prices_include_vat = false,
       vat_settings_confirmed_at = now() WHERE tenant_id = :SV_AUTH;
UPDATE public.site_settings SET business_type = 'exempt', vat_settings_confirmed_at = now() WHERE tenant_id = :SV_EXEMPT;
-- the billing profiles say the opposite of the store settings, to show neither is read
INSERT INTO public.tenant_billing_profile (tenant_id, business_type, company_name, tax_id, address) VALUES
  (:SV_AUTH, 'exempt', 'חנות מורשית בע"מ', '123456782', 'רחוב הבדיקה 1'),
  (:SV_EXEMPT, 'company', 'חנות פטורה', '123456782', 'רחוב הבדיקה 2');
SELECT md5(string_agg(s.tenant_id::text || s.business_type || s.prices_include_vat::text || s.vat_rate::text, ','
                      ORDER BY s.tenant_id)) AS customer_settings_md5
  FROM public.site_settings s WHERE s.tenant_id IN (:SV_AUTH, :SV_EXEMPT) \gset

SELECT tests.check('seller VAT fixtures: one customer is authorized "before VAT" (18%), the other exempt (0%)',
  format($$SELECT public.tenant_vat_profile(%L) ->> 'business_type' = 'authorized'
             AND (public.tenant_vat_profile(%1$L) ->> 'vat_rate')::numeric = 18
             AND public.tenant_vat_profile(%2$L) ->> 'business_type' = 'exempt'
             AND (public.tenant_vat_profile(%2$L) ->> 'vat_rate')::numeric = 0
             AND billing.vat_profile() ->> 'business_type' = 'exempt'$$, :SV_AUTH, :SV_EXEMPT));

-- ---------- structure ----------
SELECT tests.check('seller VAT structure: billing.vat_profile() takes only a date — there is no customer to look at',
  $$SELECT pg_get_function_identity_arguments('billing.vat_profile'::regproc) = '_on date'$$);
SELECT tests.check('seller VAT structure: no billing function reads the customer''s VAT settings or billing profile',
  $$SELECT NOT EXISTS (
      SELECT 1 FROM pg_proc p
       WHERE (p.pronamespace = 'billing'::regnamespace OR p.proname ~ '^(my_billing_|platform_billing_)')
         AND p.prosrc ~ '(tenant_vat_profile|site_settings|tenant_billing_profile)')$$);
SELECT tests.check('seller VAT structure: every dealer type billing stores comes from billing.vat_profile() (or a reversal''s original row)',
  $$SELECT bool_and(CASE WHEN p.oid = 'billing.vat_profile'::regproc
                         -- the source itself: Nuriel's own row in billing.settings, nothing else
                         THEN p.prosrc ~ 'FROM billing\.settings' AND p.prosrc ~ 'seller_business_type'
                         ELSE p.prosrc !~ '[^_]business_type'
                              OR p.prosrc ~ 'vat_profile|_profile ->> ''business_type''|o\.vat_business_type' END)
      FROM pg_proc p
     WHERE p.pronamespace = 'billing'::regnamespace OR p.proname ~ '^(my_billing_|platform_billing_)'$$);

-- ---------- Nuriel exempt: 0% for both customers ----------
SELECT pg_temp.plat(format($$SELECT public.platform_billing_save_agreement(%L, '{"plan":"basic","billing_cycle":"monthly"}', 0)$$, :SV_AUTH)) IS NOT NULL AS ok \gset
SELECT pg_temp.plat(format($$SELECT public.platform_billing_save_agreement(%L, '{"plan":"basic","billing_cycle":"monthly"}', 0)$$, :SV_EXEMPT)) IS NOT NULL AS ok \gset
SELECT pg_temp.plat(format($$SELECT public.platform_billing_record_entry(%L, '{"kind":"charge","category":"other","amount":118,"description":"sv-exempt-seller"}')$$, :SV_AUTH)) IS NOT NULL AS ok \gset
SELECT pg_temp.plat(format($$SELECT public.platform_billing_record_entry(%L, '{"kind":"charge","category":"other","amount":118,"description":"sv-exempt-seller"}')$$, :SV_EXEMPT)) IS NOT NULL AS ok \gset
SELECT tests.check('seller VAT, Nuriel exempt: the authorized customer gets no VAT either — agreement and charge identical for both',
  format($$SELECT pg_temp.agreement_vat(%L) = 'exempt|exempt|0.00' AND pg_temp.agreement_vat(%L) = 'exempt|exempt|0.00'
             AND pg_temp.entry_vat(%1$L, 'sv-exempt-seller') = 'exempt|0.00|0.00|118.00'
             AND pg_temp.entry_vat(%2$L, 'sv-exempt-seller') = 'exempt|0.00|0.00|118.00'$$, :SV_AUTH, :SV_EXEMPT));

-- ---------- Nuriel authorized (prices before VAT): 18% for both customers ----------
SELECT pg_temp.plat($q$SELECT public.platform_billing_save_settings('{"seller_business_type":"authorized","seller_prices_include_vat":false}')$q$) IS NOT NULL AS ok \gset
SELECT pg_temp.plat(format($$SELECT public.platform_billing_save_agreement(%L, '{"plan":"basic","billing_cycle":"monthly"}', 1)$$, :SV_AUTH)) IS NOT NULL AS ok \gset
SELECT pg_temp.plat(format($$SELECT public.platform_billing_save_agreement(%L, '{"plan":"basic","billing_cycle":"monthly"}', 1)$$, :SV_EXEMPT)) IS NOT NULL AS ok \gset
SELECT pg_temp.plat(format($$SELECT public.platform_billing_record_entry(%L, '{"kind":"charge","category":"other","amount":118,"description":"sv-authorized-seller"}')$$, :SV_AUTH)) IS NOT NULL AS ok \gset
SELECT pg_temp.plat(format($$SELECT public.platform_billing_record_entry(%L, '{"kind":"charge","category":"other","amount":118,"description":"sv-authorized-seller"}')$$, :SV_EXEMPT)) IS NOT NULL AS ok \gset
SELECT tests.check('seller VAT, Nuriel authorized: the EXEMPT customer is charged the central 18% too — identical to the authorized customer',
  format($$SELECT pg_temp.agreement_vat(%L) = 'authorized|excluded|18.00' AND pg_temp.agreement_vat(%L) = 'authorized|excluded|18.00'
             AND pg_temp.entry_vat(%1$L, 'sv-authorized-seller') = pg_temp.entry_vat(%2$L, 'sv-authorized-seller')
             AND split_part(pg_temp.entry_vat(%2$L, 'sv-authorized-seller'), '|', 1) = 'authorized'
             AND split_part(pg_temp.entry_vat(%2$L, 'sv-authorized-seller'), '|', 2) = '18.00'
             AND split_part(pg_temp.entry_vat(%2$L, 'sv-authorized-seller'), '|', 3)::numeric > 0$$, :SV_AUTH, :SV_EXEMPT));
SELECT tests.check('seller VAT: Nuriel''s switch did not touch the customers'' own VAT settings',
  format($$SELECT md5(string_agg(s.tenant_id::text || s.business_type || s.prices_include_vat::text || s.vat_rate::text, ','
                                 ORDER BY s.tenant_id)) = %L
             FROM public.site_settings s WHERE s.tenant_id IN (%L, %L)$$, :'customer_settings_md5', :SV_AUTH, :SV_EXEMPT));

-- ---------- the customers flip their own settings: billing does not move ----------
UPDATE public.site_settings SET business_type = 'exempt' WHERE tenant_id = :SV_AUTH;
UPDATE public.site_settings SET business_type = 'authorized', prices_include_vat = true WHERE tenant_id = :SV_EXEMPT;
UPDATE public.tenant_billing_profile SET business_type = 'company' WHERE tenant_id = :SV_AUTH;
UPDATE public.tenant_billing_profile SET business_type = 'exempt' WHERE tenant_id = :SV_EXEMPT;
SELECT pg_temp.plat(format($$SELECT public.platform_billing_quote(%L, '{"plan":"premium","billing_cycle":"monthly"}')$$, :SV_AUTH)) AS q_auth \gset
SELECT pg_temp.plat(format($$SELECT public.platform_billing_quote(%L, '{"plan":"premium","billing_cycle":"monthly"}')$$, :SV_EXEMPT)) AS q_exempt \gset
SELECT pg_temp.plat(format($$SELECT public.platform_billing_record_entry(%L, '{"kind":"charge","category":"other","amount":118,"description":"sv-after-flip"}')$$, :SV_AUTH)) IS NOT NULL AS ok \gset
SELECT pg_temp.plat(format($$SELECT public.platform_billing_record_entry(%L, '{"kind":"charge","category":"other","amount":118,"description":"sv-after-flip"}')$$, :SV_EXEMPT)) IS NOT NULL AS ok \gset
SELECT tests.check('seller VAT: after the customers flip their own dealer types, a new quote and a new charge are exactly as before (Nuriel''s 18%)',
  format($$SELECT pg_temp.entry_vat(%1$L, 'sv-after-flip') = pg_temp.entry_vat(%1$L, 'sv-authorized-seller')
             AND pg_temp.entry_vat(%2$L, 'sv-after-flip') = pg_temp.entry_vat(%2$L, 'sv-authorized-seller')
             AND (%3$L::jsonb - 'tenant_id') = (%4$L::jsonb - 'tenant_id')$$,
         :SV_AUTH, :SV_EXEMPT, :'q_auth', :'q_exempt'));

-- ---------- restore: Nuriel exempt (the default), as found ----------
SELECT pg_temp.plat($q$SELECT public.platform_billing_save_settings('{"seller_business_type":"exempt"}')$q$) IS NOT NULL AS ok \gset
SELECT tests.check('seller VAT cleanup: Nuriel is exempt again',
  $$SELECT billing.vat_profile() ->> 'business_type' = 'exempt'$$);
