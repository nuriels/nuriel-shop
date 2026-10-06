-- ============================================================
-- stubs מינימליים של Supabase לבדיקות מסד מקומיות (Postgres 16 רגיל)
-- תפקידים, auth.users / identities, auth.uid() מתוך request.jwt.claim.sub,
-- storage.buckets / objects / foldername, והרשאות ברירת המחדל של Supabase.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN CREATE ROLE supabase_storage_admin NOLOGIN; END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  phone TEXT,
  encrypted_password TEXT,
  raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_app_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  email_confirmed_at TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ,
  banned_until TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth.identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_id TEXT,
  identity_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
$$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner UUID,
  public BOOLEAN NOT NULL DEFAULT false,
  file_size_limit BIGINT,
  allowed_mime_types TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT REFERENCES storage.buckets(id),
  name TEXT,
  owner UUID,
  metadata JSONB,
  path_tokens TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_accessed_at TIMESTAMPTZ
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
$$;

GRANT USAGE ON SCHEMA public, auth, storage, extensions TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;
GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;
-- כמו ב-Supabase: טבלאות/פונקציות/רצפים חדשים ב-public פתוחים לתפקידים (ה-RLS שומר)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
