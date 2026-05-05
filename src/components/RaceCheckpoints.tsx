import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Flag, Plus, Save, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Checkpoint {
  id: string;
  race_id: string;
  name: string;
  distance_km: number | null;
  source: "manual" | "gmcap";
  position: number;
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

const emptyNew = { name: "", distance_km: "", source: "manual" as "manual" | "gmcap" };

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

export function RaceCheckpoints({ raceId, raceStartTime, registrations }: { raceId: string; raceStartTime?: string | null; registrations: RegistrationLite[] }) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [times, setTimes] = useState<CheckpointTime[]>([]);
  const [newCp, setNewCp] = useState(emptyNew);
  const [busy, setBusy] = useState(false);
  const [activeCp, setActiveCp] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({}); // key registrationId
  const [bibInput, setBibInput] = useState("");
  const [recentEntries, setRecentEntries] = useState<Array<{ bib: string; name: string; text: string }>>([]);
  const bibRef = useRef<HTMLInputElement | null>(null);

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
    const payload = {
      race_id: raceId,
      name: newCp.name.trim(),
      distance_km: newCp.distance_km ? Number(newCp.distance_km) : null,
      source: newCp.source,
      position: checkpoints.length,
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
    if (!raceStartTime) {
      toast.error("Heure de départ de la course inconnue");
      return;
    }
    const reg = registrations.find((r) => String(r.bib_number).trim() === bib);
    if (!reg) {
      toast.error(`Dossard ${bib} introuvable`);
      return;
    }
    const startMs = new Date(raceStartTime).getTime();
    const nowMs = Date.now();
    const seconds = Math.max(0, Math.round((nowMs - startMs) / 1000));
    const text = formatTime(seconds, null);
    const sb = supabase as any;
    setBusy(true);
    const { error } = await sb
      .from("runner_checkpoint_times")
      .upsert(
        { checkpoint_id: activeCp, registration_id: reg.id, time_seconds: seconds, time_text: text, recorded_at: new Date().toISOString() },
        { onConflict: "checkpoint_id,registration_id" },
      );
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const name = `${reg.profile?.first_name ?? ""} ${reg.profile?.last_name ?? ""}`.trim() || reg.profile?.email || "—";
    setRecentEntries((prev) => [{ bib, name, text }, ...prev].slice(0, 8));
    toast.success(`Dossard ${bib} — ${text}`);
    setBibInput("");
    bibRef.current?.focus();
    void load();
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

      <div className="grid gap-3 md:grid-cols-[1fr_140px_180px_auto] md:items-end">
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
                    <Badge variant={cp.source === "gmcap" ? "secondary" : "outline"}>
                      {cp.source === "gmcap" ? "GMCAP auto" : "Manuel"}
                    </Badge>
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
              <Button variant="hero" onClick={() => void submitBib()} disabled={busy || !bibInput.trim() || !raceStartTime}>
                Valider <span className="ml-2 text-xs opacity-70">(Entrée)</span>
              </Button>
            </div>
            {!raceStartTime && (
              <p className="text-xs text-destructive">Définis l'heure de départ de la course pour activer la saisie rapide.</p>
            )}
            {recentEntries.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Derniers passages enregistrés</p>
                <div className="flex flex-wrap gap-2">
                  {recentEntries.map((e, i) => (
                    <Badge key={i} variant="secondary" className="font-mono">
                      #{e.bib} · {e.text} · {e.name}
                    </Badge>
                  ))}
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
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRegs.map((r) => (
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
                    <TableCell className="text-right">
                      <Button variant="glass" size="icon" onClick={() => saveTime(r.id)} disabled={busy} aria-label="Enregistrer"><Save className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
