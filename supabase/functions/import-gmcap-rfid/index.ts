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

async function markImportSuccess(admin: ReturnType<typeof createClient>, raceId: string, fileName: string | null, imported: number, matched: number) {
  const now = new Date().toISOString();
  const safeName = clean(fileName) || `gmcap-import-${now}.txt`;
  await admin.from("gmcap_import_sources").upsert({
    race_id: raceId,
    source_url: `manual://${encodeURIComponent(safeName)}`,
    source_type: "manual_file",
    file_name: safeName,
    pending_content: null,
    pending_import_at: null,
    schema_checked_at: now,
    enabled: true,
    last_import_at: now,
    last_import_status: "success",
    last_import_message: `${matched} correspondance(s), ${imported - matched} non associée(s) depuis ${safeName}`,
    updated_at: now,
  }, { onConflict: "race_id" });
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

    const { race_id, content, file_name } = await req.json();
    if (typeof race_id !== "string" || typeof content !== "string" || content.length < 10) {
      return json({ error: "Fichier GMCAP invalide" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    if (!(await isRaceAdmin(admin, race_id, user.id))) {
      return json({ error: "Import réservé aux organisateurs de cette course" }, 403);
    }

    const rows = parseTsv(content);
    if (rows.length === 0) {
      return json({ error: "Aucune ligne exploitable dans l'export GMCAP" }, 400);
    }

    const { data: registrations } = await admin
      .from("race_registrations")
      .select("id, bib_number")
      .eq("race_id", race_id);

    const byBib = new Map((registrations ?? []).map((reg: any) => [clean(reg.bib_number), reg.id]));
    const results: any[] = [];
    let matched = 0;

    for (const row of rows) {
      const bib = clean(row["Numéro"] || row["Numero"]);
      if (!bib) continue;

      const registrationId = byBib.get(bib) ?? null;
      if (registrationId) matched += 1;

      const abandoned = clean(row["Abandon"]).toUpperCase() === "O";
      const disqualified = clean(row["Disqualifié"] || row["Disqualifie"]).toUpperCase() === "O";
      const started = clean(row["Pris Départ"] || row["Pris Depart"]).toUpperCase() === "O";
      const status = disqualified ? "disqualified" : abandoned ? "dnf" : started ? "classified" : "not_started";

      results.push({
        race_id,
        registration_id: registrationId,
        bib_number: bib,
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

    if (results.length === 0) {
      return json({ error: "Aucun dossard exploitable dans l'export GMCAP" }, 400);
    }

    const { error: upsertError } = await admin
      .from("gmcap_results")
      .upsert(results, { onConflict: "race_id,bib_number" });

    if (upsertError) {
      return json({ error: upsertError.message }, 500);
    }

    await markImportSuccess(admin, race_id, typeof file_name === "string" ? file_name : null, results.length, matched);
    return json({ ok: true, imported: results.length, matched, unmatched: results.length - matched });
  } catch (error) {
    return json({ error: (error as Error).message ?? "Erreur import GMCAP" }, 500);
  }
});
