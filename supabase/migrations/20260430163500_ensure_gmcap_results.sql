CREATE TABLE IF NOT EXISTS public.gmcap_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id uuid NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  registration_id uuid REFERENCES public.race_registrations(id) ON DELETE SET NULL,
  bib_number text NOT NULL,
  first_name text,
  last_name text,
  category text,
  club text,
  status text NOT NULL DEFAULT 'classified',
  official_time text,
  official_seconds numeric,
  rounded_time text,
  rounded_seconds numeric,
  overall_rank integer,
  category_rank integer,
  gender_rank integer,
  split_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT gmcap_results_race_bib_unique UNIQUE (race_id, bib_number)
);

ALTER TABLE public.gmcap_results ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_gmcap_results_race_rank
  ON public.gmcap_results(race_id, overall_rank NULLS LAST, rounded_seconds NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_gmcap_results_registration
  ON public.gmcap_results(registration_id);

DROP POLICY IF EXISTS "GMCAP results viewable by everyone" ON public.gmcap_results;
CREATE POLICY "GMCAP results viewable by everyone"
  ON public.gmcap_results FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Race admins can insert GMCAP results" ON public.gmcap_results;
CREATE POLICY "Race admins can insert GMCAP results"
  ON public.gmcap_results FOR INSERT
  WITH CHECK (public.is_race_admin(race_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Race admins can update GMCAP results" ON public.gmcap_results;
CREATE POLICY "Race admins can update GMCAP results"
  ON public.gmcap_results FOR UPDATE
  USING (public.is_race_admin(race_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.is_race_admin(race_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Race admins can delete GMCAP results" ON public.gmcap_results;
CREATE POLICY "Race admins can delete GMCAP results"
  ON public.gmcap_results FOR DELETE
  USING (public.is_race_admin(race_id, auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role));

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.gmcap_results;
  EXCEPTION WHEN duplicate_object THEN NULL;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

ALTER TABLE public.gmcap_results REPLICA IDENTITY FULL;
