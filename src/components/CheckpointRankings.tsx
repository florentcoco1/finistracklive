import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Flag, Timer } from "lucide-react";

interface Checkpoint {
  id: string;
  name: string;
  distance_km: number | null;
  position: number;
}

interface CheckpointTime {
  id: string;
  checkpoint_id: string;
  registration_id: string;
  time_seconds: number | null;
  time_text: string | null;
  recorded_at: string;
}

interface Registration {
  id: string;
  bib_number: string;
  category: string | null;
}

interface Profile {
  first_name: string | null;
  last_name: string | null;
}

interface Props {
  raceId: string;
}

function formatTime(seconds: number | null, fallback: string | null): string {
  if (seconds == null) return fallback ?? "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}'${String(s).padStart(2, "0")}"`;
  return `${m}'${String(s).padStart(2, "0")}"`;
}

export default function CheckpointRankings({ raceId }: Props) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [times, setTimes] = useState<CheckpointTime[]>([]);
  const [regs, setRegs] = useState<Map<string, Registration & { first_name?: string | null; last_name?: string | null; gender?: "M" | "F" | null; rgpd_consent?: string | null }>>(new Map());
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!raceId) return;
    let active = true;

    const reload = async () => {
      const [{ data: cps }, { data: regsData }] = await Promise.all([
        supabase
          .from("race_checkpoints" as any)
          .select("id, name, distance_km, position")
          .eq("race_id", raceId)
          .order("position", { ascending: true }),
        supabase
          .from("race_registrations")
          .select("id, bib_number, category, runner_id")
          .eq("race_id", raceId),
      ]);

      const cpList = ((cps as unknown) as Checkpoint[]) ?? [];
      const regList = ((regsData as unknown) as Array<Registration & { runner_id: string }>) ?? [];

      const cpIds = cpList.map((c) => c.id);
      let timesData: CheckpointTime[] = [];
      if (cpIds.length > 0) {
        const { data } = await supabase
          .from("runner_checkpoint_times" as any)
          .select("id, checkpoint_id, registration_id, time_seconds, time_text, recorded_at")
          .in("checkpoint_id", cpIds);
        timesData = ((data as unknown) as CheckpointTime[]) ?? [];
      }

      const runnerIds = Array.from(new Set(regList.map((r) => r.runner_id).filter(Boolean)));
      const profilesByUserId = new Map<string, Profile>();
      if (runnerIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, first_name, last_name")
          .in("user_id", runnerIds);
        for (const p of ((profs as unknown) as Array<Profile & { user_id: string }>) ?? []) {
          profilesByUserId.set(p.user_id, p);
        }
      }

      const bibs = regList.map((r) => r.bib_number);
      const gmcapByBib = new Map<string, { gender: "M" | "F" | null; rgpd_consent: string | null }>();
      if (bibs.length > 0) {
        const { data: gm } = await supabase
          .from("gmcap_results" as any)
          .select("bib_number, gender, rgpd_consent")
          .eq("race_id", raceId)
          .in("bib_number", bibs);
        for (const g of ((gm as unknown) as Array<{ bib_number: string; gender: string | null; rgpd_consent: string | null }>) ?? []) {
          gmcapByBib.set(String(g.bib_number).trim(), {
            gender: (g.gender as "M" | "F" | null) ?? null,
            rgpd_consent: g.rgpd_consent ?? null,
          });
        }
      }

      const regMap = new Map<string, Registration & { first_name?: string | null; last_name?: string | null; gender?: "M" | "F" | null; rgpd_consent?: string | null }>();
      for (const r of regList) {
        const prof = profilesByUserId.get(r.runner_id);
        const gm = gmcapByBib.get(String(r.bib_number).trim());
        regMap.set(r.id, {
          ...r,
          first_name: prof?.first_name ?? null,
          last_name: prof?.last_name ?? null,
          gender: gm?.gender ?? null,
          rgpd_consent: gm?.rgpd_consent ?? null,
        });
      }

      if (!active) return;
      setCheckpoints(cpList);
      setTimes(timesData);
      setRegs(regMap);
      if (cpList.length > 0 && (!activeId || !cpList.some((c) => c.id === activeId))) {
        setActiveId(cpList[0].id);
      }
    };

    reload();

    const channel = supabase
      .channel(`checkpoint-rankings:${raceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "runner_checkpoint_times" }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "race_checkpoints", filter: `race_id=eq.${raceId}` }, () => reload())
      .subscribe();

    const poll = window.setInterval(reload, 10_000);

    return () => {
      active = false;
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId]);

  const ranked = useMemo(() => {
    if (!activeId) return [];
    const filtered = times
      .filter((t) => t.checkpoint_id === activeId && t.time_seconds != null)
      .sort((a, b) => (a.time_seconds ?? 0) - (b.time_seconds ?? 0));

    const catCounters = new Map<string, number>();
    const genderCounters = new Map<string, number>();

    return filtered.map((t, i) => {
      const reg = regs.get(t.registration_id);
      const cat = reg?.category ?? "—";
      const gen = reg?.gender ?? "—";
      const catRank = (catCounters.get(cat) ?? 0) + 1;
      catCounters.set(cat, catRank);
      const genRank = (genderCounters.get(gen) ?? 0) + 1;
      genderCounters.set(gen, genRank);
      return { t, reg, rank: i + 1, catRank, genRank, cat, gen };
    });
  }, [times, activeId, regs]);

  if (checkpoints.length === 0) return null;

  return (
    <Card className="glass-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Flag className="h-5 w-5 text-primary-glow" />
        <h2 className="font-display font-semibold text-lg">Classements par point intermédiaire</h2>
      </div>
      <Tabs value={activeId ?? undefined} onValueChange={setActiveId}>
        <TabsList className="flex flex-wrap h-auto">
          {checkpoints.map((cp) => (
            <TabsTrigger key={cp.id} value={cp.id} className="text-xs">
              {cp.name}
              {cp.distance_km != null ? ` · ${cp.distance_km} km` : ""}
            </TabsTrigger>
          ))}
        </TabsList>
        {checkpoints.map((cp) => (
          <TabsContent key={cp.id} value={cp.id} className="mt-3">
            {ranked.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                Aucun passage enregistré sur ce point.
              </p>
            ) : (
              <div className="max-h-[420px] overflow-y-auto pr-1">
                <div className="hidden md:grid grid-cols-[60px_90px_80px_1fr_90px_120px] gap-3 px-2 py-1 text-[11px] uppercase tracking-wide font-semibold text-muted-foreground border-b border-border/40">
                  <span>Clt</span>
                  <span>Catégorie</span>
                  <span>Sexe</span>
                  <span>Coureur</span>
                  <span>Dossard</span>
                  <span className="text-right">Temps officiel</span>
                </div>
                <div className="md:hidden grid grid-cols-[40px_1fr_90px] gap-3 px-2 py-1 text-[11px] uppercase tracking-wide font-semibold text-muted-foreground border-b border-border/40">
                  <span>Clt</span>
                  <span>Coureur</span>
                  <span className="text-right">Temps</span>
                </div>
                <ol className="space-y-1.5 mt-1.5">
                  {ranked.map(({ t, reg, rank, catRank, genRank, cat, gen }) => (
                    <li
                      key={t.id}
                      className="md:grid md:grid-cols-[60px_90px_80px_1fr_90px_120px] grid-cols-[40px_1fr_90px] items-center gap-3 p-2 rounded-md border border-border/50 bg-secondary/40 text-sm"
                    >
                      <span className="font-bold text-muted-foreground">{rank}</span>
                      <span className="text-xs hidden md:block">
                        <span className="font-semibold">{catRank}</span>
                        <span className="text-muted-foreground"> · {cat}</span>
                      </span>
                      <span className="text-xs hidden md:block">
                        <span className="font-semibold">{genRank}</span>
                        <span className="text-muted-foreground"> · {gen}</span>
                      </span>
                      <span className="font-medium truncate md:col-auto col-span-1">
                        {reg?.rgpd_consent === "N"
                          ? "XXXXXXX XXXXXXX"
                          : reg?.first_name || reg?.last_name
                            ? `${reg.first_name ?? ""} ${reg.last_name ?? ""}`.trim()
                            : `Dossard ${reg?.bib_number ?? ""}`}
                        <span className="md:hidden block text-[11px] text-muted-foreground">
                          {cat !== "—" ? `${catRank} · ${cat}` : ""}
                          {cat !== "—" && gen !== "—" ? " · " : ""}
                          {gen !== "—" ? `${genRank} · ${gen}` : ""}
                        </span>
                      </span>
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-primary/10 text-primary text-center hidden md:inline-block">
                        #{reg?.bib_number ?? "—"}
                      </span>
                      <span className="inline-flex items-center justify-end gap-1 font-mono">
                        <Timer className="h-3.5 w-3.5 text-muted-foreground hidden md:block" />
                        {formatTime(t.time_seconds, t.time_text)}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  );
}
