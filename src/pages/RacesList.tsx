import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { StatusBadge } from "./Index";
import { DifficultyStars } from "@/components/DifficultyStars";

interface Race {
  id: string;
  name: string;
  description: string | null;
  start_time: string;
  distance_km: number | null;
  difficulty_level: number | null;
  status: "upcoming" | "live" | "finished";
}

interface UntypedRacesQuery {
  select: (columns: string) => { order: (column: string, options: { ascending: boolean }) => Promise<{ data: unknown[] | null; error: { code?: string; message?: string } | null }> };
}

const raceColumns = "id, name, description, start_time, distance_km, difficulty_level, status";
const compatibleRaceColumns = "id, name, description, start_time, distance_km, status";

function isMissingDifficultyColumn(error: { code?: string; message?: string } | null) {
  return !!error && (error.code === "42703" || error.code === "PGRST204") && !!error.message?.includes("difficulty_level");
}

export default function RacesList() {
  const [races, setRaces] = useState<Race[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Toutes les courses — FinisTrackLive";
    const loadRaces = (columns: string) => (supabase.from as unknown as (table: string) => UntypedRacesQuery)("races")
      .select(columns)
      .order("start_time", { ascending: false })
    ;

    loadRaces(raceColumns)
      .then(async ({ data, error }) => {
        if (isMissingDifficultyColumn(error)) {
          const fallback = await loadRaces(compatibleRaceColumns);
          setRaces(((fallback.data ?? []) as Omit<Race, "difficulty_level">[]).map((race) => ({ ...race, difficulty_level: 1 })) as Race[]);
          setLoading(false);
          return;
        }
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
                <DifficultyStars level={r.difficulty_level} className="mb-2" />
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
