import { useEffect, useState, useCallback } from "react";
import { Navigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { ShieldAlert, Trash2, Pencil, Plus } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface AdminEvent {
  id: string;
  name: string;
  start_date: string | null;
  poster_url: string | null;
  organizer_id: string | null;
}

interface AdminRace {
  id: string;
  name: string;
  start_time: string;
  distance_km: number | null;
  status: string;
  organizer_id: string;
  event_id?: string | null;
}

interface AdminRegistration {
  id: string;
  bib_number: string;
  race_id: string;
  runner_id: string;
  category: string | null;
  race?: { name: string } | null;
}

// Loose typing helpers because some tables (events) may not yet be in generated types
type LooseQuery = {
  select: (cols: string) => Promise<{ data: unknown[] | null; error: unknown }>;
};
const fromAny = (table: string) =>
  (supabase.from as unknown as (t: string) => LooseQuery)(table);

export default function AdminPage() {
  const { user, loading, isAdmin } = useAuth();
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [races, setRaces] = useState<AdminRace[]>([]);
  const [regs, setRegs] = useState<AdminRegistration[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Admin global — FinisTrackLive";
  }, []);

  const refresh = useCallback(async () => {
    const [evRes, raceRes, regRes] = await Promise.all([
      fromAny("events").select("id, name, start_date, poster_url, organizer_id").catch(() => ({ data: [], error: null })),
      supabase.from("races").select("id, name, start_time, distance_km, status, organizer_id").order("start_time", { ascending: false }),
      supabase.from("race_registrations").select("id, bib_number, race_id, runner_id, category, race:race_id ( name )").order("created_at", { ascending: false }).limit(500),
    ]);
    setEvents(((evRes?.data ?? []) as AdminEvent[]).sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? "")));
    setRaces((raceRes.data ?? []) as AdminRace[]);
    setRegs((regRes.data ?? []) as unknown as AdminRegistration[]);
  }, []);

  useEffect(() => {
    if (isAdmin) void refresh();
  }, [isAdmin, refresh]);

  if (loading) return <main className="container py-12"><p className="text-muted-foreground">Chargement…</p></main>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!isAdmin) {
    return (
      <main className="container py-16">
        <Card className="glass-card p-10 text-center max-w-lg mx-auto">
          <ShieldAlert className="h-10 w-10 text-destructive mx-auto mb-3" />
          <h1 className="font-display text-2xl font-bold mb-2">Accès refusé</h1>
          <p className="text-muted-foreground">Cette zone est réservée aux administrateurs.</p>
        </Card>
      </main>
    );
  }

  const deleteEvent = async (id: string) => {
    if (!confirm("Supprimer définitivement cette épreuve ?")) return;
    setBusy(true);
    const del = (supabase.from as unknown as (t: string) => { delete: () => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> } })("events").delete().eq("id", id);
    const { error } = await del;
    setBusy(false);
    if (error) toast({ title: "Erreur", description: error.message, variant: "destructive" });
    else { toast({ title: "Épreuve supprimée" }); void refresh(); }
  };

  const deleteRace = async (id: string) => {
    if (!confirm("Supprimer définitivement cette course ? Les inscriptions associées seront aussi supprimées.")) return;
    setBusy(true);
    await supabase.from("race_registrations").delete().eq("race_id", id);
    const { error } = await supabase.from("races").delete().eq("id", id);
    setBusy(false);
    if (error) toast({ title: "Erreur", description: error.message, variant: "destructive" });
    else { toast({ title: "Course supprimée" }); void refresh(); }
  };

  const deleteRegistration = async (id: string) => {
    if (!confirm("Supprimer ce coureur de la course ?")) return;
    setBusy(true);
    const { error } = await supabase.from("race_registrations").delete().eq("id", id);
    setBusy(false);
    if (error) toast({ title: "Erreur", description: error.message, variant: "destructive" });
    else { toast({ title: "Inscription supprimée" }); void refresh(); }
  };

  const updateRegistration = async (id: string, patch: { bib_number?: string; category?: string | null }) => {
    setBusy(true);
    const { error } = await supabase.from("race_registrations").update(patch).eq("id", id);
    setBusy(false);
    if (error) toast({ title: "Erreur", description: error.message, variant: "destructive" });
    else { toast({ title: "Inscription mise à jour" }); void refresh(); }
  };

  return (
    <main className="container py-10">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <h1 className="font-display text-3xl md:text-4xl font-bold">Administration globale</h1>
          <p className="text-muted-foreground">Gestion totale des épreuves, courses et coureurs.</p>
        </div>
      </div>

      <Tabs defaultValue="events" className="mt-6">
        <TabsList>
          <TabsTrigger value="events">Épreuves ({events.length})</TabsTrigger>
          <TabsTrigger value="races">Courses ({races.length})</TabsTrigger>
          <TabsTrigger value="runners">Coureurs ({regs.length})</TabsTrigger>
        </TabsList>

        {/* EVENTS */}
        <TabsContent value="events" className="mt-6">
          <div className="flex justify-end mb-3">
            <Button asChild variant="hero" size="sm">
              <Link to="/organizer/new-event"><Plus className="h-4 w-4 mr-1" />Nouvelle épreuve</Link>
            </Button>
          </div>
          {events.length === 0 ? (
            <Card className="glass-card p-8 text-center text-muted-foreground">Aucune épreuve.</Card>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {events.map((ev) => (
                <Card key={ev.id} className="glass-card overflow-hidden">
                  <div className="aspect-[3/4] bg-secondary/40">
                    {ev.poster_url
                      ? <img src={ev.poster_url} alt={`Affiche ${ev.name}`} className="w-full h-full object-cover" loading="lazy" />
                      : <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">Sans affiche</div>}
                  </div>
                  <div className="p-4">
                    <h3 className="font-display font-semibold mb-1 line-clamp-2">{ev.name}</h3>
                    {ev.start_date && (
                      <p className="text-xs text-muted-foreground mb-3">
                        {format(new Date(ev.start_date), "d MMM yyyy", { locale: fr })}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button asChild variant="glass" size="sm" className="flex-1"><Link to={`/organizer/events/${ev.id}/edit`}><Pencil className="h-4 w-4 mr-1" />Modifier</Link></Button>
                      <Button variant="destructive" size="sm" disabled={busy} onClick={() => deleteEvent(ev.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* RACES */}
        <TabsContent value="races" className="mt-6">
          <div className="flex justify-end mb-3">
            <Button asChild variant="hero" size="sm">
              <Link to="/organizer/new-race"><Plus className="h-4 w-4 mr-1" />Nouvelle course</Link>
            </Button>
          </div>
          {races.length === 0 ? (
            <Card className="glass-card p-8 text-center text-muted-foreground">Aucune course.</Card>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {races.map((race) => (
                <Card key={race.id} className="glass-card p-5">
                  <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                    <span className="px-2 py-0.5 rounded bg-secondary">{race.status}</span>
                    {race.distance_km && <span className="ml-auto">{race.distance_km} km</span>}
                  </div>
                  <h3 className="font-display font-semibold text-lg mb-1">{race.name}</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    {format(new Date(race.start_time), "d MMM yyyy, HH:mm", { locale: fr })}
                  </p>
                  <div className="flex gap-2">
                    <Button asChild variant="glass" size="sm" className="flex-1">
                      <Link to={`/organizer/races/${race.id}/admin`}><Pencil className="h-4 w-4 mr-1" />Administrer</Link>
                    </Button>
                    <Button variant="destructive" size="sm" disabled={busy} onClick={() => deleteRace(race.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* RUNNERS / REGISTRATIONS */}
        <TabsContent value="runners" className="mt-6">
          {regs.length === 0 ? (
            <Card className="glass-card p-8 text-center text-muted-foreground">Aucune inscription.</Card>
          ) : (
            <div className="space-y-3">
              {regs.map((r) => (
                <RegistrationRow key={r.id} reg={r} busy={busy} onSave={updateRegistration} onDelete={deleteRegistration} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}

function RegistrationRow({
  reg,
  busy,
  onSave,
  onDelete,
}: {
  reg: AdminRegistration;
  busy: boolean;
  onSave: (id: string, patch: { bib_number?: string; category?: string | null }) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [bib, setBib] = useState(reg.bib_number);
  const [category, setCategory] = useState(reg.category ?? "");
  return (
    <Card className="glass-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <p className="font-medium">{reg.race?.name ?? "Course inconnue"}</p>
          <p className="text-xs text-muted-foreground font-mono">runner: {reg.runner_id.slice(0, 8)}…</p>
        </div>
        {editing ? (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">Dossard</Label>
              <Input value={bib} onChange={(e) => setBib(e.target.value)} className="w-24 h-9" />
            </div>
            <div>
              <Label className="text-xs">Catégorie</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} className="w-32 h-9" />
            </div>
            <Button
              size="sm"
              variant="hero"
              disabled={busy}
              onClick={async () => {
                await onSave(reg.id, { bib_number: bib, category: category || null });
                setEditing(false);
              }}
            >
              Enregistrer
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Annuler</Button>
          </div>
        ) : (
          <>
            <span className="text-sm">Dossard <strong>#{reg.bib_number}</strong></span>
            {reg.category && <span className="text-xs text-muted-foreground">{reg.category}</span>}
            <Button size="sm" variant="glass" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /></Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => onDelete(reg.id)}><Trash2 className="h-4 w-4" /></Button>
          </>
        )}
      </div>
    </Card>
  );
}
