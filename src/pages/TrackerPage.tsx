import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { ChevronLeft, Play, Square, Activity, Satellite, Flag, AlertTriangle, Watch } from "lucide-react";
import { formatDistance, formatPace, formatSpeed } from "@/lib/gpx";
import type { RunnerStatus } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

interface Race {
  id: string;
  name: string;
  distance_km: number | null;
}
interface Registration {
  id: string;
  bib_number: string;
  tracking_active: boolean;
  runner_status: RunnerStatus;
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
  const geoOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 } as const;

  const [race, setRace] = useState<Race | null>(null);
  const [reg, setReg] = useState<Registration | null>(null);
  const [tracking, setTracking] = useState(false);
  const [lastPos, setLastPos] = useState<Position | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pointsSent, setPointsSent] = useState(0);
  const [lastSendAt, setLastSendAt] = useState<number | null>(null);
  const [lastSendError, setLastSendError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastSentRef = useRef<number>(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const gpsHeartbeatRef = useRef<number | null>(null);
  const lastGpsEventAtRef = useRef<number>(0);
  const restartCooldownRef = useRef<number>(0);
  const trackingRef = useRef(false);
  const garminFreshTimeoutRef = useRef<number | null>(null);

  // Garmin LiveTrack
  const [garminUrl, setGarminUrl] = useState<string>(() => localStorage.getItem("garmin_livetrack_url") ?? "");
  const [garminActive, setGarminActive] = useState(false);
  const [garminError, setGarminError] = useState<string | null>(null);
  const [garminLastPointAt, setGarminLastPointAt] = useState<number | null>(null);
  const garminIntervalRef = useRef<number | null>(null);
  const garminSinceRef = useRef<number>(0);

  // True if Garmin produced a fresh point in the last 30s -> phone GPS pauses sending
  const garminFreshRef = useRef<boolean>(false);

  useEffect(() => { document.title = "Suivi GPS — FinisTrackLive"; }, []);
  useEffect(() => { trackingRef.current = tracking; }, [tracking]);

  useEffect(() => {
    if (!raceId || !user) return;
    Promise.all([
      supabase.from("races").select("id, name, distance_km").eq("id", raceId).single(),
      supabase.from("race_registrations").select("id, bib_number, tracking_active, runner_status").eq("race_id", raceId).eq("runner_id", user.id).maybeSingle(),
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
    // Priority Garmin: if a fresh Garmin point arrived in the last 30s, skip phone GPS
    if (garminFreshRef.current) return;
    // throttle locally to ~3s (server enforces 2s minimum)
    const now = Date.now();
    if (now - lastSentRef.current < 3000) return;
    lastSentRef.current = now;

    const { data, error } = await supabase.functions.invoke("record-position", {
      body: { registration_id: reg.id, latitude: lat, longitude: lng, accuracy, speed },
    });
    if (error) {
      console.error("[record-position] error", error);
      setLastSendError(error.message ?? "Envoi échoué");
      return;
    }
    if ((data as any)?.error) {
      console.warn("[record-position] server", data);
      setLastSendError((data as any).error);
      return;
    }
    setLastSendError(null);
    setPointsSent((n) => n + 1);
    setLastSendAt(Date.now());
    setError(null);
    if (data?.position) {
      setLastPos(data.position as Position);
      console.log("[record-position] ok", data.position);
    }
  };

  const clearPhoneWatcher = () => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  };

  const handleGeoSuccess = (pos: GeolocationPosition) => {
    lastGpsEventAtRef.current = Date.now();
    setError(null);
    console.log("[geo] watchPosition", pos.coords.latitude, pos.coords.longitude, "acc:", pos.coords.accuracy);
    void sendPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.speed ?? undefined);
  };

  const handleGeoError = (err: GeolocationPositionError) => {
    lastGpsEventAtRef.current = Date.now();
    console.warn("[geo] error", err.code, err.message);
    setError(err.message);

    if (err.code === err.PERMISSION_DENIED) {
      toast.error("Autorise la localisation précise et garde cette page ouverte.");
      return;
    }

    if (!trackingRef.current) return;

    const now = Date.now();
    if (now - restartCooldownRef.current < 8000) return;
    restartCooldownRef.current = now;

    clearPhoneWatcher();
    watchIdRef.current = navigator.geolocation.watchPosition(handleGeoSuccess, handleGeoError, geoOptions);
    window.setTimeout(() => {
      if (!trackingRef.current || garminFreshRef.current) return;
      navigator.geolocation.getCurrentPosition(handleGeoSuccess, handleGeoError, geoOptions);
    }, 1500);
  };

  const startPhoneWatcher = () => {
    if (!("geolocation" in navigator)) return;
    clearPhoneWatcher();
    lastGpsEventAtRef.current = Date.now();
    watchIdRef.current = navigator.geolocation.watchPosition(handleGeoSuccess, handleGeoError, geoOptions);
  };

  // Poll Garmin LiveTrack every 10s
  const pollGarmin = async () => {
    if (!reg || !garminUrl) return;
    const { data, error } = await supabase.functions.invoke("poll-garmin-livetrack", {
      body: {
        registration_id: reg.id,
        livetrack_url: garminUrl,
        since_ms: garminSinceRef.current,
      },
    });
    if (error) {
      console.error("[garmin] invoke error", error);
      setGarminError(error.message);
      return;
    }
    if (data && (data as any).ok === false) {
      console.warn("[garmin] response not ok", data);
      setGarminError((data as any).error ?? "Erreur Garmin inconnue");
      return;
    }
    setGarminError(null);
    if (data?.latest_ms && data.latest_ms > garminSinceRef.current) {
      garminSinceRef.current = data.latest_ms;
      setGarminLastPointAt(data.latest_ms);
    }
    if (data?.points > 0) {
      garminFreshRef.current = true;
      if (garminFreshTimeoutRef.current != null) window.clearTimeout(garminFreshTimeoutRef.current);
      // expire freshness after 30s of silence
      garminFreshTimeoutRef.current = window.setTimeout(() => {
        garminFreshRef.current = false;
        garminFreshTimeoutRef.current = null;
      }, 30_000);
    }
    if (data?.position) setLastPos(data.position as Position);
  };

  const startGarmin = () => {
    if (!garminUrl.trim()) {
      toast.error("Colle d'abord ton URL Garmin LiveTrack");
      return;
    }
    if (!/livetrack\.garmin\.com\/session\/.+\/token\/.+/.test(garminUrl)) {
      toast.error("URL invalide. Format: https://livetrack.garmin.com/session/.../token/...");
      return;
    }
    localStorage.setItem("garmin_livetrack_url", garminUrl.trim());
    setGarminActive(true);
    garminSinceRef.current = 0;
    pollGarmin();
    garminIntervalRef.current = window.setInterval(pollGarmin, 10_000);
    toast.success("Suivi Garmin LiveTrack activé");
  };

  const stopGarmin = () => {
    if (garminIntervalRef.current != null) {
      window.clearInterval(garminIntervalRef.current);
      garminIntervalRef.current = null;
    }
    if (garminFreshTimeoutRef.current != null) {
      window.clearTimeout(garminFreshTimeoutRef.current);
      garminFreshTimeoutRef.current = null;
    }
    setGarminActive(false);
    garminFreshRef.current = false;
    toast.success("Suivi Garmin arrêté");
  };

  const acquireWakeLock = async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
        wakeLockRef.current?.addEventListener?.("release", () => {
          console.log("[wake-lock] released");
        });
      }
    } catch (e) {
      console.warn("[wake-lock] failed", e);
    }
  };

  const releaseWakeLock = async () => {
    try { await wakeLockRef.current?.release?.(); } catch { /* noop */ }
    wakeLockRef.current = null;
  };

  // Re-acquire wake lock when tab becomes visible again
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && tracking) {
        acquireWakeLock();
        if (!garminFreshRef.current) startPhoneWatcher();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [tracking]);

  useEffect(() => {
    if (!tracking) {
      if (gpsHeartbeatRef.current != null) {
        window.clearInterval(gpsHeartbeatRef.current);
        gpsHeartbeatRef.current = null;
      }
      return;
    }

    gpsHeartbeatRef.current = window.setInterval(() => {
      if (garminFreshRef.current) return;

      const silenceMs = Date.now() - lastGpsEventAtRef.current;
      if (silenceMs < 12000) return;

      console.warn("[geo] heartbeat stalled", silenceMs);
      navigator.geolocation.getCurrentPosition(handleGeoSuccess, handleGeoError, geoOptions);

      if (silenceMs > 25000) {
        const now = Date.now();
        if (now - restartCooldownRef.current >= 8000) {
          restartCooldownRef.current = now;
          startPhoneWatcher();
        }
      }
    }, 10000);

    return () => {
      if (gpsHeartbeatRef.current != null) {
        window.clearInterval(gpsHeartbeatRef.current);
        gpsHeartbeatRef.current = null;
      }
    };
  }, [tracking]);

  const startTracking = async () => {
    if (!reg) return;
    if (!("geolocation" in navigator)) {
      toast.error("Géolocalisation non supportée par ce navigateur");
      return;
    }

    // Reset finished_at on (re)start so the runner reappears as active on the map
    const { error } = await supabase
      .from("race_registrations")
      .update({
        tracking_active: true,
        started_at: new Date().toISOString(),
        finished_at: null,
      } as any)
      .eq("id", reg.id);
    if (error) { toast.error(error.message); return; }

    setTracking(true);
    trackingRef.current = true;
    setError(null);
    setPointsSent(0);
    setLastSendError(null);
    lastGpsEventAtRef.current = Date.now();
    acquireWakeLock();
    toast.success("Suivi GPS démarré");

    navigator.geolocation.getCurrentPosition(handleGeoSuccess, handleGeoError, geoOptions);
    startPhoneWatcher();
  };


  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [stopChoice, setStopChoice] = useState<"finished" | "dnf" | "problem" | "">("");
  const [dnfReason, setDnfReason] = useState("");
  const [problemDesc, setProblemDesc] = useState("");

  const DNF_REASONS = [
    "Épuisement",
    "Blessure",
    "Erreur de parcours",
    "Problème matériel",
    "Conditions météo",
    "Autre",
  ];

  // Stop tracking + persist outcome (arrived / dnf / problem)
  const confirmStop = async () => {
    if (!reg || !stopChoice) return;

    // Stop GPS watchers
    clearPhoneWatcher();
    if (garminIntervalRef.current != null) {
      window.clearInterval(garminIntervalRef.current);
      garminIntervalRef.current = null;
      setGarminActive(false);
      garminFreshRef.current = false;
    }
    if (garminFreshTimeoutRef.current != null) {
      window.clearTimeout(garminFreshTimeoutRef.current);
      garminFreshTimeoutRef.current = null;
    }
    if (gpsHeartbeatRef.current != null) {
      window.clearInterval(gpsHeartbeatRef.current);
      gpsHeartbeatRef.current = null;
    }
    releaseWakeLock();
    setTracking(false);
    trackingRef.current = false;

    const update: Record<string, unknown> = {
      tracking_active: false,
      finished_at: new Date().toISOString(),
    };

    if (stopChoice === "finished") {
      update.runner_status = "running"; // arrived: status stays "running", finished_at marks arrival
      update.dnf_reason = null;
      update.problem_description = null;
    } else if (stopChoice === "dnf") {
      if (!dnfReason) { toast.error("Choisis un motif d'abandon"); return; }
      update.runner_status = "dnf";
      update.dnf_reason = dnfReason;
    } else if (stopChoice === "problem") {
      if (!problemDesc.trim()) { toast.error("Décris le problème"); return; }
      update.runner_status = "problem";
      update.problem_description = problemDesc.trim();
    }

    const { error } = await supabase
      .from("race_registrations")
      .update(update as any)
      .eq("id", reg.id);

    if (error) { toast.error(error.message); return; }

    setReg({
      ...reg,
      runner_status: (update.runner_status as RunnerStatus) ?? reg.runner_status,
    });
    setStopDialogOpen(false);
    setStopChoice("");
    setDnfReason("");
    setProblemDesc("");

    toast.success(
      stopChoice === "finished" ? "Bravo, arrivée enregistrée 🏁" :
      stopChoice === "dnf" ? "Abandon enregistré. Bon courage !" :
      "Problème signalé. L'organisation est prévenue.",
    );
  };

  useEffect(() => {
    return () => {
      clearPhoneWatcher();
      if (garminIntervalRef.current != null) window.clearInterval(garminIntervalRef.current);
      if (garminFreshTimeoutRef.current != null) window.clearTimeout(garminFreshTimeoutRef.current);
      if (gpsHeartbeatRef.current != null) window.clearInterval(gpsHeartbeatRef.current);
      releaseWakeLock();
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

  const isDnfOrProblem = reg.runner_status === "dnf" || reg.runner_status === "problem";

  return (
    <main className="container py-6 max-w-md">
      <Link to={`/races/${race.id}`} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
        <ChevronLeft className="h-4 w-4 mr-1" /> Retour
      </Link>

      <Card className="glass-card p-6 mb-4 text-center">
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Dossard</p>
        <p className="font-display text-5xl font-bold text-gradient mb-1">#{reg.bib_number}</p>
        <p className="text-sm text-muted-foreground">{race.name}</p>
        {reg.runner_status === "dnf" && (
          <p className="mt-2 text-sm font-semibold text-destructive">🏳️ Abandon enregistré</p>
        )}
        {reg.runner_status === "problem" && (
          <p className="mt-2 text-sm font-semibold text-warning">⚠️ Problème signalé</p>
        )}
      </Card>

      {!isDnfOrProblem && (
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
            <Button variant="destructive" size="xl" className="w-full" onClick={() => setStopDialogOpen(true)}>
              <Square className="h-5 w-5 mr-2" /> Arrêter le suivi
            </Button>
          ) : (
            <Button variant="hero" size="xl" className="w-full animate-pulse-glow" onClick={startTracking}>
              <Play className="h-5 w-5 mr-2" /> Démarrer le suivi
            </Button>
          )}

          {error && <p className="text-xs text-destructive mt-3">{error}</p>}
        </Card>
      )}

      {!isDnfOrProblem && (
        <Card className="glass-card p-6 mb-4">
          <div className="flex items-center gap-3 mb-4">
            <Watch className={`h-4 w-4 ${garminActive ? "text-primary-glow" : "text-muted-foreground"}`} />
            <p className="text-sm font-medium">Garmin LiveTrack</p>
            {garminActive && (
              <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-success">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
                </span>
                Connecté
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Colle l'URL LiveTrack envoyée par ta montre Garmin pour un suivi plus précis (priorité sur le GPS du téléphone).
          </p>
          <Input
            type="url"
            placeholder="https://livetrack.garmin.com/session/.../token/..."
            value={garminUrl}
            onChange={(e) => setGarminUrl(e.target.value)}
            disabled={garminActive}
            className="mb-3 text-xs"
          />
          {garminActive ? (
            <Button variant="outline" size="sm" className="w-full" onClick={stopGarmin}>
              <Square className="h-4 w-4 mr-2" /> Désactiver Garmin
            </Button>
          ) : (
            <Button variant="secondary" size="sm" className="w-full" onClick={startGarmin}>
              <Watch className="h-4 w-4 mr-2" /> Activer le suivi Garmin
            </Button>
          )}
          {garminLastPointAt && (
            <p className="text-[11px] text-muted-foreground mt-2 text-center">
              Dernier point Garmin : {new Date(garminLastPointAt).toLocaleTimeString("fr-FR")}
            </p>
          )}
          {garminError && <p className="text-xs text-destructive mt-2">{garminError}</p>}
        </Card>
      )}

      {/* Unified Stop Dialog: arrived / DNF / problem */}
      <Dialog open={stopDialogOpen} onOpenChange={(o) => { setStopDialogOpen(o); if (!o) { setStopChoice(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Arrêter le suivi</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">Quel est le motif de l'arrêt ?</p>

          <RadioGroup value={stopChoice} onValueChange={(v) => setStopChoice(v as typeof stopChoice)} className="space-y-2">
            <div className="flex items-center space-x-2 rounded-lg border border-border/50 p-3 hover:border-success/50 transition-smooth">
              <RadioGroupItem value="finished" id="stop-finished" />
              <Label htmlFor="stop-finished" className="cursor-pointer flex items-center gap-2">
                <Flag className="h-4 w-4 text-success" /> Je suis arrivé(e) 🏁
              </Label>
            </div>
            <div className="flex items-center space-x-2 rounded-lg border border-border/50 p-3 hover:border-destructive/50 transition-smooth">
              <RadioGroupItem value="dnf" id="stop-dnf" />
              <Label htmlFor="stop-dnf" className="cursor-pointer flex items-center gap-2">
                <Flag className="h-4 w-4 text-destructive" /> Abandon
              </Label>
            </div>
            <div className="flex items-center space-x-2 rounded-lg border border-border/50 p-3 hover:border-warning/50 transition-smooth">
              <RadioGroupItem value="problem" id="stop-problem" />
              <Label htmlFor="stop-problem" className="cursor-pointer flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" /> J'ai un problème
              </Label>
            </div>
          </RadioGroup>

          {stopChoice === "dnf" && (
            <div className="mt-2">
              <p className="text-xs font-medium text-muted-foreground mb-2">Motif de l'abandon</p>
              <RadioGroup value={dnfReason} onValueChange={setDnfReason} className="space-y-1.5">
                {DNF_REASONS.map((reason) => (
                  <div key={reason} className="flex items-center space-x-2">
                    <RadioGroupItem value={reason} id={`dnf-${reason}`} />
                    <Label htmlFor={`dnf-${reason}`} className="cursor-pointer text-sm">{reason}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          )}

          {stopChoice === "problem" && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-muted-foreground">
                L'organisation sera prévenue avec ta position et ton téléphone.
              </p>
              <Textarea
                value={problemDesc}
                onChange={(e) => setProblemDesc(e.target.value)}
                placeholder="Décris brièvement ton problème…"
                maxLength={300}
                rows={3}
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setStopDialogOpen(false)}>Annuler</Button>
            <Button
              variant={stopChoice === "dnf" ? "destructive" : "hero"}
              disabled={
                !stopChoice ||
                (stopChoice === "dnf" && !dnfReason) ||
                (stopChoice === "problem" && !problemDesc.trim())
              }
              onClick={confirmStop}
            >
              Confirmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

        <div className="mt-4 rounded-lg bg-secondary/30 border border-border/40 p-3 space-y-1.5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Diagnostic transmission</p>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Points envoyés</span>
            <span className="font-mono font-semibold">{pointsSent}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Dernier envoi</span>
            <span className="font-mono">
              {lastSendAt ? new Date(lastSendAt).toLocaleTimeString("fr-FR") : "—"}
            </span>
          </div>
          {lastSendError && (
            <p className="text-[11px] text-destructive mt-1">⚠️ {lastSendError}</p>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground mt-3 text-center">
          📱 L'écran reste allumé pendant le suivi. Évite de fermer l'onglet.
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
