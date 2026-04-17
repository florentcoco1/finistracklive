import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import RaceMap, { colorForRegistration } from "@/components/RaceMap";
import { StatusBadge } from "./Index";
import { formatDistance, formatPace, formatSpeed } from "@/lib/gpx";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { ChevronLeft, Trophy, Radio, UserPlus, Smartphone, AlertTriangle, Flag, Phone } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import type { LeaderboardRow } from "@/lib/types";

interface Race {
  id: string;
  name: string;
  description: string | null;
  start_time: string;
  distance_km: number | null;
  status: "upcoming" | "live" | "finished";
  gpx_geojson: any;
  route_points: { lat: number; lng: number; cumulativeDistanceM: number }[] | null;
  organizer_id: string;
}

export default function RaceDetail() {
  const { id: raceId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [race, setRace] = useState<Race | null>(null);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [focused, setFocused] = useState<string | null>(null);
  const [myRegistration, setMyRegistration] = useState<{ id: string; bib_number: string } | null>(null);
  const [signupOpen, setSignupOpen] = useState(false);
  const [bibInput, setBibInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");

  useEffect(() => {
    if (!raceId) return;
    supabase
      .from("races")
      .select("id, name, description, start_time, distance_km, status, gpx_geojson, route_points, organizer_id")
      .eq("id", raceId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          toast.error("Course introuvable");
          return;
        }
        setRace(data as any);
        document.title = `${data.name} — LiveTrack`;
      });
  }, [raceId]);

  // Load + subscribe to leaderboard
  useEffect(() => {
    if (!raceId) return;
    let active = true;

    const reload = async () => {
      const { data } = await supabase
        .from("live_leaderboard")
        .select("*")
        .eq("race_id", raceId);
      if (active) setRows((data ?? []) as LeaderboardRow[]);
    };
    reload();

    const channel = supabase
      .channel(`race:${raceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "runner_positions" },
        () => reload(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "race_registrations", filter: `race_id=eq.${raceId}` },
        () => reload(),
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [raceId]);

  // Load my registration if logged in
  useEffect(() => {
    if (!raceId || !user) {
      setMyRegistration(null);
      return;
    }
    supabase
      .from("race_registrations")
      .select("id, bib_number")
      .eq("race_id", raceId)
      .eq("runner_id", user.id)
      .maybeSingle()
      .then(({ data }) => setMyRegistration(data));
  }, [raceId, user]);

  const routeCoords = useMemo<[number, number][]>(() => {
    if (race?.route_points && race.route_points.length > 0) {
      return race.route_points.map((p) => [p.lat, p.lng]);
    }
    return [];
  }, [race]);

  const isOrganizer = user && race && race.organizer_id === user.id;

  const alerts = useMemo(
    () => rows.filter((r) => r.runner_status === "dnf" || r.runner_status === "problem"),
    [rows],
  );

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const da = a.distance_along_route_m ?? -1;
        const db = b.distance_along_route_m ?? -1;
        return db - da;
      }),
    [rows],
  );

  const handleRegister = async () => {
    if (!user) {
      toast.error("Connecte-toi pour t'inscrire");
      return;
    }
    if (!bibInput.trim()) {
      toast.error("N° de dossard requis");
      return;
    }
    if (!phoneInput.trim() || phoneInput.trim().length < 6) {
      toast.error("N° de téléphone requis");
      return;
    }
    const { data, error } = await supabase
      .from("race_registrations")
      .insert({
        race_id: raceId!,
        runner_id: user.id,
        bib_number: bibInput.trim(),
        emergency_phone: phoneInput.trim(),
      } as any)
      .select("id, bib_number")
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    setMyRegistration(data);
    setSignupOpen(false);
    toast.success(`Inscrit avec le dossard #${data.bib_number}`);
  };

  if (!race) {
    return (
      <main className="container py-12">
        <p className="text-muted-foreground">Chargement…</p>
      </main>
    );
  }

  return (
    <main className="container py-6 md:py-10">
      <Link to="/races" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
        <ChevronLeft className="h-4 w-4 mr-1" /> Toutes les courses
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <StatusBadge status={race.status} />
            {race.distance_km && (
              <span className="text-sm text-muted-foreground">{race.distance_km} km</span>
            )}
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-bold">{race.name}</h1>
          <p className="text-muted-foreground mt-1">
            {format(new Date(race.start_time), "EEEE d MMMM yyyy, HH:mm", { locale: fr })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {user && myRegistration ? (
            <Button asChild variant="hero">
              <Link to={`/race/${race.id}/track`}>
                <Smartphone className="h-4 w-4 mr-2" /> Mode coureur (#{myRegistration.bib_number})
              </Link>
            </Button>
          ) : user ? (
            <Dialog open={signupOpen} onOpenChange={setSignupOpen}>
              <DialogTrigger asChild>
                <Button variant="hero"><UserPlus className="h-4 w-4 mr-2" /> S'inscrire</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>S'inscrire à {race.name}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="bib">N° de dossard</Label>
                    <Input id="bib" value={bibInput} onChange={(e) => setBibInput(e.target.value)} placeholder="ex: 142" />
                  </div>
                  <div>
                    <Label htmlFor="phone">N° de téléphone</Label>
                    <Input id="phone" type="tel" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} placeholder="ex: 06 12 34 56 78" />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="hero" onClick={handleRegister}>Confirmer</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : (
            <Button asChild variant="hero">
              <Link to="/auth?mode=signup"><UserPlus className="h-4 w-4 mr-2" /> Se connecter pour s'inscrire</Link>
            </Button>
          )}
        </div>
      </div>

      {race.description && (
        <p className="text-muted-foreground mb-6 max-w-3xl">{race.description}</p>
      )}

      {/* Organizer alerts */}
      {isOrganizer && alerts.length > 0 && (
        <Card className="glass-card p-4 mb-6 border-warning/50">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-5 w-5 text-warning" />
            <h2 className="font-display font-semibold text-lg">Alertes coureurs ({alerts.length})</h2>
          </div>
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li key={a.registration_id} className={`rounded-lg p-3 border ${a.runner_status === "problem" ? "border-warning/50 bg-warning/10" : "border-destructive/30 bg-destructive/5"}`}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-sm">
                      #{a.bib_number} {a.first_name} {a.last_name}
                    </span>
                    {a.runner_status === "dnf" ? (
                      <span className="ml-2 text-xs text-destructive font-semibold">
                        <Flag className="inline h-3 w-3 mr-1" />Abandon{a.dnf_reason ? ` — ${a.dnf_reason}` : ""}
                      </span>
                    ) : (
                      <span className="ml-2 text-xs text-warning font-semibold">
                        <AlertTriangle className="inline h-3 w-3 mr-1" />Problème
                      </span>
                    )}
                  </div>
                  {a.emergency_phone && (
                    <a href={`tel:${a.emergency_phone}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0">
                      <Phone className="h-3 w-3" /> {a.emergency_phone}
                    </a>
                  )}
                </div>
                {a.runner_status === "problem" && a.problem_description && (
                  <p className="text-xs text-muted-foreground mt-1">« {a.problem_description} »</p>
                )}
                {a.latitude && a.longitude && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    📍 Dernière position : {a.latitude.toFixed(5)}, {a.longitude.toFixed(5)}
                    {a.distance_along_route_m != null && ` — ${formatDistance(a.distance_along_route_m)}`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
        <Card className="glass-card p-2 h-[420px] md:h-[600px] overflow-hidden">
          <RaceMap routeCoords={routeCoords} runners={rows} focusedRunnerId={focused} />
        </Card>

        <Card className="glass-card p-4 max-h-[600px] flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="h-5 w-5 text-primary-glow" />
            <h2 className="font-display font-semibold text-lg">Classement live</h2>
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-success">
              <Radio className="h-3 w-3" /> Temps réel
            </span>
          </div>
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Aucun coureur inscrit pour le moment.</p>
          ) : (
            <ol className="space-y-2 overflow-y-auto pr-1">
              {sorted.map((r, i) => {
                const stale = r.last_position_at
                  ? Date.now() - new Date(r.last_position_at).getTime() > 30000
                  : true;
                const color = colorForRegistration(r.registration_id);
                return (
                  <li
                    key={r.registration_id}
                    onClick={() => setFocused(r.registration_id)}
                    className={`flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-secondary/40 cursor-pointer hover:border-primary/40 transition-smooth ${stale ? "opacity-60" : ""}`}
                  >
                    <span className="text-sm font-bold text-muted-foreground w-5 text-center">{i + 1}</span>
                    <span
                      className="h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                      style={{ background: color }}
                    >
                      {r.bib_number}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {r.first_name} {r.last_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistance(r.distance_along_route_m)}
                        {r.progress_percent != null && ` · ${r.progress_percent.toFixed(0)}%`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatSpeed(r.rolling_speed_kmh)} · {formatPace(r.rolling_pace_sec_per_km)}
                      </p>
                      {r.runner_status === 'dnf' && (
                        <p className="text-[10px] text-destructive mt-0.5 font-semibold">
                          🏳️ Abandon{r.dnf_reason ? ` — ${r.dnf_reason}` : ""}
                        </p>
                      )}
                      {r.runner_status === 'problem' && (
                        <p className="text-[10px] text-warning mt-0.5 font-semibold">
                          ⚠️ Problème{r.problem_description ? ` — ${r.problem_description}` : ""}
                        </p>
                      )}
                      {stale && r.tracking_active && r.runner_status === 'running' && (
                        <p className="text-[10px] text-warning mt-0.5">📡 signal perdu</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>
    </main>
  );
}
