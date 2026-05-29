import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import postgres from 'npm:postgres@3.4.5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BUCKET = 'checkpoint-photos';

async function ensureBucket(admin: any) {
  const { data: existing } = await admin.storage.getBucket(BUCKET);
  if (!existing) {
    const { error } = await admin.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'],
    });
    if (error && !String(error.message).toLowerCase().includes('already')) throw error;
  }
}

async function ensurePhotosSchema(dbUrl: string) {
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    await sql.begin(async (tx) => {
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
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'unauthenticated' }, 401);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const dbUrl = Deno.env.get('SUPABASE_DB_URL')!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: 'unauthenticated' }, 401);

    const admin = createClient(url, service);
    await ensureBucket(admin);
    await ensurePhotosSchema(dbUrl);

    const ct = req.headers.get('content-type') ?? '';
    if (!ct.includes('multipart/form-data')) {
      return json({ ok: true, bucket: BUCKET });
    }

    const form = await req.formData();
    const file = form.get('file');
    const raceId = String(form.get('race_id') ?? '');
    const checkpointId = String(form.get('checkpoint_id') ?? '');
    const registrationId = String(form.get('registration_id') ?? '');
    const caption = String(form.get('caption') ?? '').trim();
    if (!(file instanceof File)) return json({ error: 'file_required' }, 400);
    if (!raceId && !checkpointId) return json({ error: 'missing_race' }, 400);
    if (file.size > 10 * 1024 * 1024) return json({ error: 'file_too_large' }, 400);

    // Verify organizer owns the race. Checkpoint uploads can infer the race from the checkpoint.
    let targetRaceId = raceId;
    if (checkpointId) {
      const { data: cp } = await admin.from('race_checkpoints').select('race_id').eq('id', checkpointId).maybeSingle();
      if (!cp) return json({ error: 'checkpoint_not_found' }, 404);
      if (targetRaceId && targetRaceId !== cp.race_id) return json({ error: 'checkpoint_race_mismatch' }, 400);
      targetRaceId = cp.race_id;
    }
    const { data: race } = await admin.from('races').select('organizer_id').eq('id', targetRaceId).maybeSingle();
    if (!race) return json({ error: 'race_not_found' }, 404);

    const { data: roles } = await userClient.from('user_roles').select('role').eq('user_id', userData.user.id);
    const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === 'admin');
    if (race.organizer_id !== userData.user.id && !isAdmin) return json({ error: 'forbidden' }, 403);

    const ext = (file.name.split('.').pop() ?? 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
    const path = registrationId && checkpointId
      ? `${checkpointId}/${registrationId}/${Date.now()}-${crypto.randomUUID()}.${ext}`
      : `${targetRaceId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) return json({ error: upErr.message }, 500);
    if (!registrationId) {
      const { error: dbErr } = await admin.from('checkpoint_photos').insert({
        race_id: targetRaceId,
        checkpoint_id: checkpointId || null,
        uploaded_by: userData.user.id,
        storage_path: path,
        caption: caption || null,
      });
      if (dbErr) {
        await admin.storage.from(BUCKET).remove([path]);
        return json({ error: dbErr.message }, 500);
      }
    }
    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
    return json({ ok: true, path, public_url: pub.publicUrl });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
