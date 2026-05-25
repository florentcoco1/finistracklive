import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { StatusBadge } from "./Index";
import { DifficultyStars } from "@/components/DifficultyStars";
import { Calendar, MapPin, Globe, Mail, Phone, Facebook, Instagram, Twitter, ChevronLeft, Pencil } from "lucide-react";

interface EventRow {
  id: string;
  organizer_id: string;
  name: string;
  description: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  poster_url: string | null;
  website_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  twitter_url: string | null;
}

interface RaceRow {
  id: string;
  name: string;
  start_time: string;
  distance_km: number | null;
  difficulty_level: number | null;
  status: "upcoming" | "live" | "finished";
}

interface UntypedQuery {
  select: (c: string) => {
    eq: (col: string, val: string) => {
      single: () => Promise<{ data: unknown | null; error: unknown }>;
      order: (col: string, opts: { ascending: boolean }) => Promise<{ data: unknown[] | null; error: { code?: string; message?: string } | null }>;
    };
  };
}

const raceColumns = "id, name, start_time, distance_km, difficulty_level, status";
const compatibleRaceColumns = "id, name, start_time, distance_km, status";

function isMissingDifficultyColumn(error: { code?: string; message?: string } | null) {
  return !!error && (error.code === "42703" || error.code === "PGRST204") && !!error.message?.includes("difficulty_level");
}

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [races, setRaces] = useState<RaceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRaces = async () => {
    if (!id) return;
    const loadRaces = (columns: string) => (supabase.from as unknown as (t: string) => UntypedQuery)("races")
      .select(columns)
      .eq("event_id", id)
      .order("start_time", { ascending: true });

    const rc = await loadRaces(raceColumns);
    if (isMissingDifficultyColumn(rc.error)) {
      const fallback = await loadRaces(compatibleRaceColumns);
      setRaces(((fallback.data ?? []) as Omit<RaceRow, "difficulty_level">[]).map((race) => ({ ...race, difficulty_level: 1 })) as RaceRow[]);
      return;
    }
    setRaces((rc.data ?? []) as RaceRow[]);
  };

  useEffect(() => {
    if (!id) return;
    Promise.all([
      (supabase.from as unknown as (t: string) => UntypedQuery)("events")
        .select("id, organizer_id, name, description, location, start_date, end_date, poster_url, website_url, facebook_url, instagram_url, twitter_url")
        .eq("id", id)
        .single(),
      (supabase.from as unknown as (t: string) => UntypedQuery)("races")
        .select(raceColumns)
        .eq("event_id", id)
        .order("start_time", { ascending: true }),
      (supabase as any)
        .from("events_contacts")
        .select("contact_email, contact_phone")
        .eq("event_id", id)
        .maybeSingle(),
    ]).then(async ([ev, rc, contact]: any[]) => {
      const evData = ev.data as EventRow | null;
      const c = (contact?.data ?? {}) as { contact_email?: string | null; contact_phone?: string | null };
      const merged = evData ? { ...evData, contact_email: c.contact_email ?? null, contact_phone: c.contact_phone ?? null } : null;
      setEvent(merged);
      if (evData) document.title = `${evData.name} — FinisTrackLive`;
      if (isMissingDifficultyColumn(rc.error)) {
        await fetchRaces();
        setLoading(false);
        return;
      }
      setRaces((rc.data ?? []) as RaceRow[]);
      setLoading(false);
    });


    const channel = supabase
      .channel(`event-races-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "races" },
        () => {
          fetchRaces();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  const isOwner = user && event && user.id === event.organizer_id;

  if (loading) return <main className="container py-12"><p className="text-muted-foreground">Chargement…</p></main>;
  if (!event) return <main className="container py-12"><p className="text-muted-foreground">Épreuve introuvable.</p></main>;

  return (
    <main className="container py-8">
      <Link to="/events" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
        <ChevronLeft className="h-4 w-4 mr-1" /> Toutes les épreuves
      </Link>

      <div className="grid md:grid-cols-[400px_1fr] gap-8 mb-10">
        <Card className="glass-card overflow-hidden">
          <div className="aspect-[210/297] bg-secondary/40">
            {event.poster_url ? (
              <img src={event.poster_url} alt={`Affiche ${event.name}`} className="w-full h-full object-contain" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">Pas d'affiche</div>
            )}
          </div>
        </Card>

        <div>
          <div className="flex items-start justify-between gap-3 mb-3">
            <h1 className="font-display text-3xl md:text-4xl font-bold">{event.name}</h1>
            {isOwner && (
              <Button asChild variant="glass" size="sm">
                <Link to={`/organizer/events/${event.id}/edit`}><Pencil className="h-4 w-4 mr-1" />Modifier</Link>
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mb-4">
            {event.start_date && (
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                {format(new Date(event.start_date), "d MMM yyyy", { locale: fr })}
                {event.end_date && event.end_date !== event.start_date && ` → ${format(new Date(event.end_date), "d MMM yyyy", { locale: fr })}`}
              </span>
            )}
            {event.location && (
              <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" />{event.location}</span>
            )}
          </div>

          {event.description && (
            <p className="text-foreground/90 whitespace-pre-line mb-5">{event.description}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {event.website_url && (
              <a href={event.website_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-secondary/60 hover:bg-secondary transition-colors">
                <Globe className="h-4 w-4" />Site web
              </a>
            )}
            {event.contact_email && (
              <a href={`mailto:${event.contact_email}`} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-secondary/60 hover:bg-secondary transition-colors">
                <Mail className="h-4 w-4" />{event.contact_email}
              </a>
            )}
            {event.contact_phone && (
              <a href={`tel:${event.contact_phone}`} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-secondary/60 hover:bg-secondary transition-colors">
                <Phone className="h-4 w-4" />{event.contact_phone}
              </a>
            )}
            {event.facebook_url && (
              <a href={event.facebook_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-secondary/60 hover:bg-secondary"><Facebook className="h-4 w-4" /></a>
            )}
            {event.instagram_url && (
              <a href={event.instagram_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-secondary/60 hover:bg-secondary"><Instagram className="h-4 w-4" /></a>
            )}
            {event.twitter_url && (
              <a href={event.twitter_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-secondary/60 hover:bg-secondary"><Twitter className="h-4 w-4" /></a>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-2xl font-semibold">Courses de l'épreuve</h2>
        {isOwner && (
          <Button asChild variant="hero" size="sm">
            <Link to={`/organizer/new-race?event=${event.id}`}>+ Ajouter une course</Link>
          </Button>
        )}
      </div>

      {races.length === 0 ? (
        <Card className="glass-card p-10 text-center">
          <p className="text-muted-foreground">Aucune course rattachée pour l'instant.</p>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {races.map((r) => {
            const computedStatus: "upcoming" | "live" | "finished" =
              r.status === "finished"
                ? "finished"
                : new Date(r.start_time).getTime() > Date.now()
                  ? "upcoming"
                  : "live";
            return (
              <Link key={r.id} to={`/races/${r.id}`}>
                <Card className="glass-card p-5 h-full hover:border-primary/50 hover:shadow-glow transition-smooth">
                  <div className="flex items-center gap-2 mb-3">
                    <StatusBadge status={computedStatus} />
                    {r.distance_km && <span className="text-xs text-muted-foreground">{r.distance_km} km</span>}
                  </div>
                  <h3 className="font-display font-semibold text-lg mb-1">{r.name}</h3>
                  <DifficultyStars level={r.difficulty_level} className="mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(r.start_time), "EEEE d MMMM yyyy, HH:mm", { locale: fr })}
                  </p>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
