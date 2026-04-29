ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS gmcap_source_url text,
  ADD COLUMN IF NOT EXISTS gmcap_auto_import_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gmcap_last_import_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS gmcap_last_import_status text,
  ADD COLUMN IF NOT EXISTS gmcap_last_import_message text;
