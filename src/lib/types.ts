export type RunnerStatus = 'running' | 'dnf' | 'problem';

export interface LeaderboardRow {
  registration_id: string;
  race_id: string;
  runner_id: string;
  bib_number: string;
  category: string | null;
  tracking_active: boolean;
  started_at: string | null;
  finished_at: string | null;
  runner_status: RunnerStatus;
  emergency_phone: string | null;
  dnf_reason: string | null;
  problem_description: string | null;
  first_name: string | null;
  last_name: string | null;
  gender?: string | null;
  latitude: number | null;
  longitude: number | null;
  distance_along_route_m: number | null;
  progress_percent: number | null;
  rolling_speed_kmh: number | null;
  rolling_pace_sec_per_km: number | null;
  last_position_at: string | null;
  // GMCAP official timing (joined by bib_number)
  official_time: string | null;
  official_seconds: number | null;
  rounded_time: string | null;
  rounded_seconds: number | null;
  overall_rank: number | null;
  category_rank: number | null;
  gender_rank: number | null;
  gmcap_status: string | null;
  gmcap_imported_at: string | null;
}

export interface RouteCoord {
  lat: number;
  lng: number;
  cumulativeDistanceM: number;
}
