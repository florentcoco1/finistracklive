import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Timer, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/pages/Index";
import { DifficultyStars } from "@/components/DifficultyStars";

interface LiveRaceCardProps {
  race: {
    id: string;
    name: string;
    start_time: string;
    distance_km: number | null;
    difficulty_level: number | null;
    status: "upcoming" | "live" | "finished";
    description?: string | null;
  };
  showDescription?: boolean;
}

interface PodiumRow {
  registration_id: string;
  bib_number: string;
  first_name: string | null;
  last_name: string | null;
  gender: "M" | "F" | null;
  checkpoint_name: string | null;
  checkpoint_position: number;
  time_text: string | null;
  time_seconds: number | null;
  finished: boolean;
  finish_rank: number | null;
}

function formatElapsed(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function LiveRaceCard({ race, showDescription }: LiveRaceCardProps) {
  const startMs = useMemo(() => new Date(race.start_time).getTime(), [race.start_time]);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [podium, setPodium] = useState<{ men: PodiumRow[]; women: PodiumRow[]; overall: PodiumRow[] } | null>(null);

  const hasStarted = nowTs >= startMs;
  const effectiveStatus: "upcoming" | "live" | "finished" =
    race.status === "finished" ? "finished" : hasStarted ? "live" : "upcoming";
  const isLive = effectiveStatus === "live";
  const showPodium = effectiveStatus !== "upcoming";
  const elapsedSec = isLive ? Math.floor((nowTs - startMs) / 1000) : 0;

  useEffect(() => {
    if (!isLive) return;
    const t = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [isLive]);

  useEffect(() => {
    if (!showPodium) {
      setPodium(null);
      return;
    }

    let active = true;

    const load = async () => {
      const [{ data: regs }, { data: checkpoints }, { data: gmcap }] = await Promise.all([
        supabase
          .from("race_registrations")
          .select("id, runner_id, bib_number")
          .eq("race_id", race.id),
        supabase
          .from("race_checkpoints")
          .select("id, name, position")
          .eq("race_id", race.id)
          .order("position", { ascending: true }),
        supabase
          .from("gmcap_results")
          .select("bib_number, first_name, last_name, gender, official_time_seconds, official_time_text, scratch_rank")
          .eq("race_id", race.id),
      ]);
      if (!active) return;
      const regList = (regs ?? []) as Array<{ id: string; runner_id: string; bib_number: string }>;
      const cpList = (checkpoints ?? []) as Array<{ id: string; name: string; position: number }>;
      const gmcapList = (gmcap ?? []) as Array<{ bib_number: string; first_name: string | null; last_name: string | null; gender: string | null; official_time_seconds: number | null; official_time_text: string | null; scratch_rank: number | null }>;

      const regIds = regList.map((r) => r.id);
      const runnerIds = Array.from(new Set(regList.map((r) => r.runner_id)));

      const [{ data: times }, { data: profiles }] = await Promise.all([
        regIds.length > 0
          ? supabase
              .from("runner_checkpoint_times")
              .select("registration_id, checkpoint_id, time_seconds, time_text")
              .in("registration_id", regIds)
          : Promise.resolve({ data: [] as any[] }),
        runnerIds.length > 0
          ? supabase
              .from("profiles")
              .select("user_id, first_name, last_name")
              .in("user_id", runnerIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      if (!active) return;

      const cpById = new Map(cpList.map((c) => [c.id, c]));
      const profileById = new Map((profiles ?? []).map((p) => [p.user_id, p]));
      const gmcapByBib = new Map(gmcapList.map((g) => [String(g.bib_number).trim(), g]));
      const regBibs = new Set(regList.map((r) => String(r.bib_number).trim()));

      const bestByReg = new Map<string, { position: number; checkpoint_id: string; time_seconds: number | null; time_text: string | null }>();
      for (const t of (times ?? []) as Array<{ registration_id: string; checkpoint_id: string; time_seconds: number | null; time_text: string | null }>) {
        const cp = cpById.get(t.checkpoint_id);
        if (!cp) continue;
        const prev = bestByReg.get(t.registration_id);
        if (!prev || cp.position > prev.position) {
          bestByReg.set(t.registration_id, {
            position: cp.position,
            checkpoint_id: t.checkpoint_id,
            time_seconds: t.time_seconds,
            time_text: t.time_text,
          });
        }
      }

      const rows: PodiumRow[] = regList
        .map((r) => {
          const g = gmcapByBib.get(String(r.bib_number).trim());
          const best = bestByReg.get(r.id);
          const finished = !!(g && g.official_time_seconds != null);
          if (!finished && !best) return null;
          const cp = best ? cpById.get(best.checkpoint_id) : null;
          const profile = profileById.get(r.runner_id);
          return {
            registration_id: r.id,
            bib_number: r.bib_number,
            first_name: profile?.first_name ?? g?.first_name ?? null,
            last_name: profile?.last_name ?? g?.last_name ?? null,
            gender: (g?.gender as "M" | "F" | null) ?? null,
            checkpoint_name: finished ? "Arrivée" : (cp?.name ?? null),
            checkpoint_position: finished ? Number.MAX_SAFE_INTEGER : (best?.position ?? 0),
            time_text: finished ? (g?.official_time_text ?? null) : (best?.time_text ?? null),
            time_seconds: finished ? (g?.official_time_seconds ?? null) : (best?.time_seconds ?? null),
            finished,
            finish_rank: finished ? (g?.scratch_rank ?? null) : null,
          } as PodiumRow;
        })
        .filter((r): r is PodiumRow => r !== null);

      // Inclure les finishers du GMCAP qui ne sont pas dans race_registrations
      for (const g of gmcapList) {
        const bib = String(g.bib_number).trim();
        if (regBibs.has(bib)) continue;
        if (g.official_time_seconds == null) continue;
        rows.push({
          registration_id: `gmcap-${bib}`,
          bib_number: bib,
          first_name: g.first_name,
          last_name: g.last_name,
          gender: (g.gender as "M" | "F" | null) ?? null,
          checkpoint_name: "Arrivée",
          checkpoint_position: Number.MAX_SAFE_INTEGER,
          time_text: g.official_time_text,
          time_seconds: g.official_time_seconds,
          finished: true,
          finish_rank: g.scratch_rank,
        });
      }

      const sortFn = (a: PodiumRow, b: PodiumRow) => {
        if (a.finished !== b.finished) return a.finished ? -1 : 1;
        if (a.finished && b.finished) {
          const ra = a.finish_rank ?? Number.POSITIVE_INFINITY;
          const rb = b.finish_rank ?? Number.POSITIVE_INFINITY;
          if (ra !== rb) return ra - rb;
          return (a.time_seconds ?? Infinity) - (b.time_seconds ?? Infinity);
        }
        if (b.checkpoint_position !== a.checkpoint_position) return b.checkpoint_position - a.checkpoint_position;
        const ta = a.time_seconds ?? Number.POSITIVE_INFINITY;
        const tb = b.time_seconds ?? Number.POSITIVE_INFINITY;
        return ta - tb;
      };

      const men = rows.filter((r) => r.gender === "M").sort(sortFn).slice(0, 3);
      const women = rows.filter((r) => r.gender === "F").sort(sortFn).slice(0, 3);
      const overall = rows.slice().sort(sortFn).slice(0, 3);
      setPodium({ men, women, overall });
    };

    load();
    const poll = window.setInterval(load, 15000);
    const channel = supabase
      .channel(`live-card:${race.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "runner_checkpoint_times" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "gmcap_results", filter: `race_id=eq.${race.id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "race_registrations", filter: `race_id=eq.${race.id}` }, () => load())
      .subscribe();
    return () => {
      active = false;
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [showPodium, race.id]);


  return (
    <Link to={`/races/${race.id}`}>
      <Card className={`glass-card p-5 h-full hover:border-primary/50 hover:shadow-glow transition-smooth ${isLive ? "border-success/40" : ""}`}>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <StatusBadge status={effectiveStatus} />
          {race.distance_km && <span className="text-xs text-muted-foreground">{race.distance_km} km</span>}
          {isLive && (
            <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 border border-primary/30 text-primary-glow text-xs font-semibold tabular-nums">
              <Timer className="h-3 w-3" /> {formatElapsed(elapsedSec)}
            </span>
          )}
        </div>
        <h3 className="font-display font-semibold text-lg mb-1">{race.name}</h3>
        <DifficultyStars level={race.difficulty_level} className="mb-2" />
        <p className="text-sm text-muted-foreground mb-2">
          {format(new Date(race.start_time), "EEEE d MMMM yyyy, HH:mm", { locale: fr })}
        </p>
        {showDescription && race.description && (
          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{race.description}</p>
        )}

        {showPodium && podium && (podium.men.length > 0 || podium.women.length > 0 || podium.overall.length > 0) && (
          <div className="mt-3 pt-3 border-t border-border/40 space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-primary-glow">
              <Trophy className="h-3.5 w-3.5" /> Classement {effectiveStatus === "finished" ? "final" : "provisoire"}
            </div>
            {podium.men.length === 0 && podium.women.length === 0 ? (
              <PodiumList title="Top 3" rows={podium.overall} />
            ) : (
              <>
                <PodiumList title="Hommes" rows={podium.men} />
                <PodiumList title="Femmes" rows={podium.women} />
              </>
            )}
          </div>
        )}

      </Card>
    </Link>
  );
}

function PodiumList({ title, rows }: { title: string; rows: PodiumRow[] }) {
  if (rows.length === 0) {
    return (
      <div>
        <p className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">{title}</p>
        <p className="text-xs text-muted-foreground/70">Aucun passage chronométré</p>
      </div>
    );
  }
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">{title}</p>
      <ol className="space-y-1">
        {rows.map((r, i) => (
          <li key={r.registration_id} className="flex items-center gap-2 text-xs">
            <span className="w-5 text-center shrink-0">{medals[i]}</span>
            <span className="font-medium truncate flex-1">
              #{r.bib_number} {r.first_name} {r.last_name}
            </span>
            <span className={`shrink-0 ${r.finished ? "text-success font-semibold" : "text-muted-foreground"}`}>
              {r.finished
                ? `Arrivé${r.finish_rank ? ` · ${r.finish_rank}e` : ""}${r.time_text ? ` · ${r.time_text}` : ""}`
                : `${r.checkpoint_name ?? `CP ${r.checkpoint_position + 1}`}${r.time_text ? ` · ${r.time_text}` : ""}`}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
