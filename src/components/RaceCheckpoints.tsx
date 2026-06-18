import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Flag, Plus, Save, Trash2, X, Zap } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PHOTO_BUCKET = "checkpoint-photos";

async function uploadCheckpointPhoto(file: File, checkpointId: string, registrationId: string) {
  const form = new FormData();
  form.append("file", file);
  form.append("checkpoint_id", checkpointId);
  form.append("registration_id", registrationId);
  const { data, error } = await supabase.functions.invoke("upload-checkpoint-photo", { body: form });
  if (error) throw error;
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as { ok: true; path: string; public_url: string };
}

interface Checkpoint {
  id: string;
  race_id: string;
  name: string;
  distance_km: number | null;
  source: "manual" | "gmcap";
  position: number;
  detector_id: number | null;
}

interface RegistrationLite {
  id: string;
  bib_number: string;
  profile: { first_name: string | null; last_name: string | null; email: string | null } | null;
}

interface CheckpointTime {
  id: string;
  checkpoint_id: string;
  registration_id: string;
  time_seconds: number | null;
  time_text: string | null;
}

const emptyNew = { name: "", distance_km: "", source: "manual" as "manual" | "gmcap", detector_id: "31" };

function parseTime(input: string): { seconds: number | null; text: string | null } {
  const s = input.trim();
  if (!s) return { seconds: null, text: null };
  const parts = s.split(":").map((p) => p.trim());
  if (parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return { seconds: null, text: s };
  let h = 0, m = 0, sec = 0;
  if (parts.length === 3) [h, m, sec] = parts.map(Number);
  else if (parts.length === 2) [m, sec] = parts.map(Number);
  else sec = Number(parts[0]);
  const total = Math.round(h * 3600 + m * 60 + sec);
  return { seconds: total, text: s };
}

function formatTime(seconds: number | null, fallback: string | null): string {
  if (seconds == null) return fallback ?? "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface EventRunner {
  registration_id: string;
  race_id: string;
  race_name: string;
  race_start_time: string | null;
  bib_number: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

export function RaceCheckpoints({ raceId, eventId, raceStartTime, registrations }: { raceId: string; eventId?: string | null; raceStartTime?: string | null; registrations: RegistrationLite[] }) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [times, setTimes] = useState<CheckpointTime[]>([]);
  const [newCp, setNewCp] = useState(emptyNew);
  const [busy, setBusy] = useState(false);
  const [activeCp, setActiveCp] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({}); // key registrationId
  const [bibInput, setBibInput] = useState("");
  const [recentEntries, setRecentEntries] = useState<Array<{ bib: string; firstName: string; lastName: string; raceName: string; text: string; photos: string[] }>>([]);
  const bibRef = useRef<HTMLInputElement | null>(null);
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [photosByReg, setPhotosByReg] = useState<Record<string, string[]>>({});
  const [uploadingReg, setUploadingReg] = useState<string | null>(null);
  const [eventRunners, setEventRunners] = useState<EventRunner[]>([]);
  const [eventCheckpoints, setEventCheckpoints] = useState<Array<{ id: string; race_id: string; name: string }>>([]);

  const ensureSchema = useCallback(async () => {
    await supabase.functions.invoke("ensure-checkpoints-schema");
    await new Promise((r) => setTimeout(r, 1000));
  }, []);

  const isMissingSchema = (err: any) =>
    err && (err.code === "PGRST205" || /race_checkpoints|runner_checkpoint_times/.test(String(err.message ?? "")));

  const load = useCallback(async () => {
    const sb = supabase as any;
    let { data: cps, error: cpErr } = await sb.from("race_checkpoints").select("*").eq("race_id", raceId).order("position");
    if (cpErr && isMissingSchema(cpErr)) {
      await ensureSchema();
      ({ data: cps } = await sb.from("race_checkpoints").select("*").eq("race_id", raceId).order("position"));
    }
    setCheckpoints((cps ?? []) as Checkpoint[]);
    const ids = ((cps ?? []) as Checkpoint[]).map((c) => c.id);
    if (ids.length) {
      const { data: t2 } = await sb
        .from("runner_checkpoint_times")
        .select("id, checkpoint_id, registration_id, time_seconds, time_text")
        .in("checkpoint_id", ids);
      setTimes((t2 ?? []) as CheckpointTime[]);
    } else {
      setTimes([]);
    }
  }, [raceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Load all runners + checkpoints of the parent event for cross-race bib lookup
  useEffect(() => {
    if (!eventId) {
      setEventRunners([]);
      setEventCheckpoints([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const sb = supabase as any;
      const { data: races } = await sb.from("races").select("id, name, start_time").eq("event_id", eventId);
      const raceIds = (races ?? []).map((r: any) => r.id);
      if (raceIds.length === 0) return;
      const raceMeta = new Map<string, { name: string; start_time: string | null }>(
        (races ?? []).map((r: any) => [r.id, { name: r.name, start_time: r.start_time }]),
      );
      const { data: regs } = await sb
        .from("race_registrations")
        .select("id, race_id, bib_number, runner:profiles!race_registrations_runner_id_fkey(first_name, last_name, email)")
        .in("race_id", raceIds);
      const { data: cps } = await sb
        .from("race_checkpoints")
        .select("id, race_id, name")
        .in("race_id", raceIds);
      if (cancelled) return;
      const runners: EventRunner[] = (regs ?? []).map((r: any) => {
        const meta = raceMeta.get(r.race_id) ?? { name: "", start_time: null };
        return {
          registration_id: r.id,
          race_id: r.race_id,
          race_name: meta.name,
          race_start_time: meta.start_time,
          bib_number: r.bib_number,
          first_name: r.runner?.first_name ?? null,
          last_name: r.runner?.last_name ?? null,
          email: r.runner?.email ?? null,
        };
      });
      setEventRunners(runners);
      setEventCheckpoints((cps ?? []) as any);
    })();
    return () => { cancelled = true; };
  }, [eventId, checkpoints.length]);

  useEffect(() => {
    if (!activeCp) {
      setDrafts({});
      return;
    }
    const map: Record<string, string> = {};
    times.filter((t) => t.checkpoint_id === activeCp).forEach((t) => {
      map[t.registration_id] = formatTime(t.time_seconds, t.time_text);
    });
    setDrafts(map);
  }, [activeCp, times]);

  const addCheckpoint = async () => {
    if (!newCp.name.trim()) return toast.error("Nom du point requis");
    setBusy(true);
    const payload: Record<string, unknown> = {
      race_id: raceId,
      name: newCp.name.trim(),
      distance_km: newCp.distance_km ? Number(newCp.distance_km) : null,
      source: newCp.source,
      position: checkpoints.length,
      detector_id: newCp.source === "gmcap" ? Number(newCp.detector_id) || null : null,
    };
    let { error } = await (supabase as any).from("race_checkpoints").insert(payload);
    if (error && isMissingSchema(error)) {
      await ensureSchema();
      ({ error } = await (supabase as any).from("race_checkpoints").insert(payload));
    }
    setBusy(false);
    if (error) return toast.error(error.message);
    setNewCp(emptyNew);
    toast.success("Point de chrono ajouté");
    void load();
  };

  const deleteCheckpoint = async (id: string) => {
    if (!window.confirm("Supprimer ce point de chrono et toutes ses saisies ?")) return;
    const { error } = await (supabase as any).from("race_checkpoints").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (activeCp === id) setActiveCp(null);
    void load();
  };

  const sortedRegs = useMemo(
    () =>
      [...registrations].sort((a, b) => {
        const na = parseInt(String(a.bib_number ?? "").replace(/\D/g, ""), 10);
        const nb = parseInt(String(b.bib_number ?? "").replace(/\D/g, ""), 10);
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
        return String(a.bib_number ?? "").localeCompare(String(b.bib_number ?? ""));
      }),
    [registrations],
  );

  const saveTime = async (registrationId: string) => {
    if (!activeCp) return;
    const raw = drafts[registrationId] ?? "";
    const { seconds, text } = parseTime(raw);
    const sb = supabase as any;
    setBusy(true);
    if (!raw.trim()) {
      const existing = times.find((t) => t.checkpoint_id === activeCp && t.registration_id === registrationId);
      if (existing) {
        const { error } = await sb.from("runner_checkpoint_times").delete().eq("id", existing.id);
        if (error) toast.error(error.message);
      }
    } else {
      const { error } = await sb
        .from("runner_checkpoint_times")
        .upsert(
          { checkpoint_id: activeCp, registration_id: registrationId, time_seconds: seconds, time_text: text, recorded_at: new Date().toISOString() },
          { onConflict: "checkpoint_id,registration_id" },
        );
      if (error) toast.error(error.message);
    }
    setBusy(false);
    void load();
  };

  const submitBib = async () => {
    if (!activeCp) return;
    const bib = bibInput.trim();
    if (!bib) return;
    const active = checkpoints.find((c) => c.id === activeCp);
    if (!active) return;

    // 1) Try local race first
    let targetRegId: string | null = null;
    let targetCheckpointId: string = activeCp;
    let targetStart: string | null = raceStartTime ?? null;
    let targetRaceName = "";
    let firstName = "";
    let lastName = "";

    const localReg = registrations.find((r) => String(r.bib_number).trim() === bib);
    if (localReg) {
      targetRegId = localReg.id;
      firstName = localReg.profile?.first_name ?? "";
      lastName = localReg.profile?.last_name ?? "";
    } else {
      // 2) Look across the event
      const xReg = eventRunners.find((r) => String(r.bib_number).trim() === bib);
      if (xReg) {
        const xCp = eventCheckpoints.find((c) => c.race_id === xReg.race_id && c.name === active.name);
        if (!xCp) {
          toast.error(`Aucun point « ${active.name} » sur la course « ${xReg.race_name} ». Crée-le d'abord pour cette course.`);
          return;
        }
        targetRegId = xReg.registration_id;
        targetCheckpointId = xCp.id;
        targetStart = xReg.race_start_time;
        targetRaceName = xReg.race_name;
        firstName = xReg.first_name ?? "";
        lastName = xReg.last_name ?? "";
      } else {
        // 3) Look across ALL accessible races (any event) for a checkpoint of the same name
        const sb = supabase as any;
        const { data: cps } = await sb
          .from("race_checkpoints")
          .select("id, race_id, name, race:races(id, name, start_time)")
          .eq("name", active.name);
        const candidateRaceIds = (cps ?? []).map((c: any) => c.race_id);
        if (candidateRaceIds.length === 0) {
          toast.error(`Dossard ${bib} introuvable et aucun autre point « ${active.name} » trouvé.`);
          return;
        }
        const { data: regs } = await sb
          .from("race_registrations")
          .select("id, race_id, bib_number, runner:profiles!race_registrations_runner_id_fkey(first_name, last_name, email)")
          .in("race_id", candidateRaceIds)
          .eq("bib_number", bib);
        const match = (regs ?? [])[0];
        if (!match) {
          toast.error(`Dossard ${bib} introuvable sur une course avec le point « ${active.name} ».`);
          return;
        }
        const xCp = (cps ?? []).find((c: any) => c.race_id === match.race_id);
        targetRegId = match.id;
        targetCheckpointId = xCp.id;
        targetStart = xCp.race?.start_time ?? null;
        targetRaceName = xCp.race?.name ?? "";
        firstName = match.runner?.first_name ?? "";
        lastName = match.runner?.last_name ?? "";
      }
    }


    if (!targetStart) {
      toast.error("Heure de départ de la course inconnue");
      return;
    }
    const startMs = new Date(targetStart).getTime();
    const nowMs = Date.now();
    const seconds = Math.max(0, Math.round((nowMs - startMs) / 1000));
    const text = formatTime(seconds, null);
    const sb = supabase as any;
    setBusy(true);
    const { error } = await sb
      .from("runner_checkpoint_times")
      .upsert(
        { checkpoint_id: targetCheckpointId, registration_id: targetRegId, time_seconds: seconds, time_text: text, recorded_at: new Date().toISOString() },
        { onConflict: "checkpoint_id,registration_id" },
      );
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }
    const uploadedUrls: string[] = [];
    if (pendingPhotos.length > 0) {
      for (const f of pendingPhotos) {
        try {
          const res = await uploadCheckpointPhoto(f, targetCheckpointId, targetRegId!);
          uploadedUrls.push(res.public_url);
        } catch (e) {
          toast.error(`Photo non envoyée : ${(e as Error).message}`);
        }
      }
      if (targetCheckpointId === activeCp) {
        setPhotosByReg((m) => ({ ...m, [targetRegId!]: [...(m[targetRegId!] ?? []), ...uploadedUrls] }));
      }
      setPendingPhotos([]);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
    setBusy(false);
    setRecentEntries((prev) => [{ bib, firstName, lastName, raceName: targetRaceName, text, photos: uploadedUrls }, ...prev].slice(0, 8));
    toast.success(`Dossard ${bib} — ${text}${targetRaceName ? ` · ${targetRaceName}` : ""}${uploadedUrls.length ? ` · ${uploadedUrls.length} photo(s)` : ""}`);
    setBibInput("");
    bibRef.current?.focus();
    void load();
  };

  // Load existing photos for active checkpoint
  useEffect(() => {
    if (!activeCp) { setPhotosByReg({}); return; }
    let cancelled = false;
    (async () => {
      const { data: dirs } = await supabase.storage.from(PHOTO_BUCKET).list(activeCp, { limit: 1000 });
      if (cancelled || !dirs) return;
      const map: Record<string, string[]> = {};
      for (const d of dirs) {
        if (!d.name) continue;
        const regId = d.name;
        const { data: files } = await supabase.storage.from(PHOTO_BUCKET).list(`${activeCp}/${regId}`, { limit: 1000 });
        if (!files) continue;
        map[regId] = files
          .filter((f) => f.name)
          .map((f) => supabase.storage.from(PHOTO_BUCKET).getPublicUrl(`${activeCp}/${regId}/${f.name}`).data.publicUrl);
      }
      if (!cancelled) setPhotosByReg(map);
    })();
    return () => { cancelled = true; };
  }, [activeCp]);

  const uploadPhotosForReg = async (registrationId: string, files: FileList | null) => {
    if (!activeCp || !files || files.length === 0) return;
    setUploadingReg(registrationId);
    const urls: string[] = [];
    for (const f of Array.from(files)) {
      try {
        const res = await uploadCheckpointPhoto(f, activeCp, registrationId);
        urls.push(res.public_url);
      } catch (e) {
        toast.error(`Photo non envoyée : ${(e as Error).message}`);
      }
    }
    if (urls.length) {
      setPhotosByReg((m) => ({ ...m, [registrationId]: [...(m[registrationId] ?? []), ...urls] }));
      toast.success(`${urls.length} photo(s) ajoutée(s)`);
    }
    setUploadingReg(null);
  };

  const active = checkpoints.find((c) => c.id === activeCp) ?? null;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-semibold">Points de chronométrage</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Crée des points de passage manuels (KM10, KM15…) ou marque-les comme automatiques (importés depuis GMCAP). La saisie manuelle se fait par dossard.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_120px_180px_160px_auto] md:items-end">
        <div className="space-y-2"><Label>Nom du point</Label><Input value={newCp.name} onChange={(e) => setNewCp((v) => ({ ...v, name: e.target.value }))} placeholder="KM10" /></div>
        <div className="space-y-2"><Label>Distance (km)</Label><Input type="number" step="0.1" value={newCp.distance_km} onChange={(e) => setNewCp((v) => ({ ...v, distance_km: e.target.value }))} /></div>
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={newCp.source} onValueChange={(v) => setNewCp((s) => ({ ...s, source: v as "manual" | "gmcap" }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manuel (saisie organisateur)</SelectItem>
              <SelectItem value="gmcap">Automatique (GMCAP)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Détecteur</Label>
          <Select
            value={newCp.detector_id}
            onValueChange={(v) => setNewCp((s) => ({ ...s, detector_id: v }))}
            disabled={newCp.source !== "gmcap"}
          >
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="31">31 — Arrivée</SelectItem>
              {Array.from({ length: 20 }, (_, i) => 11 + i).map((n) => (
                <SelectItem key={n} value={String(n)}>{n} — Intermédiaire</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="hero" onClick={addCheckpoint} disabled={busy}><Plus className="h-4 w-4 mr-2" /> Ajouter</Button>
      </div>

      <div className="rounded-lg border border-border/50 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Distance</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Saisies</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {checkpoints.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">Aucun point de chrono pour cette course.</TableCell></TableRow>
            )}
            {checkpoints.map((cp) => {
              const count = times.filter((t) => t.checkpoint_id === cp.id).length;
              return (
                <TableRow key={cp.id}>
                  <TableCell className="font-medium"><Flag className="h-4 w-4 inline mr-2 text-primary" />{cp.name}</TableCell>
                  <TableCell>{cp.distance_km != null ? `${cp.distance_km} km` : "—"}</TableCell>
                  <TableCell>
                    {cp.source === "gmcap" ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">GMCAP auto</Badge>
                        <Select
                          value={cp.detector_id != null ? String(cp.detector_id) : ""}
                          onValueChange={async (v) => {
                            const { error } = await (supabase as any)
                              .from("race_checkpoints")
                              .update({ detector_id: Number(v) })
                              .eq("id", cp.id);
                            if (error) toast.error(error.message);
                            else { toast.success(`Détecteur D${v} associé`); void load(); }
                          }}
                        >
                          <SelectTrigger className="h-7 w-32 text-xs"><SelectValue placeholder="Détecteur…" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="31">31 — Arrivée</SelectItem>
                            {Array.from({ length: 20 }, (_, i) => 11 + i).map((n) => (
                              <SelectItem key={n} value={String(n)}>{n} — Intermédiaire</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <Badge variant="outline">Manuel</Badge>
                    )}
                  </TableCell>
                  <TableCell>{count} / {registrations.length}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {cp.source === "manual" && (
                        <Button variant={activeCp === cp.id ? "hero" : "glass"} size="sm" onClick={() => setActiveCp(activeCp === cp.id ? null : cp.id)}>
                          {activeCp === cp.id ? "Fermer" : "Saisir temps"}
                        </Button>
                      )}
                      <Button variant="destructive" size="icon" onClick={() => deleteCheckpoint(cp.id)} aria-label="Supprimer"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {active && active.source === "manual" && (
        <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-lg font-semibold">Saisie manuelle — {active.name}</h3>
              <p className="text-xs text-muted-foreground">
                Saisis le N° de dossard puis valide : l'heure du PC est utilisée comme heure de passage. Le temps de course est calculé depuis l'heure de départ {raceStartTime ? `(${new Date(raceStartTime).toLocaleString("fr-FR")})` : ""}.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-border/50 bg-background/40 p-3 space-y-3">
            <Label className="text-sm font-semibold flex items-center gap-2"><Zap className="h-4 w-4 text-primary" /> Chrono rapide par dossard</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                ref={bibRef}
                autoFocus
                value={bibInput}
                onChange={(e) => setBibInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submitBib(); } }}
                placeholder="N° de dossard"
                className="max-w-48 font-mono text-lg"
                inputMode="numeric"
              />
              <Button variant="hero" onClick={() => void submitBib()} disabled={busy || !bibInput.trim()}>
                Valider <span className="ml-2 text-xs opacity-70">(Entrée)</span>
              </Button>
              <Button type="button" variant="glass" onClick={() => photoInputRef.current?.click()}>
                <Camera className="h-4 w-4 mr-2" /> Photo {pendingPhotos.length > 0 ? `(${pendingPhotos.length})` : ""}
              </Button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (files) setPendingPhotos((prev) => [...prev, ...Array.from(files)]);
                }}
              />
            </div>
            {pendingPhotos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {pendingPhotos.map((f, i) => (
                  <div key={i} className="relative">
                    <img src={URL.createObjectURL(f)} alt="" className="h-16 w-16 object-cover rounded border border-border/50" />
                    <button
                      type="button"
                      onClick={() => setPendingPhotos((p) => p.filter((_, idx) => idx !== i))}
                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5"
                      aria-label="Retirer"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground w-full">Les photos seront jointes au prochain dossard validé.</p>
              </div>
            )}
            {!raceStartTime && (
              <p className="text-xs text-destructive">Définis l'heure de départ de la course pour activer la saisie rapide.</p>
            )}
            {recentEntries.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Derniers passages enregistrés</p>
                <div className="rounded-md border border-border/50 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Dossard</TableHead>
                        <TableHead>Prénom</TableHead>
                        <TableHead>Nom</TableHead>
                        <TableHead>Course</TableHead>
                        <TableHead className="text-right">Temps</TableHead>
                        <TableHead>Photos</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentEntries.map((e, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono">#{e.bib}</TableCell>
                          <TableCell>{e.firstName || "—"}</TableCell>
                          <TableCell>{e.lastName || "—"}</TableCell>
                          <TableCell>{e.raceName || <span className="text-muted-foreground italic">course actuelle</span>}</TableCell>
                          <TableCell className="font-mono text-right">{e.text}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 flex-wrap">
                              {e.photos.map((u, j) => (
                                <a key={j} href={u} target="_blank" rel="noreferrer">
                                  <img src={u} alt="" className="h-8 w-8 object-cover rounded border border-border/50" />
                                </a>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">Tu peux aussi corriger ou saisir un temps manuel ci-dessous (format <code>mm:ss</code> ou <code>h:mm:ss</code>, vide pour effacer).</p>

          <div className="rounded-lg border border-border/50 overflow-hidden max-h-[60vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dossard</TableHead>
                  <TableHead>Coureur</TableHead>
                  <TableHead>Temps</TableHead>
                  <TableHead>Photos</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRegs.map((r) => {
                  const photos = photosByReg[r.id] ?? [];
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono">{r.bib_number}</TableCell>
                      <TableCell>{`${r.profile?.first_name ?? ""} ${r.profile?.last_name ?? ""}`.trim() || r.profile?.email || "—"}</TableCell>
                      <TableCell>
                        <Input
                          value={drafts[r.id] ?? ""}
                          onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                          onBlur={() => saveTime(r.id)}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          placeholder="mm:ss"
                          className="max-w-32"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 flex-wrap">
                          {photos.map((u, j) => (
                            <a key={j} href={u} target="_blank" rel="noreferrer">
                              <img src={u} alt="" className="h-10 w-10 object-cover rounded border border-border/50" />
                            </a>
                          ))}
                          <label className="cursor-pointer inline-flex items-center justify-center h-10 w-10 rounded border border-dashed border-border/60 hover:border-primary/60 text-muted-foreground">
                            {uploadingReg === r.id ? "…" : <Camera className="h-4 w-4" />}
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              multiple
                              className="hidden"
                              onChange={(e) => { void uploadPhotosForReg(r.id, e.target.files); e.target.value = ""; }}
                            />
                          </label>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="glass" size="icon" onClick={() => saveTime(r.id)} disabled={busy} aria-label="Enregistrer"><Save className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
