import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import RaceMap, { colorForRegistration } from "@/components/RaceMap";
import ElevationChart from "@/components/ElevationChart";
import { StatusBadge } from "./Index";
import { formatDistance, formatPace, formatSpeed } from "@/lib/gpx";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { ChevronLeft, Trophy, UserPlus, Smartphone, AlertTriangle, Flag, Phone, Link2, RefreshCw, Timer, Shield } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import type { LeaderboardRow } from "@/lib/types";
import { DifficultyStars } from "@/components/DifficultyStars";
import CheckpointRankings from "@/components/CheckpointRankings";

interface Race {
  id: string;
  name: string;
  description: string | null;
  start_time: string;
  distance_km: number | null;
  difficulty_level: number | null;
  status: "upcoming" | "live" | "finished";
  gpx_geojson: any;
  route_points: { lat: number; lng: number; cumulativeDistanceM: number }[] | null;
  organizer_id: string;
}

interface UntypedRaceQuery {
  select: (columns: string) => {
    eq: (column: string, value: string) => { single: () => Promise<{ data: unknown | null; error: { message: string } | null }> };
  };
}

function isMissingDifficultyColumn(error: { message: string } | null) {
  return !!error?.message?.includes("difficulty_level");
}

export default function RaceDetail() {
  const { id: raceId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [race, setRace] = useState<Race | null>(null);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [genderFilter, setGenderFilter] = useState<"all" | "M" | "F">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [focused, setFocused] = useState<string | null>(null);
  const [myRegistration, setMyRegistration] = useState<{ id: string; bib_number: string } | null>(null);
  const [gmcapEligible, setGmcapEligible] = useState<boolean | null>(null);
  const [profileMissing, setProfileMissing] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const [bibInput, setBibInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [importingRfid, setImportingRfid] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [gmcapSourceId, setGmcapSourceId] = useState<string | null>(null);
  const [gmcapSourceUrl, setGmcapSourceUrl] = useState("");
  const [gmcapEnabled, setGmcapEnabled] = useState(true);
  const [gmcapStatus, setGmcapStatus] = useState<string | null>(null);
  const [savingSource, setSavingSource] = useState(false);

  useEffect(() => {
    if (!raceId) return;
    const loadRace = (columns: string) => (supabase.from as unknown as (table: string) => UntypedRaceQuery)("races")
      .select(columns)
      .eq("id", raceId)
      .single();

    loadRace("id, name, description, start_time, distance_km, difficulty_level, status, gpx_geojson, route_points, organizer_id")
      .then(async ({ data, error }) => {
        if (isMissingDifficultyColumn(error)) {
          const fallback = await loadRace("id, name, description, start_time, distance_km, status, gpx_geojson, route_points, organizer_id");
          data = fallback.data ? { ...(fallback.data as Omit<Race, "difficulty_level">), difficulty_level: 1 } : null;
          error = fallback.error;
        }
        if (error || !data) {
          toast.error("Course introuvable");
          return;
        }
        const nextRace = data as Race;
        setRace(nextRace);
        document.title = `${nextRace.name} — FinisTrackLive`;
      });
  }, [raceId]);

  // Load + subscribe to leaderboard, with polling fallback every 8s
  useEffect(() => {
    if (!raceId) return;
    let active = true;

    const patchRunnerPosition = (incoming: Partial<LeaderboardRow> & { registration_id: string; recorded_at?: string | null }) => {
      if (!active) return;
      setRows((current) => {
        let matched = false;
        const next = current.map((row) => {
          if (row.registration_id !== incoming.registration_id) return row;
          matched = true;

          const incomingAt = incoming.recorded_at ?? row.last_position_at;
          const currentAt = row.last_position_at;
          if (
            incomingAt &&
            currentAt &&
            new Date(incomingAt).getTime() < new Date(currentAt).getTime()
          ) {
            return row;
          }

          return {
            ...row,
            latitude: incoming.latitude ?? row.latitude,
            longitude: incoming.longitude ?? row.longitude,
            distance_along_route_m: incoming.distance_along_route_m ?? row.distance_along_route_m,
            progress_percent: incoming.progress_percent ?? row.progress_percent,
            rolling_speed_kmh: incoming.rolling_speed_kmh ?? row.rolling_speed_kmh,
            rolling_pace_sec_per_km: incoming.rolling_pace_sec_per_km ?? row.rolling_pace_sec_per_km,
            last_position_at: incomingAt ?? row.last_position_at,
          };
        });

        return matched ? next : current;
      });
    };

    const reload = async () => {
      const [{ data: lbData, error: lbError }, { data: gmcapData, error: gmcapError }] = await Promise.all([
        supabase.from("live_leaderboard").select("*").eq("race_id", raceId),
        supabase
          .from("gmcap_results" as any)
          .select("bib_number, first_name, last_name, gender, category, status, official_time_text, official_time_seconds, scratch_rank, category_rank, gender_rank, imported_at")
          .eq("race_id", raceId),
      ]);
      if (lbError) console.warn("[leaderboard] reload error", lbError);
      if (gmcapError) console.warn("[leaderboard] gmcap reload error", gmcapError);

      const baseRows = (lbData ?? []) as LeaderboardRow[];
      const gmcapRows = ((gmcapData ?? []) as unknown) as Array<{
        bib_number: string | null;
        first_name: string | null;
        last_name: string | null;
        gender: string | null;
        category: string | null;
        status: string | null;
        official_time_text: string | null;
        official_time_seconds: number | null;
        scratch_rank: number | null;
        category_rank: number | null;
        gender_rank: number | null;
        imported_at: string | null;
      }>;

      const baseByBib = new Map<string, LeaderboardRow>();
      for (const row of baseRows) {
        const key = row.bib_number ? String(row.bib_number).trim() : "";
        if (key) baseByBib.set(key, row);
      }

      // If GMCAP data exists, the official ranking is built EXCLUSIVELY from GMCAP rows.
      // We enrich each GMCAP row with live tracking data when a registration matches by bib.
      if (gmcapRows.length > 0) {
        const usedBibs = new Set<string>();
        const fromGmcap: LeaderboardRow[] = gmcapRows.map((r) => {
          const key = r.bib_number ? String(r.bib_number).trim() : "";
          if (key) usedBibs.add(key);
          const base = key ? baseByBib.get(key) : undefined;
          const isDnf = r.status === "dnf" || r.status === "disqualified";
          return {
            registration_id: base?.registration_id ?? `gmcap:${key}`,
            race_id: raceId,
            runner_id: base?.runner_id ?? "",
            bib_number: key,
            category: r.category ?? base?.category ?? null,
            tracking_active: base?.tracking_active ?? false,
            started_at: base?.started_at ?? null,
            finished_at: base?.finished_at ?? null,
            runner_status: base?.runner_status ?? (isDnf ? "dnf" : "running"),
            emergency_phone: base?.emergency_phone ?? null,
            dnf_reason: base?.dnf_reason ?? null,
            problem_description: base?.problem_description ?? null,
            first_name: r.first_name ?? base?.first_name ?? null,
            last_name: r.last_name ?? base?.last_name ?? null,
            gender: r.gender ?? null,
            latitude: base?.latitude ?? null,
            longitude: base?.longitude ?? null,
            distance_along_route_m: base?.distance_along_route_m ?? null,
            progress_percent: base?.progress_percent ?? null,
            rolling_speed_kmh: base?.rolling_speed_kmh ?? null,
            rolling_pace_sec_per_km: base?.rolling_pace_sec_per_km ?? null,
            last_position_at: base?.last_position_at ?? null,
            official_time: r.official_time_text,
            official_seconds: r.official_time_seconds,
            rounded_time: null,
            rounded_seconds: null,
            overall_rank: r.scratch_rank,
            category_rank: r.category_rank,
            gender_rank: r.gender_rank,
            gmcap_status: r.status,
            gmcap_imported_at: r.imported_at,
          } as LeaderboardRow;
        });

        // Keep registered runners not present in GMCAP at the bottom (still tracked / not yet timed)
        const remaining = baseRows.filter((row) => {
          const key = row.bib_number ? String(row.bib_number).trim() : "";
          return !key || !usedBibs.has(key);
        });

        if (active) setRows([...fromGmcap, ...remaining]);
        return;
      }

      // No GMCAP data yet — fall back to live leaderboard only
      if (active) setRows(baseRows);
    };
    reload();

    const channel = supabase
      .channel(`race:${raceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "runner_positions" },
        (payload) => {
          console.log("[realtime] runner_positions", payload.eventType);
          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            const next = payload.new as {
              registration_id: string;
              latitude: number | null;
              longitude: number | null;
              distance_along_route_m: number | null;
              progress_percent: number | null;
              rolling_speed_kmh: number | null;
              rolling_pace_sec_per_km: number | null;
              recorded_at: string;
            };

            patchRunnerPosition(next);
            return;
          }

          reload();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "race_registrations", filter: `race_id=eq.${raceId}` },
        (payload) => {
          console.log("[realtime] race_registrations", payload.eventType);
          reload();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "gmcap_results", filter: `race_id=eq.${raceId}` },
        () => reload(),
      )
      .subscribe((status) => {
        console.log("[realtime] channel status:", status);
      });

    // Polling fallback in case realtime drops
    const poll = window.setInterval(reload, 4000);

    return () => {
      active = false;
      window.clearInterval(poll);
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

  // Check GmCAP eligibility: the runner must be in this race's GmCAP roster
  // (imported before the race starts), matched by name + birth date.
  useEffect(() => {
    if (!user || !raceId) {
      setGmcapEligible(null);
      setProfileMissing(false);
      return;
    }
    let active = true;
    (async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("first_name, last_name, birth_date")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!active) return;
      const first = profile?.first_name?.trim();
      const last = profile?.last_name?.trim();
      const birth = profile?.birth_date;
      if (!first || !last || !birth) {
        setProfileMissing(true);
        setGmcapEligible(false);
        return;
      }
      setProfileMissing(false);
      const { data: matches } = await supabase
        .from("gmcap_results" as any)
        .select("id")
        .eq("race_id", raceId)
        .ilike("first_name", first)
        .ilike("last_name", last)
        .eq("birth_date", birth)
        .limit(1);
      if (!active) return;
      setGmcapEligible((((matches as unknown) as any[]) ?? []).length > 0);
    })();
    return () => { active = false; };
  }, [user, raceId]);

  const routeCoords = useMemo<[number, number][]>(() => {
    if (race?.route_points && race.route_points.length > 0) {
      return race.route_points.map((p) => [p.lat, p.lng]);
    }
    return [];
  }, [race]);

  const isOrganizer = user && race && race.organizer_id === user.id;

  // Live tick to update elapsed race time every second
  const [nowTs, setNowTs] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const startMs = race ? new Date(race.start_time).getTime() : null;
  const hasStarted = startMs != null && nowTs >= startMs;
  const effectiveStatus: "upcoming" | "live" | "finished" =
    race?.status === "finished" ? "finished" : hasStarted ? "live" : "upcoming";
  const elapsedSec = hasStarted && startMs != null ? Math.floor((nowTs - startMs) / 1000) : 0;
  const formatElapsed = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  useEffect(() => {
    if (!raceId || !isOrganizer) return;
    supabase
      .from("gmcap_import_sources" as any)
      .select("id, source_url, enabled, last_import_at, last_import_status, last_import_message")
      .eq("race_id", raceId)
      .maybeSingle()
      .then(({ data }) => {
        const source = data as any;
        if (!source) return;
        setGmcapSourceId(source.id);
        setGmcapSourceUrl(source.source_url ?? "");
        setGmcapEnabled(source.enabled ?? true);
        setGmcapStatus(source.last_import_status ? `${source.last_import_status} · ${source.last_import_message ?? ""}` : null);
      });
  }, [raceId, isOrganizer]);

  const alerts = useMemo(
    () => rows.filter((r) => r.runner_status === "dnf" || r.runner_status === "problem"),
    [rows],
  );

  const sorted = useMemo(() => {
    const rank = (s: string | null) => (s === "dnf" ? 2 : s === "problem" ? 1 : 0);
    return [...rows].sort((a, b) => {
      const ar = a.overall_rank;
      const br = b.overall_rank;
      if (ar != null && br != null) return ar - br;
      if (ar != null) return -1;
      if (br != null) return 1;
      const at = a.rounded_seconds ?? a.official_seconds;
      const bt = b.rounded_seconds ?? b.official_seconds;
      if (at != null && bt != null) return at - bt;
      if (at != null) return -1;
      if (bt != null) return 1;
      const ra = rank(a.runner_status);
      const rb = rank(b.runner_status);
      if (ra !== rb) return ra - rb;
      if (a.finished_at && b.finished_at) {
        return new Date(a.finished_at).getTime() - new Date(b.finished_at).getTime();
      }
      if (a.finished_at) return -1;
      if (b.finished_at) return 1;
      const da = a.distance_along_route_m ?? -1;
      const db = b.distance_along_route_m ?? -1;
      return db - da;
    });
  }, [rows]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sorted.filter((r) => {
      if (genderFilter !== "all" && r.gender !== genderFilter) return false;
      if (!q) return true;
      const haystack = `${r.first_name ?? ""} ${r.last_name ?? ""} ${r.bib_number ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [sorted, genderFilter, searchQuery]);

  const handleGmcapImport = async (file: File | null) => {
    if (!file || !raceId) return;
    setImportingRfid(true);
    try {
      const content = new TextDecoder("iso-8859-1").decode(await file.arrayBuffer());
      const { data, error } = await supabase.functions.invoke("import-gmcap-rfid", {
        body: { race_id: raceId, content },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Import GMCAP : ${(data as any).matched} correspondance(s), ${(data as any).unmatched} non associée(s)`);
    } catch (error) {
      toast.error((error as Error).message || "Import GMCAP impossible");
    } finally {
      setImportingRfid(false);
    }
  };

  const saveGmcapSource = async () => {
    if (!raceId || !gmcapSourceUrl.trim()) {
      toast.error("Lien GMCAP requis");
      return;
    }
    setSavingSource(true);
    const payload = {
      race_id: raceId,
      source_url: gmcapSourceUrl.trim(),
      enabled: gmcapEnabled,
      updated_at: new Date().toISOString(),
    };
    const query = gmcapSourceId
      ? supabase.from("gmcap_import_sources" as any).update(payload).eq("id", gmcapSourceId).select("id").single()
      : supabase.from("gmcap_import_sources" as any).insert(payload).select("id").single();
    const { data, error } = await query;
    setSavingSource(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setGmcapSourceId((data as any).id);
    setSourceOpen(false);
    toast.success("Synchronisation GMCAP configurée");
  };

  const syncGmcapNow = async () => {
    if (!raceId) return;
    setImportingRfid(true);
    const { data, error } = await supabase.functions.invoke("sync-gmcap-rfid", { body: { race_id: raceId } });
    setImportingRfid(false);
    if (error || (data as any)?.error) {
      toast.error(error?.message ?? (data as any).error);
      return;
    }
    const result = (data as any).synced?.[0];
    if (result?.error) toast.error(result.error);
    else toast.success(`GMCAP synchronisé : ${result?.matched ?? 0} correspondance(s)`);
  };

  useEffect(() => {
    if (!isOrganizer || !gmcapSourceId || !gmcapEnabled || !raceId) return;
    const timer = window.setInterval(() => {
      void supabase.functions.invoke("sync-gmcap-rfid", { body: { race_id: raceId } });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [isOrganizer, gmcapSourceId, gmcapEnabled, raceId]);

  const medalFor = (rank: number, status: string | null) => {
    if (status === "dnf" || status === "problem") return null;
    if (rank === 0) return { emoji: "🥇", label: "Or", ring: "ring-2 ring-amber-400 shadow-[0_0_20px_hsl(45_95%_55%/0.5)]", bg: "bg-gradient-to-br from-amber-300/20 to-amber-500/10 border-amber-400/50" };
    if (rank === 1) return { emoji: "🥈", label: "Argent", ring: "ring-2 ring-slate-300 shadow-[0_0_18px_hsl(220_15%_70%/0.45)]", bg: "bg-gradient-to-br from-slate-200/25 to-slate-400/10 border-slate-300/50" };
    if (rank === 2) return { emoji: "🥉", label: "Bronze", ring: "ring-2 ring-orange-500 shadow-[0_0_18px_hsl(25_85%_50%/0.4)]", bg: "bg-gradient-to-br from-orange-400/20 to-orange-600/10 border-orange-500/50" };
    return null;
  };

  const handleRegister = async () => {
    if (!user) {
      toast.error("Connecte-toi pour t'inscrire");
      return;
    }
    if (race?.status === "finished") {
      toast.error("Les inscriptions sont closes : la course est terminée");
      return;
    }
    if (!gmcapEligible) {
      toast.error("Inscription réservée aux coureurs déjà importés depuis GmCAP");
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
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <StatusBadge status={effectiveStatus} />
            {race.distance_km && (
              <span className="text-sm text-muted-foreground">{race.distance_km} km</span>
            )}
            {effectiveStatus === "live" && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/15 border border-primary/30 text-primary-glow text-xs font-semibold tabular-nums">
                <Timer className="h-3 w-3" /> {formatElapsed(elapsedSec)}
              </span>
            )}
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-bold">{race.name}</h1>
          <p className="text-muted-foreground mt-1">
            {format(new Date(race.start_time), "EEEE d MMMM yyyy, HH:mm", { locale: fr })}
          </p>
          <DifficultyStars level={race.difficulty_level} className="mt-2" />
        </div>
        <div className="flex flex-wrap gap-2">
          {isOrganizer && (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="hero">
                <Link to={`/organizer/races/${race.id}/admin`}><Shield className="h-4 w-4 mr-2" /> Administration</Link>
              </Button>
              <Dialog open={sourceOpen} onOpenChange={setSourceOpen}>
                <DialogTrigger asChild>
                  <Button variant="glass"><Link2 className="h-4 w-4 mr-2" /> Source GMCAP</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Synchronisation automatique GMCAP</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="gmcap-source-url">Lien HTTP/HTTPS de l'export GMCAP</Label>
                      <Input id="gmcap-source-url" value={gmcapSourceUrl} onChange={(e) => setGmcapSourceUrl(e.target.value)} placeholder="https://.../GmCAP-Export.txt" />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <input type="checkbox" checked={gmcapEnabled} onChange={(e) => setGmcapEnabled(e.target.checked)} /> Synchroniser toutes les minutes
                    </label>
                    {gmcapStatus && <p className="text-xs text-muted-foreground">Dernier import : {gmcapStatus}</p>}
                  </div>
                  <DialogFooter>
                    <Button variant="hero" onClick={saveGmcapSource} disabled={savingSource}>{savingSource ? "Enregistrement…" : "Enregistrer"}</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              {gmcapSourceId && (
                <Button variant="glass" onClick={syncGmcapNow} disabled={importingRfid}>
                  <RefreshCw className="h-4 w-4 mr-2" /> {importingRfid ? "Sync…" : "Sync maintenant"}
                </Button>
              )}
            </div>
          )}
          {user && myRegistration ? (
            <Button asChild variant="hero">
              <Link to={`/race/${race.id}/track`}>
                <Smartphone className="h-4 w-4 mr-2" /> Mode coureur (#{myRegistration.bib_number})
              </Link>
            </Button>
          ) : race.status === "finished" ? (
            <Button variant="glass" disabled>
              <Flag className="h-4 w-4 mr-2" /> Inscriptions closes
            </Button>
          ) : user ? (
            gmcapEligible === null ? (
              <Button variant="glass" disabled>
                <UserPlus className="h-4 w-4 mr-2" /> Vérification GmCAP…
              </Button>
            ) : !gmcapEligible ? (
              <Button variant="glass" disabled title={profileMissing ? "Complétez votre profil (nom, prénom, date de naissance) pour vous inscrire" : "Vous devez d'abord avoir été importé depuis GmCAP pour vous inscrire"}>
                <UserPlus className="h-4 w-4 mr-2" /> {profileMissing ? "Profil incomplet" : "Inscription via GmCAP requise"}
              </Button>
            ) : (
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
            )
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
        <div className="space-y-4">
          <Card className="glass-card p-2 h-[420px] md:h-[600px] overflow-hidden">
            <RaceMap routeCoords={routeCoords} routePoints={race.route_points} runners={rows} focusedRunnerId={focused} />
          </Card>

          <Card className="glass-card p-4 h-[220px]">
            <div className="flex items-center gap-2 mb-2">
              <svg className="h-4 w-4 text-primary-glow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m2 22 5-5 4 4 7-7 4 4"/><path d="M2 22h20"/></svg>
              <h3 className="font-display font-semibold text-sm">Profil de dénivelé & avancement du peloton</h3>
            </div>
            <div className="h-[calc(100%-32px)]">
              <ElevationChart
                gpxGeojson={race.gpx_geojson}
                totalDistanceKm={race.distance_km}
                runners={rows}
              />
            </div>
          </Card>
        </div>

        <Card className="glass-card p-4 max-h-[600px] flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="h-5 w-5 text-primary-glow" />
            <h2 className="font-display font-semibold text-lg">Classement live</h2>
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-success">
              <Timer className="h-3 w-3" /> Classement GMCAP
            </span>
          </div>
          <div className="flex items-center gap-1 mb-2">
            <Button size="sm" variant={genderFilter === "all" ? "hero" : "glass"} onClick={() => setGenderFilter("all")}>Tous</Button>
            <Button size="sm" variant={genderFilter === "M" ? "hero" : "glass"} onClick={() => setGenderFilter("M")}>Hommes</Button>
            <Button size="sm" variant={genderFilter === "F" ? "hero" : "glass"} onClick={() => setGenderFilter("F")}>Femmes</Button>
            <span className="ml-auto text-xs text-muted-foreground">{filtered.length} coureur{filtered.length > 1 ? "s" : ""}</span>
          </div>
          <Input
            type="search"
            placeholder="Rechercher par nom ou dossard…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value.slice(0, 60))}
            className="mb-3"
          />
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Aucun coureur {genderFilter === "M" ? "homme" : genderFilter === "F" ? "femme" : "inscrit"} pour le moment.</p>
          ) : (
            <ol className="space-y-2 overflow-y-auto pr-1">
              {filtered.map((r, i) => {
                const stale = r.last_position_at
                  ? Date.now() - new Date(r.last_position_at).getTime() > 30000
                  : true;
                const color = colorForRegistration(r.registration_id);
                const medal = medalFor(i, r.runner_status);
                return (
                  <li
                    key={r.registration_id}
                    onClick={() => setFocused(r.registration_id)}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:border-primary/40 transition-smooth ${stale ? "opacity-60" : ""} ${medal ? medal.bg : "border-border/50 bg-secondary/40"}`}
                  >
                    {medal ? (
                      <span className="text-xl w-6 text-center shrink-0" aria-label={`Médaille ${medal.label}`}>{medal.emoji}</span>
                    ) : (
                      <span className="text-sm font-bold text-muted-foreground w-6 text-center shrink-0">{i + 1}</span>
                    )}
                    <span
                      className={`h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0 ${medal ? medal.ring : ""}`}
                      style={{ background: color }}
                    >
                      {r.bib_number}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm truncate ${medal ? "font-bold" : "font-medium"}`}>
                        {r.first_name} {r.last_name}
                        {r.gender ? <span className="ml-2 text-xs font-normal text-muted-foreground">({r.gender === "M" ? "H" : r.gender})</span> : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {(r.rounded_time ?? r.official_time)
                          ? `Temps officiel ${r.rounded_time ?? r.official_time}`
                          : `${formatDistance(r.distance_along_route_m)}${r.progress_percent != null ? ` · ${r.progress_percent.toFixed(0)}%` : ""}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {(r.category_rank || r.gender_rank)
                          ? [
                              r.category ? `cat. ${r.category}${r.category_rank ? ` · ${r.category_rank}e` : ""}` : null,
                              r.gender_rank ? `sexe · ${r.gender_rank}e` : null,
                            ].filter(Boolean).join(" · ")
                          : `${formatSpeed(r.rolling_speed_kmh)} · ${formatPace(r.rolling_pace_sec_per_km)}`}
                      </p>
                      {r.overall_rank == null && r.last_position_at && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">GPS support · {formatSpeed(r.rolling_speed_kmh)}</p>
                      )}
                      {r.finished_at && (
                        <p className="text-[10px] text-success mt-0.5 font-semibold">
                          🏁 Arrivée {format(new Date(r.finished_at), "HH:mm:ss", { locale: fr })}
                        </p>
                      )}
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
                      {stale && r.tracking_active && r.runner_status === 'running' && !r.finished_at && (
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

      <div className="mt-6">
        <CheckpointRankings raceId={race.id} />
      </div>
    </main>
  );
}
