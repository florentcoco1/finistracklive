import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { ChevronLeft, Play, Square, Activity, Satellite, Flag, AlertTriangle, Watch, Trophy, Timer } from "lucide-react";
import { formatDistance, formatPace, formatSpeed, haversineMeters } from "@/lib/gpx";
import type { RunnerStatus, RouteCoord, LeaderboardRow } from "@/lib/types";
import RaceMap from "@/components/RaceMap";
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
  route_points: RouteCoord[] | null;
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
  speed?: number | null;
  latitude?: number | null;
  longitude?: number | null;
}
interface FunctionErrorResponse {
  error?: string;
  ok?: boolean;
}
interface WakeLockNavigator extends Navigator {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinel>;
  };
}

const PHONE_SEND_INTERVAL_MS = 10_000;
const RUNNER_STATS_REFRESH_MS = 5_000;
const RUNNER_MAP_REFRESH_MS = 8_000;
const GPS_WAKE_AFTER_MS = 45_000;
const GPS_RESTART_AFTER_MS = 90_000;
const GPS_HEARTBEAT_MS = 30_000;

function snapDistanceToRoute(point: { lat: number; lng: number }, route: RouteCoord[] | null): number | null {
  if (!route || route.length < 2) return null;

  let bestDist = Infinity;
  let bestAlong = 0;

  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    const meanLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos(meanLat);
    const bx = (b.lng - a.lng) * mPerDegLng;
    const by = (b.lat - a.lat) * mPerDegLat;
    const px = (point.lng - a.lng) * mPerDegLng;
    const py = (point.lat - a.lat) * mPerDegLat;
    const segLen2 = bx * bx + by * by;
    const t = Math.max(0, Math.min(1, segLen2 > 0 ? (px * bx + py * by) / segLen2 : 0));
    const dx = px - t * bx;
    const dy = py - t * by;
    const distM = Math.sqrt(dx * dx + dy * dy);

    if (distM < bestDist) {
      bestDist = distM;
      const segLengthM = haversineMeters(a, b);
      bestAlong = a.cumulativeDistanceM + t * segLengthM;
    }
  }

  return Math.max(0, Math.round(bestAlong));
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
  const [mapPoint, setMapPoint] = useState<{ lat: number; lng: number; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pointsSent, setPointsSent] = useState(0);
  const [lastSendAt, setLastSendAt] = useState<number | null>(null);
  const [lastSendError, setLastSendError] = useState<string | null>(null);
  const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardRow[]>([]);
  const watchIdRef = useRef<number | null>(null);
  const lastSentRef = useRef<number>(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const gpsHeartbeatRef = useRef<number | null>(null);
  const lastGpsEventAtRef = useRef<number>(0);
  const restartCooldownRef = useRef<number>(0);
  const trackingRef = useRef(false);
  const garminFreshTimeoutRef = useRef<number | null>(null);
  const lastMetricSampleRef = useRef<{ distanceM: number; at: number } | null>(null);
  const lastMapRefreshRef = useRef<number>(0);
  const lastStatsRefreshRef = useRef<number>(0);

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

  const sortedLeaderboard = useMemo(() => {
    const rankStatus = (status: string | null) => (status === "dnf" ? 2 : status === "problem" ? 1 : 0);
    return [...leaderboardRows].sort((a, b) => {
      if (a.rfid_overall_rank != null && b.rfid_overall_rank != null) return a.rfid_overall_rank - b.rfid_overall_rank;
      if (a.rfid_overall_rank != null) return -1;
      if (b.rfid_overall_rank != null) return 1;
      if (a.rfid_official_seconds != null && b.rfid_official_seconds != null) return a.rfid_official_seconds - b.rfid_official_seconds;
      if (a.rfid_official_seconds != null) return -1;
      if (b.rfid_official_seconds != null) return 1;
      const statusDelta = rankStatus(a.runner_status) - rankStatus(b.runner_status);
      if (statusDelta !== 0) return statusDelta;
      if (a.finished_at && b.finished_at) return new Date(a.finished_at).getTime() - new Date(b.finished_at).getTime();
      if (a.finished_at) return -1;
      if (b.finished_at) return 1;
      return (b.distance_along_route_m ?? -1) - (a.distance_along_route_m ?? -1);
    });
  }, [leaderboardRows]);

  const myLiveRank = useMemo(() => {
    if (!reg) return null;
    const index = sortedLeaderboard.findIndex((row) => row.registration_id === reg.id);
    return index >= 0 ? index + 1 : null;
  }, [reg, sortedLeaderboard]);

  const visibleLeaderboardRows = useMemo(() => {
    if (!reg) return sortedLeaderboard.slice(0, 5);
    const topRows = sortedLeaderboard.slice(0, 5);
    const mine = sortedLeaderboard.find((row) => row.registration_id === reg.id);
    if (mine && !topRows.some((row) => row.registration_id === reg.id)) return [...topRows, mine];
    return topRows;
  }, [reg, sortedLeaderboard]);

  useEffect(() => {
    if (!raceId || !user) return;
    Promise.all([
      supabase.from("races").select("id, name, distance_km, route_points").eq("id", raceId).single(),
      supabase.from("race_registrations").select("id, bib_number, tracking_active, runner_status").eq("race_id", raceId).eq("runner_id", user.id).maybeSingle(),
    ]).then(([raceRes, regRes]) => {
      if (raceRes.data) setRace(raceRes.data as unknown as Race);
      if (regRes.data) {
        setReg(regRes.data as Registration);
        setTracking(regRes.data.tracking_active);
      }
    });
  }, [raceId, user]);

  useEffect(() => {
    if (!raceId || !tracking) {
      setLeaderboardRows([]);
      return;
    }

    let active = true;
    const reloadLeaderboard = async () => {
      const { data, error } = await supabase
        .from("live_leaderboard")
        .select("*")
        .eq("race_id", raceId);

      if (error) {
        console.warn("[runner-leaderboard] reload error", error);
        return;
      }
      if (active) setLeaderboardRows((data ?? []) as LeaderboardRow[]);
    };

    void reloadLeaderboard();
    const channel = supabase
      .channel(`runner-leaderboard:${raceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "runner_positions" },
        () => reloadLeaderboard(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "race_registrations", filter: `race_id=eq.${raceId}` },
        () => reloadLeaderboard(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rfid_timing_results", filter: `race_id=eq.${raceId}` },
        () => reloadLeaderboard(),
      )
      .subscribe();
    const poll = window.setInterval(reloadLeaderboard, 5000);

    return () => {
      active = false;
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [raceId, tracking]);

  const sendPosition = async (lat: number, lng: number, accuracy?: number, speed?: number) => {
    if (!reg) return;
    // Priority Garmin: if a fresh Garmin point arrived in the last 30s, skip phone GPS
    if (garminFreshRef.current) return;
    // throttle locally: smoother GPS capture, calmer UI + fewer backend writes
    const now = Date.now();
    if (now - lastSentRef.current < PHONE_SEND_INTERVAL_MS) return;
    lastSentRef.current = now;

    const { data, error } = await supabase.functions.invoke("record-position", {
      body: { registration_id: reg.id, latitude: lat, longitude: lng, accuracy, speed },
    });
    if (error) {
      console.error("[record-position] error", error);
      setLastSendError(error.message ?? "Envoi échoué");
      return;
    }
    const recordResponse = data as (FunctionErrorResponse & { position?: Position }) | null;
    if (recordResponse?.error) {
      console.warn("[record-position] server", data);
      setLastSendError(recordResponse.error);
      return;
    }
    setLastSendError(null);
    setPointsSent((n) => n + 1);
    setLastSendAt(Date.now());
    setError(null);
    if (recordResponse?.position) {
      const serverPos = recordResponse.position;
      setLastPos((current) => ({
        ...serverPos,
        distance_along_route_m: serverPos.distance_along_route_m ?? current?.distance_along_route_m ?? null,
        progress_percent: serverPos.progress_percent ?? current?.progress_percent ?? null,
        rolling_speed_kmh: serverPos.rolling_speed_kmh ?? current?.rolling_speed_kmh ?? null,
        rolling_pace_sec_per_km: serverPos.rolling_pace_sec_per_km ?? current?.rolling_pace_sec_per_km ?? null,
      }));
      console.log("[record-position] ok", data.position);
    }
  };

  const updateLocalPosition = (lat: number, lng: number, nativeSpeed?: number | null) => {
    const now = Date.now();
    if (now - lastStatsRefreshRef.current < RUNNER_STATS_REFRESH_MS) return;
    lastStatsRefreshRef.current = now;

    const distanceM = snapDistanceToRoute({ lat, lng }, race?.route_points ?? null);
    const routeEnd = race?.route_points?.length ? race.route_points[race.route_points.length - 1] : null;
    const totalM = race?.distance_km ? race.distance_km * 1000 : routeEnd?.cumulativeDistanceM;
    const previous = lastMetricSampleRef.current;

    let rollingSpeedKmh =
      typeof nativeSpeed === "number" && Number.isFinite(nativeSpeed) && nativeSpeed >= 0
        ? nativeSpeed * 3.6
        : lastPos?.rolling_speed_kmh ?? null;

    if (previous && distanceM != null) {
      const elapsedS = (now - previous.at) / 1000;
      const deltaM = Math.max(0, distanceM - previous.distanceM);
      if (elapsedS >= 3 && deltaM >= 2) {
        rollingSpeedKmh = (deltaM / 1000) / (elapsedS / 3600);
      }
    }

    if (distanceM != null) {
      lastMetricSampleRef.current = { distanceM, at: now };
    }

    setLastPos((current) => ({
      distance_along_route_m: distanceM ?? current?.distance_along_route_m ?? null,
      progress_percent:
        distanceM != null && totalM && totalM > 0
          ? Math.max(0, Math.min(100, (distanceM / totalM) * 100))
          : current?.progress_percent ?? null,
      rolling_speed_kmh: rollingSpeedKmh,
      rolling_pace_sec_per_km:
        rollingSpeedKmh && rollingSpeedKmh > 0 ? Math.round(3600 / rollingSpeedKmh) : current?.rolling_pace_sec_per_km ?? null,
      speed: nativeSpeed ?? current?.speed ?? null,
      recorded_at: new Date(now).toISOString(),
      latitude: lat,
      longitude: lng,
    }));
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
    if (Date.now() - lastMapRefreshRef.current >= RUNNER_MAP_REFRESH_MS) {
      setMapPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() });
      lastMapRefreshRef.current = Date.now();
    }
    updateLocalPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.speed ?? null);
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
    const garminResponse = data as (FunctionErrorResponse & { latest_ms?: number; points?: number; position?: Position }) | null;
    if (garminResponse?.ok === false) {
      console.warn("[garmin] response not ok", data);
      setGarminError(garminResponse.error ?? "Erreur Garmin inconnue");
      return;
    }
    setGarminError(null);
    if (garminResponse?.latest_ms && garminResponse.latest_ms > garminSinceRef.current) {
      garminSinceRef.current = garminResponse.latest_ms;
      setGarminLastPointAt(garminResponse.latest_ms);
    }
    if ((garminResponse?.points ?? 0) > 0) {
      garminFreshRef.current = true;
      if (garminFreshTimeoutRef.current != null) window.clearTimeout(garminFreshTimeoutRef.current);
      // expire freshness after 30s of silence
      garminFreshTimeoutRef.current = window.setTimeout(() => {
        garminFreshRef.current = false;
        garminFreshTimeoutRef.current = null;
      }, 30_000);
    }
    if (garminResponse?.position) {
      const p = garminResponse.position;
      setLastPos((current) => ({
        ...p,
        distance_along_route_m: p.distance_along_route_m ?? current?.distance_along_route_m ?? null,
        progress_percent: p.progress_percent ?? current?.progress_percent ?? null,
        rolling_speed_kmh: p.rolling_speed_kmh ?? current?.rolling_speed_kmh ?? null,
        rolling_pace_sec_per_km: p.rolling_pace_sec_per_km ?? current?.rolling_pace_sec_per_km ?? null,
      }));
      if (p.latitude != null && p.longitude != null) {
        if (p.distance_along_route_m != null) {
          lastMetricSampleRef.current = { distanceM: p.distance_along_route_m, at: Date.now() };
        }
        if (Date.now() - lastMapRefreshRef.current >= RUNNER_MAP_REFRESH_MS) {
          setMapPoint({ lat: p.latitude, lng: p.longitude, at: Date.now() });
          lastMapRefreshRef.current = Date.now();
        }
      }
    }
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
      const wakeNavigator = navigator as WakeLockNavigator;
      if (wakeNavigator.wakeLock) {
        wakeLockRef.current = await wakeNavigator.wakeLock.request("screen");
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
      if (silenceMs < GPS_WAKE_AFTER_MS) return;

      console.warn("[geo] heartbeat stalled", silenceMs);
      navigator.geolocation.getCurrentPosition(handleGeoSuccess, handleGeoError, geoOptions);

      if (silenceMs > GPS_RESTART_AFTER_MS) {
        const now = Date.now();
        if (now - restartCooldownRef.current >= 8000) {
          restartCooldownRef.current = now;
          startPhoneWatcher();
        }
      }
    }, GPS_HEARTBEAT_MS);

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
    lastMetricSampleRef.current = null;
    lastStatsRefreshRef.current = 0;
    lastMapRefreshRef.current = 0;
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

  const routeCoords = useMemo<[number, number][]>(
    () => race?.route_points?.map((p) => [p.lat, p.lng]) ?? [],
    [race?.route_points],
  );

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

      {race.route_points && race.route_points.length > 1 && (
        <Card className="glass-card p-3 mb-4 overflow-hidden">
          <div className="h-72 w-full">
            <RaceMap
              routeCoords={routeCoords}
              routePoints={race.route_points}
              runners={
                mapPoint
                  ? [{
                      registration_id: reg.id,
                      race_id: race.id,
                      runner_id: user.id,
                      bib_number: reg.bib_number,
                      category: null,
                      tracking_active: tracking,
                      started_at: null,
                      finished_at: null,
                      runner_status: reg.runner_status,
                      emergency_phone: null,
                      dnf_reason: null,
                      problem_description: null,
                      first_name: null,
                      last_name: null,
                      latitude: mapPoint.lat,
                      longitude: mapPoint.lng,
                      distance_along_route_m: lastPos?.distance_along_route_m ?? null,
                      progress_percent: lastPos?.progress_percent ?? null,
                      rolling_speed_kmh: lastPos?.rolling_speed_kmh ?? null,
                      rolling_pace_sec_per_km: lastPos?.rolling_pace_sec_per_km ?? null,
                      last_position_at: new Date(mapPoint.at).toISOString(),
                    } as LeaderboardRow]
                  : []
              }
              focusedRunnerId={mapPoint ? reg.id : null}
            />
          </div>
        </Card>
      )}

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

      {tracking && !isDnfOrProblem && (
        <Card className="glass-card p-5 mt-4">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="h-4 w-4 text-primary-glow" />
            <p className="text-sm font-medium">Classement en direct</p>
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-success">
              <Timer className="h-3 w-3" /> Live
            </span>
          </div>

          {myLiveRank && (
            <div className="rounded-lg bg-primary/10 border border-primary/20 p-3 mb-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Ma position</p>
              <p className="font-display text-2xl font-bold text-primary">{myLiveRank}<sup className="text-sm">e</sup></p>
            </div>
          )}

          {visibleLeaderboardRows.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">Classement en attente des premiers points GPS.</p>
          ) : (
            <ol className="space-y-2">
              {visibleLeaderboardRows.map((row) => {
                const rank = sortedLeaderboard.findIndex((item) => item.registration_id === row.registration_id) + 1;
                const isMe = row.registration_id === reg.id;
                return (
                  <li key={row.registration_id} className={`flex items-center gap-3 rounded-lg border p-3 ${isMe ? "border-primary/40 bg-primary/10" : "border-border/50 bg-secondary/40"}`}>
                    <span className={`w-7 shrink-0 text-center font-display text-sm font-bold ${isMe ? "text-primary" : "text-muted-foreground"}`}>{rank}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">#{row.bib_number}{isMe ? " · Moi" : row.first_name || row.last_name ? ` · ${row.first_name ?? ""} ${row.last_name ?? ""}` : ""}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.rfid_rounded_time ?? row.rfid_official_time ?? `${formatDistance(row.distance_along_route_m)}${row.progress_percent != null ? ` · ${row.progress_percent.toFixed(0)}%` : ""}`}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatSpeed(row.rolling_speed_kmh)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      )}
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
