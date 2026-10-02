ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS kiosk_pin TEXT NOT NULL DEFAULT '0000';

ALTER TABLE public.stores
  ADD CONSTRAINT stores_kiosk_pin_format CHECK (kiosk_pin ~ '^[0-9]{4}$');