// Edge function: record-position
// Receives a GPS point from a runner, snaps it to the race route,
// computes distance along route + rolling speed/pace over last 5 minutes,
// and inserts a runner_positions row.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RoutePoint = { lat: number; lng: number; cumulativeDistanceM: number };

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

/** Project a GPS point onto the polyline. Returns the cumulative distance of the closest point. */
function snapToRoute(
  point: { lat: number; lng: number },
  route: RoutePoint[],
): { distanceAlongM: number; deviationM: number } {
  if (route.length === 0) return { distanceAlongM: 0, deviationM: Infinity };
  if (route.length === 1)
    return {
      distanceAlongM: 0,
      deviationM: haversineMeters(point, route[0]),
    };

  let bestDist = Infinity;
  let bestAlong = 0;

  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];

    // Local equirectangular projection (good enough for short segments)
    const meanLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos(meanLat);

    const ax = 0;
    const ay = 0;
    const bx = (b.lng - a.lng) * mPerDegLng;
    const by = (b.lat - a.lat) * mPerDegLat;
    const px = (point.lng - a.lng) * mPerDegLng;
    const py = (point.lat - a.lat) * mPerDegLat;

    const segLen2 = bx * bx + by * by;
    let t = segLen2 > 0 ? (px * bx + py * by) / segLen2 : 0;
    t = Math.max(0, Math.min(1, t));

    const projX = ax + t * bx;
    const projY = ay + t * by;
    const dx = px - projX;
    const dy = py - projY;
    const distM = Math.sqrt(dx * dx + dy * dy);

    if (distM < bestDist) {
      bestDist = distM;
      const segDist = Math.sqrt(segLen2);
      bestAlong = a.cumulativeDistanceM + t * segDist;
    }
  }

  return { distanceAlongM: bestAlong, deviationM: bestDist };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Use the user's JWT to verify identity
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();

    if (userErr || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const body = await req.json();
    const {
      registration_id,
      latitude,
      longitude,
      accuracy,
      speed,
    } = body ?? {};

    // Basic validation
    if (
      typeof registration_id !== "string" ||
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      latitude < -90 || latitude > 90 ||
      longitude < -180 || longitude > 180
    ) {
      return new Response(
        JSON.stringify({ error: "Invalid payload" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Service-role client to bypass RLS for the controlled write
    const admin = createClient(supabaseUrl, serviceKey);

    // Verify registration belongs to this user + load race route
    const { data: reg, error: regErr } = await admin
      .from("race_registrations")
      .select("id, runner_id, race_id, races:race_id ( route_points, distance_km )")
      .eq("id", registration_id)
      .single();

    if (regErr || !reg || reg.runner_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Registration not found or not yours" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const race = (reg as any).races;
    const routePoints: RoutePoint[] = Array.isArray(race?.route_points)
      ? race.route_points
      : [];
    const totalKm: number = Number(race?.distance_km ?? 0);

    // Anti-cheat lite: require a recent point gap of at least 2s
    const { data: lastRows } = await admin
      .from("runner_positions")
      .select("recorded_at")
      .eq("registration_id", registration_id)
      .order("recorded_at", { ascending: false })
      .limit(1);
    const lastRecordedAt = lastRows?.[0]?.recorded_at
      ? new Date(lastRows[0].recorded_at).getTime()
      : 0;
    if (Date.now() - lastRecordedAt < 2000) {
      return new Response(
        JSON.stringify({ error: "Rate limited (min 2s between points)" }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Snap to route
    let distanceAlongM: number | null = null;
    let progressPercent: number | null = null;
    if (routePoints.length > 0) {
      const snap = snapToRoute({ lat: latitude, lng: longitude }, routePoints);
      distanceAlongM = Math.round(snap.distanceAlongM);
      if (totalKm > 0) {
        progressPercent = Math.max(
          0,
          Math.min(100, (distanceAlongM / (totalKm * 1000)) * 100),
        );
      }
    }

    // Rolling 5-min metrics
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: window } = await admin
      .from("runner_positions")
      .select("recorded_at, distance_along_route_m")
      .eq("registration_id", registration_id)
      .gte("recorded_at", fiveMinAgo)
      .order("recorded_at", { ascending: true });

    let rollingSpeedKmh: number | null = null;
    let rollingPaceSecPerKm: number | null = null;

    if (
      window && window.length >= 1 && distanceAlongM != null
    ) {
      const oldest = window[0];
      const oldDist = Number(oldest.distance_along_route_m ?? distanceAlongM);
      const oldTime = new Date(oldest.recorded_at).getTime();
      const dDist = Math.max(0, distanceAlongM - oldDist);
      const dTimeS = (Date.now() - oldTime) / 1000;
      if (dTimeS > 5 && dDist > 10) {
        rollingSpeedKmh = (dDist / 1000) / (dTimeS / 3600);
        rollingPaceSecPerKm = Math.round(dTimeS / (dDist / 1000));
      } else if (dTimeS > 5) {
        rollingSpeedKmh = 0;
      }
    }

    const { data: inserted, error: insErr } = await admin
      .from("runner_positions")
      .insert({
        registration_id,
        latitude,
        longitude,
        accuracy: accuracy ?? null,
        speed: speed ?? null,
        distance_along_route_m: distanceAlongM,
        progress_percent: progressPercent,
        rolling_speed_kmh: rollingSpeedKmh,
        rolling_pace_sec_per_km: rollingPaceSecPerKm,
      })
      .select()
      .single();

    if (insErr) {
      return new Response(
        JSON.stringify({ error: insErr.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        position: inserted,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message ?? "Server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
