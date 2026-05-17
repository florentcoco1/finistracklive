import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import LiveRaceCard from "@/components/LiveRaceCard";

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
            <LiveRaceCard key={r.id} race={r} showDescription />
          ))}
        </div>
      )}
    </main>
  );
}
