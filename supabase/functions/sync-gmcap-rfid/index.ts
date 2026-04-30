import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ParsedRow = Record<string, string>;
type Source = {
  id: string;
  race_id: string;
  source_url: string;
  source_type: string | null;
  pending_content: string | null;
  enabled: boolean;
  last_import_at: string | null;
};
type Registration = { id: string; bib_number: string };

const clean = (value: unknown) => String(value ?? "").trim();
const decimal = (value: unknown) => {
  const n = Number(clean(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const integer = (value: unknown) => {
  const n = Number.parseInt(clean(value), 10);
  return Number.isFinite(n) ? n : null;
};

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

async function importContent(admin: ReturnType<typeof createClient>, raceId: string, content: string) {
  const rows = parseTsv(content);
  if (rows.length === 0) throw new Error("Aucune ligne exploitable dans l'export GMCAP");

  const { data: registrations } = await admin
    .from("race_registrations")
    .select("id, bib_number")
    .eq("race_id", raceId);

  const byBib = new Map(((registrations ?? []) as Registration[]).map((reg) => [clean(reg.bib_number), reg.id]));
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

    results.push({
      race_id: raceId,
      registration_id: registrationId,
      bib_number: bib,
      first_name: clean(row["Prénom"] || row["Prenom"]) || null,
      last_name: clean(row.Nom) || null,
      category: clean(row["Abbrev. Catégorie"] || row["Abbrev. Categorie"] || row["Catégorie"] || row["Categorie"]) || null,
      club: clean(row.Club) || null,
      status: disqualified ? "disqualified" : abandoned ? "dnf" : started ? "classified" : "not_started",
      official_time: clean(row.Temps) || null,
      official_seconds: decimal(row["Nb.Secondes"]),
      rounded_time: clean(row["Temps Arrondi"]) || null,
      rounded_seconds: decimal(row["Nb.Secondes Arrondi"]),
      overall_rank: integer(row.Classement),
      category_rank: integer(row["Classement par Cat."]),
      gender_rank: integer(row["Classement par Sexe"]),
      split_payload: extractSplits(row),
      raw_payload: row,
      imported_at: new Date().toISOString(),
    });
  }

  if (results.length === 0) throw new Error("Aucun dossard exploitable dans l'export GMCAP");

  const { error } = await admin
    .from("gmcap_results")
    .upsert(results, { onConflict: "race_id,bib_number" });
  if (error) throw new Error(error.message);

  return { imported: results.length, matched, unmatched: results.length - matched };
}

async function readSource(source: Source) {
  if (source.source_type === "manual_file") {
    if (!source.pending_content) throw new Error("Aucun contenu manuel GMCAP en attente");
    return source.pending_content;
  }
  const url = source.source_url;
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("La synchronisation cloud nécessite un lien HTTP/HTTPS vers l'export GMCAP");
  }
  const response = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
  if (!response.ok) throw new Error(`Lecture GMCAP impossible [${response.status}]`);
  const bytes = await response.arrayBuffer();
  return new TextDecoder("iso-8859-1").decode(bytes);
}

async function syncSource(admin: ReturnType<typeof createClient>, source: Source) {
  const content = await readSource(source);
  const result = await importContent(admin, source.race_id, content);
  await admin.from("gmcap_import_sources").update({
    last_import_at: new Date().toISOString(),
    last_import_status: "success",
    last_import_message: `${result.matched} correspondance(s), ${result.unmatched} non associée(s)`,
    pending_content: null,
    pending_import_at: null,
    schema_checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", source.id);
  return { race_id: source.race_id, ...result };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const raceId = typeof body?.race_id === "string" ? body.race_id : null;

    if (raceId) {
      const authHeader = req.headers.get("Authorization") ?? "";
      const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await userClient.auth.getUser();
      const { data: isAdmin, error: adminCheckError } = user
        ? await admin.rpc("is_race_admin", { _race_id: raceId, _user_id: user.id })
        : { data: false, error: null };
      const { data: race } = user && adminCheckError
        ? await admin.from("races").select("organizer_id").eq("id", raceId).single()
        : { data: null };
      if (!user || (!isAdmin && race?.organizer_id !== user.id)) {
        return new Response(JSON.stringify({ error: "Synchronisation réservée à l'organisateur" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const query = admin.from("gmcap_import_sources").select("id, race_id, source_url, source_type, pending_content, enabled, last_import_at, last_import_status").eq("enabled", true);
    const { data: sources, error } = raceId ? await query.eq("race_id", raceId) : await query;
    if (error) throw new Error(error.message);

    const due = (sources ?? []).filter((source: Source) => {
      if (raceId) return true;
      return !source.last_import_at || Date.now() - new Date(source.last_import_at).getTime() >= 55_000;
    });

    const synced = [];
    for (const source of due as Source[]) {
      try {
        synced.push(await syncSource(admin, source));
      } catch (error) {
        await admin.from("gmcap_import_sources").update({
          last_import_at: new Date().toISOString(),
          last_import_status: "error",
          last_import_message: (error as Error).message,
          updated_at: new Date().toISOString(),
        }).eq("id", source.id);
        synced.push({ race_id: source.race_id, error: (error as Error).message });
      }
    }

    return new Response(JSON.stringify({ ok: true, schema_ready: true, checked: sources?.length ?? 0, synced }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message ?? "Erreur synchronisation GMCAP" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
