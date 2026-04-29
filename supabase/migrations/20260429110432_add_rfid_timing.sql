ALTER TABLE public.race_registrations
  ADD COLUMN IF NOT EXISTS rfid_identifier text,
  ADD COLUMN IF NOT EXISTS rfid_matched_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS rfid_source text;

CREATE TABLE IF NOT EXISTS public.rfid_timing_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id uuid NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  registration_id uuid REFERENCES public.race_registrations(id) ON DELETE SET NULL,
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

ALTER TABLE public.rfid_timing_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "RFID results are viewable by everyone"
  ON public.rfid_timing_results FOR SELECT
  USING (true);

CREATE POLICY "Organizers can import RFID results"
  ON public.rfid_timing_results FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.races r
      WHERE r.id = rfid_timing_results.race_id
        AND r.organizer_id = auth.uid()
        AND public.has_role(auth.uid(), 'organizer'::app_role)
    )
  );

CREATE POLICY "Organizers can update RFID results"
  ON public.rfid_timing_results FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.races r
      WHERE r.id = rfid_timing_results.race_id
        AND r.organizer_id = auth.uid()
        AND public.has_role(auth.uid(), 'organizer'::app_role)
    )
  );

CREATE POLICY "Organizers can delete RFID results"
  ON public.rfid_timing_results FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.races r
      WHERE r.id = rfid_timing_results.race_id
        AND r.organizer_id = auth.uid()
        AND public.has_role(auth.uid(), 'organizer'::app_role)
    )
  );

CREATE INDEX IF NOT EXISTS idx_rfid_results_race_rank
  ON public.rfid_timing_results(race_id, overall_rank NULLS LAST, official_seconds NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_rfid_results_registration
  ON public.rfid_timing_results(registration_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_race_rfid_identifier
  ON public.race_registrations(race_id, rfid_identifier)
  WHERE rfid_identifier IS NOT NULL;

ALTER TABLE public.rfid_timing_results REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rfid_timing_results;

DROP VIEW IF EXISTS public.live_leaderboard;

CREATE VIEW public.live_leaderboard AS
SELECT
  rr.id          AS registration_id,
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
FROM race_registrations rr
LEFT JOIN profiles p ON p.user_id = rr.runner_id
LEFT JOIN public.rfid_timing_results tr ON tr.registration_id = rr.id
LEFT JOIN LATERAL (
  SELECT rp.*
  FROM runner_positions rp
  WHERE rp.registration_id = rr.id
  ORDER BY rp.recorded_at DESC
  LIMIT 1
) lp ON true;
