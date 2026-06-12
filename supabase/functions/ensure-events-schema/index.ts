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
          CREATE TABLE IF NOT EXISTS public.events (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organizer_id uuid NOT NULL,
            name text NOT NULL,
            description text,
            location text,
            start_date date,
            end_date date,
            website_url text,
            contact_email text,
            contact_phone text,
            facebook_url text,
            instagram_url text,
            twitter_url text,
            poster_url text,
            created_at timestamp with time zone NOT NULL DEFAULT now(),
            updated_at timestamp with time zone NOT NULL DEFAULT now()
          )
        `);
        await tx.unsafe(`ALTER TABLE public.events ENABLE ROW LEVEL SECURITY`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Events are viewable by everyone" ON public.events`);
        await tx.unsafe(`CREATE POLICY "Events are viewable by everyone" ON public.events FOR SELECT USING (true)`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Organizers can create events" ON public.events`);
        await tx.unsafe(`CREATE POLICY "Organizers can create events" ON public.events FOR INSERT WITH CHECK (auth.uid() = organizer_id AND public.has_role(auth.uid(), 'organizer'::public.app_role))`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Organizers can update their own events" ON public.events`);
        await tx.unsafe(`CREATE POLICY "Organizers can update their own events" ON public.events FOR UPDATE USING (auth.uid() = organizer_id AND public.has_role(auth.uid(), 'organizer'::public.app_role)) WITH CHECK (auth.uid() = organizer_id AND public.has_role(auth.uid(), 'organizer'::public.app_role))`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Organizers can delete their own events" ON public.events`);
        await tx.unsafe(`CREATE POLICY "Organizers can delete their own events" ON public.events FOR DELETE USING (auth.uid() = organizer_id AND public.has_role(auth.uid(), 'organizer'::public.app_role))`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Admins manage all events" ON public.events`);
        await tx.unsafe(`CREATE POLICY "Admins manage all events" ON public.events FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role))`);
        await tx.unsafe(`DROP TRIGGER IF EXISTS update_events_updated_at ON public.events`);
        await tx.unsafe(`CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()`);
        await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_events_organizer_id ON public.events(organizer_id)`);
        await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_events_start_date ON public.events(start_date DESC)`);
        await tx.unsafe(`ALTER TABLE public.races ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE SET NULL`);
        await tx.unsafe(`CREATE INDEX IF NOT EXISTS idx_races_event_id ON public.races(event_id)`);
        await tx.unsafe(`ALTER TABLE public.races ADD COLUMN IF NOT EXISTS difficulty_level integer NOT NULL DEFAULT 1`);
        await tx.unsafe(`ALTER TABLE public.races DROP CONSTRAINT IF EXISTS races_difficulty_level_range`);
        await tx.unsafe(`ALTER TABLE public.races ADD CONSTRAINT races_difficulty_level_range CHECK (difficulty_level BETWEEN 1 AND 5)`);
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
