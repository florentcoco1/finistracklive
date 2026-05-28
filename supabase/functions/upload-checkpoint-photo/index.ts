import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BUCKET = 'checkpoint-photos';

async function ensureBucket(admin: ReturnType<typeof createClient>) {
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

    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: 'unauthenticated' }, 401);

    const admin = createClient(url, service);
    await ensureBucket(admin);

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
