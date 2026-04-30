import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Calendar, MapPin } from "lucide-react";

interface EventRow {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  poster_url: string | null;
}

interface UntypedQuery {
  select: (c: string) => { order: (col: string, opts: { ascending: boolean; nullsFirst?: boolean }) => Promise<{ data: unknown[] | null }> };
}

export default function EventsList() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = "Épreuves — FinisTrackLive";
    (supabase.from as unknown as (t: string) => UntypedQuery)("events")
      .select("id, name, description, location, start_date, end_date, poster_url")
      .order("start_date", { ascending: false, nullsFirst: false })
      .then(({ data }) => {
        setEvents((data ?? []) as EventRow[]);
        setLoading(false);
      });
  }, []);

  return (
    <main className="container py-12">
      <h1 className="font-display text-4xl font-bold mb-2">Épreuves</h1>
      <p className="text-muted-foreground mb-8">Découvrez les événements et les courses qui les composent</p>

      {loading ? (
        <p className="text-muted-foreground">Chargement…</p>
      ) : events.length === 0 ? (
        <Card className="glass-card p-12 text-center">
          <p className="text-muted-foreground">Aucune épreuve pour l'instant.</p>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {events.map((e) => (
            <Link key={e.id} to={`/events/${e.id}`}>
              <Card className="glass-card overflow-hidden h-full hover:border-primary/50 hover:shadow-glow transition-smooth">
                <div className="aspect-[4/3] bg-secondary/40 overflow-hidden">
                  {e.poster_url ? (
                    <img src={e.poster_url} alt={`Affiche ${e.name}`} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                      Pas d'affiche
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <h3 className="font-display font-semibold text-lg mb-2">{e.name}</h3>
                  {e.start_date && (
                    <p className="text-sm text-muted-foreground flex items-center gap-1.5 mb-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {format(new Date(e.start_date), "d MMM yyyy", { locale: fr })}
                      {e.end_date && e.end_date !== e.start_date && ` → ${format(new Date(e.end_date), "d MMM yyyy", { locale: fr })}`}
                    </p>
                  )}
                  {e.location && (
                    <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" />
                      {e.location}
                    </p>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
