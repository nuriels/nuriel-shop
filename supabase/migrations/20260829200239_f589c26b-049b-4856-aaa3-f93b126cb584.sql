-- הגדרות אישיות למשתמש
CREATE TABLE public.user_profiles (
  user_id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  logo_url text,
  theme_mode text NOT NULL DEFAULT 'light',
  accent_color text NOT NULL DEFAULT '#0041B9',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_profiles_theme_mode_check CHECK (theme_mode IN ('light', 'dark')),
  CONSTRAINT user_profiles_accent_color_check CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles TO authenticated;
GRANT ALL ON public.user_profiles TO service_role;

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own profile select" ON public.user_profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));

CREATE POLICY "own profile insert" ON public.user_profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own profile update" ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own profile delete" ON public.user_profiles
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- בקשות איפוס סיסמה ידניות
CREATE TABLE public.password_reset_requests (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  phone text,
  message text,
  status text NOT NULL DEFAULT 'new',
  admin_note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT password_reset_requests_status_check CHECK (status IN ('new', 'handled')),
  CONSTRAINT password_reset_requests_email_check CHECK (char_length(email) BETWEEN 3 AND 255),
  CONSTRAINT password_reset_requests_message_check CHECK (message IS NULL OR char_length(message) <= 1000),
  CONSTRAINT password_reset_requests_phone_check CHECK (phone IS NULL OR char_length(phone) <= 30)
);

GRANT INSERT ON public.password_reset_requests TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.password_reset_requests TO authenticated;
GRANT ALL ON public.password_reset_requests TO service_role;

ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;

-- כל אדם יכול לשלוח בקשה מדף ההתחברות (גם ללא התחברות)
CREATE POLICY "anyone can request reset" ON public.password_reset_requests
  FOR INSERT TO anon, authenticated
  WITH CHECK (status = 'new' AND admin_note IS NULL);

CREATE POLICY "super admin reads resets" ON public.password_reset_requests
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "super admin updates resets" ON public.password_reset_requests
  FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "super admin deletes resets" ON public.password_reset_requests
  FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE TRIGGER password_reset_requests_updated_at
  BEFORE UPDATE ON public.password_reset_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();