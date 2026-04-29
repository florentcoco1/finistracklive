CREATE TABLE IF NOT EXISTS public.race_organizers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id uuid NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'co_organizer',
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (race_id, user_id)
);

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

DROP POLICY IF EXISTS "Race admins can view race organizers" ON public.race_organizers;
CREATE POLICY "Race admins can view race organizers"
  ON public.race_organizers FOR SELECT
  USING (public.is_race_admin(race_id, auth.uid()));

DROP POLICY IF EXISTS "Race owners can add race organizers" ON public.race_organizers;
CREATE POLICY "Race owners can add race organizers"
  ON public.race_organizers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.races r
      WHERE r.id = race_organizers.race_id
        AND r.organizer_id = auth.uid()
        AND public.has_role(auth.uid(), 'organizer'::app_role)
    )
  );

DROP POLICY IF EXISTS "Race owners can remove race organizers" ON public.race_organizers;
CREATE POLICY "Race owners can remove race organizers"
  ON public.race_organizers FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.races r
      WHERE r.id = race_organizers.race_id
        AND r.organizer_id = auth.uid()
        AND public.has_role(auth.uid(), 'organizer'::app_role)
    )
  );

DROP POLICY IF EXISTS "Race admins can manage registrations" ON public.race_registrations;
CREATE POLICY "Race admins can manage registrations"
  ON public.race_registrations FOR ALL
  USING (public.is_race_admin(race_id, auth.uid()))
  WITH CHECK (public.is_race_admin(race_id, auth.uid()));

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

CREATE INDEX IF NOT EXISTS idx_race_organizers_race ON public.race_organizers(race_id);
CREATE INDEX IF NOT EXISTS idx_race_organizers_user ON public.race_organizers(user_id);
