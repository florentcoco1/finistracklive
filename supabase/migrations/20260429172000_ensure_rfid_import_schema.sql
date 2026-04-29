ALTER TABLE public.race_registrations
  ADD COLUMN IF NOT EXISTS rfid_identifier text,
  ADD COLUMN IF NOT EXISTS rfid_matched_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS rfid_source text;

CREATE TABLE IF NOT EXISTS public.rfid_timing_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id uuid NOT NULL,
  registration_id uuid,
  rfid_identifier text NOT NULL,
  bib_number text,
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
  UNIQUE (race_id, rfid_identifier)
);

CREATE TABLE IF NOT EXISTS public.gmcap_import_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id uuid NOT NULL UNIQUE,
  source_url text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_import_at timestamp with time zone,
  last_import_status text,
  last_import_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.race_organizers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'co_organizer',
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (race_id, user_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rfid_timing_results_race_id_fkey') THEN
    ALTER TABLE public.rfid_timing_results
      ADD CONSTRAINT rfid_timing_results_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.races(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rfid_timing_results_registration_id_fkey') THEN
    ALTER TABLE public.rfid_timing_results
      ADD CONSTRAINT rfid_timing_results_registration_id_fkey FOREIGN KEY (registration_id) REFERENCES public.race_registrations(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gmcap_import_sources_race_id_fkey') THEN
    ALTER TABLE public.gmcap_import_sources
      ADD CONSTRAINT gmcap_import_sources_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.races(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'race_organizers_race_id_fkey') THEN
    ALTER TABLE public.race_organizers
      ADD CONSTRAINT race_organizers_race_id_fkey FOREIGN KEY (race_id) REFERENCES public.races(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE public.rfid_timing_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gmcap_import_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_organizers ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_race_admin(_race_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.races r
    WHERE r.id = _race_id AND r.organizer_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.race_organizers ro
    WHERE ro.race_id = _race_id AND ro.user_id = _user_id
  )
$$;

DROP POLICY IF EXISTS "RFID results are viewable by everyone" ON public.rfid_timing_results;
CREATE POLICY "RFID results are viewable by everyone"
  ON public.rfid_timing_results FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Race admins can import RFID results" ON public.rfid_timing_results;
CREATE POLICY "Race admins can import RFID results"
  ON public.rfid_timing_results FOR INSERT
  WITH CHECK (public.is_race_admin(race_id, auth.uid()));

DROP POLICY IF EXISTS "Race admins can update RFID results" ON public.rfid_timing_results;
CREATE POLICY "Race admins can update RFID results"
  ON public.rfid_timing_results FOR UPDATE
  USING (public.is_race_admin(race_id, auth.uid()))
  WITH CHECK (public.is_race_admin(race_id, auth.uid()));

DROP POLICY IF EXISTS "Race admins can delete RFID results" ON public.rfid_timing_results;
CREATE POLICY "Race admins can delete RFID results"
  ON public.rfid_timing_results FOR DELETE
  USING (public.is_race_admin(race_id, auth.uid()));

DROP POLICY IF EXISTS "Race admins can view GMCAP import source" ON public.gmcap_import_sources;
CREATE POLICY "Race admins can view GMCAP import source"
  ON public.gmcap_import_sources FOR SELECT
  USING (public.is_race_admin(race_id, auth.uid()));

DROP POLICY IF EXISTS "Race admins can create GMCAP import source" ON public.gmcap_import_sources;
CREATE POLICY "Race admins can create GMCAP import source"
  ON public.gmcap_import_sources FOR INSERT
  WITH CHECK (public.is_race_admin(race_id, auth.uid()));

DROP POLICY IF EXISTS "Race admins can update GMCAP import source" ON public.gmcap_import_sources;
CREATE POLICY "Race admins can update GMCAP import source"
  ON public.gmcap_import_sources FOR UPDATE
  USING (public.is_race_admin(race_id, auth.uid()))
  WITH CHECK (public.is_race_admin(race_id, auth.uid()));

DROP POLICY IF EXISTS "Race admins can delete GMCAP import source" ON public.gmcap_import_sources;
CREATE POLICY "Race admins can delete GMCAP import source"
  ON public.gmcap_import_sources FOR DELETE
  USING (public.is_race_admin(race_id, auth.uid()));

DROP POLICY IF EXISTS "Race admins can view race organizers" ON public.race_organizers;
CREATE POLICY "Race admins can view race organizers"
  ON public.race_organizers FOR SELECT
  USING (public.is_race_admin(race_id, auth.uid()));

DROP POLICY IF EXISTS "Race owners can add race organizers" ON public.race_organizers;
CREATE POLICY "Race owners can add race organizers"
  ON public.race_organizers FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.races r WHERE r.id = race_organizers.race_id AND r.organizer_id = auth.uid()));

DROP POLICY IF EXISTS "Race owners can remove race organizers" ON public.race_organizers;
CREATE POLICY "Race owners can remove race organizers"
  ON public.race_organizers FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.races r WHERE r.id = race_organizers.race_id AND r.organizer_id = auth.uid()));

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_race_rfid_identifier
  ON public.race_registrations(race_id, rfid_identifier)
  WHERE rfid_identifier IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rfid_results_race_rank
  ON public.rfid_timing_results(race_id, overall_rank NULLS LAST, official_seconds NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_rfid_results_registration ON public.rfid_timing_results(registration_id);
CREATE INDEX IF NOT EXISTS idx_gmcap_import_sources_enabled ON public.gmcap_import_sources(enabled, last_import_at);
CREATE INDEX IF NOT EXISTS idx_race_organizers_race ON public.race_organizers(race_id);
CREATE INDEX IF NOT EXISTS idx_race_organizers_user ON public.race_organizers(user_id);

ALTER TABLE public.rfid_timing_results REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rfid_timing_results'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rfid_timing_results;
  END IF;
END $$;

DROP VIEW IF EXISTS public.live_leaderboard;
CREATE VIEW public.live_leaderboard AS
SELECT
  rr.id AS registration_id,
  rr.race_id,
  rr.runner_id,
  rr.bib_number,
  rr.category,
  rr.tracking_active,
  rr.started_at,
  rr.finished_at,
  rr.runner_status,
  rr.emergency_phone,
  rr.dnf_reason,
  rr.problem_description,
  rr.rfid_identifier,
  rr.rfid_matched_at,
  rr.rfid_source,
  p.first_name,
  p.last_name,
  lp.latitude,
  lp.longitude,
  lp.distance_along_route_m,
  lp.progress_percent,
  lp.rolling_speed_kmh,
  lp.rolling_pace_sec_per_km,
  lp.recorded_at AS last_position_at,
  tr.official_time AS rfid_official_time,
  tr.official_seconds AS rfid_official_seconds,
  tr.rounded_time AS rfid_rounded_time,
  tr.rounded_seconds AS rfid_rounded_seconds,
  tr.overall_rank AS rfid_overall_rank,
  tr.category_rank AS rfid_category_rank,
  tr.gender_rank AS rfid_gender_rank,
  tr.imported_at AS rfid_imported_at
FROM public.race_registrations rr
LEFT JOIN public.profiles p ON p.user_id = rr.runner_id
LEFT JOIN public.rfid_timing_results tr ON tr.registration_id = rr.id
LEFT JOIN LATERAL (
  SELECT rp.*
  FROM public.runner_positions rp
  WHERE rp.registration_id = rr.id
  ORDER BY rp.recorded_at DESC
  LIMIT 1
) lp ON true;
