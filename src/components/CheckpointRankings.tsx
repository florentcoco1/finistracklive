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
  const [regs, setRegs] = useState<Map<string, Registration & { first_name?: string | null; last_name?: string | null }>>(new Map());
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

      // Fetch times for these checkpoints
      const cpIds = cpList.map((c) => c.id);
      let timesData: CheckpointTime[] = [];
      if (cpIds.length > 0) {
        const { data } = await supabase
          .from("runner_checkpoint_times" as any)
          .select("id, checkpoint_id, registration_id, time_seconds, time_text, recorded_at")
          .in("checkpoint_id", cpIds);
        timesData = ((data as unknown) as CheckpointTime[]) ?? [];
      }

      // Fetch profiles for runner names
      const runnerIds = Array.from(new Set(regList.map((r) => r.runner_id).filter(Boolean)));
      let profilesByUserId = new Map<string, Profile>();
      if (runnerIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, first_name, last_name")
          .in("user_id", runnerIds);
        for (const p of ((profs as unknown) as Array<Profile & { user_id: string }>) ?? []) {
          profilesByUserId.set(p.user_id, p);
        }
      }

      const regMap = new Map<string, Registration & { first_name?: string | null; last_name?: string | null }>();
      for (const r of regList) {
        const prof = profilesByUserId.get(r.runner_id);
        regMap.set(r.id, { ...r, first_name: prof?.first_name ?? null, last_name: prof?.last_name ?? null });
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
    const filtered = times.filter((t) => t.checkpoint_id === activeId);
    return filtered
      .filter((t) => t.time_seconds != null)
      .sort((a, b) => (a.time_seconds ?? 0) - (b.time_seconds ?? 0));
  }, [times, activeId]);

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
              <ol className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                {ranked.map((t, i) => {
                  const reg = regs.get(t.registration_id);
                  return (
                    <li
                      key={t.id}
                      className="flex items-center gap-3 p-2 rounded-md border border-border/50 bg-secondary/40"
                    >
                      <span className="text-sm font-bold text-muted-foreground w-7 text-center shrink-0">
                        {i + 1}
                      </span>
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-primary/10 text-primary shrink-0">
                        #{reg?.bib_number ?? "—"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {reg?.first_name || reg?.last_name
                            ? `${reg.first_name ?? ""} ${reg.last_name ?? ""}`.trim()
                            : `Dossard ${reg?.bib_number ?? ""}`}
                          {reg?.category ? (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              ({reg.category})
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 text-sm font-mono text-foreground shrink-0">
                        <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                        {formatTime(t.time_seconds, t.time_text)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  );
}
