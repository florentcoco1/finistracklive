ALTER TABLE public.gmcap_import_sources
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'url',
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS pending_content text,
  ADD COLUMN IF NOT EXISTS pending_import_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS schema_checked_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_gmcap_import_sources_pending_schema
  ON public.gmcap_import_sources(last_import_status, pending_import_at)
  WHERE last_import_status = 'pending_schema';
