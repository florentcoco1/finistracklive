import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { ChevronLeft, Play, Square, Activity, Satellite } from "lucide-react";
import { formatDistance, formatPace, formatSpeed } from "@/lib/gpx";

interface Race {
  id: string;
  name: string;
  distance_km: number | null;
}
interface Registration {
  id: string;
  bib_number: string;
  tracking_active: boolean;
}
interface Position {
  distance_along_route_m: number | null;
  progress_percent: number | null;
  rolling_speed_kmh: number | null;
  rolling_pace_sec_per_km: number | null;
  recorded_at: string;
}

export default function TrackerPage() {
  const { id: raceId } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [race, setRace] = useState<Race | null>(null);
  const [reg, setReg] = useState<Registration | null>(null);
  const [tracking, setTracking] = useState(false);
  const [lastPos, setLastPos] = useState<Position | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastSentRef = useRef<number>(0);

  useEffect(() => { document.title = "Suivi GPS — LiveTrack"; }, []);

  useEffect(() => {
    if (!raceId || !user) return;
    Promise.all([
      supabase.from("races").select("id, name, distance_km").eq("id", raceId).single(),
      supabase.from("race_registrations").select("id, bib_number, tracking_active").eq("race_id", raceId).eq("runner_id", user.id).maybeSingle(),
    ]).then(([raceRes, regRes]) => {
      if (raceRes.data) setRace(raceRes.data as Race);
      if (regRes.data) {
        setReg(regRes.data as Registration);
        setTracking(regRes.data.tracking_active);
      }
    });
  }, [raceId, user]);

  const sendPosition = async (lat: number, lng: number, accuracy?: number, speed?: number) => {
    if (!reg) return;
    // throttle locally to ~5s
    const now = Date.now();
    if (now - lastSentRef.current < 4500) return;
    lastSentRef.current = now;

    const { data, error } = await supabase.functions.invoke("record-position", {
      body: { registration_id: reg.id, latitude: lat, longitude: lng, accuracy, speed },
    });
    if (error) {
      console.error(error);
      return;
    }
    if (data?.position) setLastPos(data.position as Position);
  };

  const startTracking = async () => {
    if (!reg) return;
    if (!("geolocation" in navigator)) {
      toast.error("Géolocalisation non supportée par ce navigateur");
      return;
    }

    const { error } = await supabase
      .from("race_registrations")
      .update({ tracking_active: true, started_at: reg.tracking_active ? undefined : new Date().toISOString() })
      .eq("id", reg.id);
    if (error) { toast.error(error.message); return; }

    setTracking(true);
    setError(null);
    toast.success("Suivi GPS démarré");

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        sendPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.speed ?? undefined);
      },
      (err) => {
        setError(err.message);
        toast.error("Erreur GPS : " + err.message);
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
  };

  const stopTracking = async () => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setTracking(false);
    if (reg) {
      await supabase
        .from("race_registrations")
        .update({ tracking_active: false, finished_at: new Date().toISOString() })
        .eq("id", reg.id);
    }
    toast.success("Suivi arrêté");
  };

  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  if (loading) return <main className="container py-12"><p className="text-muted-foreground">Chargement…</p></main>;
  if (!user) return <Navigate to="/auth" replace />;

  if (!race || !reg) {
    return (
      <main className="container py-12">
        <Card className="glass-card p-8">
          <p className="text-muted-foreground mb-4">Tu n'es pas inscrit à cette course.</p>
          <Button variant="hero" onClick={() => navigate(`/races/${raceId}`)}>Voir la course</Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="container py-6 max-w-md">
      <Link to={`/races/${race.id}`} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
        <ChevronLeft className="h-4 w-4 mr-1" /> Retour
      </Link>

      <Card className="glass-card p-6 mb-4 text-center">
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Dossard</p>
        <p className="font-display text-5xl font-bold text-gradient mb-1">#{reg.bib_number}</p>
        <p className="text-sm text-muted-foreground">{race.name}</p>
      </Card>

      <Card className="glass-card p-6 mb-4">
        <div className="flex items-center gap-3 mb-5">
          <span className={`relative flex h-3 w-3 ${tracking ? "" : "opacity-30"}`}>
            {tracking && <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />}
            <span className={`relative inline-flex rounded-full h-3 w-3 ${tracking ? "bg-success" : "bg-muted-foreground"}`} />
          </span>
          <p className="text-sm font-medium">{tracking ? "Suivi GPS actif" : "Suivi inactif"}</p>
          <Satellite className={`h-4 w-4 ml-auto ${tracking ? "text-success" : "text-muted-foreground"}`} />
        </div>

        {tracking ? (
          <Button variant="destructive" size="xl" className="w-full" onClick={stopTracking}>
            <Square className="h-5 w-5 mr-2" /> Arrêter le suivi
          </Button>
        ) : (
          <Button variant="hero" size="xl" className="w-full animate-pulse-glow" onClick={startTracking}>
            <Play className="h-5 w-5 mr-2" /> Démarrer le suivi
          </Button>
        )}

        {error && <p className="text-xs text-destructive mt-3">{error}</p>}
      </Card>

      <Card className="glass-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-primary-glow" />
          <p className="text-sm font-medium">Mes stats live</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Distance" value={formatDistance(lastPos?.distance_along_route_m)} />
          <Stat label="Progression" value={lastPos?.progress_percent != null ? `${lastPos.progress_percent.toFixed(0)}%` : "—"} />
          <Stat label="Vitesse" value={formatSpeed(lastPos?.rolling_speed_kmh)} />
          <Stat label="Allure" value={formatPace(lastPos?.rolling_pace_sec_per_km)} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-3 text-center">
          Garde l'écran allumé et ne ferme pas l'onglet pendant la course.
        </p>
      </Card>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary/50 border border-border/50 p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-display text-lg font-semibold mt-0.5">{value}</p>
    </div>
  );
}
