import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BUCKET = 'event-posters';

async function ensureBucket(admin: ReturnType<typeof createClient>) {
  const { data: existing } = await admin.storage.getBucket(BUCKET);
  if (!existing) {
    const { error } = await admin.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    });
    if (error && !String(error.message).toLowerCase().includes('already')) throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: roles } = await userClient.from('user_roles').select('role').eq('user_id', userData.user.id);
    const isOrganizer = (roles ?? []).some((r: { role: string }) => r.role === 'organizer' || r.role === 'admin');
    if (!isOrganizer) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const admin = createClient(url, service);
    await ensureBucket(admin);

    const ct = req.headers.get('content-type') ?? '';
    if (!ct.includes('multipart/form-data')) {
      // Just ensure bucket
      return new Response(JSON.stringify({ ok: true, bucket: BUCKET }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return new Response(JSON.stringify({ error: 'file_required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (file.size > 10 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'file_too_large' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const safeName = file.name.replace(/[^a-z0-9.-]/gi, '_');
    const path = `${userData.user.id}/${Date.now()}-${safeName}`;
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
    return new Response(JSON.stringify({ ok: true, path, public_url: pub.publicUrl }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
