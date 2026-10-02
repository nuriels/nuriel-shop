-- ============================================================
-- יומן מיילים ללקוח: כל מייל שהמערכת שולחת ללקוח נשמר בתיק הלקוח
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customer_emails (
  id         UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES public.user_roles(user_id) ON DELETE CASCADE,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  /** סוג המייל: order / quote / password_reset / temp_password / password_changed / agreement / manual / other */
  kind       TEXT NOT NULL DEFAULT 'other',
  html       TEXT NOT NULL,
  sent       BOOLEAN NOT NULL,
  error      TEXT,
  sent_by    UUID REFERENCES public.user_roles(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_emails_user_idx ON public.customer_emails (user_id, created_at DESC);

GRANT SELECT ON public.customer_emails TO authenticated;
GRANT ALL ON public.customer_emails TO service_role;
ALTER TABLE public.customer_emails ENABLE ROW LEVEL SECURITY;

-- הכתיבה נעשית בשרת בלבד; קריאה למנהל, לסוכן של הלקוח וללקוח עצמו
DROP POLICY IF EXISTS "customer emails readable by owner or staff" ON public.customer_emails;
CREATE POLICY "customer emails readable by owner or staff" ON public.customer_emails
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_admin(auth.uid())
  OR (public.is_agent(auth.uid()) AND public.is_agent_of_customer(auth.uid(), user_id))
);
