import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Activity, MapPin, Radio, Trophy, Smartphone, Zap, Calendar } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format, isToday, isPast, isFuture, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { DifficultyStars } from "@/components/DifficultyStars";
import logo from "@/assets/logo.png";
import LiveRaceCard from "@/components/LiveRaceCard";
interface Race {
  id: string;
  name: string;
  start_time: string;
  distance_km: number | null;
  difficulty_level: number | null;
  status: "upcoming" | "live" | "finished";
}

interface EventItem {
  id: string;
  name: string;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  poster_url: string | null;
}

interface UntypedRacesQuery {
  select: (columns: string) => {
    order: (column: string, options: { ascending: boolean }) => { limit: (count: number) => Promise<{ data: unknown[] | null; error: { code?: string; message?: string } | null }> };
  };
}

const raceColumns = "id, name, start_time, distance_km, difficulty_level, status";
const compatibleRaceColumns = "id, name, start_time, distance_km, status";

function isMissingDifficultyColumn(error: { code?: string; message?: string } | null) {
  return !!error && (error.code === "42703" || error.code === "PGRST204") && !!error.message?.includes("difficulty_level");
}

function getEventStatus(ev: EventItem): "live" | "upcoming" | "finished" {
  const start = ev.start_date ? parseISO(ev.start_date) : null;
  const end = ev.end_date ? parseISO(ev.end_date) : null;
  const now = new Date();
  if (start && end) {
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    if (now >= startDay && now <= endDay) return "live";
    if (now < startDay) return "upcoming";
    return "finished";
  }
  if (start) {
    if (isToday(start)) return "live";
    if (isFuture(start)) return "upcoming";
    return "finished";
  }
  return "upcoming";
}

const Index = () => {
  const [races, setRaces] = useState<Race[]>([]);
  const [liveEvent, setLiveEvent] = useState<EventItem | null>(null);

  useEffect(() => {
    document.title = "FinisTrackLive — Suivi de course en direct";
    const loadRaces = (columns: string) => (supabase.from as unknown as (table: string) => UntypedRacesQuery)("races")
      .select(columns)
      .order("start_time", { ascending: true })
      .limit(6);

    loadRaces(raceColumns).then(async ({ data, error }) => {
      if (isMissingDifficultyColumn(error)) {
        const fallback = await loadRaces(compatibleRaceColumns);
        setRaces(((fallback.data ?? []) as Omit<Race, "difficulty_level">[]).map((race) => ({ ...race, difficulty_level: 1 })) as Race[]);
        return;
      }
      setRaces((data ?? []) as Race[]);
    });

    // Fetch events and find one that is currently live
    (supabase.from as unknown as (table: string) => UntypedRacesQuery)("events")
      .select("id, name, location, start_date, end_date, poster_url")
      .order("start_date", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        const events = (data ?? []) as EventItem[];
        const live = events.find((e) => getEventStatus(e) === "live");
        if (live) {
          setLiveEvent(live);
        } else {
          // fallback to most recent upcoming or finished
          const sorted = events.sort((a, b) => {
            const ad = a.start_date ? new Date(a.start_date).getTime() : 0;
            const bd = b.start_date ? new Date(b.start_date).getTime() : 0;
            return bd - ad;
          });
          setLiveEvent(sorted[0] ?? null);
        }
      });
  }, []);

  const liveRace = races.find((r) => {
    const startMs = new Date(r.start_time).getTime();
    const now = Date.now();
    return r.status === "live" || (now >= startMs && r.status !== "finished");
  });
  const upcomingRaces = races.filter((r) => r.id !== liveRace?.id);

  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 hero-grid-bg" />
        <div className="container relative py-20 md:py-28 text-center">
          <div className="flex justify-center mb-6 animate-fade-in-up">
            <img
              src={logo}
              alt="FinisTrackLive"
              className="h-24 w-24 md:h-32 md:w-32 object-contain drop-shadow-2xl"
            />
          </div>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-secondary/60 border border-border text-xs font-medium text-muted-foreground mb-6 animate-fade-in-up">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
            </span>
            Suivi GPS en temps réel
          </div>
          <h1 className="font-display text-4xl md:text-6xl lg:text-7xl font-bold leading-[1.05] tracking-tight max-w-4xl mx-auto animate-fade-in-up">
            Suivez chaque coureur, <span className="text-gradient">seconde par seconde</span>
          </h1>
          <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto animate-fade-in-up">
            Plateforme de suivi live pour courses et trails. Charge ton GPX, inscris tes coureurs, et regarde-les progresser sur la carte en temps réel.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center animate-fade-in-up">
            <Button asChild variant="hero" size="xl">
              <Link to="/races">Voir les courses live</Link>
            </Button>
            <Button asChild variant="glass" size="xl">
              <Link to="/events">Voir les épreuves</Link>
            </Button>
            <Button asChild variant="ghost" size="xl">
              <Link to="/auth?mode=signup">Créer un compte</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Live race highlight */}
      {liveRace && (
        <section className="container -mt-8 mb-8 relative z-10">
          <div className="mb-4 flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-success" />
            </span>
            <h2 className="font-display text-xl font-bold text-success">Course en cours</h2>
          </div>
          <LiveRaceCard race={liveRace} showDescription />
        </section>
      )}

      {/* Live event highlight (fallback when no live race) */}
      {!liveRace && liveEvent && (
        <section className="container -mt-8 mb-8 relative z-10">
          <Link to={`/events/${liveEvent.id}`}>
            <Card className="glass-card p-6 md:p-8 hover:border-primary/50 hover:shadow-glow transition-smooth relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-success/5 to-transparent pointer-events-none" />
              <div className="relative flex flex-col md:flex-row md:items-center gap-4 md:gap-8">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    {getEventStatus(liveEvent) === "live" ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-success/15 border border-success/30 text-success text-xs font-semibold">
                        <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" /> En cours
                      </span>
                    ) : getEventStatus(liveEvent) === "upcoming" ? (
                      <span className="px-2.5 py-0.5 rounded-full bg-primary/15 border border-primary/30 text-primary-glow text-xs font-medium">
                        Prochainement
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full bg-muted border border-border text-muted-foreground text-xs font-medium">
                        Terminée
                      </span>
                    )}
                  </div>
                  <h2 className="font-display text-2xl md:text-3xl font-bold">{liveEvent.name}</h2>
                  <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                    {liveEvent.location && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {liveEvent.location}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {liveEvent.start_date
                        ? format(parseISO(liveEvent.start_date), "EEEE d MMMM yyyy", { locale: fr })
                        : "Date à confirmer"}
                    </span>
                  </div>
                </div>
                <Button variant="hero" size="lg" className="shrink-0">
                  Voir l'épreuve
                </Button>
              </div>
            </Card>
          </Link>
        </section>
      )}

      {/* Features */}
      <section className="container py-16 md:py-24">
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { icon: MapPin, title: "Parcours GPX", desc: "Charge le tracé officiel et il s'affiche sur la carte avec distance et progression." },
            { icon: Radio, title: "Live temps réel", desc: "Position des coureurs mise à jour en direct via WebSocket. Aucun rafraîchissement." },
            { icon: Trophy, title: "Classement live", desc: "Distance parcourue sur le tracé, vitesse moyenne et allure sur 5 minutes glissantes." },
            { icon: Smartphone, title: "Pensé mobile", desc: "Mode coureur optimisé pour smartphone. Un bouton, le suivi démarre." },
            { icon: Zap, title: "Anti-triche", desc: "Snap-to-route côté serveur. Impossible de gonfler artificiellement sa distance." },
            { icon: Activity, title: "Vue spectateur", desc: "Page publique pour partager avec famille, supporters et médias." },
          ].map((f, i) => (
            <Card key={i} className="glass-card p-6 hover:border-primary/40 transition-smooth">
              <div className="h-11 w-11 rounded-xl bg-gradient-mesh border border-primary/20 flex items-center justify-center mb-4">
                <f.icon className="h-5 w-5 text-primary-glow" />
              </div>
              <h3 className="font-display font-semibold text-lg mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Races preview */}
      <section className="container pb-20">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h2 className="font-display text-3xl md:text-4xl font-bold">Courses à venir</h2>
            <p className="text-muted-foreground mt-1">Les prochaines épreuves disponibles sur la plateforme</p>
          </div>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link to="/races">Toutes les courses →</Link>
          </Button>
        </div>

        {races.length === 0 ? (
          <Card className="glass-card p-12 text-center">
            <p className="text-muted-foreground">Aucune course pour l'instant. Les organisateurs peuvent en créer depuis leur espace.</p>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {races.map((r) => (
              <Link key={r.id} to={`/races/${r.id}`}>
                <Card className="glass-card p-5 h-full hover:border-primary/50 hover:shadow-glow transition-smooth">
                  <div className="flex items-center gap-2 mb-3">
                    <StatusBadge status={r.status} />
                    {r.distance_km && (
                      <span className="text-xs text-muted-foreground">{r.distance_km} km</span>
                    )}
                  </div>
                  <h3 className="font-display font-semibold text-lg mb-1">{r.name}</h3>
                  <DifficultyStars level={r.difficulty_level} className="mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(r.start_time), "EEEE d MMMM, HH:mm", { locale: fr })}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
};

export function StatusBadge({ status }: { status: "upcoming" | "live" | "finished" }) {
  if (status === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-success/15 border border-success/30 text-success text-xs font-semibold">
        <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" /> LIVE
      </span>
    );
  }
  if (status === "finished") {
    return (
      <span className="px-2.5 py-0.5 rounded-full bg-muted border border-border text-muted-foreground text-xs font-medium">
        Terminée
      </span>
    );
  }
  return (
    <span className="px-2.5 py-0.5 rounded-full bg-primary/15 border border-primary/30 text-primary-glow text-xs font-medium">
      À venir
    </span>
  );
}

export default Index;
