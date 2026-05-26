import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ParsedRow = Record<string, string> & { __norm?: Map<string, string> };
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

async function importContent(admin: ReturnType<typeof createClient>, raceId: string, content: string) {
  const rows = parseDelimited(content);
  if (rows.length === 0) throw new Error("Aucune ligne exploitable dans l'export GMCAP");

  const { data: registrations } = await admin
    .from("race_registrations")
    .select("id, bib_number")
    .eq("race_id", raceId);

  const byBib = new Map(((registrations ?? []) as Registration[]).map((reg) => [clean(reg.bib_number), reg.id]));
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
    const rgpdValue = pick(row, "RGPD", "Consentement", "Autorisation", "Publication").toUpperCase();
    const rgpdConsent = rgpdValue === "N" ? "N" : "O";

    results.push({
      race_id: raceId,
      bib_number: bib,
      first_name: pick(row, "Prénom", "Prenom") || null,
      last_name: pick(row, "Nom") || null,
      category: pick(row, "Abbrev. Catégorie", "Abbrev. Categorie", "Catégorie", "Categorie") || null,
      club: pick(row, "Club") || null,
      status: disqualified ? "disqualified" : abandoned ? "dnf" : started ? "classified" : "not_started",
      official_time_text: pick(row, "Temps") || null,
      official_time_seconds: integer(pick(row, "Nb.Secondes")),
      scratch_rank: integer(pick(row, "Classement")),
      category_rank: integer(pick(row, "Classement par Cat.", "Classement par Cat")),
      gender_rank: integer(pick(row, "Classement par Sexe")),
      split_payload: extractSplits(row),
      rgpd_consent: rgpdConsent,
      imported_at: new Date().toISOString(),
    });
  }

  if (results.length === 0) throw new Error("Aucun dossard exploitable dans l'export GMCAP");

  // Dédoublonnage : garder la dernière occurrence par (race_id, bib_number)
  const dedupMap = new Map<string, typeof results[number]>();
  for (const r of results) dedupMap.set(`${r.race_id}::${r.bib_number}`, r);
  const deduped = Array.from(dedupMap.values());

  const { error } = await admin
    .from("gmcap_results")
    .upsert(deduped, { onConflict: "race_id,bib_number" });
  if (error) throw new Error(error.message);

  return { imported: results.length, matched, unmatched: results.length - matched };
}

async function readSource(source: Source) {
  if (source.source_type === "manual_file") {
    if (!source.pending_content) throw new Error("Aucun fichier GMCAP en attente : sélectionne un fichier puis clique sur Importer maintenant.");
    return source.pending_content;
  }
  if (source.source_type === "manual_upload") {
    throw new Error("Le dernier import GMCAP a été fait manuellement. Pour relancer, sélectionne à nouveau le fichier puis clique sur Importer maintenant.");
  }
  const url = source.source_url;
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("La synchronisation cloud nécessite un lien HTTP/HTTPS vers l'export GMCAP");
  }
  const browserHeaders: Record<string, string> = {
    "Cache-Control": "no-cache",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/plain,text/csv,application/octet-stream,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Referer": `${parsed.protocol}//${parsed.host}/`,
  };
  let response = await fetch(url, { headers: browserHeaders, redirect: "follow" });
  if (response.status === 403) {
    // Retry without Referer — some servers block cross-origin referers
    const { Referer: _r, ...noReferer } = browserHeaders;
    response = await fetch(url, { headers: noReferer, redirect: "follow" });
  }
  if (!response.ok) {
    const host = parsed.host;
    // AwardSpace / atwebpages.com bloquent les IPs hors France (Error 403 - Local).
    const geoBlocked = response.status === 403 && /atwebpages\.com|awardspace/i.test(host);
    const detail = geoBlocked
      ? `L'hébergeur « ${host} » (AwardSpace) bloque les requêtes hors de France, donc le serveur FinisTrackLive ne peut pas lire ce fichier. Solutions : 1) lance l'uploader local (dossier scripts/local-gmcap-uploader) sur le PC de chrono — il enverra le fichier automatiquement toutes les minutes ; 2) ou utilise l'import manuel ci-dessous ; 3) ou héberge le fichier sur un service sans filtrage géographique (GitHub Pages, Netlify, OVH, Cloudflare R2…).`
      : `Le serveur distant a refusé l'accès (HTTP ${response.status}). Vérifie que l'URL est publique (ouvre-la dans un navigateur en navigation privée) ou utilise l'import manuel.`;
    throw new Error(`Lecture GMCAP impossible [${response.status}]. ${detail}`);
  }
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
    if (error) {
      const msg = error.message ?? "";
      // Table not yet created: respond gracefully so the client doesn't crash
      if (/gmcap_import_sources/i.test(msg) && /(not find|does not exist|schema cache)/i.test(msg)) {
        return new Response(JSON.stringify({ ok: true, schema_ready: false, warning: "GMCAP_SCHEMA_MISSING", checked: 0, synced: [] }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(msg);
    }

    const due = (sources ?? []).filter((source: Source) => {
      if (source.source_type === "manual_upload") return false;
      if (source.source_type === "manual_file" && !source.pending_content) return false;
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
