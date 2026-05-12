import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { LeaderboardRow } from "@/lib/types";

interface CheckpointMarker {
  id: string;
  name: string;
  distance_km: number | null;
}

interface ElevationChartProps {
  /** Stored gpx_geojson from the race row */
  gpxGeojson: any;
  /** Total race distance in km, used as fallback when GPX doesn't have ele */
  totalDistanceKm: number | null;
  /** Active runners — used to draw the peloton progress band */
  runners: LeaderboardRow[];
  /** Optional intermediate timing checkpoints */
  checkpoints?: CheckpointMarker[];
}

interface ProfilePoint {
  distanceKm: number;
  elevation: number;
}

const EARTH_RADIUS_M = 6371000;
function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(sa));
}

/** Extract [lng, lat, ele?] coords from any LineString / MultiLineString in the GeoJSON. */
function extractCoords(geojson: any): [number, number, number?][] {
  if (!geojson || !Array.isArray(geojson.features)) return [];
  const out: [number, number, number?][] = [];
  for (const feat of geojson.features) {
    const g = feat?.geometry;
    if (!g) continue;
    if (g.type === "LineString") {
      for (const c of g.coordinates) {
        out.push([c[0], c[1], typeof c[2] === "number" ? c[2] : undefined]);
      }
    } else if (g.type === "MultiLineString") {
      for (const line of g.coordinates) {
        for (const c of line) {
          out.push([c[0], c[1], typeof c[2] === "number" ? c[2] : undefined]);
        }
      }
    }
  }
  return out;
}

/** Downsample to ~200 points for smooth rendering. */
function downsample<T>(arr: T[], target = 200): T[] {
  if (arr.length <= target) return arr;
  const step = arr.length / target;
  const out: T[] = [];
  for (let i = 0; i < target; i++) {
    out.push(arr[Math.min(arr.length - 1, Math.floor(i * step))]);
  }
  out.push(arr[arr.length - 1]);
  return out;
}

export default function ElevationChart({
  gpxGeojson,
  totalDistanceKm,
  runners,
  checkpoints,
}: ElevationChartProps) {
  const { profile, totalKm, hasElevation, totalGain } = useMemo(() => {
    const coords = extractCoords(gpxGeojson);
    if (coords.length < 2) {
      return { profile: [] as ProfilePoint[], totalKm: 0, hasElevation: false, totalGain: 0 };
    }

    const points: ProfilePoint[] = [];
    let cumulative = 0;
    let gain = 0;
    let prevEle: number | null = null;
    let elevationCount = 0;

    for (let i = 0; i < coords.length; i++) {
      const [lng, lat, ele] = coords[i];
      if (i > 0) {
        const [pLng, pLat] = coords[i - 1];
        cumulative += haversineMeters({ lat: pLat, lng: pLng }, { lat, lng });
      }
      const elevation = typeof ele === "number" ? ele : 0;
      if (typeof ele === "number") elevationCount++;
      if (prevEle != null && typeof ele === "number") {
        const d = elevation - prevEle;
        if (d > 0) gain += d;
      }
      if (typeof ele === "number") prevEle = elevation;
      points.push({ distanceKm: cumulative / 1000, elevation });
    }

    return {
      profile: downsample(points, 250),
      totalKm: cumulative / 1000,
      hasElevation: elevationCount > points.length / 2,
      totalGain: Math.round(gain),
    };
  }, [gpxGeojson]);

  const { minProgressKm, maxProgressKm, leaderKm, runnerCount } = useMemo(() => {
    const active = runners.filter(
      (r) =>
        r.runner_status === "running" &&
        !r.finished_at &&
        r.distance_along_route_m != null,
    );
    if (active.length === 0) {
      return { minProgressKm: null, maxProgressKm: null, leaderKm: null, runnerCount: 0 };
    }
    const distances = active.map((r) => (r.distance_along_route_m ?? 0) / 1000);
    return {
      minProgressKm: Math.min(...distances),
      maxProgressKm: Math.max(...distances),
      leaderKm: Math.max(...distances),
      runnerCount: active.length,
    };
  }, [runners]);

  if (!hasElevation || profile.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4">
        <p className="text-sm text-muted-foreground">
          Le fichier GPX de cette course ne contient pas d'altitude.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Ré-importe un GPX avec données d'élévation pour voir le profil.
        </p>
      </div>
    );
  }

  // Y-axis padding for nicer rendering
  const elevations = profile.map((p) => p.elevation);
  const minEle = Math.min(...elevations);
  const maxEle = Math.max(...elevations);
  const padding = Math.max(20, (maxEle - minEle) * 0.1);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2 px-2 flex-wrap gap-2">
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">
            D+ <span className="font-semibold text-foreground">{totalGain} m</span>
          </span>
          <span className="text-muted-foreground">
            Distance <span className="font-semibold text-foreground">{totalKm.toFixed(1)} km</span>
          </span>
        </div>
        {runnerCount > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block w-3 h-2 rounded-sm bg-primary/30 border border-primary/60" />
            Peloton {runnerCount} coureur{runnerCount > 1 ? "s" : ""}
            {minProgressKm != null && maxProgressKm != null && (
              <span className="font-semibold text-foreground">
                ({minProgressKm.toFixed(1)} → {maxProgressKm.toFixed(1)} km)
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={profile}
            margin={{ top: 8, right: 12, left: -10, bottom: 0 }}
          >
            <defs>
              <linearGradient id="eleGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="distanceKm"
              type="number"
              domain={[0, totalKm]}
              tickFormatter={(v) => `${v.toFixed(0)}`}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              stroke="hsl(var(--border))"
              unit=" km"
            />
            <YAxis
              domain={[Math.floor(minEle - padding), Math.ceil(maxEle + padding)]}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              stroke="hsl(var(--border))"
              tickFormatter={(v) => `${Math.round(v)}`}
              width={45}
              unit=" m"
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(v: number) => `${v.toFixed(2)} km`}
              formatter={(value: number) => [`${Math.round(value)} m`, "Altitude"]}
            />

            {/* Peloton progress band */}
            {minProgressKm != null && maxProgressKm != null && maxProgressKm > minProgressKm && (
              <ReferenceArea
                x1={minProgressKm}
                x2={maxProgressKm}
                fill="hsl(var(--primary))"
                fillOpacity={0.15}
                stroke="hsl(var(--primary))"
                strokeOpacity={0.4}
                strokeDasharray="3 3"
              />
            )}

            {/* Leader marker */}
            {leaderKm != null && (
              <ReferenceLine
                x={leaderKm}
                stroke="hsl(45 95% 55%)"
                strokeWidth={2}
                label={{
                  value: "🥇",
                  position: "top",
                  fontSize: 14,
                }}
              />
            )}

            {/* Checkpoints (chronométrage intermédiaire) */}
            {checkpoints?.filter((c) => c.distance_km != null).map((c) => (
              <ReferenceLine
                key={`cp-${c.id}`}
                x={c.distance_km!}
                stroke="hsl(var(--accent))"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                label={{
                  value: `🚩 ${c.name}`,
                  position: "insideTopRight",
                  fontSize: 10,
                  fill: "hsl(var(--accent))",
                }}
              />
            ))}

            <Area
              type="monotone"
              dataKey="elevation"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              fill="url(#eleGradient)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
