import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ParsedRow = Record<string, string>;

const clean = (value: unknown) => String(value ?? "").trim();
const decimal = (value: unknown) => {
  const n = Number(clean(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const integer = (value: unknown) => {
  const n = Number.parseInt(clean(value), 10);
  return Number.isFinite(n) ? n : null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function isMissingSchemaError(message: string) {
  return message.includes("schema cache") || message.includes("rfid_timing_results") || message.includes("rfid_identifier");
}

function parseTsv(content: string): ParsedRow[] {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t").map(clean);
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(headers.map((header, index) => [header, clean(cells[index])]));
  });
}

function extractSplits(row: ParsedRow) {
  const splits: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (/^(NbPassage |\d+\||Clt )/.test(key) && value) splits[key] = value;
  }
  return splits;
}

async function isRaceAdmin(admin: ReturnType<typeof createClient>, raceId: string, userId: string) {
  const { data, error } = await admin.rpc("is_race_admin", { _race_id: raceId, _user_id: userId });
  if (!error && data) return true;

  const { data: race } = await admin
    .from("races")
    .select("organizer_id")
    .eq("id", raceId)
    .single();

  return race?.organizer_id === userId;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return json({ error: "Non autorisé" }, 401);
    }

    const { race_id, content } = await req.json();
    if (typeof race_id !== "string" || typeof content !== "string" || content.length < 10) {
      return json({ error: "Fichier GMCAP invalide" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    if (!(await isRaceAdmin(admin, race_id, user.id))) {
      return json({ error: "Import réservé aux organisateurs de cette course" }, 403);
    }

    const rows = parseTsv(content);
    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: "Aucune ligne exploitable dans l'export GMCAP" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: registrations } = await admin
      .from("race_registrations")
      .select("id, bib_number")
      .eq("race_id", race_id);

    const byBib = new Map((registrations ?? []).map((reg: any) => [clean(reg.bib_number), reg.id]));
    const updates = [];
    const results = [];
    let matched = 0;

    for (const row of rows) {
      const bib = clean(row["Numéro"] || row["Numero"]);
      const rfid = clean(row.ID || row["Id"] || row["Identifiant"] || bib);
      if (!rfid) continue;

      const registrationId = byBib.get(bib) ?? null;
      if (registrationId) {
        matched += 1;
        updates.push(
          admin
            .from("race_registrations")
            .update({ rfid_identifier: rfid, rfid_matched_at: new Date().toISOString(), rfid_source: "GMCAP" })
            .eq("id", registrationId),
        );
      }

      const abandoned = clean(row["Abandon"]).toUpperCase() === "O";
      const disqualified = clean(row["Disqualifié"] || row["Disqualifie"]).toUpperCase() === "O";
      const started = clean(row["Pris Départ"] || row["Pris Depart"]).toUpperCase() === "O";
      const status = disqualified ? "disqualified" : abandoned ? "dnf" : started ? "classified" : "not_started";

      results.push({
        race_id,
        registration_id: registrationId,
        rfid_identifier: rfid,
        bib_number: bib || null,
        first_name: clean(row["Prénom"] || row["Prenom"]) || null,
        last_name: clean(row["Nom"]) || null,
        category: clean(row["Abbrev. Catégorie"] || row["Abbrev. Categorie"] || row["Catégorie"] || row["Categorie"]) || null,
        club: clean(row["Club"]) || null,
        status,
        official_time: clean(row["Temps"]) || null,
        official_seconds: decimal(row["Nb.Secondes"]),
        rounded_time: clean(row["Temps Arrondi"]) || null,
        rounded_seconds: decimal(row["Nb.Secondes Arrondi"]),
        overall_rank: integer(row["Classement"]),
        category_rank: integer(row["Classement par Cat."]),
        gender_rank: integer(row["Classement par Sexe"]),
        split_payload: extractSplits(row),
        raw_payload: row,
        imported_at: new Date().toISOString(),
      });
    }

    const updateResults = await Promise.all(updates);
    const missingRegistrationSchema = updateResults.find((result) => result.error && isMissingSchemaError(result.error.message));
    if (missingRegistrationSchema?.error) {
      return json({
        error: "Le schéma RFID n’est pas encore initialisé dans Lovable Cloud. La migration de réparation a été ajoutée ; relance l’import quand elle sera appliquée.",
        code: "RFID_SCHEMA_MISSING",
      }, 503);
    }
    const updateError = updateResults.find((result) => result.error)?.error;
    if (updateError) return json({ error: updateError.message }, 500);

    const { error: upsertError } = await admin
      .from("rfid_timing_results")
      .upsert(results, { onConflict: "race_id,rfid_identifier" });

    if (upsertError) {
      if (isMissingSchemaError(upsertError.message)) {
        return json({
          error: "Le schéma RFID n’est pas encore initialisé dans Lovable Cloud. La migration de réparation a été ajoutée ; relance l’import quand elle sera appliquée.",
          code: "RFID_SCHEMA_MISSING",
        }, 503);
      }
      return json({ error: upsertError.message }, 500);
    }

    return json({ ok: true, imported: results.length, matched, unmatched: results.length - matched });
  } catch (error) {
    return json({ error: (error as Error).message ?? "Erreur import GMCAP" }, 500);
  }
});
