
-- =========================================
-- ENUMS
-- =========================================
CREATE TYPE public.app_role AS ENUM ('organizer', 'runner');
CREATE TYPE public.race_status AS ENUM ('upcoming', 'live', 'finished');

-- =========================================
-- TIMESTAMP TRIGGER FUNCTION
-- =========================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =========================================
-- PROFILES
-- =========================================
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  birth_date DATE,
  phone TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are viewable by everyone"
  ON public.profiles FOR SELECT USING (true);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- USER ROLES + has_role()
-- =========================================
CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- =========================================
-- AUTO-CREATE PROFILE + DEFAULT ROLE ON SIGNUP
-- =========================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, first_name, last_name, birth_date, phone)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'first_name',
    NEW.raw_user_meta_data ->> 'last_name',
    NULLIF(NEW.raw_user_meta_data ->> 'birth_date', '')::DATE,
    NEW.raw_user_meta_data ->> 'phone'
  );

  -- Default role: runner. Organizer role can be granted later.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'runner');

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================
-- RACES
-- =========================================
CREATE TABLE public.races (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organizer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  gpx_url TEXT,
  gpx_geojson JSONB,
  route_points JSONB,         -- [{lat, lng, cumulativeDistanceM}]
  distance_km NUMERIC,
  status public.race_status NOT NULL DEFAULT 'upcoming',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.races ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Races are viewable by everyone"
  ON public.races FOR SELECT USING (true);

CREATE POLICY "Organizers can create races"
  ON public.races FOR INSERT
  WITH CHECK (auth.uid() = organizer_id AND public.has_role(auth.uid(), 'organizer'));

CREATE POLICY "Organizers can update their own races"
  ON public.races FOR UPDATE
  USING (auth.uid() = organizer_id AND public.has_role(auth.uid(), 'organizer'));

CREATE POLICY "Organizers can delete their own races"
  ON public.races FOR DELETE
  USING (auth.uid() = organizer_id AND public.has_role(auth.uid(), 'organizer'));

CREATE TRIGGER update_races_updated_at
  BEFORE UPDATE ON public.races
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_races_status ON public.races(status);
CREATE INDEX idx_races_start_time ON public.races(start_time DESC);

-- =========================================
-- RACE REGISTRATIONS
-- =========================================
CREATE TABLE public.race_registrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  race_id UUID NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  runner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bib_number TEXT NOT NULL,
  category TEXT,
  tracking_active BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(race_id, runner_id),
  UNIQUE(race_id, bib_number)
);

ALTER TABLE public.race_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Registrations are viewable by everyone"
  ON public.race_registrations FOR SELECT USING (true);

CREATE POLICY "Runners can register themselves"
  ON public.race_registrations FOR INSERT
  WITH CHECK (auth.uid() = runner_id);

CREATE POLICY "Runners can update their own registration"
  ON public.race_registrations FOR UPDATE
  USING (auth.uid() = runner_id);

CREATE POLICY "Runners can delete their own registration"
  ON public.race_registrations FOR DELETE
  USING (auth.uid() = runner_id);

CREATE TRIGGER update_race_registrations_updated_at
  BEFORE UPDATE ON public.race_registrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_registrations_race ON public.race_registrations(race_id);
CREATE INDEX idx_registrations_runner ON public.race_registrations(runner_id);

-- =========================================
-- RUNNER POSITIONS (live GPS)
-- =========================================
CREATE TABLE public.runner_positions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  registration_id UUID NOT NULL REFERENCES public.race_registrations(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy NUMERIC,
  speed NUMERIC,
  distance_along_route_m NUMERIC,
  progress_percent NUMERIC,
  rolling_speed_kmh NUMERIC,
  rolling_pace_sec_per_km INTEGER,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.runner_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Positions are viewable by everyone"
  ON public.runner_positions FOR SELECT USING (true);

CREATE POLICY "Runners can insert their own positions"
  ON public.runner_positions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.race_registrations r
      WHERE r.id = registration_id AND r.runner_id = auth.uid()
    )
  );

CREATE INDEX idx_positions_registration_recorded
  ON public.runner_positions(registration_id, recorded_at DESC);

-- Enable realtime
ALTER TABLE public.runner_positions REPLICA IDENTITY FULL;
ALTER TABLE public.race_registrations REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.runner_positions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.race_registrations;

-- =========================================
-- LIVE LEADERBOARD VIEW
-- =========================================
CREATE OR REPLACE VIEW public.live_leaderboard
WITH (security_invoker = true)
AS
SELECT
  reg.id              AS registration_id,
  reg.race_id,
  reg.runner_id,
  reg.bib_number,
  reg.category,
  reg.tracking_active,
  reg.started_at,
  reg.finished_at,
  p.first_name,
  p.last_name,
  pos.latitude,
  pos.longitude,
  pos.distance_along_route_m,
  pos.progress_percent,
  pos.rolling_speed_kmh,
  pos.rolling_pace_sec_per_km,
  pos.recorded_at AS last_position_at
FROM public.race_registrations reg
LEFT JOIN public.profiles p ON p.user_id = reg.runner_id
LEFT JOIN LATERAL (
  SELECT *
  FROM public.runner_positions rp
  WHERE rp.registration_id = reg.id
  ORDER BY rp.recorded_at DESC
  LIMIT 1
) pos ON true;

-- =========================================
-- STORAGE: gpx-files bucket
-- =========================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('gpx-files', 'gpx-files', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "GPX files are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'gpx-files');

CREATE POLICY "Organizers can upload GPX files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'gpx-files'
    AND auth.uid() IS NOT NULL
    AND public.has_role(auth.uid(), 'organizer')
  );

CREATE POLICY "Organizers can update their own GPX files"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'gpx-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Organizers can delete their own GPX files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'gpx-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
