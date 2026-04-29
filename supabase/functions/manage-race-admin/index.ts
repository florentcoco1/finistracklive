import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.25.76";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const uuid = z.string().uuid();
const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("load"), race_id: uuid }),
  z.object({ action: z.literal("save_gmcap"), race_id: uuid, source_url: z.string().url().max(1000), enabled: z.boolean() }),
  z.object({ action: z.literal("sync_gmcap"), race_id: uuid }),
  z.object({
    action: z.literal("update_registration"),
    race_id: uuid,
    registration_id: uuid,
    bib_number: z.string().trim().min(1).max(40),
    category: z.string().trim().max(80).nullable(),
    emergency_phone: z.string().trim().max(40).nullable(),
    rfid_identifier: z.string().trim().max(120).nullable(),
  }),
  z.object({ action: z.literal("delete_registration"), race_id: uuid, registration_id: uuid }),
  z.object({
    action: z.literal("add_registration"),
    race_id: uuid,
    email: z.string().trim().email().max(255),
    bib_number: z.string().trim().min(1).max(40),
    category: z.string().trim().max(80).nullable(),
    emergency_phone: z.string().trim().max(40).nullable(),
  }),
  z.object({ action: z.literal("add_organizer"), race_id: uuid, email: z.string().trim().email().max(255) }),
  z.object({ action: z.literal("remove_organizer"), race_id: uuid, organizer_id: uuid }),
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function requireRaceAdmin(admin: ReturnType<typeof createClient>, userId: string, raceId: string) {
  const { data, error } = await admin.rpc("is_race_admin", { _race_id: raceId, _user_id: userId });
  if (error || !data) throw new Error("Administration réservée aux organisateurs de cette course");
}

async function loadRace(admin: ReturnType<typeof createClient>, raceId: string) {
  const [{ data: source }, { data: registrations }, { data: organizers }, { data: race }] = await Promise.all([
    admin.from("gmcap_import_sources").select("id, source_url, enabled, last_import_at, last_import_status, last_import_message").eq("race_id", raceId).maybeSingle(),
    admin.from("race_registrations").select("id, runner_id, bib_number, category, emergency_phone, runner_status, rfid_identifier, rfid_matched_at, rfid_source, created_at").eq("race_id", raceId).order("bib_number"),
    admin.from("race_organizers").select("id, user_id, role, created_at").eq("race_id", raceId).order("created_at"),
    admin.from("races").select("id, name, organizer_id").eq("id", raceId).single(),
  ]);

  const profileIds = [
    ...new Set([
      race?.organizer_id,
      ...((registrations ?? []).map((r: any) => r.runner_id)),
      ...((organizers ?? []).map((o: any) => o.user_id)),
    ].filter(Boolean)),
  ];
  const { data: profiles } = profileIds.length
    ? await admin.from("profiles").select("user_id, email, first_name, last_name, phone").in("user_id", profileIds)
    : { data: [] as any[] };
  const profileById = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));

  return {
    source,
    registrations: (registrations ?? []).map((r: any) => ({ ...r, profile: profileById.get(r.runner_id) ?? null })),
    organizers: [
      race?.organizer_id && { id: "owner", user_id: race.organizer_id, role: "propriétaire", created_at: null, profile: profileById.get(race.organizer_id) ?? null },
      ...((organizers ?? []).map((o: any) => ({ ...o, profile: profileById.get(o.user_id) ?? null }))),
    ].filter(Boolean),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Connexion requise" }, 401);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: "Données invalides", details: parsed.error.flatten().fieldErrors }, 400);
    const body = parsed.data;
    await requireRaceAdmin(admin, user.id, body.race_id);

    if (body.action === "load") return json(await loadRace(admin, body.race_id));

    if (body.action === "save_gmcap") {
      const { data: existing } = await admin.from("gmcap_import_sources").select("id").eq("race_id", body.race_id).maybeSingle();
      const payload = { race_id: body.race_id, source_url: body.source_url, enabled: body.enabled, updated_at: new Date().toISOString() };
      const result = existing
        ? await admin.from("gmcap_import_sources").update(payload).eq("id", existing.id)
        : await admin.from("gmcap_import_sources").insert(payload);
      if (result.error) throw new Error(result.error.message);
      return json({ ok: true, ...(await loadRace(admin, body.race_id)) });
    }

    if (body.action === "sync_gmcap") {
      return json({ ok: true, message: "La synchronisation se lance depuis l’interface course avec le moteur GMCAP existant." });
    }

    if (body.action === "update_registration") {
      const { error } = await admin.from("race_registrations").update({
        bib_number: body.bib_number,
        category: body.category || null,
        emergency_phone: body.emergency_phone || null,
        rfid_identifier: body.rfid_identifier || null,
        rfid_source: body.rfid_identifier ? "GMCAP" : null,
        rfid_matched_at: body.rfid_identifier ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq("id", body.registration_id).eq("race_id", body.race_id);
      if (error) throw new Error(error.message);
      return json({ ok: true, ...(await loadRace(admin, body.race_id)) });
    }

    if (body.action === "delete_registration") {
      const { error } = await admin.from("race_registrations").delete().eq("id", body.registration_id).eq("race_id", body.race_id);
      if (error) throw new Error(error.message);
      return json({ ok: true, ...(await loadRace(admin, body.race_id)) });
    }

    if (body.action === "add_registration") {
      const { data: profile } = await admin.from("profiles").select("user_id").ilike("email", body.email).maybeSingle();
      if (!profile?.user_id) return json({ error: "Aucun utilisateur trouvé avec cet email" }, 404);
      const { error } = await admin.from("race_registrations").upsert({
        race_id: body.race_id,
        runner_id: profile.user_id,
        bib_number: body.bib_number,
        category: body.category || null,
        emergency_phone: body.emergency_phone || null,
      }, { onConflict: "race_id,runner_id" });
      if (error) throw new Error(error.message);
      return json({ ok: true, ...(await loadRace(admin, body.race_id)) });
    }

    if (body.action === "add_organizer") {
      const { data: profile } = await admin.from("profiles").select("user_id").ilike("email", body.email).maybeSingle();
      if (!profile?.user_id) return json({ error: "Aucun utilisateur trouvé avec cet email" }, 404);
      const [{ error: organizerError }, { error: roleError }] = await Promise.all([
        admin.from("race_organizers").upsert({ race_id: body.race_id, user_id: profile.user_id, created_by: user.id }, { onConflict: "race_id,user_id" }),
        admin.from("user_roles").upsert({ user_id: profile.user_id, role: "organizer" }, { onConflict: "user_id,role" }),
      ]);
      if (organizerError || roleError) throw new Error(organizerError?.message ?? roleError?.message);
      return json({ ok: true, ...(await loadRace(admin, body.race_id)) });
    }

    if (body.action === "remove_organizer") {
      const { data: race } = await admin.from("races").select("organizer_id").eq("id", body.race_id).single();
      if (race?.organizer_id === body.organizer_id) return json({ error: "Le propriétaire de la course ne peut pas être retiré" }, 400);
      const { error } = await admin.from("race_organizers").delete().eq("race_id", body.race_id).eq("user_id", body.organizer_id);
      if (error) throw new Error(error.message);
      return json({ ok: true, ...(await loadRace(admin, body.race_id)) });
    }

    return json({ error: "Action inconnue" }, 400);
  } catch (error) {
    return json({ error: (error as Error).message || "Erreur administration" }, 500);
  }
});
