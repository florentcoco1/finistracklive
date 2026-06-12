import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { AlertTriangle, ChevronLeft, Flag, Image as ImageIcon, Link2, Map, Plus, RefreshCw, Save, Shield, Trash2, Upload, UserPlus, Users } from "lucide-react";
import { parseGpx } from "@/lib/gpx";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { RaceCheckpoints } from "@/components/RaceCheckpoints";
import { RaceInviteCard } from "@/components/RaceInviteCard";
import RaceMap from "@/components/RaceMap";
import ElevationChart from "@/components/ElevationChart";
import { DifficultyStars } from "@/components/DifficultyStars";

interface RaceSummary {
  id: string;
  name: string;
  start_time: string;
  status: string;
  event_id: string | null;
  gpx_geojson: any;
  route_points: { lat: number; lng: number; cumulativeDistanceM: number }[] | null;
  distance_km: number | null;
  difficulty_level: number | null;
}

interface EventOption {
  id: string;
  name: string;
}

interface GmcapSource {
  id: string;
  source_url: string;
  source_type?: string | null;
  file_name?: string | null;
  enabled: boolean;
  last_import_at: string | null;
  last_import_status: string | null;
  last_import_message: string | null;
}

interface AdminProfile {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone?: string | null;
}

interface RegistrationRow {
  id: string;
  runner_id: string;
  bib_number: string;
  category: string | null;
  emergency_phone: string | null;
  address: string | null;
  runner_status: string;
  created_at: string;
  profile: AdminProfile | null;
  gender?: string | null;
  birth_date?: string | null;
}

interface OrganizerRow {
  id: string;
  user_id: string;
  role: string;
  created_at: string | null;
  profile: AdminProfile | null;
}

interface AdminResponse {
  error?: string;
  source?: GmcapSource | null;
  registrations?: RegistrationRow[];
  organizers?: OrganizerRow[];
  imported_count?: number;
}

interface SyncResponse {
  error?: string;
  schema_ready?: boolean;
  message?: string;
  synced?: Array<{ error?: string; matched?: number }>;
}

interface ManualImportResponse {
  error?: string;
  code?: string;
  warning?: string;
  imported?: number;
  matched?: number;
  unmatched?: number;
}

const emptyRegistration = { email: "", bib_number: "", category: "", gender: "", emergency_phone: "", address: "" };
const pendingDbName = "finistracklive-gmcap";
const pendingStoreName = "pending-imports";

function displayName(profile: AdminProfile | null) {
  const name = `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim();
  return name || profile?.email || "—";
}

function genderLabel(g: string | null | undefined) {
  if (g === "M") return "H";
  if (g === "F") return "F";
  return "—";
}

async function pendingStore(mode: IDBTransactionMode) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(pendingDbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(pendingStoreName, { keyPath: "raceId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return db.transaction(pendingStoreName, mode).objectStore(pendingStoreName);
}

async function saveLocalPendingImport(raceId: string, fileName: string, content: string) {
  const store = await pendingStore("readwrite");
  await new Promise<void>((resolve, reject) => {
    const request = store.put({ raceId, fileName, content, savedAt: new Date().toISOString() });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function readLocalPendingImport(raceId: string) {
  const store = await pendingStore("readonly");
  return await new Promise<{ raceId: string; fileName: string; content: string; savedAt: string } | null>((resolve, reject) => {
    const request = store.get(raceId);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function clearLocalPendingImport(raceId: string) {
  const store = await pendingStore("readwrite");
  await new Promise<void>((resolve, reject) => {
    const request = store.delete(raceId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function readTextFile(file: File) {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

export default function RaceAdmin() {
  const { id: raceId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [race, setRace] = useState<RaceSummary | null>(null);
  const [source, setSource] = useState<GmcapSource | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceEnabled, setSourceEnabled] = useState(true);
  const [registrations, setRegistrations] = useState<RegistrationRow[]>([]);
  const [organizers, setOrganizers] = useState<OrganizerRow[]>([]);
  const [importedCount, setImportedCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [manualImporting, setManualImporting] = useState(false);
  const [gmcapFile, setGmcapFile] = useState<File | null>(null);
  const [markFinishedOnImport, setMarkFinishedOnImport] = useState(false);
  const [runnerImportFile, setRunnerImportFile] = useState<File | null>(null);
  const [runnerImporting, setRunnerImporting] = useState(false);
  const [runnerImportReport, setRunnerImportReport] = useState<{ registered: number; created: number; errors: string[] } | null>(null);
  const [localPendingFile, setLocalPendingFile] = useState<string | null>(null);
  const [newRunner, setNewRunner] = useState(emptyRegistration);
  const [newOrganizerEmail, setNewOrganizerEmail] = useState("");
  const [startTimeInput, setStartTimeInput] = useState("");
  const [savingStart, setSavingStart] = useState(false);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventId, setEventId] = useState<string>("");
  const [savingEvent, setSavingEvent] = useState(false);
  const [raceName, setRaceName] = useState<string>("");
  const [savingName, setSavingName] = useState(false);
  const [difficultyLevel, setDifficultyLevel] = useState(1);
  const [savingDifficulty, setSavingDifficulty] = useState(false);
  const [gpxFile, setGpxFile] = useState<File | null>(null);
  const [uploadingGpx, setUploadingGpx] = useState(false);
  const [checkpoints, setCheckpoints] = useState<Array<{ id: string; name: string; distance_km: number | null }>>([]);
  const [githubRepo, setGithubRepo] = useState("florentcoco1/finistracklive");
  const [githubPath, setGithubPath] = useState("public");
  const [githubBranch, setGithubBranch] = useState("main");
  const [githubFiles, setGithubFiles] = useState<Array<{ name: string; download_url: string }>>([]);
  const [githubLoading, setGithubLoading] = useState(false);

  const loadGithubFiles = async () => {
    if (!githubRepo.trim()) {
      toast.error("Renseigne le dépôt GitHub (owner/repo)");
      return;
    }
    setGithubLoading(true);
    try {
      const cleanPath = githubPath.replace(/^\/+|\/+$/g, "");
      const url = `https://api.github.com/repos/${githubRepo.trim()}/contents/${cleanPath}?ref=${githubBranch.trim() || "main"}`;
      const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) throw new Error(`GitHub ${res.status} : ${res.statusText}. Vérifie que le dépôt est public.`);
      const items = await res.json();
      if (!Array.isArray(items)) throw new Error("Chemin invalide : ce n'est pas un dossier.");
      const files = items
        .filter((it: any) => it.type === "file" && /\.(txt|csv|tsv)$/i.test(it.name))
        .map((it: any) => ({ name: it.name, download_url: it.download_url }));
      setGithubFiles(files);
      if (!files.length) toast.warning("Aucun fichier .txt/.csv/.tsv trouvé dans ce dossier.");
      else toast.success(`${files.length} fichier(s) trouvé(s)`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGithubLoading(false);
    }
  };

  useEffect(() => {
    if (!raceId) return;
    const reload = async () => {
      const { data } = await (supabase as any)
        .from("race_checkpoints")
        .select("id, name, distance_km, position")
        .eq("race_id", raceId)
        .order("position", { ascending: true });
      setCheckpoints(((data as unknown) as Array<{ id: string; name: string; distance_km: number | null }>) ?? []);
    };
    reload();
    const ch = supabase
      .channel(`race-admin-checkpoints:${raceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "race_checkpoints", filter: `race_id=eq.${raceId}` }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [raceId]);

  const invokeAdmin = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("manage-race-admin", { body });
    if (error) throw error;
    const payload = data as AdminResponse;
    if (payload?.error) throw new Error(payload.error);
    return payload;
  }, []);

  const applyAdminData = useCallback((data: AdminResponse) => {
    setSource(data.source ?? null);
    setSourceUrl(data.source?.source_url ?? "");
    setSourceEnabled(data.source?.enabled ?? true);
    setRegistrations(data.registrations ?? []);
    setOrganizers(data.organizers ?? []);
    setImportedCount(data.imported_count ?? 0);
  }, []);

  const load = useCallback(async () => {
    if (!raceId) return;
    const data = await invokeAdmin({ action: "load", race_id: raceId });
    applyAdminData(data);
  }, [raceId, invokeAdmin, applyAdminData]);

  useEffect(() => {
    if (!raceId || loading) return;
    if (!user) {
      navigate("/auth");
      return;
    }

    (supabase.from as unknown as (t: string) => { select: (c: string) => { eq: (col: string, val: string) => { single: () => Promise<{ data: unknown; error: unknown }> } } })("races")
      .select("id, name, start_time, status, event_id, gpx_geojson, route_points, distance_km, difficulty_level")
      .eq("id", raceId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          toast.error("Course introuvable");
          navigate("/races");
          return;
        }
        const row = data as RaceSummary;
        setRace(row);
        setEventId(row.event_id ?? "");
        setRaceName(row.name ?? "");
        setDifficultyLevel(Number(row.difficulty_level) || 1);
        const d = new Date(row.start_time);
        const pad = (n: number) => String(n).padStart(2, "0");
        setStartTimeInput(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
        document.title = `Administration ${row.name} — FinisTrackLive`;
      });

    supabase
      .from("events")
      .select("id, name")
      .order("start_date", { ascending: false })
      .then(({ data }) => {
        setEvents((data ?? []) as EventOption[]);
      });

    load().catch((error) => {
      toast.error((error as Error).message || "Administration inaccessible");
      navigate(`/races/${raceId}`);
    });

    readLocalPendingImport(raceId).then((pending) => setLocalPendingFile(pending?.fileName ?? null)).catch(() => undefined);
  }, [raceId, user, loading, navigate, load]);

  const stats = useMemo(() => {
    return { total: registrations.length, organizers: organizers.length, imported: importedCount };
  }, [registrations, organizers, importedCount]);

  const saveGmcap = async () => {
    if (!raceId || !sourceUrl.trim()) {
      toast.error("Lien GMCAP requis");
      return;
    }
    setBusy(true);
    try {
      const data = await invokeAdmin({ action: "save_gmcap", race_id: raceId, source_url: sourceUrl.trim(), enabled: sourceEnabled });
      applyAdminData(data);
      toast.success("Lien GMCAP enregistré");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveStartTime = async () => {
    if (!raceId || !startTimeInput) {
      toast.error("Heure de départ requise");
      return;
    }
    setSavingStart(true);
    try {
      const iso = new Date(startTimeInput).toISOString();
      const { error } = await supabase.from("races").update({ start_time: iso }).eq("id", raceId);
      if (error) throw error;
      setRace((prev) => (prev ? { ...prev, start_time: iso } : prev));
      toast.success("Heure de départ mise à jour");
    } catch (error) {
      toast.error((error as Error).message || "Mise à jour impossible");
    } finally {
      setSavingStart(false);
    }
  };

  const saveEvent = async () => {
    if (!raceId) return;
    setSavingEvent(true);
    try {
      const newEventId = eventId || null;
      const { error } = await supabase.from("races").update({ event_id: newEventId }).eq("id", raceId);
      if (error) throw error;
      setRace((prev) => (prev ? { ...prev, event_id: newEventId } : prev));
      toast.success(newEventId ? "Course rattachée à l'épreuve" : "Course détachée de l'épreuve");
    } catch (error) {
      toast.error((error as Error).message || "Mise à jour impossible");
    } finally {
      setSavingEvent(false);
    }
  };

  const saveName = async () => {
    if (!raceId) return;
    const trimmed = raceName.trim();
    if (!trimmed) {
      toast.error("Le nom de la course ne peut pas être vide");
      return;
    }
    setSavingName(true);
    try {
      const { error } = await supabase.from("races").update({ name: trimmed }).eq("id", raceId);
      if (error) throw error;
      setRace((prev) => (prev ? { ...prev, name: trimmed } : prev));
      document.title = `Administration ${trimmed} — FinisTrackLive`;
      toast.success("Nom de la course mis à jour");
    } catch (error) {
      toast.error((error as Error).message || "Mise à jour impossible");
    } finally {
      setSavingName(false);
    }
  };


  const replaceGpx = async () => {
    if (!raceId || !gpxFile || !user) {
      toast.error("Sélectionne un fichier GPX");
      return;
    }
    if (gpxFile.size > 8 * 1024 * 1024) {
      toast.error("Fichier trop volumineux : limite 8 Mo");
      return;
    }
    setUploadingGpx(true);
    try {
      const text = await gpxFile.text();
      const { geojson, routePoints, distanceKm } = parseGpx(text);
      const path = `${user.id}/${Date.now()}-${gpxFile.name.replace(/[^a-z0-9.-]/gi, "_")}`;
      const { error: upErr } = await supabase.storage
        .from("gpx-files")
        .upload(path, gpxFile, { contentType: "application/gpx+xml" });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("gpx-files").getPublicUrl(path);
      const { error: updErr } = await supabase
        .from("races")
        .update({
          gpx_url: pub.publicUrl,
          gpx_geojson: geojson as never,
          route_points: routePoints as never,
          distance_km: distanceKm,
        })
        .eq("id", raceId);
      if (updErr) throw updErr;
      setRace((prev) => (prev ? { ...prev, gpx_geojson: geojson as any, route_points: routePoints as any, distance_km: distanceKm } : prev));
      toast.success(`Tracé GPX mis à jour (${distanceKm} km)`);
      setGpxFile(null);
    } catch (error) {
      toast.error((error as Error).message || "Mise à jour du GPX impossible");
    } finally {
      setUploadingGpx(false);
    }
  };

  const syncGmcap = async () => {
    if (!raceId) return;
    const isCompletedManualImport = source?.source_type === "manual_upload" || (source?.source_type === "manual_file" && source?.last_import_status !== "pending_schema");
    if (isCompletedManualImport && !localPendingFile) {
      toast.error("Le dernier import GMCAP était manuel : sélectionne à nouveau le fichier puis clique sur Importer maintenant.");
      return;
    }
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-gmcap-rfid", { body: { race_id: raceId } });
      const payload = data as SyncResponse;
      if (error || payload?.error) throw new Error(error?.message ?? payload.error);
      await load();
      const result = payload.synced?.[0];
      if (payload.schema_ready === false) toast.warning(payload.message ?? "Import en attente, vérification GMCAP relancée automatiquement.");
      else if (result?.error) toast.error(result.error);
      else toast.success(`GMCAP synchronisé : ${result?.matched ?? 0} correspondance(s)`);
    } catch (error) {
      toast.error((error as Error).message || "Synchronisation impossible");
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (!raceId || source?.last_import_status !== "pending_schema") return;
    const checkPendingImport = async () => {
      if (syncing) return;
      setSyncing(true);
      try {
        const { data, error } = await supabase.functions.invoke("sync-gmcap-rfid", { body: { race_id: raceId } });
        const payload = data as SyncResponse;
        if (!error && !payload?.error) await load();
      } finally {
        setSyncing(false);
      }
    };
    const interval = window.setInterval(checkPendingImport, 30_000);
    return () => window.clearInterval(interval);
  }, [raceId, source?.last_import_status, syncing, load]);

  useEffect(() => {
    if (!raceId || !localPendingFile) return;
    const interval = window.setInterval(() => {
      retryLocalPendingImport().catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [raceId, localPendingFile]);

  // Auto-sync every 60s for URL-based GMCAP sources when "Synchronisation automatique" is enabled
  useEffect(() => {
    if (!raceId) return;
    const isUrlSource = (source?.source_type ?? "url") === "url" && !!source?.source_url;
    if (!source?.enabled || !isUrlSource) return;
    let inFlight = false;
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const { data, error } = await supabase.functions.invoke("sync-gmcap-rfid", { body: { race_id: raceId } });
        const payload = data as SyncResponse;
        if (!error && !payload?.error) await load();
      } catch {
        /* silencieux : la prochaine tentative dans 60s */
      } finally {
        inFlight = false;
      }
    };
    const interval = window.setInterval(tick, 60_000);
    return () => window.clearInterval(interval);
  }, [raceId, source?.enabled, source?.source_type, source?.source_url, load]);


  const importGmcapFile = async () => {
    if (!raceId || !gmcapFile) {
      toast.error("Sélectionne un fichier GMCAP à importer");
      return;
    }
    if (gmcapFile.size > 8 * 1024 * 1024) {
      toast.error("Fichier trop volumineux : limite 8 Mo");
      return;
    }

    setManualImporting(true);
    try {
      const content = await readTextFile(gmcapFile);
      const { data, error } = await supabase.functions.invoke("import-gmcap-rfid", { body: { race_id: raceId, content, file_name: gmcapFile.name } });
      const payload = data as ManualImportResponse;
      if (error) throw new Error(error.message);
      if (payload?.warning === "GMCAP_SCHEMA_MISSING" || payload?.warning === "RFID_IMPORT_PENDING" || payload?.warning === "RFID_SCHEMA_MISSING") {
        await saveLocalPendingImport(raceId, gmcapFile.name, content);
        setLocalPendingFile(gmcapFile.name);
        await syncGmcap();
        toast.warning("Import GMCAP enregistré en attente : FinisTrackLive le relancera automatiquement dès que le service sera prêt.");
        return;
      }
      if (payload?.error) throw new Error(payload.error);
      await load();
      const p: any = payload;
      const cpInfo = p.detector_checkpoints > 0
        ? ` · ${p.checkpoint_times_imported ?? 0} temps intermédiaires (sur ${p.checkpoint_times_found ?? 0} détectés, ${p.detector_checkpoints} détecteur(s) configuré(s))${p.checkpoint_times_error ? ` ⚠️ ${p.checkpoint_times_error}` : ""}`
        : "";
      toast.success(`Import GMCAP terminé : ${payload.matched ?? 0} coureur(s) lié(s), ${payload.imported ?? 0} résultat(s) importé(s)${cpInfo}`);
      await clearLocalPendingImport(raceId);
      setLocalPendingFile(null);
      setGmcapFile(null);
      if (markFinishedOnImport) {
        const { error: statusError } = await supabase.from("races").update({ status: "finished" }).eq("id", raceId);
        if (statusError) {
          toast.error(`Course non marquée terminée : ${statusError.message}`);
        } else {
          setRace((prev) => (prev ? { ...prev, status: "finished" } : prev));
          toast.success("Course marquée comme terminée 🏁");
        }
        setMarkFinishedOnImport(false);
      }
    } catch (error) {
      const message = (error as Error).message || "Import GMCAP impossible";
      toast.error(message.includes("GMCAP_SCHEMA_MISSING") ? "Import enregistré en attente : relance automatique dès que le service GMCAP sera prêt." : message);
    } finally {
      setManualImporting(false);
    }
  };

  const retryLocalPendingImport = async () => {
    if (!raceId) return;
    const pending = await readLocalPendingImport(raceId);
    if (!pending) return;
    setManualImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("import-gmcap-rfid", { body: { race_id: raceId, content: pending.content, file_name: pending.fileName } });
      const payload = data as ManualImportResponse;
      if (error) throw new Error(error.message);
      if (payload?.warning === "GMCAP_SCHEMA_MISSING" || payload?.warning === "RFID_IMPORT_PENDING" || payload?.warning === "RFID_SCHEMA_MISSING") return;
      if (payload?.error) throw new Error(payload.error);
      await clearLocalPendingImport(raceId);
      setLocalPendingFile(null);
      await load();
      toast.success(`Import en attente terminé : ${payload.matched ?? 0} coureur(s) lié(s), ${payload.imported ?? 0} résultat(s) importé(s)`);
    } catch {
      // Le fichier reste conservé localement pour la prochaine vérification automatique.
    } finally {
      setManualImporting(false);
    }
  };

  const updateRegistration = async (registration: RegistrationRow) => {
    if (!raceId) return;
    setBusy(true);
    try {
      const data = await invokeAdmin({
        action: "update_registration",
        race_id: raceId,
        registration_id: registration.id,
        bib_number: registration.bib_number,
        category: registration.category || null,
        emergency_phone: registration.emergency_phone || null,
        address: registration.address || null,
      });
      applyAdminData(data);
      toast.success("Inscription mise à jour");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deleteRegistration = async (registrationId: string) => {
    if (!raceId || !window.confirm("Retirer ce coureur de la course ?")) return;
    setBusy(true);
    try {
      const data = await invokeAdmin({ action: "delete_registration", race_id: raceId, registration_id: registrationId });
      applyAdminData(data);
      toast.success("Coureur retiré");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deleteAllRegistrations = async () => {
    if (!raceId) return;
    if (registrations.length === 0) {
      toast.info("Aucun coureur à supprimer");
      return;
    }
    const confirmation = window.prompt(`Cette action va supprimer DÉFINITIVEMENT les ${registrations.length} coureur(s) inscrit(s). Tape SUPPRIMER pour confirmer.`);
    if (confirmation !== "SUPPRIMER") {
      toast.info("Suppression annulée");
      return;
    }
    setBusy(true);
    try {
      const data = await invokeAdmin({ action: "delete_all_registrations", race_id: raceId }) as AdminResponse & { deleted?: number };
      applyAdminData(data);
      toast.success(`${data.deleted ?? 0} coureur(s) supprimé(s)`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addRegistration = async () => {
    if (!raceId || !newRunner.email.trim() || !newRunner.bib_number.trim()) {
      toast.error("Email et dossard requis");
      return;
    }
    setBusy(true);
    try {
      const data = await invokeAdmin({
        action: "add_registration",
        race_id: raceId,
        email: newRunner.email.trim(),
        bib_number: newRunner.bib_number.trim(),
        category: newRunner.category.trim() || null,
        gender: newRunner.gender || null,
        emergency_phone: newRunner.emergency_phone.trim() || null,
        address: newRunner.address.trim() || null,
      });
      applyAdminData(data);
      setNewRunner(emptyRegistration);
      toast.success("Coureur ajouté");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const importRunnerFile = async () => {
    if (!raceId || !runnerImportFile) {
      toast.error("Sélectionne un fichier texte de coureurs");
      return;
    }
    if (runnerImportFile.size > 8 * 1024 * 1024) {
      toast.error("Fichier trop volumineux : limite 8 Mo");
      return;
    }
    setRunnerImporting(true);
    try {
      const content = await readTextFile(runnerImportFile);
      // Découpe le fichier en lots pour éviter le dépassement CPU de l'edge function
      const rawLines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
      const headerIdx = rawLines.findIndex((l) => l.trim());
      if (headerIdx < 0) throw new Error("Fichier vide");
      const header = rawLines[headerIdx];
      const dataLines = rawLines.slice(headerIdx + 1).filter((l) => l.trim());
      const CHUNK = 60;
      const chunks: string[] = [];
      if (!dataLines.length) {
        chunks.push(content);
      } else {
        for (let i = 0; i < dataLines.length; i += CHUNK) {
          chunks.push([header, ...dataLines.slice(i, i + CHUNK)].join("\n"));
        }
      }

      let totalRegistered = 0;
      let totalCreated = 0;
      let totalUpdated = 0;
      let totalSkipped = 0;
      const allErrors: string[] = [];
      let lastData: unknown = null;

      for (let i = 0; i < chunks.length; i += 1) {
        toast.info(`Import lot ${i + 1}/${chunks.length}…`);
        const data = await invokeAdmin({
          action: "bulk_import_registrations",
          race_id: raceId,
          file_name: runnerImportFile.name,
          content: chunks[i],
        });
        const s = data as AdminResponse & { created?: number; updated?: number; registered?: number; skipped?: number; errors?: string[] };
        totalRegistered += s.registered ?? 0;
        totalCreated += s.created ?? 0;
        totalUpdated += s.updated ?? 0;
        totalSkipped += s.skipped ?? 0;
        if (s.errors?.length) allErrors.push(...s.errors);
        lastData = data;
      }

      if (lastData) applyAdminData(lastData);
      setRunnerImportReport({ registered: totalRegistered, created: totalCreated, errors: allErrors });
      if (allErrors.length) toast.warning(`${totalRegistered} coureur(s) importé(s), ${allErrors.length} problème(s). Voir le rapport ci-dessous.`);
      else toast.success(`${totalRegistered} coureur(s) importé(s) · ${totalCreated} compte(s) créé(s)`);
      setRunnerImportFile(null);
    } catch (error) {
      toast.error((error as Error).message || "Import coureurs impossible");
    } finally {
      setRunnerImporting(false);
    }
  };

  const addOrganizer = async () => {
    if (!raceId || !newOrganizerEmail.trim()) {
      toast.error("Email organisateur requis");
      return;
    }
    setBusy(true);
    try {
      const data = await invokeAdmin({ action: "add_organizer", race_id: raceId, email: newOrganizerEmail.trim() });
      applyAdminData(data);
      setNewOrganizerEmail("");
      toast.success("Organisateur ajouté");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeOrganizer = async (organizerId: string) => {
    if (!raceId || !window.confirm("Retirer cet organisateur de cette course ?")) return;
    setBusy(true);
    try {
      const data = await invokeAdmin({ action: "remove_organizer", race_id: raceId, organizer_id: organizerId });
      applyAdminData(data);
      toast.success("Organisateur retiré");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!race) {
    return (
      <main className="container py-12">
        <p className="text-muted-foreground">Chargement de l’administration…</p>
      </main>
    );
  }

  return (
    <main className="container py-6 md:py-10">
      <Link to={`/races/${race.id}`} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
        <ChevronLeft className="h-4 w-4 mr-1" /> Retour à la course
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <Badge variant="secondary" className="mb-2">Administration</Badge>
          <h1 className="font-display text-3xl md:text-4xl font-bold">{race.name}</h1>
          <p className="text-muted-foreground mt-1">
            {format(new Date(race.start_time), "EEEE d MMMM yyyy, HH:mm", { locale: fr })}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Card className="glass-card p-3"><p className="text-2xl font-bold">{stats.total}</p><p className="text-xs text-muted-foreground">inscrits</p></Card>
          <Card className="glass-card p-3"><p className="text-2xl font-bold">{stats.imported}</p><p className="text-xs text-muted-foreground">importés</p></Card>
          <Card className="glass-card p-3"><p className="text-2xl font-bold">{stats.organizers}</p><p className="text-xs text-muted-foreground">organisateurs</p></Card>
        </div>
      </div>

      <Card className="glass-card p-4 mb-6">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="race-name">Nom de la course</Label>
            <Input
              id="race-name"
              value={raceName}
              onChange={(e) => setRaceName(e.target.value)}
              placeholder="Ex. Trail 25 km"
            />
            <p className="text-xs text-muted-foreground">
              Ce nom est affiché partout (page course, classements, imports GMCAP).
            </p>
          </div>
          <Button variant="hero" onClick={saveName} disabled={savingName || raceName.trim() === (race?.name ?? "")}>
            <Save className="h-4 w-4 mr-2" /> Enregistrer
          </Button>
        </div>
      </Card>

      <Card className="glass-card p-4 mb-6">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="race-event">Épreuve de rattachement</Label>
            <select
              id="race-event"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">— Aucune épreuve —</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.name}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Rattache cette course à une épreuve pour qu'elle apparaisse dans la section « Courses de l'épreuve ».
            </p>
          </div>
          <Button variant="hero" onClick={saveEvent} disabled={savingEvent}>
            <Save className="h-4 w-4 mr-2" /> Enregistrer
          </Button>
        </div>
      </Card>

      <Card className="glass-card p-4 mb-6">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="race-start-time">Heure de départ officielle (chrono)</Label>
            <Input
              id="race-start-time"
              type="datetime-local"
              value={startTimeInput}
              onChange={(e) => setStartTimeInput(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Sert de référence pour calculer les temps de course (même rôle que l'heure de départ GMCAP).
            </p>
          </div>
          <Button variant="hero" onClick={saveStartTime} disabled={savingStart}>
            <Save className="h-4 w-4 mr-2" /> Enregistrer
          </Button>
        </div>
      </Card>

      <Card className="glass-card p-4 mb-6">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="race-gpx">Fichier GPX du tracé</Label>
            <Input
              id="race-gpx"
              type="file"
              accept=".gpx,application/gpx+xml,application/xml,text/xml"
              onChange={(e) => setGpxFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">
              Remplace le tracé GPX. La distance et les points de route seront recalculés automatiquement.
              {gpxFile && ` Fichier sélectionné : ${gpxFile.name} · ${(gpxFile.size / 1024).toFixed(1)} Ko`}
            </p>
          </div>
          <Button variant="hero" onClick={replaceGpx} disabled={!gpxFile || uploadingGpx}>
            <Map className="h-4 w-4 mr-2" /> {uploadingGpx ? "Envoi…" : "Modifier le GPX"}
          </Button>
        </div>
      </Card>

      {race && (race.route_points?.length ?? 0) > 0 && (
        <Card className="glass-card p-2 mb-6 overflow-hidden">
          <div className="px-2 pt-2 pb-1 flex items-center gap-2">
            <Map className="h-4 w-4 text-primary-glow" />
            <h3 className="font-display font-semibold text-sm">Aperçu du tracé</h3>
            {race.distance_km != null && (
              <span className="ml-auto text-xs text-muted-foreground">{race.distance_km} km</span>
            )}
          </div>
          <div className="h-[360px] md:h-[460px]">
            <RaceMap
              routeCoords={(race.route_points ?? []).map((p) => [p.lat, p.lng])}
              routePoints={race.route_points ?? undefined}
              runners={[]}
              checkpoints={checkpoints}
            />
          </div>
          {race.gpx_geojson && (
            <div className="h-[220px] mt-2 px-1 pb-1">
              <ElevationChart
                gpxGeojson={race.gpx_geojson}
                totalDistanceKm={race.distance_km}
                runners={[]}
                checkpoints={checkpoints}
              />
            </div>
          )}
        </Card>
      )}

      {race && <RaceInviteCard raceId={race.id} raceName={race.name} />}

      {race && (
        <Card className="glass-card p-4 mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ImageIcon className="h-5 w-5 text-primary-glow" />
            <div>
              <div className="font-display font-semibold">Photos des intermédiaires</div>
              <div className="text-xs text-muted-foreground">Galerie publique des photos prises sur les points chronos</div>
            </div>
          </div>
          <Button asChild variant="hero" size="sm">
            <Link to={`/organizer/races/${race.id}/photos`}>Ouvrir la galerie</Link>
          </Button>
        </Card>
      )}

      <Tabs defaultValue="gmcap" className="space-y-4">
        <TabsList className="grid w-full max-w-3xl grid-cols-4">
          <TabsTrigger value="gmcap"><Link2 className="h-4 w-4 mr-2" /> GMCAP</TabsTrigger>
          <TabsTrigger value="runners"><Users className="h-4 w-4 mr-2" /> Coureurs</TabsTrigger>
          <TabsTrigger value="checkpoints"><Flag className="h-4 w-4 mr-2" /> Chronos</TabsTrigger>
          <TabsTrigger value="organizers"><Shield className="h-4 w-4 mr-2" /> Organisateurs</TabsTrigger>
        </TabsList>

        <TabsContent value="gmcap">
          <Card className="glass-card p-5 space-y-5">
            <div>
              <h2 className="font-display text-xl font-semibold">Lien avec le fichier GMCAP</h2>
              <p className="text-sm text-muted-foreground mt-1">Le classement officiel vient du fichier GMCAP, synchronisé toutes les minutes lorsque la source est active.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
              <div className="space-y-2">
                <Label htmlFor="source-url">URL HTTP/HTTPS de l’export GMCAP</Label>
                <Input id="source-url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://.../GmCAP-Export.txt" />
              </div>
              <Button variant="hero" onClick={saveGmcap} disabled={busy}><Save className="h-4 w-4 mr-2" /> Enregistrer</Button>
            </div>
            <div className="space-y-3 rounded-lg border border-border/50 bg-secondary/20 p-4">
              <div>
                <h3 className="font-display text-sm font-semibold">Choisir un fichier depuis GitHub</h3>
                <p className="text-xs text-muted-foreground mt-1">Liste les fichiers .txt/.csv/.tsv d'un dossier d'un dépôt public, puis remplit automatiquement l'URL ci-dessus.</p>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="gh-repo" className="text-xs">Dépôt (owner/repo)</Label>
                  <Input id="gh-repo" value={githubRepo} onChange={(e) => setGithubRepo(e.target.value)} placeholder="florentcoco1/finistracklive" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gh-path" className="text-xs">Dossier</Label>
                  <Input id="gh-path" value={githubPath} onChange={(e) => setGithubPath(e.target.value)} placeholder="public" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gh-branch" className="text-xs">Branche</Label>
                  <Input id="gh-branch" value={githubBranch} onChange={(e) => setGithubBranch(e.target.value)} placeholder="main" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="glass" onClick={loadGithubFiles} disabled={githubLoading}>
                  {githubLoading ? "Chargement…" : "Lister les fichiers"}
                </Button>
                {githubFiles.length > 0 && (
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm flex-1 min-w-[200px]"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                  >
                    <option value="">— Sélectionne un fichier —</option>
                    {githubFiles.map((f) => (
                      <option key={f.download_url} value={f.download_url}>{f.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={sourceEnabled} onChange={(e) => setSourceEnabled(e.target.checked)} className="accent-current" /> Synchronisation automatique toutes les minutes
            </label>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/50 bg-secondary/30 p-3">
              <Badge variant={source?.last_import_status === "error" ? "destructive" : "secondary"}>
                {source?.last_import_status === "pending_schema" || localPendingFile ? "import en attente" : source?.last_import_status ?? "non configuré"}
              </Badge>
              <p className="text-sm text-muted-foreground flex-1">
                {localPendingFile ? `Fichier gardé sur ce PC : ${localPendingFile}` : source?.last_import_status === "pending_schema" && source.file_name ? `Fichier en attente : ${source.file_name}` : source?.last_import_at ? `Dernier import le ${format(new Date(source.last_import_at), "dd/MM/yyyy à HH:mm:ss", { locale: fr })}` : "Aucun import lancé"}
                {source?.last_import_message ? ` · ${source.last_import_message}` : ""}
              </p>
              <Button variant="glass" onClick={localPendingFile ? retryLocalPendingImport : syncGmcap} disabled={(!source && !localPendingFile) || source?.source_type === "manual_upload" || (source?.source_type === "manual_file" && source?.last_import_status !== "pending_schema") || syncing || manualImporting}><RefreshCw className="h-4 w-4 mr-2" /> {syncing || manualImporting ? "Vérif…" : source?.last_import_status === "pending_schema" || localPendingFile ? "Vérifier maintenant" : "Sync maintenant"}</Button>
            </div>
            <div className="space-y-3 rounded-lg border border-border/50 bg-secondary/20 p-4">
              <div>
                <h3 className="font-display text-lg font-semibold">Import manuel depuis le PC GMCAP</h3>
                <p className="text-sm text-muted-foreground mt-1">Sélectionne l'export texte/TSV généré par GMCAP sur cet ordinateur. Si le service est temporairement indisponible, le fichier est gardé en attente puis importé automatiquement.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <div className="space-y-2">
                  <Label htmlFor="gmcap-file">Fichier export GMCAP</Label>
                  <Input
                    id="gmcap-file"
                    type="file"
                    accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values"
                    onChange={(e) => setGmcapFile(e.target.files?.[0] ?? null)}
                  />
                  {gmcapFile && <p className="text-xs text-muted-foreground">{gmcapFile.name} · {(gmcapFile.size / 1024).toFixed(1)} Ko</p>}
                </div>
                <Button variant="hero" onClick={importGmcapFile} disabled={!gmcapFile || manualImporting}>
                  <Upload className="h-4 w-4 mr-2" /> {manualImporting ? "Import…" : "Importer maintenant"}
                </Button>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={markFinishedOnImport}
                  onChange={(e) => setMarkFinishedOnImport(e.target.checked)}
                  className="accent-current"
                />
                Marquer la course comme terminée après cet import (dernier fichier GMCAP)
                {race.status === "finished" && <Badge variant="secondary" className="ml-2">déjà terminée</Badge>}
              </label>
            </div>
            <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <p>La synchronisation automatique nécessite un lien HTTP/HTTPS accessible par FinisTrackLive. L’import manuel fonctionne directement avec un fichier local du PC utilisé pour GMCAP.</p>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="runners">
          <Card className="glass-card p-5 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-semibold">Inscrits coureurs</h2>
                <p className="text-sm text-muted-foreground mt-1">Associe les dossards et catégories. Le classement officiel est rapproché automatiquement par numéro de dossard avec les résultats GMCAP.</p>
              </div>
              <Button variant="destructive" size="sm" onClick={deleteAllRegistrations} disabled={busy || registrations.length === 0}>
                <Trash2 className="h-4 w-4 mr-2" /> Supprimer tous les coureurs
              </Button>
            </div>
            <div className="space-y-3 rounded-lg border border-border/50 bg-secondary/20 p-4">
              <div>
                <h3 className="font-display text-lg font-semibold">Import massif depuis un fichier texte</h3>
                <p className="text-sm text-muted-foreground mt-1">Importe un export TSV/CSV avec en-têtes Nom, Prénom, EMail, Numéro, Tel et Catégorie.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <div className="space-y-2">
                  <Label htmlFor="runner-import-file">Fichier coureurs</Label>
                  <Input
                    id="runner-import-file"
                    type="file"
                    accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values,text/csv"
                    onChange={(e) => setRunnerImportFile(e.target.files?.[0] ?? null)}
                  />
                  {runnerImportFile && <p className="text-xs text-muted-foreground">{runnerImportFile.name} · {(runnerImportFile.size / 1024).toFixed(1)} Ko</p>}
                </div>
                <Button variant="hero" onClick={importRunnerFile} disabled={!runnerImportFile || runnerImporting}>
                  <Upload className="h-4 w-4 mr-2" /> {runnerImporting ? "Import…" : "Importer les coureurs"}
                </Button>
              </div>
              {runnerImportReport && (
                <div className={`rounded-lg border p-3 text-sm space-y-2 ${runnerImportReport.errors.length ? "border-warning/40 bg-warning/10" : "border-emerald-500/30 bg-emerald-500/10"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">
                      {runnerImportReport.registered} coureur(s) importé(s) · {runnerImportReport.created} compte(s) créé(s)
                      {runnerImportReport.errors.length ? ` · ${runnerImportReport.errors.length} problème(s)` : ""}
                    </p>
                    <Button variant="ghost" size="sm" onClick={() => setRunnerImportReport(null)}>Fermer</Button>
                  </div>
                  {runnerImportReport.errors.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-warning">Doublons et conflits de dossards</p>
                      <ul className="list-disc pl-5 space-y-1 max-h-56 overflow-y-auto">
                        {runnerImportReport.errors.map((err, idx) => (
                          <li key={idx} className="text-xs">{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-[1fr_110px_120px_110px_150px_1fr_auto] lg:items-end">
              <div className="space-y-2"><Label>Email utilisateur</Label><Input value={newRunner.email} onChange={(e) => setNewRunner((v) => ({ ...v, email: e.target.value }))} placeholder="coureur@email.fr" /></div>
              <div className="space-y-2"><Label>Dossard</Label><Input value={newRunner.bib_number} onChange={(e) => setNewRunner((v) => ({ ...v, bib_number: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Catégorie</Label><Input value={newRunner.category} onChange={(e) => setNewRunner((v) => ({ ...v, category: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Sexe</Label>
                <select value={newRunner.gender} onChange={(e) => setNewRunner((v) => ({ ...v, gender: e.target.value }))} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="">—</option>
                  <option value="M">H</option>
                  <option value="F">F</option>
                </select>
              </div>
              <div className="space-y-2"><Label>Téléphone</Label><Input value={newRunner.emergency_phone} onChange={(e) => setNewRunner((v) => ({ ...v, emergency_phone: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Adresse</Label><Input value={newRunner.address} onChange={(e) => setNewRunner((v) => ({ ...v, address: e.target.value }))} /></div>
              <Button variant="hero" onClick={addRegistration} disabled={busy}><UserPlus className="h-4 w-4 mr-2" /> Ajouter</Button>
            </div>
            <div className="rounded-lg border border-border/50 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Coureur</TableHead>
                    <TableHead>Sexe</TableHead>
                    <TableHead>Dossard</TableHead>
                    <TableHead>Catégorie</TableHead>
                    <TableHead>Téléphone</TableHead>
                    <TableHead>Adresse</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...registrations].sort((a, b) => {
                    const na = parseInt(String(a.bib_number ?? "").replace(/\D/g, ""), 10);
                    const nb = parseInt(String(b.bib_number ?? "").replace(/\D/g, ""), 10);
                    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
                    return String(a.bib_number ?? "").localeCompare(String(b.bib_number ?? ""));
                  }).map((registration) => (
                    <TableRow key={registration.id}>
                      <TableCell>
                        <p className="font-medium">{displayName(registration.profile)}</p>
                        <p className="text-xs text-muted-foreground">{registration.profile?.email}</p>
                      </TableCell>
                      <TableCell>{genderLabel(registration.gender)}</TableCell>
                      <TableCell><Input value={registration.bib_number} onChange={(e) => setRegistrations((rows) => rows.map((r) => r.id === registration.id ? { ...r, bib_number: e.target.value } : r))} className="min-w-20" /></TableCell>
                      <TableCell><Input value={registration.category ?? ""} onChange={(e) => setRegistrations((rows) => rows.map((r) => r.id === registration.id ? { ...r, category: e.target.value } : r))} className="min-w-24" /></TableCell>
                      <TableCell><Input value={registration.emergency_phone ?? ""} onChange={(e) => setRegistrations((rows) => rows.map((r) => r.id === registration.id ? { ...r, emergency_phone: e.target.value } : r))} className="min-w-32" /></TableCell>
                      <TableCell><Input value={registration.address ?? ""} onChange={(e) => setRegistrations((rows) => rows.map((r) => r.id === registration.id ? { ...r, address: e.target.value } : r))} className="min-w-56" /></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="glass" size="icon" onClick={() => updateRegistration(registration)} disabled={busy} aria-label="Enregistrer"><Save className="h-4 w-4" /></Button>
                          <Button variant="destructive" size="icon" onClick={() => deleteRegistration(registration.id)} disabled={busy} aria-label="Retirer"><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="checkpoints">
          <Card className="glass-card p-5">
            <RaceCheckpoints raceId={race.id} eventId={race.event_id} raceStartTime={race.start_time} registrations={registrations.map((r) => ({ id: r.id, bib_number: r.bib_number, profile: r.profile }))} />
          </Card>
        </TabsContent>

        <TabsContent value="organizers">
          <Card className="glass-card p-5 space-y-5">
            <div>
              <h2 className="font-display text-xl font-semibold">Organisateurs de la course</h2>
              <p className="text-sm text-muted-foreground mt-1">Donne accès à l’administration GMCAP et à la gestion des inscrits pour cette course.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <div className="space-y-2"><Label>Email utilisateur</Label><Input value={newOrganizerEmail} onChange={(e) => setNewOrganizerEmail(e.target.value)} placeholder="organisateur@email.fr" /></div>
              <Button variant="hero" onClick={addOrganizer} disabled={busy}><Plus className="h-4 w-4 mr-2" /> Ajouter organisateur</Button>
            </div>
            <div className="rounded-lg border border-border/50 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Organisateur</TableHead><TableHead>Rôle</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {organizers.map((organizer) => (
                    <TableRow key={`${organizer.id}-${organizer.user_id}`}>
                      <TableCell><p className="font-medium">{displayName(organizer.profile)}</p><p className="text-xs text-muted-foreground">{organizer.profile?.email}</p></TableCell>
                      <TableCell><Badge variant="secondary">{organizer.role}</Badge></TableCell>
                      <TableCell className="text-right">
                        {organizer.id !== "owner" && <Button variant="destructive" size="icon" onClick={() => removeOrganizer(organizer.user_id)} disabled={busy} aria-label="Retirer"><Trash2 className="h-4 w-4" /></Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  );
}
