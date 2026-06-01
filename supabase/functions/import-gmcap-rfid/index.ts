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

async function markImportSuccess(admin: any, raceId: string, fileName: string | null, imported: number, matched: number) {
  const now = new Date().toISOString();
  const safeName = clean(fileName) || `gmcap-import-${now}.txt`;
  const { data: existing } = await admin
    .from("gmcap_import_sources")
    .select("id, source_url, source_type, enabled")
    .eq("race_id", raceId)
    .maybeSingle();

  if (existing?.id) {
    const isWebSource = /^https?:\/\//i.test(clean(existing.source_url));
    await admin.from("gmcap_import_sources").update({
      source_url: isWebSource ? existing.source_url : `manual://${encodeURIComponent(safeName)}`,
      source_type: isWebSource ? "url" : "manual_upload",
      file_name: safeName,
      pending_content: null,
      pending_import_at: null,
      schema_checked_at: now,
      enabled: isWebSource ? existing.enabled : false,
      last_import_at: now,
      last_import_status: "success",
      last_import_message: `${matched} correspondance(s), ${imported - matched} non associée(s) depuis ${safeName}`,
      updated_at: now,
    }).eq("id", existing.id);
    return;
  }

  await admin.from("gmcap_import_sources").upsert({
    race_id: raceId,
    source_url: `manual://${encodeURIComponent(safeName)}`,
    source_type: "manual_upload",
    file_name: safeName,
    pending_content: null,
    pending_import_at: null,
    schema_checked_at: now,
    enabled: false,
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

// Parse a time string like "1:23:45", "23:45.6", "01:23:45,200" into integer seconds.
function timeToSeconds(value: string): number | null {
  const s = clean(value).replace(",", ".");
  if (!s || /^0+([:.]0+)*$/.test(s)) return null;
  const parts = s.split(":");
  if (parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  let h = 0, m = 0, sec = 0;
  if (parts.length === 3) { h = Number(parts[0]); m = Number(parts[1]); sec = Number(parts[2]); }
  else if (parts.length === 2) { m = Number(parts[0]); sec = Number(parts[1]); }
  else { sec = Number(parts[0]); }
  const total = Math.round(h * 3600 + m * 60 + sec);
  return total > 0 ? total : null;
}

// Find the time value for a given detector in a GMCAP row.
// GMCAP intermediate columns are named like "20|1" (detector 20, passage 1).
// We scan the raw row keys to be robust to header variants and to encoding/normalization issues.
function pickDetectorTime(row: ParsedRow, detectorId: number): string | null {
  // Match a header whose label contains "<detectorId>|<digit>" anywhere.
  const re = new RegExp(`(?:^|[^0-9])${detectorId}\\s*\\|\\s*\\d+`);
  for (const [key, value] of Object.entries(row)) {
    if (typeof value !== "string" || !value) continue;
    if (re.test(key)) return value;
  }
  // Fallback: normalized lookup ("20|1" -> "201", "20|2" -> "202"...).
  const map = row.__norm;
  if (map) {
    for (let pass = 1; pass <= 9; pass += 1) {
      const v = map.get(normKey(`${detectorId}|${pass}`));
      if (v) return v;
    }
  }
  return null;
}

async function isRaceAdmin(admin: any, raceId: string, userId: string) {
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

    const { data: raceRow } = await admin
      .from("races")
      .select("name, start_time")
      .eq("id", race_id)
      .single();
    const raceNameNorm = normKey(clean(raceRow?.name ?? ""));
    const raceStartMs = raceRow?.start_time ? new Date(raceRow.start_time).getTime() : null;
    const FINISH_DETECTOR_ID = 31;
    const finishUpdates: Array<{ id: string; finished_at: string }> = [];

    const byBib = new Map((registrations ?? []).map((reg: any) => [clean(reg.bib_number), reg.id]));

    // Load GMCAP-source checkpoints to populate runner_checkpoint_times from detector columns.
    const { data: gmcapCheckpoints } = await admin
      .from("race_checkpoints")
      .select("id, detector_id")
      .eq("race_id", race_id)
      .eq("source", "gmcap");
    const detectorCheckpoints = (gmcapCheckpoints ?? []).filter((c: any) => c.detector_id != null);

    const results: any[] = [];
    const checkpointTimes: any[] = [];
    let matched = 0;
    let skippedByCourse = 0;
    let courseFieldSeen = false;

    for (const row of rows) {
      const courseValue = pick(row, "Course", "Épreuve", "Epreuve", "Race");
      if (courseValue) {
        courseFieldSeen = true;
        if (raceNameNorm && normKey(courseValue) !== raceNameNorm) {
          skippedByCourse += 1;
          continue;
        }
      }

      const bib = pick(row, "Numéro", "Numero", "Numro", "No", "N°", "Dossard", "Doss.", "Doss", "Bib", "Bib Number");
      if (!bib) continue;

      const registrationId = byBib.get(bib) ?? null;
      if (registrationId) matched += 1;

      // Collect detector times for GMCAP checkpoints (e.g. "20|1" column for detector 20).
      if (registrationId && detectorCheckpoints.length > 0) {
        for (const cp of detectorCheckpoints) {
          const raw = pickDetectorTime(row, cp.detector_id as number);
          if (!raw) continue;
          const seconds = timeToSeconds(raw);
          if (seconds == null) continue;
          checkpointTimes.push({
            checkpoint_id: cp.id,
            registration_id: registrationId,
            time_seconds: seconds,
            time_text: raw,
            recorded_at: new Date().toISOString(),
          });
        }
      }

      // Détecteur d'arrivée (GMCAP 31) → marque le coureur comme arrivé
      if (registrationId && raceStartMs != null) {
        const rawFinish = pickDetectorTime(row, FINISH_DETECTOR_ID);
        const finishSeconds = rawFinish ? timeToSeconds(rawFinish) : null;
        if (finishSeconds != null && finishSeconds > 0) {
          finishUpdates.push({
            id: registrationId,
            finished_at: new Date(raceStartMs + finishSeconds * 1000).toISOString(),
          });
        }
      }

      const abandoned = pick(row, "Abandon").toUpperCase() === "O";
      const disqualified = pick(row, "Disqualifié", "Disqualifie").toUpperCase() === "O";
      const started = pick(row, "Pris Départ", "Pris Depart").toUpperCase() === "O";
      const status = disqualified ? "disqualified" : abandoned ? "dnf" : started ? "classified" : "not_started";

      // Date de naissance : accepte JJ/MM/AAAA, AAAA-MM-JJ ou année seule
      const rawBirth = pick(row, "Date de Naissance", "Date Naissance", "Naissance", "Né(e) le", "Ne le", "Date de naissance");
      let birthDate: string | null = null;
      if (rawBirth) {
        const m = rawBirth.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
        if (m) {
          const [, d, mo, y] = m;
          const year = y.length === 2 ? (Number(y) > 30 ? `19${y}` : `20${y}`) : y;
          birthDate = `${year.padStart(4, "0")}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawBirth)) {
          birthDate = rawBirth;
        } else if (/^\d{4}$/.test(rawBirth)) {
          birthDate = `${rawBirth}-01-01`;
        }
      }

      // Sexe : normalisé en "M" / "F"
      const rawGender = pick(row, "Sexe", "Genre", "Sex", "Gender", "S").toUpperCase().trim();
      let gender: string | null = null;
      if (rawGender.startsWith("M") || rawGender === "H") gender = "M";
      else if (rawGender.startsWith("F") || rawGender === "W") gender = "F";

      const officialTimeText = pick(row, "Temps Arrondi", "Temps") || null;
      const officialTimeSeconds = integer(pick(row, "Nb.Secondes Arrondi", "Nb.Secondes")) ?? (decimal(pick(row, "Nb.Secondes Arrondi", "Nb.Secondes")) != null ? Math.round(decimal(pick(row, "Nb.Secondes Arrondi", "Nb.Secondes"))!) : null);

      // Un temps à 00:00:00 (ou non renseigné) signifie que le coureur n'a pas de chrono officiel : exclu du classement
      const hasValidTime = !!officialTimeText && !/^0+([:.]0+)+$/.test(officialTimeText.trim()) && (officialTimeSeconds == null || officialTimeSeconds > 0);
      const finalStatus = !hasValidTime && status === "classified" ? "not_started" : status;

      const rgpdValue = pick(row, "RGPD", "Consentement", "Autorisation", "Publication").toUpperCase();
      const rgpdConsent = rgpdValue === "N" ? "N" : "O";

      results.push({
        race_id,
        bib_number: bib,
        first_name: pick(row, "Prénom", "Prenom") || null,
        last_name: pick(row, "Nom") || null,
        phone: pick(row, "Tel", "Tél", "Téléphone", "Telephone", "Phone", "Portable", "Mobile", "GSM") || null,
        birth_date: birthDate,
        gender,
        category: pick(row, "Abbrev. Catégorie", "Abbrev. Categorie", "Catégorie", "Categorie") || null,
        club: pick(row, "Club") || null,
        status: finalStatus,
        official_time_text: hasValidTime ? officialTimeText : null,
        official_time_seconds: hasValidTime ? officialTimeSeconds : null,
        scratch_rank: hasValidTime ? integer(pick(row, "Classement")) : null,
        category_rank: hasValidTime ? integer(pick(row, "Classement par Cat.", "Classement par Cat")) : null,
        gender_rank: hasValidTime ? integer(pick(row, "Classement par Sexe")) : null,
        split_payload: extractSplits(row),
        rgpd_consent: rgpdConsent,
        imported_at: new Date().toISOString(),
      });
    }

    if (results.length === 0) {
      if (courseFieldSeen && skippedByCourse > 0) {
        return json({ error: `Aucune ligne ne correspond à la course « ${raceRow?.name ?? ""} » (${skippedByCourse} ligne(s) ignorée(s) car champ "Course" différent).` }, 400);
      }
      return json({ error: "Aucun dossard exploitable dans l'export GMCAP" }, 400);
    }

    // Deduplicate by race_id+bib_number to avoid "ON CONFLICT cannot affect row a second time"
    const dedupedMap = new Map<string, typeof results[number]>();
    for (const r of results) {
      dedupedMap.set(`${r.race_id}::${r.bib_number}`, r);
    }
    const deduped = Array.from(dedupedMap.values());

    // Recompute scratch/gender/category ranks from official_time_seconds to fix any
    // inconsistencies in the source GMCAP file. Only classified runners with a valid
    // time are ranked.
    const ranked = deduped.filter(
      (r) => r.status === "classified" && typeof r.official_time_seconds === "number" && (r.official_time_seconds as number) > 0
    );
    ranked.sort((a, b) => (a.official_time_seconds as number) - (b.official_time_seconds as number));
    const rankedSet = new Set(ranked);
    const genderCounters = new Map<string, number>();
    const categoryCounters = new Map<string, number>();
    ranked.forEach((r, idx) => {
      r.scratch_rank = idx + 1;
      if (r.gender) {
        const n = (genderCounters.get(r.gender) ?? 0) + 1;
        genderCounters.set(r.gender, n);
        r.gender_rank = n;
      } else {
        r.gender_rank = null;
      }
      if (r.category) {
        const n = (categoryCounters.get(r.category) ?? 0) + 1;
        categoryCounters.set(r.category, n);
        r.category_rank = n;
      } else {
        r.category_rank = null;
      }
    });
    for (const r of deduped) {
      if (!rankedSet.has(r)) {
        r.scratch_rank = null;
        r.gender_rank = null;
        r.category_rank = null;
      }
    }

    const { error: upsertError } = await admin
      .from("gmcap_results")
      .upsert(deduped, { onConflict: "race_id,bib_number" });

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

    // Upsert detector checkpoint times (deduplicated by checkpoint_id+registration_id).
    let checkpointTimesImported = 0;
    let checkpointTimesError: string | null = null;
    if (checkpointTimes.length > 0) {
      const ctMap = new Map<string, typeof checkpointTimes[number]>();
      for (const t of checkpointTimes) {
        ctMap.set(`${t.checkpoint_id}::${t.registration_id}`, t);
      }
      const ctDeduped = Array.from(ctMap.values());
      const { error: ctErr } = await admin
        .from("runner_checkpoint_times")
        .upsert(ctDeduped, { onConflict: "checkpoint_id,registration_id" });
      if (ctErr) {
        checkpointTimesError = ctErr.message;
      } else {
        checkpointTimesImported = ctDeduped.length;
      }
    }

    // Marque les coureurs détectés à l'arrivée (détecteur GMCAP 31) comme arrivés.
    let finishedMarked = 0;
    const finishMap = new Map<string, string>();
    for (const u of finishUpdates) finishMap.set(u.id, u.finished_at);
    for (const [id, finished_at] of finishMap.entries()) {
      const { error: finErr } = await admin
        .from("race_registrations")
        .update({ finished_at, tracking_active: false, updated_at: new Date().toISOString() })
        .eq("id", id)
        .is("finished_at", null);
      if (!finErr) finishedMarked += 1;
    }

    await markImportSuccess(admin, race_id, typeof file_name === "string" ? file_name : null, results.length, matched);
    return json({
      ok: true,
      imported: results.length,
      matched,
      unmatched: results.length - matched,
      skipped_by_course: skippedByCourse,
      checkpoint_times_imported: checkpointTimesImported,
      checkpoint_times_found: checkpointTimes.length,
      detector_checkpoints: detectorCheckpoints.length,
      checkpoint_times_error: checkpointTimesError,
      finished_marked: finishedMarked,
    });
  } catch (error) {
    return json({ error: (error as Error).message ?? "Erreur import GMCAP" }, 500);
  }
});
