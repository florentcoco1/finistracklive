import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Trophy, Medal, Search, ChevronLeft, User as UserIcon } from "lucide-react";

interface RaceLite {
  id: string;
  name: string;
  start_time: string;
  distance_km: number | null;
  status: string;
}

interface ResultRow {
  id: string;
  race_id: string;
  bib_number: string;
  first_name: string | null;
  last_name: string | null;
  gender: string | null;
  category: string | null;
  club: string | null;
  official_time_text: string | null;
  official_time_seconds: number | null;
  scratch_rank: number | null;
  category_rank: number | null;
  gender_rank: number | null;
  status: string | null;
}

interface RunnerKey {
  first_name: string;
  last_name: string;
  gender: string | null;
}

function runnerKey(r: { first_name: string | null; last_name: string | null }) {
  return `${(r.first_name ?? "").trim().toLowerCase()}|${(r.last_name ?? "").trim().toLowerCase()}`;
}

function rankBadge(rank: number | null) {
  if (!rank) return null;
  const color = rank === 1 ? "text-yellow-400" : rank === 2 ? "text-slate-300" : rank === 3 ? "text-amber-600" : "text-muted-foreground";
  return <span className={`inline-flex items-center gap-1 ${color}`}>{rank <= 3 && <Medal className="h-3 w-3" />}{rank}</span>;
}

export default function Results() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [races, setRaces] = useState<RaceLite[]>([]);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRaceId, setSelectedRaceId] = useState<string | "all">("all");
  const [search, setSearch] = useState("");
  const [openRunner, setOpenRunner] = useState<RunnerKey | null>(null);

  useEffect(() => {
    document.title = "Résultats — FinisTrackLive";
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/auth?redirect=/results");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const [racesRes, resultsRes] = await Promise.all([
        supabase.from("races").select("id, name, start_time, distance_km, status").order("start_time", { ascending: false }),
        supabase.from("gmcap_results").select("id, race_id, bib_number, first_name, last_name, gender, category, club, official_time_text, official_time_seconds, scratch_rank, category_rank, gender_rank, status"),
      ]);
      setRaces((racesRes.data ?? []) as RaceLite[]);
      setResults((resultsRes.data ?? []) as ResultRow[]);
      setLoading(false);
    })();
  }, [user]);

  const racesById = useMemo(() => {
    const m = new Map<string, RaceLite>();
    races.forEach((r) => m.set(r.id, r));
    return m;
  }, [races]);

  const filteredResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    return results.filter((r) => {
      if (selectedRaceId !== "all" && r.race_id !== selectedRaceId) return false;
      if (!q) return true;
      const hay = `${r.first_name ?? ""} ${r.last_name ?? ""} ${r.bib_number ?? ""} ${r.club ?? ""}`.toLowerCase();
      return hay.includes(q);
    }).sort((a, b) => (a.scratch_rank ?? 9999) - (b.scratch_rank ?? 9999));
  }, [results, selectedRaceId, search]);

  const runnerResults = useMemo(() => {
    if (!openRunner) return [];
    const key = `${openRunner.first_name.toLowerCase()}|${openRunner.last_name.toLowerCase()}`;
    return results
      .filter((r) => runnerKey(r) === key)
      .sort((a, b) => {
        const ra = racesById.get(a.race_id);
        const rb = racesById.get(b.race_id);
        return new Date(rb?.start_time ?? 0).getTime() - new Date(ra?.start_time ?? 0).getTime();
      });
  }, [openRunner, results, racesById]);

  const runnerStats = useMemo(() => {
    if (!runnerResults.length) return null;
    const podiums = runnerResults.filter((r) => (r.scratch_rank ?? 99) <= 3).length;
    const wins = runnerResults.filter((r) => r.scratch_rank === 1).length;
    const bestScratch = Math.min(...runnerResults.map((r) => r.scratch_rank ?? Infinity));
    const bestGender = Math.min(...runnerResults.map((r) => r.gender_rank ?? Infinity));
    const bestCat = Math.min(...runnerResults.map((r) => r.category_rank ?? Infinity));
    return {
      total: runnerResults.length,
      podiums,
      wins,
      bestScratch: Number.isFinite(bestScratch) ? bestScratch : null,
      bestGender: Number.isFinite(bestGender) ? bestGender : null,
      bestCat: Number.isFinite(bestCat) ? bestCat : null,
    };
  }, [runnerResults]);

  if (authLoading || !user) {
    return <main className="container py-12"><p className="text-muted-foreground">Chargement…</p></main>;
  }

  return (
    <main className="container py-12">
      <div className="flex items-center gap-2 mb-2">
        <Link to="/" className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm">
          <ChevronLeft className="h-4 w-4" /> Accueil
        </Link>
      </div>
      <h1 className="font-display text-4xl font-bold mb-2 flex items-center gap-3">
        <Trophy className="h-8 w-8 text-primary" /> Résultats
      </h1>
      <p className="text-muted-foreground mb-8">Classements officiels et bilans par coureur</p>

      <Card className="glass-card p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1 block">Course</label>
            <select
              value={selectedRaceId}
              onChange={(e) => setSelectedRaceId(e.target.value as string)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">Toutes les courses</option>
              {races.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} — {format(new Date(r.start_time), "d MMM yyyy", { locale: fr })}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1 block">Rechercher</label>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nom, prénom, dossard, club…"
                className="pl-9"
              />
            </div>
          </div>
        </div>
      </Card>

      {loading ? (
        <p className="text-muted-foreground">Chargement…</p>
      ) : filteredResults.length === 0 ? (
        <Card className="glass-card p-12 text-center">
          <p className="text-muted-foreground">Aucun résultat disponible.</p>
        </Card>
      ) : (
        <Card className="glass-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Scratch</TableHead>
                <TableHead className="w-20">Dossard</TableHead>
                <TableHead>Coureur</TableHead>
                <TableHead className="w-16">Sexe</TableHead>
                <TableHead>Catégorie</TableHead>
                {selectedRaceId === "all" && <TableHead>Course</TableHead>}
                <TableHead>Temps</TableHead>
                <TableHead className="w-16">Sexe</TableHead>
                <TableHead className="w-16">Cat.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredResults.map((r) => {
                const race = racesById.get(r.race_id);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-semibold">{rankBadge(r.scratch_rank)}</TableCell>
                    <TableCell className="text-muted-foreground">{r.bib_number}</TableCell>
                    <TableCell>
                      <button
                        className="text-left hover:text-primary transition-colors font-medium inline-flex items-center gap-1"
                        onClick={() => setOpenRunner({
                          first_name: r.first_name ?? "",
                          last_name: r.last_name ?? "",
                          gender: r.gender,
                        })}
                      >
                        <UserIcon className="h-3 w-3" />
                        {r.last_name?.toUpperCase()} {r.first_name}
                      </button>
                      {r.club && <div className="text-xs text-muted-foreground">{r.club}</div>}
                    </TableCell>
                    <TableCell>{r.gender ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{r.category ?? "—"}</TableCell>
                    {selectedRaceId === "all" && (
                      <TableCell className="text-sm">
                        {race ? (
                          <Link to={`/races/${race.id}`} className="hover:text-primary">
                            {race.name}
                          </Link>
                        ) : "—"}
                      </TableCell>
                    )}
                    <TableCell className="font-mono">{r.official_time_text ?? "—"}</TableCell>
                    <TableCell>{rankBadge(r.gender_rank)}</TableCell>
                    <TableCell>{rankBadge(r.category_rank)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={!!openRunner} onOpenChange={(o) => !o && setOpenRunner(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserIcon className="h-5 w-5" />
              {openRunner?.last_name?.toUpperCase()} {openRunner?.first_name}
              {openRunner?.gender && <Badge variant="secondary" className="ml-2">{openRunner.gender}</Badge>}
            </DialogTitle>
          </DialogHeader>

          {runnerStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <Card className="glass-card p-3 text-center">
                <div className="text-2xl font-bold">{runnerStats.total}</div>
                <div className="text-xs text-muted-foreground">Courses</div>
              </Card>
              <Card className="glass-card p-3 text-center">
                <div className="text-2xl font-bold text-yellow-400">{runnerStats.wins}</div>
                <div className="text-xs text-muted-foreground">Victoires</div>
              </Card>
              <Card className="glass-card p-3 text-center">
                <div className="text-2xl font-bold">{runnerStats.podiums}</div>
                <div className="text-xs text-muted-foreground">Podiums</div>
              </Card>
              <Card className="glass-card p-3 text-center">
                <div className="text-2xl font-bold">{runnerStats.bestScratch ?? "—"}</div>
                <div className="text-xs text-muted-foreground">Meilleur scratch</div>
              </Card>
            </div>
          )}

          {runnerStats && (
            <div className="grid grid-cols-2 gap-3 mb-4">
              <Card className="glass-card p-3 text-center">
                <div className="text-lg font-semibold">{runnerStats.bestGender ?? "—"}</div>
                <div className="text-xs text-muted-foreground">Meilleur classement sexe</div>
              </Card>
              <Card className="glass-card p-3 text-center">
                <div className="text-lg font-semibold">{runnerStats.bestCat ?? "—"}</div>
                <div className="text-xs text-muted-foreground">Meilleur classement catégorie</div>
              </Card>
            </div>
          )}

          <h3 className="font-semibold mb-2">Historique des courses</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Course</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Temps</TableHead>
                <TableHead>Scratch</TableHead>
                <TableHead>Sexe</TableHead>
                <TableHead>Cat.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runnerResults.map((r) => {
                const race = racesById.get(r.race_id);
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      {race ? (
                        <Link to={`/races/${race.id}`} className="hover:text-primary font-medium">
                          {race.name}
                        </Link>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {race ? format(new Date(race.start_time), "d MMM yyyy", { locale: fr }) : "—"}
                    </TableCell>
                    <TableCell className="font-mono">{r.official_time_text ?? "—"}</TableCell>
                    <TableCell>{rankBadge(r.scratch_rank)}</TableCell>
                    <TableCell>{rankBadge(r.gender_rank)}</TableCell>
                    <TableCell>{rankBadge(r.category_rank)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </main>
  );
}
