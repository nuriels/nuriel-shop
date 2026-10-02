REVOKE ALL ON FUNCTION public.check_selling_price() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_selling_price() TO service_role;