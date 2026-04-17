
ALTER TABLE public.race_registrations
  ADD COLUMN IF NOT EXISTS dnf_reason text,
  ADD COLUMN IF NOT EXISTS problem_description text;

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
  p.first_name,
  p.last_name,
  lp.latitude,
  lp.longitude,
  lp.distance_along_route_m,
  lp.progress_percent,
  lp.rolling_speed_kmh,
  lp.rolling_pace_sec_per_km,
  lp.recorded_at AS last_position_at
FROM race_registrations rr
LEFT JOIN profiles p ON p.user_id = rr.runner_id
LEFT JOIN LATERAL (
  SELECT rp.*
  FROM runner_positions rp
  WHERE rp.registration_id = rr.id
  ORDER BY rp.recorded_at DESC
  LIMIT 1
) lp ON true;
