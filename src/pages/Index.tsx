import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Activity, MapPin, Radio, Trophy, Smartphone, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface Race {
  id: string;
  name: string;
  start_time: string;
  distance_km: number | null;
  status: "upcoming" | "live" | "finished";
}

const Index = () => {
  const [races, setRaces] = useState<Race[]>([]);

  useEffect(() => {
    document.title = "FinisTrackLive — Suivi de course en direct";
    supabase
      .from("races")
      .select("id, name, start_time, distance_km, status")
      .order("start_time", { ascending: true })
      .limit(6)
      .then(({ data }) => setRaces((data ?? []) as Race[]));
  }, []);

  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 hero-grid-bg" />
        <div className="container relative py-20 md:py-28 text-center">
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
              <Link to="/auth?mode=signup">Créer un compte</Link>
            </Button>
          </div>
        </div>
      </section>

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
