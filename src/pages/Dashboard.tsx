import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Smartphone, Trophy, ShieldCheck } from "lucide-react";
import { StatusBadge } from "./Index";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface MyRegistration {
  id: string;
  bib_number: string;
  race: {
    id: string;
    name: string;
    start_time: string;
    distance_km: number | null;
    status: "upcoming" | "live" | "finished";
  };
}

interface OrganizerRace {
  id: string;
  name: string;
  start_time: string;
  distance_km: number | null;
  status: "upcoming" | "live" | "finished";
}

interface OrganizerEvent {
  id: string;
  name: string;
  start_date: string | null;
  poster_url: string | null;
}

interface DelegatedRaceRow {
  race: OrganizerRace | null;
}

interface UntypedQuery {
  select: (columns: string) => { eq: (column: string, value: string) => Promise<{ data: unknown[] | null }> };
}

export default function Dashboard() {
  const { user, loading, isOrganizer, roles } = useAuth();
  const navigate = useNavigate();
  const [registrations, setRegistrations] = useState<MyRegistration[]>([]);
  const [organizerRaces, setOrganizerRaces] = useState<OrganizerRace[]>([]);
  const [organizerEvents, setOrganizerEvents] = useState<OrganizerEvent[]>([]);

  useEffect(() => {
    document.title = "Mon espace — FinisTrackLive";
  }, []);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("race_registrations")
      .select("id, bib_number, race:race_id ( id, name, start_time, distance_km, status )")
      .eq("runner_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => setRegistrations((data ?? []) as unknown as MyRegistration[]));
  }, [user]);

  useEffect(() => {
    if (!user || !isOrganizer) return;
    Promise.all([
      supabase
        .from("races")
        .select("id, name, start_time, distance_km, status")
        .eq("organizer_id", user.id)
        .order("start_time", { ascending: false }),
      (supabase.from as unknown as (table: string) => UntypedQuery)("race_organizers")
        .select("race:races ( id, name, start_time, distance_km, status )")
        .eq("user_id", user.id),
    ]).then(([owned, delegated]) => {
      const delegatedRaces = ((delegated.data ?? []) as unknown as DelegatedRaceRow[]).map((row) => row.race).filter(Boolean) as OrganizerRace[];
      const byId = new Map<string, OrganizerRace>();
      [...((owned.data ?? []) as OrganizerRace[]), ...delegatedRaces].forEach((race) => byId.set(race.id, race));
      setOrganizerRaces([...byId.values()].sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()));
    });
  }, [user, isOrganizer]);

  useEffect(() => {
    if (!user || !isOrganizer) return;
    (supabase.from as unknown as (t: string) => UntypedQuery)("events")
      .select("id, name, start_date, poster_url")
      .eq("organizer_id", user.id)
      .then(({ data }) => setOrganizerEvents(((data ?? []) as OrganizerEvent[]).sort((a, b) => (b.start_date ?? "").localeCompare(a.start_date ?? ""))));
  }, [user, isOrganizer]);

  if (loading) return <main className="container py-12"><p className="text-muted-foreground">Chargement…</p></main>;
  if (!user) return <Navigate to="/auth" replace />;

  return (
    <main className="container py-10">
      <h1 className="font-display text-3xl md:text-4xl font-bold mb-2">Mon espace</h1>
      <p className="text-muted-foreground mb-8">
        {roles.includes("organizer") ? "Organisateur · Coureur" : "Coureur"}
      </p>

      <div className="grid md:grid-cols-3 gap-4 mb-10">
        <Card className="glass-card p-5">
          <Trophy className="h-5 w-5 text-primary-glow mb-2" />
          <p className="text-2xl font-bold">{registrations.length}</p>
          <p className="text-sm text-muted-foreground">Inscriptions</p>
        </Card>
        <Card className="glass-card p-5">
          <Smartphone className="h-5 w-5 text-primary-glow mb-2" />
          <p className="text-2xl font-bold">{registrations.filter(r => r.race?.status === "live").length}</p>
          <p className="text-sm text-muted-foreground">Courses en direct</p>
        </Card>
        <Card className="glass-card p-5">
          <ShieldCheck className="h-5 w-5 text-primary-glow mb-2" />
          {isOrganizer ? (
            <>
              <p className="text-base font-semibold">Organisateur</p>
              <Button asChild variant="link" className="px-0 h-auto"><Link to="/organizer/new-race">+ Créer une course</Link></Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-2">Accès organisateur réservé aux comptes autorisés.</p>
              <Button asChild variant="glass" size="sm"><Link to="/races">Voir les courses</Link></Button>
            </>
          )}
        </Card>
      </div>

      {isOrganizer && (
        <section className="mb-10">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="font-display text-2xl font-semibold">Administration courses</h2>
            <Button asChild variant="hero" size="sm"><Link to="/organizer/new-race">Créer une course</Link></Button>
          </div>
          {organizerRaces.length === 0 ? (
            <Card className="glass-card p-8 text-center">
              <p className="text-muted-foreground mb-4">Aucune course organisée pour le moment.</p>
              <Button asChild variant="hero"><Link to="/organizer/new-race">Créer ma première course</Link></Button>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {organizerRaces.map((race) => (
                <Card key={race.id} className="glass-card p-5">
                  <div className="flex items-center gap-2 mb-2">
                    <StatusBadge status={race.status} />
                    {race.distance_km && <span className="ml-auto text-xs text-muted-foreground">{race.distance_km} km</span>}
                  </div>
                  <h3 className="font-display font-semibold text-lg mb-1">{race.name}</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    {format(new Date(race.start_time), "d MMM yyyy, HH:mm", { locale: fr })}
                  </p>
                  <div className="flex gap-2">
                    <Button asChild variant="hero" size="sm" className="flex-1">
                      <Link to={`/organizer/races/${race.id}/admin`}>Administrer</Link>
                    </Button>
                    <Button asChild variant="glass" size="sm">
                      <Link to={`/races/${race.id}`}>Voir</Link>
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      <h2 className="font-display text-2xl font-semibold mb-4">Mes courses</h2>
      {registrations.length === 0 ? (
        <Card className="glass-card p-10 text-center">
          <p className="text-muted-foreground mb-4">Tu n'es inscrit à aucune course.</p>
          <Button asChild variant="hero"><Link to="/races">Découvrir les courses</Link></Button>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {registrations.map((reg) => (
            <Card key={reg.id} className="glass-card p-5">
              <div className="flex items-center gap-2 mb-2">
                <StatusBadge status={reg.race.status} />
                <span className="ml-auto text-xs text-muted-foreground">Dossard #{reg.bib_number}</span>
              </div>
              <h3 className="font-display font-semibold text-lg mb-1">{reg.race.name}</h3>
              <p className="text-sm text-muted-foreground mb-3">
                {format(new Date(reg.race.start_time), "d MMM yyyy, HH:mm", { locale: fr })}
                {reg.race.distance_km && ` · ${reg.race.distance_km} km`}
              </p>
              <div className="flex gap-2">
                <Button asChild variant="hero" size="sm" className="flex-1">
                  <Link to={`/race/${reg.race.id}/track`}>Suivi GPS</Link>
                </Button>
                <Button asChild variant="glass" size="sm">
                  <Link to={`/races/${reg.race.id}`}>Voir</Link>
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
