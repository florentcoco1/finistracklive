import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ParsedRow = Record<string, string> & { __norm?: Map<string, string> };

const clean = (value: unknown) => String(value ?? "").trim();
const decimal = (value: unknown) => {
  const n = Number(clean(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const integer = (value: unknown) => {
  const n = Number.parseInt(clean(value), 10);
  return Number.isFinite(n) ? n : null;
};

// Normalize header keys: lowercase, strip diacritics + replacement char, collapse non-alphanumerics.
// Resilient to encoding issues (é vs e vs �) and punctuation variants.
const normKey = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\uFFFD/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const normLoose = (s: string) => normKey(s).replace(/[aeiouy]/g, "");

function pick(row: ParsedRow, ...candidates: string[]): string {
  const map = row.__norm;
  if (!map) return "";
  for (const c of candidates) {
    const v = map.get(normKey(c));
    if (v != null && v !== "") return v;
  }
  const looseCandidates = new Set(candidates.map(normLoose));
  for (const [key, value] of map.entries()) {
    if (value !== "" && looseCandidates.has(normLoose(key))) return value;
  }
  return "";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const isMissingGmcapSchema = (message: string) =>
  /gmcap_results|schema cache|does not exist|Could not find the table/i.test(message);

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

function detectDelimiter(line: string) {
  const delimiters = ["\t", ";", ","];
  return delimiters
    .map((delimiter) => ({ delimiter, count: line.split(delimiter).length }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter ?? "\t";
}

function parseDelimited(content: string): ParsedRow[] {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headerIndex = lines.findIndex((line) => /num|dossard|bib|classement|temps/i.test(normKey(line)));
  const firstDataLine = headerIndex >= 0 ? headerIndex : 0;
  const delimiter = detectDelimiter(lines[firstDataLine]);
  const headers = lines[firstDataLine].split(delimiter).map(clean);
  return lines.slice(firstDataLine + 1).map((line) => {
    const cells = line.split(delimiter);
    const row: ParsedRow = Object.fromEntries(headers.map((header, index) => [header, clean(cells[index])])) as ParsedRow;
    const norm = new Map<string, string>();
    headers.forEach((h, i) => norm.set(normKey(h), clean(cells[i])));
    Object.defineProperty(row, "__norm", { value: norm, enumerable: false });
    return row;
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

    const rows = parseDelimited(content);
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
      const bib = pick(row, "Numéro", "Numero", "Numro", "No", "N°", "Dossard", "Doss.", "Doss", "Bib", "Bib Number");
      if (!bib) continue;

      const registrationId = byBib.get(bib) ?? null;
      if (registrationId) matched += 1;

      const abandoned = pick(row, "Abandon").toUpperCase() === "O";
      const disqualified = pick(row, "Disqualifié", "Disqualifie").toUpperCase() === "O";
      const started = pick(row, "Pris Départ", "Pris Depart").toUpperCase() === "O";
      const status = disqualified ? "disqualified" : abandoned ? "dnf" : started ? "classified" : "not_started";

      results.push({
        race_id,
        bib_number: bib,
        first_name: pick(row, "Prénom", "Prenom") || null,
        last_name: pick(row, "Nom") || null,
        category: pick(row, "Abbrev. Catégorie", "Abbrev. Categorie", "Catégorie", "Categorie") || null,
        club: pick(row, "Club") || null,
        status,
        official_time_text: pick(row, "Temps") || null,
        official_time_seconds: integer(pick(row, "Nb.Secondes")) ?? (decimal(pick(row, "Nb.Secondes")) != null ? Math.round(decimal(pick(row, "Nb.Secondes"))!) : null),
        scratch_rank: integer(pick(row, "Classement")),
        category_rank: integer(pick(row, "Classement par Cat.", "Classement par Cat")),
        gender_rank: integer(pick(row, "Classement par Sexe")),
        split_payload: extractSplits(row),
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
      if (isMissingGmcapSchema(upsertError.message)) {
        return json({
          ok: false,
          warning: "GMCAP_SCHEMA_MISSING",
          imported: 0,
          matched: 0,
          unmatched: results.length,
          error: "Import GMCAP en attente : la table des résultats est en cours de préparation.",
        });
      }
      return json({ error: upsertError.message }, 500);
    }

    await markImportSuccess(admin, race_id, typeof file_name === "string" ? file_name : null, results.length, matched);
    return json({ ok: true, imported: results.length, matched, unmatched: results.length - matched });
  } catch (error) {
    return json({ error: (error as Error).message ?? "Erreur import GMCAP" }, 500);
  }
});
