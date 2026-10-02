-- חתימת מים אישית: תמונת מדבקה + מיקום + שקיפות, פר משתמש.
-- אידמפוטנטי — בטוח להרצה חוזרת.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS watermark_path     TEXT,
  ADD COLUMN IF NOT EXISTS watermark_position TEXT    NOT NULL DEFAULT 'bottom-right',
  ADD COLUMN IF NOT EXISTS watermark_opacity  INTEGER NOT NULL DEFAULT 40;

DO $$ BEGIN
  ALTER TABLE public.user_profiles
    ADD CONSTRAINT user_profiles_watermark_position_check
    CHECK (watermark_position IN ('bottom-right','bottom-left','top-right','top-left'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.user_profiles
    ADD CONSTRAINT user_profiles_watermark_opacity_check
    CHECK (watermark_opacity BETWEEN 10 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
