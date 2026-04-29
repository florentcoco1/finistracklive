CREATE TABLE IF NOT EXISTS public.gmcap_import_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id uuid NOT NULL UNIQUE REFERENCES public.races(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_import_at timestamp with time zone,
  last_import_status text,
  last_import_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.gmcap_import_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Organizers can view GMCAP import source"
  ON public.gmcap_import_sources FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.races r
      WHERE r.id = gmcap_import_sources.race_id
        AND r.organizer_id = auth.uid()
        AND public.has_role(auth.uid(), 'organizer'::app_role)
    )
  );

CREATE POLICY "Organizers can create GMCAP import source"
  ON public.gmcap_import_sources FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.races r
      WHERE r.id = gmcap_import_sources.race_id
        AND r.organizer_id = auth.uid()
        AND public.has_role(auth.uid(), 'organizer'::app_role)
    )
  );

CREATE POLICY "Organizers can update GMCAP import source"
  ON public.gmcap_import_sources FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.races r
      WHERE r.id = gmcap_import_sources.race_id
        AND r.organizer_id = auth.uid()
        AND public.has_role(auth.uid(), 'organizer'::app_role)
    )
  );

CREATE POLICY "Organizers can delete GMCAP import source"
  ON public.gmcap_import_sources FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.races r
      WHERE r.id = gmcap_import_sources.race_id
        AND r.organizer_id = auth.uid()
        AND public.has_role(auth.uid(), 'organizer'::app_role)
    )
  );

CREATE INDEX IF NOT EXISTS idx_gmcap_import_sources_enabled
  ON public.gmcap_import_sources(enabled, last_import_at);
