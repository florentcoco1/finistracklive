-- Drop the live_leaderboard view first (depends on rfid_* columns)
DROP VIEW IF EXISTS public.live_leaderboard;

-- Remove RFID-related columns and indexes from race_registrations
DROP INDEX IF EXISTS public.idx_registrations_race_rfid_identifier;
ALTER TABLE public.race_registrations
  DROP COLUMN IF EXISTS rfid_identifier,
  DROP COLUMN IF EXISTS rfid_matched_at,
  DROP COLUMN IF EXISTS rfid_source;

-- Rename rfid_timing_results to gmcap_results and rebuild around bib_number
ALTER TABLE IF EXISTS public.rfid_timing_results RENAME TO gmcap_results;

ALTER TABLE public.gmcap_results DROP CONSTRAINT IF EXISTS rfid_timing_results_race_id_rfid_identifier_key;
DROP INDEX IF EXISTS public.idx_rfid_results_race_rank;
DROP INDEX IF EXISTS public.idx_rfid_results_registration;

ALTER TABLE public.gmcap_results DROP COLUMN IF EXISTS rfid_identifier;

-- Deduplicate any existing rows on (race_id, bib_number) keeping the most recent import
DELETE FROM public.gmcap_results g
USING public.gmcap_results g2
WHERE g.race_id = g2.race_id
  AND g.bib_number IS NOT NULL
  AND g2.bib_number IS NOT NULL
  AND g.bib_number = g2.bib_number
  AND g.imported_at < g2.imported_at;

DELETE FROM public.gmcap_results WHERE bib_number IS NULL;

ALTER TABLE public.gmcap_results ALTER COLUMN bib_number SET NOT NULL;

ALTER TABLE public.gmcap_results
  ADD CONSTRAINT gmcap_results_race_bib_unique UNIQUE (race_id, bib_number);

CREATE INDEX IF NOT EXISTS idx_gmcap_results_race_rank
  ON public.gmcap_results(race_id, overall_rank NULLS LAST, rounded_seconds NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_gmcap_results_registration
  ON public.gmcap_results(registration_id);

DROP POLICY IF EXISTS "RFID results are viewable by everyone" ON public.gmcap_results;
DROP POLICY IF EXISTS "Organizers can import RFID results" ON public.gmcap_results;
DROP POLICY IF EXISTS "Organizers can update RFID results" ON public.gmcap_results;
DROP POLICY IF EXISTS "Organizers can delete RFID results" ON public.gmcap_results;

CREATE POLICY "GMCAP results viewable by everyone"
  ON public.gmcap_results FOR SELECT
  USING (true);

CREATE POLICY "Organizers can insert GMCAP results"
  ON public.gmcap_results FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.races r
      WHERE r.id = gmcap_results.race_id
        AND r.organizer_id = auth.uid()
        AND public.has_role(auth.uid(), 'organizer'::app_role)
    )
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "Organizers can update GMCAP results"
  ON public.gmcap_results FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.races r
      WHERE r.id = gmcap_results.race_id
        AND r.organizer_id = auth.uid()
        AND public.has_role(auth.uid(), 'organizer'::app_role)
    )
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "Organizers can delete GMCAP results"
  ON public.gmcap_results FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.races r
      WHERE r.id = gmcap_results.race_id
        AND r.organizer_id = auth.uid()
        AND public.has_role(auth.uid(), 'organizer'::app_role)
    )
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.rfid_timing_results';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.gmcap_results';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

ALTER TABLE public.gmcap_results REPLICA IDENTITY FULL;

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
  p.first_name,
  p.last_name,
  lp.latitude,
  lp.longitude,
  lp.distance_along_route_m,
  lp.progress_percent,
  lp.rolling_speed_kmh,
  lp.rolling_pace_sec_per_km,
  lp.recorded_at AS last_position_at,
  gr.official_time     AS official_time,
  gr.official_seconds  AS official_seconds,
  gr.rounded_time      AS rounded_time,
  gr.rounded_seconds   AS rounded_seconds,
  gr.overall_rank      AS overall_rank,
  gr.category_rank     AS category_rank,
  gr.gender_rank       AS gender_rank,
  gr.status            AS gmcap_status,
  gr.imported_at       AS gmcap_imported_at
FROM race_registrations rr
LEFT JOIN profiles p ON p.user_id = rr.runner_id
LEFT JOIN public.gmcap_results gr
  ON gr.race_id = rr.race_id AND gr.bib_number = rr.bib_number
LEFT JOIN LATERAL (
  SELECT rp.*
  FROM runner_positions rp
  WHERE rp.registration_id = rr.id
  ORDER BY rp.recorded_at DESC
  LIMIT 1
) lp ON true;
