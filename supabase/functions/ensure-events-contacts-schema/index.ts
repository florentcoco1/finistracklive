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
    const canManage = (roles ?? []).some((r: { role: string }) => r.role === 'organizer' || r.role === 'admin');
    if (!canManage) return json({ error: 'forbidden' }, 403);

    const sql = postgres(dbUrl, { max: 1, prepare: false });
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(`CREATE TABLE IF NOT EXISTS public.events_contacts (
          event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
          contact_email text,
          contact_phone text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`);
        await tx.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.events_contacts TO authenticated`);
        await tx.unsafe(`GRANT ALL ON public.events_contacts TO service_role`);
        await tx.unsafe(`ALTER TABLE public.events_contacts ENABLE ROW LEVEL SECURITY`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Event contacts readable by owner or admin" ON public.events_contacts`);
        await tx.unsafe(`CREATE POLICY "Event contacts readable by owner or admin" ON public.events_contacts FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR EXISTS (SELECT 1 FROM public.events e WHERE e.id = events_contacts.event_id AND e.organizer_id = auth.uid()))`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Event contacts writable by owner or admin" ON public.events_contacts`);
        await tx.unsafe(`CREATE POLICY "Event contacts writable by owner or admin" ON public.events_contacts FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR EXISTS (SELECT 1 FROM public.events e WHERE e.id = events_contacts.event_id AND e.organizer_id = auth.uid())) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) OR EXISTS (SELECT 1 FROM public.events e WHERE e.id = events_contacts.event_id AND e.organizer_id = auth.uid()))`);
        await tx.unsafe(`DROP TRIGGER IF EXISTS update_events_contacts_updated_at ON public.events_contacts`);
        await tx.unsafe(`CREATE TRIGGER update_events_contacts_updated_at BEFORE UPDATE ON public.events_contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()`);
        await tx.unsafe(`GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon`);
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
