import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { Timer } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface EventLite { id: string; name: string }
interface RaceLite { id: string; name: string; start_time: string | null; event_id: string | null }
interface CheckpointLite { id: string; race_id: string; name: string }
interface RegistrationLite {
  id: string;
  race_id: string;
  bib_number: string;
  first_name: string | null;
  last_name: string | null;
}
interface Entry {
  bib: string;
  firstName: string;
  lastName: string;
  raceName: string;
  text: string;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function ManualTiming() {
  const { user, isOrganizer, isAdmin, loading } = useAuth();
  const [events, setEvents] = useState<EventLite[]>([]);
  const [eventId, setEventId] = useState<string>("");
  const [races, setRaces] = useState<RaceLite[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointLite[]>([]);
  const [registrations, setRegistrations] = useState<RegistrationLite[]>([]);
  const [checkpointName, setCheckpointName] = useState<string>("");
  const [bibInput, setBibInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<Entry[]>([]);
  const bibRef = useRef<HTMLInputElement | null>(null);

  // Load events accessible to the user
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const sb = supabase as any;
      // Get all events, the RLS / accessibility is loose; we still filter by ownership/organizer rights
      const { data: ownEvents } = await sb.from("events").select("id, name").eq("organizer_id", user.id);
      const { data: delegated } = await sb
        .from("event_organizers")
        .select("event_id, events:events!event_organizers_event_id_fkey(id, name)")
        .eq("user_id", user.id);
      // Also include events from races the user has direct race_organizers on
      const { data: raceOrgs } = await sb
        .from("race_organizers")
        .select("race_id, races:races!race_organizers_race_id_fkey(id, name, event_id, events:events!races_event_id_fkey(id, name))")
        .eq("user_id", user.id);

      const map = new Map<string, EventLite>();
      (ownEvents ?? []).forEach((e: any) => map.set(e.id, { id: e.id, name: e.name }));
      (delegated ?? []).forEach((e: any) => {
        if (e.events) map.set(e.events.id, { id: e.events.id, name: e.events.name });
      });
      (raceOrgs ?? []).forEach((r: any) => {
        const ev = r.races?.events;
        if (ev) map.set(ev.id, { id: ev.id, name: ev.name });
      });

      if (isAdmin) {
        const { data: allEvents } = await sb.from("events").select("id, name").order("name");
        (allEvents ?? []).forEach((e: any) => map.set(e.id, { id: e.id, name: e.name }));
      }

      if (cancelled) return;
      const list = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
      setEvents(list);
    })();
    return () => { cancelled = true; };
  }, [user, isAdmin]);

  // Load races + checkpoints + registrations for the selected event
  useEffect(() => {
    if (!eventId) {
      setRaces([]); setCheckpoints([]); setRegistrations([]); setCheckpointName("");
      return;
    }
    let cancelled = false;
    (async () => {
      const sb = supabase as any;
      const { data: rs } = await sb.from("races").select("id, name, start_time, event_id").eq("event_id", eventId);
      const raceIds = (rs ?? []).map((r: any) => r.id);
      if (cancelled) return;
      setRaces((rs ?? []) as RaceLite[]);
      if (raceIds.length === 0) { setCheckpoints([]); setRegistrations([]); return; }
      const [{ data: cps }, { data: regs }] = await Promise.all([
        sb.from("race_checkpoints").select("id, race_id, name").in("race_id", raceIds),
        sb.from("race_registrations")
          .select("id, race_id, bib_number, runner_id")
          .in("race_id", raceIds),
      ]);
      if (cancelled) return;
      setCheckpoints((cps ?? []) as CheckpointLite[]);
      const runnerIds = Array.from(new Set(((regs ?? []) as any[]).map((r) => r.runner_id).filter(Boolean)));
      const profilesMap = new Map<string, { first_name: string | null; last_name: string | null }>();
      if (runnerIds.length > 0) {
        const { data: profs } = await sb.from("profiles").select("user_id, first_name, last_name").in("user_id", runnerIds);
        (profs ?? []).forEach((p: any) => profilesMap.set(p.user_id, { first_name: p.first_name, last_name: p.last_name }));
      }
      setRegistrations(((regs ?? []) as any[]).map((r) => {
        const p = profilesMap.get(r.runner_id);
        return {
          id: r.id,
          race_id: r.race_id,
          bib_number: r.bib_number,
          first_name: p?.first_name ?? null,
          last_name: p?.last_name ?? null,
        };
      }));

    })();
    return () => { cancelled = true; };
  }, [eventId]);

  const checkpointNames = useMemo(() => {
    const set = new Set<string>();
    checkpoints.forEach((c) => set.add(c.name));
    return Array.from(set).sort();
  }, [checkpoints]);

  const submitBib = useCallback(async () => {
    const bib = bibInput.trim();
    if (!bib) return;
    if (!checkpointName) { toast.error("Sélectionne un point de chrono"); return; }
    const norm = (v: string) => v.trim().replace(/^0+/, "");
    const bibN = norm(bib);
    const sb = supabase as any;

    // 1) Try local cached registrations (any matching, ignoring leading zeros)
    let reg = registrations.find((r) => norm(String(r.bib_number)) === bibN);

    // 2) Server-side fallback in case RLS / cache hid it
    if (!reg) {
      const raceIds = races.map((r) => r.id);
      if (raceIds.length > 0) {
        const { data } = await sb
          .from("race_registrations")
          .select("id, race_id, bib_number, runner:profiles!race_registrations_runner_id_fkey(first_name, last_name)")
          .in("race_id", raceIds);
        const match = ((data ?? []) as any[]).find((r) => norm(String(r.bib_number)) === bibN);
        if (match) {
          reg = {
            id: match.id,
            race_id: match.race_id,
            bib_number: match.bib_number,
            first_name: match.runner?.first_name ?? null,
            last_name: match.runner?.last_name ?? null,
          };
        }
      }
    }

    if (!reg) { toast.error(`Dossard ${bib} introuvable sur cette épreuve`); return; }
    const race = races.find((r) => r.id === reg!.race_id);
    if (!race) { toast.error("Course introuvable"); return; }
    const cp = checkpoints.find((c) => c.race_id === reg!.race_id && c.name === checkpointName);
    if (!cp) {
      toast.error(`Aucun point « ${checkpointName} » sur la course « ${race.name} »`);
      return;
    }
    if (!race.start_time) { toast.error(`Heure de départ inconnue pour « ${race.name} »`); return; }
    const seconds = Math.max(0, Math.round((Date.now() - new Date(race.start_time).getTime()) / 1000));
    const text = formatTime(seconds);
    setBusy(true);
    const { error } = await sb
      .from("runner_checkpoint_times")
      .upsert(
        { checkpoint_id: cp.id, registration_id: reg.id, time_seconds: seconds, time_text: text, recorded_at: new Date().toISOString() },
        { onConflict: "checkpoint_id,registration_id" },
      );
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setRecent((prev) => [{ bib, firstName: reg!.first_name ?? "", lastName: reg!.last_name ?? "", raceName: race.name, text }, ...prev].slice(0, 15));
    toast.success(`Dossard ${bib} — ${text} · ${race.name}`);
    setBibInput("");
    bibRef.current?.focus();
  }, [bibInput, checkpointName, registrations, races, checkpoints]);


  if (loading) return null;
  if (!user) return <Navigate to="/auth" replace />;
  if (!isOrganizer && !isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-xl bg-gradient-primary flex items-center justify-center shadow-glow">
          <Timer className="h-6 w-6 text-primary-foreground" />
        </div>
        <div>
          <h1 className="font-display text-3xl font-bold">Saisie manuelle des chronos</h1>
          <p className="text-muted-foreground text-sm">Sélectionne une épreuve et un point de chronométrage, puis scanne ou tape les dossards.</p>
        </div>
      </div>

      <div className="glass-card p-5 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Épreuve</Label>
            <Select value={eventId} onValueChange={(v) => { setEventId(v); setCheckpointName(""); }}>
              <SelectTrigger><SelectValue placeholder="Choisir une épreuve" /></SelectTrigger>
              <SelectContent>
                {events.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Point de chronométrage</Label>
            <Select value={checkpointName} onValueChange={setCheckpointName} disabled={!eventId || checkpointNames.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder={!eventId ? "Choisis d'abord une épreuve" : checkpointNames.length === 0 ? "Aucun point disponible" : "Choisir un point"} />
              </SelectTrigger>
              <SelectContent>
                {checkpointNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {checkpointName && (
          <div className="space-y-3 pt-2 border-t border-border/40">
            <Label htmlFor="bib">Dossard</Label>
            <div className="flex gap-2">
              <Input
                id="bib"
                ref={bibRef}
                autoFocus
                inputMode="numeric"
                value={bibInput}
                onChange={(e) => setBibInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submitBib(); } }}
                placeholder="Saisir un dossard puis Entrée"
                className="text-lg"
              />
              <Button onClick={() => void submitBib()} disabled={busy || !bibInput.trim()}>
                Enregistrer
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Le temps est calculé automatiquement à partir de l'heure de départ de la course du coureur.
            </p>
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <div className="glass-card p-5 space-y-3">
          <h2 className="font-display text-lg font-semibold">Dernières saisies</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dossard</TableHead>
                <TableHead>Coureur</TableHead>
                <TableHead>Course</TableHead>
                <TableHead className="text-right">Temps</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((e, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono font-semibold">{e.bib}</TableCell>
                  <TableCell>{[e.firstName, e.lastName].filter(Boolean).join(" ") || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{e.raceName}</TableCell>
                  <TableCell className="text-right font-mono">{e.text}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
