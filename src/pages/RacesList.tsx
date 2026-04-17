import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { StatusBadge } from "./Index";

interface Race {
  id: string;
  name: string;
  description: string | null;
  start_time: string;
  distance_km: number | null;
  status: "upcoming" | "live" | "finished";
}

export default function RacesList() {
  const [races, setRaces] = useState<Race[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Toutes les courses — FinisTrackLive";
    supabase
      .from("races")
      .select("id, name, description, start_time, distance_km, status")
      .order("start_time", { ascending: false })
      .then(({ data }) => {
        setRaces((data ?? []) as Race[]);
        setLoading(false);
      });
  }, []);

  return (
    <main className="container py-12">
      <h1 className="font-display text-4xl font-bold mb-2">Toutes les courses</h1>
      <p className="text-muted-foreground mb-8">À venir, en direct ou terminées</p>

      {loading ? (
        <p className="text-muted-foreground">Chargement…</p>
      ) : races.length === 0 ? (
        <Card className="glass-card p-12 text-center">
          <p className="text-muted-foreground">Aucune course pour l'instant.</p>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {races.map((r) => (
            <Link key={r.id} to={`/races/${r.id}`}>
              <Card className="glass-card p-5 h-full hover:border-primary/50 hover:shadow-glow transition-smooth">
                <div className="flex items-center gap-2 mb-3">
                  <StatusBadge status={r.status} />
                  {r.distance_km && <span className="text-xs text-muted-foreground">{r.distance_km} km</span>}
                </div>
                <h3 className="font-display font-semibold text-lg mb-1">{r.name}</h3>
                <p className="text-sm text-muted-foreground mb-2">
                  {format(new Date(r.start_time), "EEEE d MMMM yyyy, HH:mm", { locale: fr })}
                </p>
                {r.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{r.description}</p>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
