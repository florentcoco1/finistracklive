import { gpx as gpxToGeoJSON } from "@tmcw/togeojson";

export type RoutePoint = { lat: number; lng: number; cumulativeDistanceM: number };

const EARTH_RADIUS_M = 6371000;

export function haversineMeters(
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

/** Parse a GPX string to GeoJSON, route points (with cumulative distance) and total distance (km). */
export function parseGpx(gpxText: string): {
  geojson: GeoJSON.FeatureCollection;
  routePoints: RoutePoint[];
  distanceKm: number;
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(gpxText, "application/xml");
  const geojson = gpxToGeoJSON(doc) as GeoJSON.FeatureCollection;

  // Flatten all coordinates from LineString / MultiLineString features
  const coords: [number, number][] = [];
  for (const feature of geojson.features) {
    const g = feature.geometry;
    if (!g) continue;
    if (g.type === "LineString") {
      for (const c of g.coordinates) coords.push([c[0], c[1]]);
    } else if (g.type === "MultiLineString") {
      for (const line of g.coordinates) for (const c of line) coords.push([c[0], c[1]]);
    }
  }

  const routePoints: RoutePoint[] = [];
  let cumulative = 0;
  for (let i = 0; i < coords.length; i++) {
    const [lng, lat] = coords[i];
    if (i > 0) {
      const [prevLng, prevLat] = coords[i - 1];
      cumulative += haversineMeters({ lat: prevLat, lng: prevLng }, { lat, lng });
    }
    routePoints.push({ lat, lng, cumulativeDistanceM: cumulative });
  }

  return {
    geojson,
    routePoints,
    distanceKm: Math.round((cumulative / 1000) * 100) / 100,
  };
}

export function formatPace(secPerKm: number | null | undefined): string {
  if (!secPerKm || secPerKm <= 0 || !Number.isFinite(secPerKm)) return "—";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

export function formatSpeed(kmh: number | null | undefined): string {
  if (kmh == null || !Number.isFinite(kmh)) return "—";
  return `${kmh.toFixed(1)} km/h`;
}
