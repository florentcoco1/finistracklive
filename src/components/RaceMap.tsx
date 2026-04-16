import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LeaderboardRow } from "@/lib/types";

interface Props {
  routeCoords: [number, number][];
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

export default function RaceMap({ routeCoords, runners, focusedRunnerId }: Props) {
  const center: [number, number] = routeCoords[0] ?? [46.5, 2.3];
  const focused = useMemo(() => {
    if (!focusedRunnerId) return null;
    const r = runners.find((x) => x.registration_id === focusedRunnerId);
    if (!r || r.latitude == null || r.longitude == null) return null;
    return [r.latitude, r.longitude] as [number, number];
  }, [focusedRunnerId, runners]);

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
        <Polyline
          positions={routeCoords}
          pathOptions={{ color: "#a78bfa", weight: 4, opacity: 0.85 }}
        />
      )}
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
