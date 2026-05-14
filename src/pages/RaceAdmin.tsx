import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { AlertTriangle, ChevronLeft, Flag, Link2, Plus, RefreshCw, Save, Shield, Trash2, Upload, UserPlus, Users } from "lucide-react";
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

interface RaceSummary {
  id: string;
  name: string;
  start_time: string;
  status: string;
  event_id: string | null;
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

const emptyRegistration = { email: "", bib_number: "", category: "", emergency_phone: "" };
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
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [manualImporting, setManualImporting] = useState(false);
  const [gmcapFile, setGmcapFile] = useState<File | null>(null);
  const [markFinishedOnImport, setMarkFinishedOnImport] = useState(false);
  const [runnerImportFile, setRunnerImportFile] = useState<File | null>(null);
  const [runnerImporting, setRunnerImporting] = useState(false);
  const [localPendingFile, setLocalPendingFile] = useState<string | null>(null);
  const [newRunner, setNewRunner] = useState(emptyRegistration);
  const [newOrganizerEmail, setNewOrganizerEmail] = useState("");
  const [startTimeInput, setStartTimeInput] = useState("");
  const [savingStart, setSavingStart] = useState(false);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventId, setEventId] = useState<string>("");
  const [savingEvent, setSavingEvent] = useState(false);

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

    supabase
      .from("races")
      .select("id, name, start_time, status, event_id")
      .eq("id", raceId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          toast.error("Course introuvable");
          navigate("/races");
          return;
        }
        setRace(data as RaceSummary);
        setEventId((data as RaceSummary).event_id ?? "");
        const d = new Date((data as RaceSummary).start_time);
        const pad = (n: number) => String(n).padStart(2, "0");
        setStartTimeInput(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
        document.title = `Administration ${data.name} — FinisTrackLive`;
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
    return { total: registrations.length, organizers: organizers.length };
  }, [registrations, organizers]);

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
      toast.success(`Import GMCAP terminé : ${payload.matched ?? 0} coureur(s) lié(s), ${payload.imported ?? 0} résultat(s) importé(s)`);
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
        emergency_phone: newRunner.emergency_phone.trim() || null,
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
      const data = await invokeAdmin({ action: "bulk_import_registrations", race_id: raceId, file_name: runnerImportFile.name, content });
      applyAdminData(data);
      const summary = data as AdminResponse & { created?: number; updated?: number; registered?: number; skipped?: number; errors?: string[] };
      if (summary.errors?.length) toast.warning(`${summary.registered ?? 0} coureur(s) importé(s), ${summary.errors.length} erreur(s) à vérifier.`);
      else toast.success(`${summary.registered ?? 0} coureur(s) importé(s) · ${summary.created ?? 0} compte(s) créé(s)`);
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
        <div className="grid grid-cols-2 gap-2 text-center">
          <Card className="glass-card p-3"><p className="text-2xl font-bold">{stats.total}</p><p className="text-xs text-muted-foreground">coureurs</p></Card>
          <Card className="glass-card p-3"><p className="text-2xl font-bold">{stats.organizers}</p><p className="text-xs text-muted-foreground">organisateurs</p></Card>
        </div>
      </div>

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

      {race && <RaceInviteCard raceId={race.id} raceName={race.name} />}

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
            <div>
              <h2 className="font-display text-xl font-semibold">Inscrits coureurs</h2>
              <p className="text-sm text-muted-foreground mt-1">Associe les dossards et catégories. Le classement officiel est rapproché automatiquement par numéro de dossard avec les résultats GMCAP.</p>
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
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_120px_120px_160px_auto] md:items-end">
              <div className="space-y-2"><Label>Email utilisateur</Label><Input value={newRunner.email} onChange={(e) => setNewRunner((v) => ({ ...v, email: e.target.value }))} placeholder="coureur@email.fr" /></div>
              <div className="space-y-2"><Label>Dossard</Label><Input value={newRunner.bib_number} onChange={(e) => setNewRunner((v) => ({ ...v, bib_number: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Catégorie</Label><Input value={newRunner.category} onChange={(e) => setNewRunner((v) => ({ ...v, category: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Téléphone</Label><Input value={newRunner.emergency_phone} onChange={(e) => setNewRunner((v) => ({ ...v, emergency_phone: e.target.value }))} /></div>
              <Button variant="hero" onClick={addRegistration} disabled={busy}><UserPlus className="h-4 w-4 mr-2" /> Ajouter</Button>
            </div>
            <div className="rounded-lg border border-border/50 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Coureur</TableHead>
                    <TableHead>Sexe</TableHead>
                    <TableHead>Dossard</TableHead>
                    <TableHead>Catégorie</TableHead>
                    <TableHead>Téléphone</TableHead>
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
            <RaceCheckpoints raceId={race.id} raceStartTime={race.start_time} registrations={registrations.map((r) => ({ id: r.id, bib_number: r.bib_number, profile: r.profile }))} />
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
