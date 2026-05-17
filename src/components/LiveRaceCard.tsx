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
  const [podium, setPodium] = useState<{ men: PodiumRow[]; women: PodiumRow[] } | null>(null);

  const hasStarted = nowTs >= startMs;
  const effectiveStatus: "upcoming" | "live" | "finished" =
    race.status === "finished" ? "finished" : hasStarted ? "live" : "upcoming";
  const isLive = effectiveStatus === "live";
  const elapsedSec = isLive ? Math.floor((nowTs - startMs) / 1000) : 0;

  useEffect(() => {
    if (!isLive) return;
    const t = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [isLive]);

  useEffect(() => {
    if (!isLive) {
      setPodium(null);
      return;
    }
    let active = true;

    const load = async () => {
      const [{ data: regs }, { data: checkpoints }] = await Promise.all([
        supabase
          .from("race_registrations")
          .select("id, runner_id, bib_number")
          .eq("race_id", race.id),
        supabase
          .from("race_checkpoints")
          .select("id, name, position")
          .eq("race_id", race.id)
          .order("position", { ascending: true }),
      ]);
      if (!active) return;
      const regList = (regs ?? []) as Array<{ id: string; runner_id: string; bib_number: string }>;
      const cpList = (checkpoints ?? []) as Array<{ id: string; name: string; position: number }>;
      if (regList.length === 0 || cpList.length === 0) {
        setPodium({ men: [], women: [] });
        return;
      }

      const regIds = regList.map((r) => r.id);
      const runnerIds = Array.from(new Set(regList.map((r) => r.runner_id)));
      const bibs = regList.map((r) => r.bib_number);

      const [{ data: times }, { data: profiles }, { data: gmcap }] = await Promise.all([
        supabase
          .from("runner_checkpoint_times")
          .select("registration_id, checkpoint_id, time_seconds, time_text")
          .in("registration_id", regIds),
        supabase
          .from("profiles")
          .select("user_id, first_name, last_name")
          .in("user_id", runnerIds),
        supabase
          .from("gmcap_results")
          .select("bib_number, gender")
          .eq("race_id", race.id)
          .in("bib_number", bibs),
      ]);
      if (!active) return;

      const cpById = new Map(cpList.map((c) => [c.id, c]));
      const profileById = new Map((profiles ?? []).map((p) => [p.user_id, p]));
      const genderByBib = new Map(
        ((gmcap ?? []) as Array<{ bib_number: string; gender: string | null }>)
          .map((g) => [String(g.bib_number).trim(), (g.gender as "M" | "F" | null) ?? null]),
      );

      // Last checkpoint reached per registration
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
          const best = bestByReg.get(r.id);
          if (!best) return null;
          const cp = cpById.get(best.checkpoint_id);
          const profile = profileById.get(r.runner_id);
          return {
            registration_id: r.id,
            bib_number: r.bib_number,
            first_name: profile?.first_name ?? null,
            last_name: profile?.last_name ?? null,
            gender: genderByBib.get(String(r.bib_number).trim()) ?? null,
            checkpoint_name: cp?.name ?? null,
            checkpoint_position: best.position,
            time_text: best.time_text,
            time_seconds: best.time_seconds,
          } as PodiumRow;
        })
        .filter((r): r is PodiumRow => r !== null);

      const sortFn = (a: PodiumRow, b: PodiumRow) => {
        if (b.checkpoint_position !== a.checkpoint_position) return b.checkpoint_position - a.checkpoint_position;
        const ta = a.time_seconds ?? Number.POSITIVE_INFINITY;
        const tb = b.time_seconds ?? Number.POSITIVE_INFINITY;
        return ta - tb;
      };

      const men = rows.filter((r) => r.gender === "M").sort(sortFn).slice(0, 3);
      const women = rows.filter((r) => r.gender === "F").sort(sortFn).slice(0, 3);
      setPodium({ men, women });
    };

    load();
    const poll = window.setInterval(load, 15000);
    return () => {
      active = false;
      window.clearInterval(poll);
    };
  }, [isLive, race.id]);

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

        {isLive && podium && (podium.men.length > 0 || podium.women.length > 0) && (
          <div className="mt-3 pt-3 border-t border-border/40 space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-primary-glow">
              <Trophy className="h-3.5 w-3.5" /> Classement provisoire
            </div>
            <PodiumList title="Hommes" rows={podium.men} />
            <PodiumList title="Femmes" rows={podium.women} />
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
            <span className="text-muted-foreground shrink-0">
              {r.checkpoint_name ?? `CP ${r.checkpoint_position + 1}`}
              {r.time_text ? ` · ${r.time_text}` : ""}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
