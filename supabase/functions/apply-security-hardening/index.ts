import postgres from 'npm:postgres@3.4.5';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'unauthenticated' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const dbUrl = Deno.env.get('SUPABASE_DB_URL');
    if (!supabaseUrl || !anonKey || !dbUrl) return json({ error: 'missing_backend_configuration' }, 500);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'unauthenticated' }, 401);

    const { data: roles } = await userClient
      .from('user_roles')
      .select('role')
      .eq('user_id', userData.user.id);
    const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === 'admin');
    if (!isAdmin) return json({ error: 'forbidden' }, 403);

    const sql = postgres(dbUrl, { max: 1, prepare: false });
    try {
      await sql.begin(async (tx) => {
        // 1) user_roles policies
        await tx.unsafe(`DROP POLICY IF EXISTS "Users can add organizer role to themselves" ON public.user_roles`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Admins manage user roles" ON public.user_roles`);
        await tx.unsafe(`CREATE POLICY "Admins manage user roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role))`);

        // 2) profiles SELECT restricted
        await tx.unsafe(`DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Profiles selectable by self or staff" ON public.profiles`);
        await tx.unsafe(`CREATE POLICY "Profiles selectable by self or staff" ON public.profiles FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'organizer'::public.app_role))`);

        // 3) events_contacts table + migrate + drop columns
        await tx.unsafe(`CREATE TABLE IF NOT EXISTS public.events_contacts (
          event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
          contact_email text,
          contact_phone text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`);
        await tx.unsafe(`DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='events' AND column_name='contact_email') THEN
            INSERT INTO public.events_contacts (event_id, contact_email, contact_phone)
            SELECT id, contact_email, contact_phone FROM public.events
              WHERE contact_email IS NOT NULL OR contact_phone IS NOT NULL
            ON CONFLICT (event_id) DO UPDATE
              SET contact_email = EXCLUDED.contact_email, contact_phone = EXCLUDED.contact_phone;
          END IF;
        END $$`);
        await tx.unsafe(`ALTER TABLE public.events DROP COLUMN IF EXISTS contact_email`);
        await tx.unsafe(`ALTER TABLE public.events DROP COLUMN IF EXISTS contact_phone`);
        await tx.unsafe(`ALTER TABLE public.events_contacts ENABLE ROW LEVEL SECURITY`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Event contacts readable by owner or admin" ON public.events_contacts`);
        await tx.unsafe(`CREATE POLICY "Event contacts readable by owner or admin" ON public.events_contacts FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR EXISTS (SELECT 1 FROM public.events e WHERE e.id = events_contacts.event_id AND e.organizer_id = auth.uid()))`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Event contacts writable by owner or admin" ON public.events_contacts`);
        await tx.unsafe(`CREATE POLICY "Event contacts writable by owner or admin" ON public.events_contacts FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR EXISTS (SELECT 1 FROM public.events e WHERE e.id = events_contacts.event_id AND e.organizer_id = auth.uid())) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR EXISTS (SELECT 1 FROM public.events e WHERE e.id = events_contacts.event_id AND e.organizer_id = auth.uid()))`);
        await tx.unsafe(`DROP TRIGGER IF EXISTS update_events_contacts_updated_at ON public.events_contacts`);
        await tx.unsafe(`CREATE TRIGGER update_events_contacts_updated_at BEFORE UPDATE ON public.events_contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()`);

        // 4) race_registration_contacts
        await tx.unsafe(`CREATE TABLE IF NOT EXISTS public.race_registration_contacts (
          registration_id uuid PRIMARY KEY REFERENCES public.race_registrations(id) ON DELETE CASCADE,
          emergency_phone text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`);
        await tx.unsafe(`DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='race_registrations' AND column_name='emergency_phone') THEN
            INSERT INTO public.race_registration_contacts (registration_id, emergency_phone)
            SELECT id, emergency_phone FROM public.race_registrations
              WHERE emergency_phone IS NOT NULL
            ON CONFLICT (registration_id) DO UPDATE SET emergency_phone = EXCLUDED.emergency_phone;
          END IF;
        END $$`);
        await tx.unsafe(`DROP VIEW IF EXISTS public.live_leaderboard`);
        await tx.unsafe(`ALTER TABLE public.race_registrations DROP COLUMN IF EXISTS emergency_phone`);
        await tx.unsafe(`ALTER TABLE public.race_registration_contacts ENABLE ROW LEVEL SECURITY`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Registration contacts readable by runner or staff" ON public.race_registration_contacts`);
        await tx.unsafe(`CREATE POLICY "Registration contacts readable by runner or staff" ON public.race_registration_contacts FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR EXISTS (SELECT 1 FROM public.race_registrations rr JOIN public.races r ON r.id = rr.race_id WHERE rr.id = race_registration_contacts.registration_id AND (rr.runner_id = auth.uid() OR r.organizer_id = auth.uid())))`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Registration contacts writable by runner or staff" ON public.race_registration_contacts`);
        await tx.unsafe(`CREATE POLICY "Registration contacts writable by runner or staff" ON public.race_registration_contacts FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR EXISTS (SELECT 1 FROM public.race_registrations rr JOIN public.races r ON r.id = rr.race_id WHERE rr.id = race_registration_contacts.registration_id AND (rr.runner_id = auth.uid() OR r.organizer_id = auth.uid()))) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR EXISTS (SELECT 1 FROM public.race_registrations rr JOIN public.races r ON r.id = rr.race_id WHERE rr.id = race_registration_contacts.registration_id AND (rr.runner_id = auth.uid() OR r.organizer_id = auth.uid())))`);
        await tx.unsafe(`DROP TRIGGER IF EXISTS update_race_registration_contacts_updated_at ON public.race_registration_contacts`);
        await tx.unsafe(`CREATE TRIGGER update_race_registration_contacts_updated_at BEFORE UPDATE ON public.race_registration_contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()`);

        // 5) Recreate live_leaderboard with security_invoker
        await tx.unsafe(`CREATE VIEW public.live_leaderboard WITH (security_invoker = on) AS
        SELECT
          rr.id AS registration_id,
          rr.race_id, rr.runner_id, rr.bib_number, rr.category,
          rr.tracking_active, rr.started_at, rr.finished_at,
          rr.runner_status, rr.dnf_reason, rr.problem_description,
          p.first_name, p.last_name,
          lp.latitude, lp.longitude,
          lp.distance_along_route_m, lp.progress_percent,
          lp.rolling_speed_kmh, lp.rolling_pace_sec_per_km,
          lp.recorded_at AS last_position_at,
          gr.official_time_text AS official_time,
          gr.official_time_seconds AS official_seconds,
          gr.scratch_rank AS overall_rank,
          gr.category_rank AS category_rank,
          gr.gender_rank AS gender_rank,
          gr.status AS gmcap_status,
          gr.imported_at AS gmcap_imported_at,
          gr.rgpd_consent AS rgpd_consent
        FROM public.race_registrations rr
        LEFT JOIN public.profiles p ON p.user_id = rr.runner_id
        LEFT JOIN public.gmcap_results gr ON gr.race_id = rr.race_id AND gr.bib_number = rr.bib_number
        LEFT JOIN LATERAL (
          SELECT rp.* FROM public.runner_positions rp
          WHERE rp.registration_id = rr.id
          ORDER BY rp.recorded_at DESC LIMIT 1
        ) lp ON true`);

        // 6) Lock down SECURITY DEFINER helper functions
        await tx.unsafe(`REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC`);
        await tx.unsafe(`REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon`);
        await tx.unsafe(`REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM authenticated`);
        await tx.unsafe(`REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC`);
        await tx.unsafe(`REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon`);
        await tx.unsafe(`REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated`);
        await tx.unsafe(`REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC`);
        await tx.unsafe(`REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon`);
        await tx.unsafe(`REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM authenticated`);

        // 7) Storage policies for event-posters
        await tx.unsafe(`DROP POLICY IF EXISTS "Event posters readable by everyone" ON storage.objects`);
        await tx.unsafe(`CREATE POLICY "Event posters readable by everyone" ON storage.objects FOR SELECT USING (bucket_id = 'event-posters')`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Organizers upload event posters" ON storage.objects`);
        await tx.unsafe(`CREATE POLICY "Organizers upload event posters" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'event-posters' AND public.has_role(auth.uid(), 'organizer'::public.app_role) AND (storage.foldername(name))[1] = auth.uid()::text)`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Organizers update their event posters" ON storage.objects`);
        await tx.unsafe(`CREATE POLICY "Organizers update their event posters" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'event-posters' AND (storage.foldername(name))[1] = auth.uid()::text)`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Organizers delete their event posters" ON storage.objects`);
        await tx.unsafe(`CREATE POLICY "Organizers delete their event posters" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'event-posters' AND (storage.foldername(name))[1] = auth.uid()::text)`);

        // 8) Storage write policies for checkpoint-photos bucket
        await tx.unsafe(`DROP POLICY IF EXISTS "Checkpoint photos insert by race organizer" ON storage.objects`);
        await tx.unsafe(`CREATE POLICY "Checkpoint photos insert by race organizer" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
          bucket_id = 'checkpoint-photos' AND (
            public.has_role(auth.uid(), 'admin'::public.app_role)
            OR EXISTS (
              SELECT 1 FROM public.race_checkpoints c
              JOIN public.races r ON r.id = c.race_id
              WHERE c.id::text = (storage.foldername(name))[1]
                AND (r.organizer_id = auth.uid() OR public.is_race_admin(r.id, auth.uid()))
            )
            OR EXISTS (
              SELECT 1 FROM public.races r
              WHERE r.id::text = (storage.foldername(name))[1]
                AND (r.organizer_id = auth.uid() OR public.is_race_admin(r.id, auth.uid()))
            )
          )
        )`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Checkpoint photos update by race organizer" ON storage.objects`);
        await tx.unsafe(`CREATE POLICY "Checkpoint photos update by race organizer" ON storage.objects FOR UPDATE TO authenticated USING (
          bucket_id = 'checkpoint-photos' AND (
            public.has_role(auth.uid(), 'admin'::public.app_role)
            OR EXISTS (
              SELECT 1 FROM public.race_checkpoints c
              JOIN public.races r ON r.id = c.race_id
              WHERE c.id::text = (storage.foldername(name))[1]
                AND (r.organizer_id = auth.uid() OR public.is_race_admin(r.id, auth.uid()))
            )
            OR EXISTS (
              SELECT 1 FROM public.races r
              WHERE r.id::text = (storage.foldername(name))[1]
                AND (r.organizer_id = auth.uid() OR public.is_race_admin(r.id, auth.uid()))
            )
          )
        )`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Checkpoint photos delete by race organizer" ON storage.objects`);
        await tx.unsafe(`CREATE POLICY "Checkpoint photos delete by race organizer" ON storage.objects FOR DELETE TO authenticated USING (
          bucket_id = 'checkpoint-photos' AND (
            public.has_role(auth.uid(), 'admin'::public.app_role)
            OR EXISTS (
              SELECT 1 FROM public.race_checkpoints c
              JOIN public.races r ON r.id = c.race_id
              WHERE c.id::text = (storage.foldername(name))[1]
                AND (r.organizer_id = auth.uid() OR public.is_race_admin(r.id, auth.uid()))
            )
            OR EXISTS (
              SELECT 1 FROM public.races r
              WHERE r.id::text = (storage.foldername(name))[1]
                AND (r.organizer_id = auth.uid() OR public.is_race_admin(r.id, auth.uid()))
            )
          )
        )`);

        // 9) Prevent public bucket listing — drop broad SELECT policies (direct public URLs still work via CDN)
        await tx.unsafe(`DROP POLICY IF EXISTS "Event posters readable by everyone" ON storage.objects`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Checkpoint photos readable by everyone" ON storage.objects`);
        await tx.unsafe(`DROP POLICY IF EXISTS "GPX files readable by everyone" ON storage.objects`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Public read access" ON storage.objects`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Anyone can view checkpoint photos" ON storage.objects`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Anyone can view gpx files" ON storage.objects`);

        // 10) Lock down is_race_admin SECURITY DEFINER helper from anon/public
        await tx.unsafe(`REVOKE EXECUTE ON FUNCTION public.is_race_admin(uuid, uuid) FROM PUBLIC`);
        await tx.unsafe(`REVOKE EXECUTE ON FUNCTION public.is_race_admin(uuid, uuid) FROM anon`);

        // 11) Remove gmcap_results from Realtime publication (prevents broadcasting phone/birth_date)
        await tx.unsafe(`DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'gmcap_results'
          ) THEN
            EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.gmcap_results';
          END IF;
        END $$`);

        // 12) Ensure events table no longer exposes contact_email/contact_phone columns to anon
        await tx.unsafe(`REVOKE SELECT ON public.events FROM anon`);
        await tx.unsafe(`GRANT SELECT (id, name, description, location, start_date, end_date, organizer_id, poster_url, website_url, facebook_url, instagram_url, twitter_url, created_at, updated_at) ON public.events TO anon`);
        await tx.unsafe(`GRANT SELECT ON public.events TO authenticated`);

        await tx.unsafe(`NOTIFY pgrst, 'reload schema'`);
      });
    } finally {
      await sql.end({ timeout: 5 });
    }

    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'unknown_error' }, 500);
  }
});
