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
    const canRun = (roles ?? []).some((r: { role: string }) => r.role === 'admin' || r.role === 'organizer');
    if (!canRun) return json({ error: 'forbidden' }, 403);

    const sql = postgres(dbUrl, { max: 1, prepare: false });
    try {
      await sql.begin(async (tx) => {
        // 1) profiles: hide email/phone/birth_date from anon
        await tx.unsafe(`REVOKE SELECT ON public.profiles FROM anon`);
        await tx.unsafe(`GRANT SELECT (id, user_id, first_name, last_name, created_at, updated_at) ON public.profiles TO anon`);
        await tx.unsafe(`GRANT SELECT ON public.profiles TO authenticated`);

        // 2) gmcap_results: hide phone from anon
        await tx.unsafe(`REVOKE SELECT ON public.gmcap_results FROM anon`);
        await tx.unsafe(`GRANT SELECT (id, race_id, bib_number, first_name, last_name, gender, birth_date, category, club, scratch_rank, category_rank, gender_rank, official_time_text, official_time_seconds, split_payload, status, imported_at, created_at, updated_at, rgpd_consent) ON public.gmcap_results TO anon`);
        await tx.unsafe(`GRANT SELECT ON public.gmcap_results TO authenticated`);

        // 3) race_registrations: hide emergency_phone/dnf_reason/problem_description from anon
        await tx.unsafe(`REVOKE SELECT ON public.race_registrations FROM anon`);
        await tx.unsafe(`GRANT SELECT (id, race_id, runner_id, bib_number, category, tracking_active, started_at, finished_at, created_at, updated_at, runner_status) ON public.race_registrations TO anon`);
        await tx.unsafe(`GRANT SELECT ON public.race_registrations TO authenticated`);

        // 4) user_roles: prevent self-grant of organizer role
        await tx.unsafe(`DROP POLICY IF EXISTS "Users can add organizer role to themselves" ON public.user_roles`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Admins manage user roles" ON public.user_roles`);
        await tx.unsafe(`CREATE POLICY "Admins manage user roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role))`);

        // 5) Storage policies for event-posters bucket
        await tx.unsafe(`DROP POLICY IF EXISTS "Event posters readable by everyone" ON storage.objects`);
        await tx.unsafe(`CREATE POLICY "Event posters readable by everyone" ON storage.objects FOR SELECT USING (bucket_id = 'event-posters')`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Organizers upload event posters" ON storage.objects`);
        await tx.unsafe(`CREATE POLICY "Organizers upload event posters" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'event-posters' AND public.has_role(auth.uid(), 'organizer'::public.app_role) AND (storage.foldername(name))[1] = auth.uid()::text)`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Organizers update their event posters" ON storage.objects`);
        await tx.unsafe(`CREATE POLICY "Organizers update their event posters" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'event-posters' AND (storage.foldername(name))[1] = auth.uid()::text)`);
        await tx.unsafe(`DROP POLICY IF EXISTS "Organizers delete their event posters" ON storage.objects`);
        await tx.unsafe(`CREATE POLICY "Organizers delete their event posters" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'event-posters' AND (storage.foldername(name))[1] = auth.uid()::text)`);

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
