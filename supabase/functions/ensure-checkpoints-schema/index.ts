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

    const { data: roles, error: rolesError } = await userClient
      .from('user_roles')
      .select('role')
      .eq('user_id', userData.user.id);
    if (rolesError) return json({ error: rolesError.message }, 500);

    const canManage = (roles ?? []).some((r: { role: string }) => r.role === 'organizer' || r.role === 'admin');
    if (!canManage) return json({ error: 'forbidden' }, 403);

    const sql = postgres(dbUrl, { max: 1, prepare: false });
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(`
          CREATE TABLE IF NOT EXISTS public.race_checkpoints (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            race_id uuid NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
            name text NOT NULL,
            distance_km numeric,
            source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','gmcap')),
            position integer NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
          )
        `);
        await tx.unsafe(`ALTER TABLE public.race_checkpoints ADD COLUMN IF NOT EXISTS live_video_url text`);
        await tx.unsafe(`ALTER TABLE public.gmcap_results ADD COLUMN IF NOT EXISTS rgpd_consent text DEFAULT 'O'`);
        await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_race_checkpoints_race_id ON public.race_checkpoints(race_id)`);
        await tx.unsafe(`ALTER TABLE public.race_checkpoints ENABLE ROW LEVEL SECURITY`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Checkpoints viewable by everyone" ON public.race_checkpoints`);
        await tx.unsafe(`CREATE POLICY "Checkpoints viewable by everyone" ON public.race_checkpoints FOR SELECT USING (true)`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Organizers manage their race checkpoints" ON public.race_checkpoints`);
        await tx.unsafe(`CREATE POLICY "Organizers manage their race checkpoints" ON public.race_checkpoints FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.races r WHERE r.id = race_checkpoints.race_id AND r.organizer_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.races r WHERE r.id = race_checkpoints.race_id AND r.organizer_id = auth.uid()))`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Admins manage all checkpoints" ON public.race_checkpoints`);
        await tx.unsafe(`CREATE POLICY "Admins manage all checkpoints" ON public.race_checkpoints FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role))`);
        await tx.unsafe(`DROP TRIGGER IF EXISTS update_race_checkpoints_updated_at ON public.race_checkpoints`);
        await tx.unsafe(`CREATE TRIGGER update_race_checkpoints_updated_at BEFORE UPDATE ON public.race_checkpoints FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()`);

        await tx.unsafe(`
          CREATE TABLE IF NOT EXISTS public.runner_checkpoint_times (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            checkpoint_id uuid NOT NULL REFERENCES public.race_checkpoints(id) ON DELETE CASCADE,
            registration_id uuid NOT NULL REFERENCES public.race_registrations(id) ON DELETE CASCADE,
            time_seconds integer,
            time_text text,
            recorded_at timestamptz NOT NULL DEFAULT now(),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (checkpoint_id, registration_id)
          )
        `);
        await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_runner_checkpoint_times_checkpoint ON public.runner_checkpoint_times(checkpoint_id)`);
        await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_runner_checkpoint_times_registration ON public.runner_checkpoint_times(registration_id)`);
        await tx.unsafe(`ALTER TABLE public.runner_checkpoint_times ENABLE ROW LEVEL SECURITY`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Checkpoint times viewable by everyone" ON public.runner_checkpoint_times`);
        await tx.unsafe(`CREATE POLICY "Checkpoint times viewable by everyone" ON public.runner_checkpoint_times FOR SELECT USING (true)`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Organizers manage their checkpoint times" ON public.runner_checkpoint_times`);
        await tx.unsafe(`CREATE POLICY "Organizers manage their checkpoint times" ON public.runner_checkpoint_times FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.race_checkpoints c JOIN public.races r ON r.id = c.race_id WHERE c.id = runner_checkpoint_times.checkpoint_id AND r.organizer_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.race_checkpoints c JOIN public.races r ON r.id = c.race_id WHERE c.id = runner_checkpoint_times.checkpoint_id AND r.organizer_id = auth.uid()))`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Admins manage all checkpoint times" ON public.runner_checkpoint_times`);
        await tx.unsafe(`CREATE POLICY "Admins manage all checkpoint times" ON public.runner_checkpoint_times FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role))`);
        await tx.unsafe(`DROP TRIGGER IF EXISTS update_runner_checkpoint_times_updated_at ON public.runner_checkpoint_times`);
        await tx.unsafe(`CREATE TRIGGER update_runner_checkpoint_times_updated_at BEFORE UPDATE ON public.runner_checkpoint_times FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()`);

        await tx.unsafe(`
          CREATE TABLE IF NOT EXISTS public.checkpoint_photos (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            race_id uuid NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
            checkpoint_id uuid REFERENCES public.race_checkpoints(id) ON DELETE SET NULL,
            uploaded_by uuid NOT NULL,
            storage_path text NOT NULL,
            caption text,
            created_at timestamptz NOT NULL DEFAULT now()
          )
        `);
        await tx.unsafe(`GRANT SELECT ON public.checkpoint_photos TO anon`);
        await tx.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkpoint_photos TO authenticated`);
        await tx.unsafe(`GRANT ALL ON public.checkpoint_photos TO service_role`);
        await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_checkpoint_photos_race ON public.checkpoint_photos(race_id)`);
        await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_checkpoint_photos_checkpoint ON public.checkpoint_photos(checkpoint_id)`);
        await tx.unsafe(`ALTER TABLE public.checkpoint_photos ENABLE ROW LEVEL SECURITY`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Photos viewable by everyone" ON public.checkpoint_photos`);
        await tx.unsafe(`CREATE POLICY "Photos viewable by everyone" ON public.checkpoint_photos FOR SELECT USING (true)`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Organizers manage their race photos" ON public.checkpoint_photos`);
        await tx.unsafe(`CREATE POLICY "Organizers manage their race photos" ON public.checkpoint_photos FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.races r WHERE r.id = checkpoint_photos.race_id AND r.organizer_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.races r WHERE r.id = checkpoint_photos.race_id AND r.organizer_id = auth.uid()))`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Admins manage all photos" ON public.checkpoint_photos`);
        await tx.unsafe(`CREATE POLICY "Admins manage all photos" ON public.checkpoint_photos FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role))`);

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
