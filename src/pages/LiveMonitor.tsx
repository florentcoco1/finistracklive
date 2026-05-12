import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { AlertTriangle, MapPin, Phone, RefreshCw, ShieldAlert, XOctagon } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface RaceOption {
  id: string;
  name: string;
  start_time: string;
}

interface AlertRow {
  registration_id: string;
  race_id: string;
  race_name: string;
  bib_number: string;
  runner_status: "dnf" | "problem";
  problem_description: string | null;
  dnf_reason: string | null;
  emergency_phone: string | null;
  updated_at: string;
  first_name: string | null;
  last_name: string | null;
  profile_phone: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_position_at: string | null;
}

export default function LiveMonitor() {
  const { user, isOrganizer, isAdmin, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [races, setRaces] = useState<RaceOption[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState<string>("all");

  const load = async () => {
    if (!user) return;
    setRefreshing(true);

    // 1. Get organizer's LIVE races only (admin sees all live races)
    // Le suivi live n'est actif que sur les courses en cours.
    // Une fois la course terminée, les alertes restent archivées sur la course
    // (lisibles via la page course) mais n'apparaissent plus ici.
    let raceQuery = supabase
      .from("races")
      .select("id, name, start_time")
      .eq("status", "live")
      .order("start_time", { ascending: false });
    if (!isAdmin) raceQuery = raceQuery.eq("organizer_id", user.id);
    const { data: racesData } = await raceQuery;
    const raceList: RaceOption[] = (racesData ?? []) as RaceOption[];
    setRaces(raceList);
    const raceIds = raceList.map((r) => r.id);
    const raceMap = new Map(raceList.map((r) => [r.id, r.name]));

    if (raceIds.length === 0) {
      setRows([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    // 2. Registrations with dnf/problem status
    const { data: regs } = await supabase
      .from("race_registrations")
      .select("id, race_id, runner_id, bib_number, runner_status, problem_description, dnf_reason, emergency_phone, updated_at")
      .in("race_id", raceIds)
      .in("runner_status", ["dnf", "problem"])
      .order("updated_at", { ascending: false });

    const regList = regs ?? [];
    const runnerIds = Array.from(new Set(regList.map((r) => r.runner_id)));

    // 3. Profiles for those runners
    const { data: profiles } = runnerIds.length
      ? await supabase
          .from("profiles")
          .select("user_id, first_name, last_name, phone")
          .in("user_id", runnerIds)
      : { data: [] as any[] };

    const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p]));

    // 4. Last GPS position per registration
    const regIds = regList.map((r) => r.id);
    const { data: positions } = regIds.length
      ? await supabase
          .from("runner_positions")
          .select("registration_id, latitude, longitude, recorded_at")
          .in("registration_id", regIds)
          .order("recorded_at", { ascending: false })
      : { data: [] as any[] };

    const posMap = new Map<string, { lat: number; lng: number; at: string }>();
    for (const p of positions ?? []) {
      if (!posMap.has(p.registration_id)) {
        posMap.set(p.registration_id, {
          lat: p.latitude,
          lng: p.longitude,
          at: p.recorded_at,
        });
      }
    }

    const merged: AlertRow[] = regList.map((r) => {
      const p = profileMap.get(r.runner_id);
      const pos = posMap.get(r.id);
      return {
        registration_id: r.id,
        race_id: r.race_id,
        race_name: raceMap.get(r.race_id) ?? "—",
        bib_number: r.bib_number,
        runner_status: r.runner_status as "dnf" | "problem",
        problem_description: r.problem_description,
        dnf_reason: r.dnf_reason,
        emergency_phone: r.emergency_phone,
        updated_at: r.updated_at,
        first_name: p?.first_name ?? null,
        last_name: p?.last_name ?? null,
        profile_phone: p?.phone ?? null,
        last_lat: pos?.lat ?? null,
        last_lng: pos?.lng ?? null,
        last_position_at: pos?.at ?? null,
      };
    });

    setRows(merged);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    if (!authLoading && user) load();
  }, [authLoading, user, isAdmin]);

  // Realtime subscription on race_registrations
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("live-monitor-registrations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "race_registrations" },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAdmin]);

  const filteredRows = useMemo(
    () => (selectedRaceId === "all" ? rows : rows.filter((r) => r.race_id === selectedRaceId)),
    [rows, selectedRaceId],
  );
  const dnfRows = useMemo(() => filteredRows.filter((r) => r.runner_status === "dnf"), [filteredRows]);
  const problemRows = useMemo(() => filteredRows.filter((r) => r.runner_status === "problem"), [filteredRows]);

  // Count alerts per race for the selector
  const alertsPerRace = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.race_id, (m.get(r.race_id) ?? 0) + 1);
    return m;
  }, [rows]);

  if (authLoading) return null;
  if (!user) return <Navigate to="/auth" replace />;
  if (!isOrganizer && !isAdmin) return <Navigate to="/" replace />;

  const selectedRaceName =
    selectedRaceId === "all"
      ? "toutes vos courses"
      : races.find((r) => r.id === selectedRaceId)?.name ?? "—";

  return (
    <main className="container py-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ShieldAlert className="h-7 w-7 text-primary" />
            Suivi live — Abandons & Alertes
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Surveillance en temps réel de {selectedRaceName}.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          Rafraîchir
        </Button>
      </div>

      <Card className="p-4">
        <label className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2 block">
          Épreuve
        </label>
        <Select value={selectedRaceId} onValueChange={setSelectedRaceId}>
          <SelectTrigger className="w-full sm:w-[420px]">
            <SelectValue placeholder="Choisir une épreuve" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les épreuves ({rows.length})</SelectItem>
            {races.map((r) => {
              const count = alertsPerRace.get(r.id) ?? 0;
              return (
                <SelectItem key={r.id} value={r.id}>
                  {r.name} {count > 0 ? `· ${count} alerte${count > 1 ? "s" : ""}` : ""}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total alertes" value={filteredRows.length} accent="primary" />
        <StatCard label="Abandons (DNF)" value={dnfRows.length} accent="destructive" />
        <StatCard label="Problèmes signalés" value={problemRows.length} accent="warning" />
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">Tous ({filteredRows.length})</TabsTrigger>
          <TabsTrigger value="problem">Problèmes ({problemRows.length})</TabsTrigger>
          <TabsTrigger value="dnf">Abandons ({dnfRows.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="mt-4">
          <AlertList rows={filteredRows} loading={loading} />
        </TabsContent>
        <TabsContent value="problem" className="mt-4">
          <AlertList rows={problemRows} loading={loading} />
        </TabsContent>
        <TabsContent value="dnf" className="mt-4">
          <AlertList rows={dnfRows} loading={loading} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent: "primary" | "destructive" | "warning" }) {
  const color =
    accent === "destructive"
      ? "text-destructive"
      : accent === "warning"
      ? "text-warning"
      : "text-primary";
  return (
    <Card className="p-5">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={`text-3xl font-bold mt-1 ${color}`}>{value}</div>
    </Card>
  );
}

function AlertList({ rows, loading }: { rows: AlertRow[]; loading: boolean }) {
  if (loading) {
    return <Card className="p-8 text-center text-muted-foreground">Chargement…</Card>;
  }
  if (rows.length === 0) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        Aucune alerte en cours. Tous les coureurs sont OK 🎉
      </Card>
    );
  }
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.registration_id}>
          <Card
            className={`p-4 border ${
              r.runner_status === "problem"
                ? "border-warning/50 bg-warning/5"
                : "border-destructive/40 bg-destructive/5"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {r.runner_status === "problem" ? (
                    <Badge variant="outline" className="border-warning text-warning">
                      <AlertTriangle className="h-3 w-3 mr-1" /> Problème
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-destructive text-destructive">
                      <XOctagon className="h-3 w-3 mr-1" /> Abandon
                    </Badge>
                  )}
                  <Link
                    to={`/races/${r.race_id}`}
                    className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                  >
                    {r.race_name}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    · il y a{" "}
                    {formatDistanceToNow(new Date(r.updated_at), { locale: fr })}
                  </span>
                </div>
                <div className="font-semibold text-lg">
                  {(r.first_name || r.last_name)
                    ? `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim()
                    : "Coureur inconnu"}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    Dossard #{r.bib_number}
                  </span>
                </div>
                {(r.problem_description || r.dnf_reason) && (
                  <div
                    className={`mt-2 rounded-md border px-3 py-2 ${
                      r.runner_status === "problem"
                        ? "border-warning/40 bg-warning/10"
                        : "border-destructive/40 bg-destructive/10"
                    }`}
                  >
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                      Motif
                    </div>
                    <p className="text-sm text-foreground/90 mt-0.5">
                      {r.runner_status === "problem"
                        ? r.problem_description
                        : r.dnf_reason}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 items-stretch sm:items-end sm:min-w-[220px]">
                {r.emergency_phone && (
                  <Button asChild size="sm" variant="outline">
                    <a href={`tel:${r.emergency_phone}`}>
                      <Phone className="h-4 w-4 mr-2" />
                      Urgence : {r.emergency_phone}
                    </a>
                  </Button>
                )}
                {r.profile_phone && r.profile_phone !== r.emergency_phone && (
                  <Button asChild size="sm" variant="ghost">
                    <a href={`tel:${r.profile_phone}`}>
                      <Phone className="h-4 w-4 mr-2" />
                      Coureur : {r.profile_phone}
                    </a>
                  </Button>
                )}
                {!r.emergency_phone && !r.profile_phone && (
                  <span className="text-xs text-muted-foreground">Aucun téléphone</span>
                )}

                {r.last_lat != null && r.last_lng != null ? (
                  <div className="rounded-md border border-border/60 bg-secondary/40 px-3 py-2 text-left sm:text-right">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1 sm:justify-end">
                      <MapPin className="h-3 w-3" /> Dernière position
                    </div>
                    <div className="text-xs font-mono mt-0.5">
                      {r.last_lat.toFixed(5)}, {r.last_lng.toFixed(5)}
                    </div>
                    {r.last_position_at && (
                      <div className="text-[11px] text-muted-foreground">
                        il y a {formatDistanceToNow(new Date(r.last_position_at), { locale: fr })}
                      </div>
                    )}
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${r.last_lat}%2C${r.last_lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary hover:underline mt-1 inline-block"
                    >
                      Ouvrir dans Maps ↗
                    </a>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground sm:text-right">
                    Aucune position GPS
                  </span>
                )}
              </div>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
