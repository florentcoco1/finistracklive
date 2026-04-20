import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LeaderboardRow, RouteCoord } from "@/lib/types";

interface Props {
  routeCoords: [number, number][];
  routePoints?: RouteCoord[] | null;
  runners: LeaderboardRow[];
  focusedRunnerId?: string | null;
}

function FitBounds({ coords }: { coords: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (coords.length === 0) return;
    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [coords, map]);
  return null;
}

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [target, map]);
  return null;
}

const COLORS = ["#6366f1", "#a855f7", "#06b6d4", "#22c55e", "#f59e0b", "#ec4899", "#ef4444", "#14b8a6"];

export function colorForRegistration(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

function makeRunnerIcon(bib: string, color: string) {
  return L.divIcon({
    className: "",
    html: `<div class="runner-marker" style="background:${color}">${bib}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function makeKmIcon(km: number) {
  return L.divIcon({
    className: "",
    html: `<div class="km-marker">${km}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/** Renvoie un marqueur tous les N km le long de la trace, en utilisant la distance cumulée. */
function computeKmMarkers(points: RouteCoord[]): { km: number; lat: number; lng: number }[] {
  if (!points || points.length < 2) return [];
  const totalKm = points[points.length - 1].cumulativeDistanceM / 1000;
  // Espacement adaptatif pour éviter la surcharge visuelle
  const step = totalKm <= 10 ? 1 : totalKm <= 30 ? 2 : totalKm <= 80 ? 5 : 10;
  const markers: { km: number; lat: number; lng: number }[] = [];
  let nextKm = step;
  for (let i = 1; i < points.length; i++) {
    const d = points[i].cumulativeDistanceM / 1000;
    while (d >= nextKm) {
      // interpolation linéaire entre points[i-1] et points[i]
      const prev = points[i - 1];
      const cur = points[i];
      const segKm = (cur.cumulativeDistanceM - prev.cumulativeDistanceM) / 1000;
      const t = segKm > 0 ? (nextKm - prev.cumulativeDistanceM / 1000) / segKm : 0;
      markers.push({
        km: nextKm,
        lat: prev.lat + (cur.lat - prev.lat) * t,
        lng: prev.lng + (cur.lng - prev.lng) * t,
      });
      nextKm += step;
    }
  }
  return markers;
}

export default function RaceMap({ routeCoords, routePoints, runners, focusedRunnerId }: Props) {
  const center: [number, number] = routeCoords[0] ?? [46.5, 2.3];
  const focused = useMemo(() => {
    if (!focusedRunnerId) return null;
    const r = runners.find((x) => x.registration_id === focusedRunnerId);
    if (!r || r.latitude == null || r.longitude == null) return null;
    return [r.latitude, r.longitude] as [number, number];
  }, [focusedRunnerId, runners]);

  const kmMarkers = useMemo(() => computeKmMarkers(routePoints ?? []), [routePoints]);

  return (
    <MapContainer
      center={center}
      zoom={13}
      scrollWheelZoom
      className="h-full w-full rounded-xl overflow-hidden"
    >
      <TileLayer
        attribution='© OpenStreetMap'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {routeCoords.length > 1 && (
        <>
          {/* Halo blanc pour ressortir sur tous les fonds */}
          <Polyline
            positions={routeCoords}
            pathOptions={{ color: "#ffffff", weight: 9, opacity: 0.9 }}
          />
          {/* Trace principale haute visibilité */}
          <Polyline
            positions={routeCoords}
            pathOptions={{ color: "#ef4444", weight: 5, opacity: 1 }}
          />
        </>
      )}
      {kmMarkers.map((m) => (
        <Marker
          key={`km-${m.km}`}
          position={[m.lat, m.lng]}
          icon={makeKmIcon(m.km)}
          interactive={false}
          keyboard={false}
        />
      ))}
      {runners
        .filter((r) => r.latitude != null && r.longitude != null)
        .map((r) => (
          <Marker
            key={r.registration_id}
            position={[r.latitude!, r.longitude!]}
            icon={makeRunnerIcon(r.bib_number, colorForRegistration(r.registration_id))}
          />
        ))}
      <FitBounds coords={routeCoords} />
      <FlyTo target={focused} />
    </MapContainer>
  );
}
