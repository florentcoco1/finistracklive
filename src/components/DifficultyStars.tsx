import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

const labels: Record<number, string> = {
  1: "Parcours facile",
  2: "Parcours accessible",
  3: "Parcours intermédiaire",
  4: "Parcours difficile",
  5: "Parcours très difficile",
};

export function difficultyLabel(level: number | null | undefined) {
  const safeLevel = Math.min(5, Math.max(1, Number(level) || 1));
  return labels[safeLevel];
}

export function DifficultyStars({ level, className }: { level?: number | null; className?: string }) {
  const safeLevel = Math.min(5, Math.max(1, Number(level) || 1));

  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)} title={difficultyLabel(safeLevel)}>
      <span className="inline-flex items-center gap-0.5" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <Star
            key={index}
            className={cn("h-3.5 w-3.5", index < safeLevel ? "fill-warning text-warning" : "text-muted-foreground/40")}
          />
        ))}
      </span>
      <span>{difficultyLabel(safeLevel)}</span>
    </span>
  );
}
