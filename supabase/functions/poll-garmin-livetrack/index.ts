// Edge function: poll-garmin-livetrack
// Polls a Garmin LiveTrack session URL and forwards the latest GPS point
// to record-position. Called every 10s by the runner's browser.
//
// Garmin LiveTrack URL format:
//   https://livetrack.garmin.com/session/{sessionId}/token/{token}
// JSON trackpoints endpoint (undocumented but stable):
//   https://livetrack.garmin.com/services/session/{sessionId}/trackpoints?requestTime=<ms>
//   Header: Authorization: <token>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ParsedSession = { sessionId: string; token: string };

function parseLiveTrackUrl(url: string): ParsedSession | null {
  try {
    const u = new URL(url.trim());
    if (!u.hostname.includes("livetrack.garmin.com")) return null;
    // Path can be:
    //   /session/{id}/token/{token}
    //   /session/{id}/token/{token}/...
    const m = u.pathname.match(/\/session\/([^/]+)\/token\/([^/?#]+)/);
    if (!m) return null;
    return { sessionId: m[1], token: m[2] };
  } catch {
    return null;
  }
}

interface TrackPoint {
  position?: { lat: number; lon: number };
  dateTime?: string;
  speed?: number; // m/s
  altitude?: number;
  fitnessPointData?: { speedMetersPerSecond?: number };
}

function respond(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify the caller is authenticated
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return respond({ ok: false, error: "Non authentifié" });
    }

    const body = await req.json().catch(() => ({}));
    const { registration_id, livetrack_url, since_ms } = body ?? {};

    if (typeof registration_id !== "string" || typeof livetrack_url !== "string") {
      return respond({ ok: false, error: "registration_id et livetrack_url requis" });
    }

    const parsed = parseLiveTrackUrl(livetrack_url);
    if (!parsed) {
      return respond({
        ok: false,
        error:
          "URL Garmin LiveTrack invalide. Format attendu: https://livetrack.garmin.com/session/.../token/...",
      });
    }

    // Fetch trackpoints from Garmin
    const requestTime = typeof since_ms === "number" ? since_ms : 0;
    const garminUrl =
      `https://livetrack.garmin.com/services/session/${parsed.sessionId}/trackpoints?requestTime=${requestTime}`;

    let garminRes: Response;
    try {
      garminRes = await fetch(garminUrl, {
        headers: {
          "Authorization": parsed.token,
          "Accept": "application/json",
          "User-Agent": "FinisTrackLive/1.0",
        },
      });
    } catch (e) {
      return respond({
        ok: false,
        error: `Impossible de joindre Garmin: ${(e as Error).message}`,
        points: 0,
      });
    }

    if (!garminRes.ok) {
      const text = await garminRes.text().catch(() => "");
      return respond({
        ok: false,
        error: `Garmin LiveTrack indisponible (HTTP ${garminRes.status}). Vérifie que la session est active et que le partage est public.`,
        garmin_status: garminRes.status,
        garmin_body_preview: text.slice(0, 200),
        points: 0,
      });
    }

    const garminJson = await garminRes.json().catch(() => null) as
      | { trackPoints?: TrackPoint[] }
      | TrackPoint[]
      | null;

    const trackPoints: TrackPoint[] = Array.isArray(garminJson)
      ? garminJson
      : Array.isArray(garminJson?.trackPoints)
      ? garminJson!.trackPoints!
      : [];

    if (trackPoints.length === 0) {
      return respond({ ok: true, points: 0, latest_ms: requestTime });
    }

    // Sort by dateTime ascending and pick the latest valid point
    const validPoints = trackPoints
      .filter((p) =>
        p.position &&
        typeof p.position.lat === "number" &&
        typeof p.position.lon === "number" &&
        p.dateTime
      )
      .sort((a, b) =>
        new Date(a.dateTime!).getTime() - new Date(b.dateTime!).getTime()
      );

    if (validPoints.length === 0) {
      return respond({ ok: true, points: 0, latest_ms: requestTime });
    }

    const latest = validPoints[validPoints.length - 1];
    const latestMs = new Date(latest.dateTime!).getTime();

    // Forward to record-position using the user's JWT
    const speedMs = latest.fitnessPointData?.speedMetersPerSecond ?? latest.speed;
    const recordRes = await fetch(`${supabaseUrl}/functions/v1/record-position`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
      },
      body: JSON.stringify({
        registration_id,
        latitude: latest.position!.lat,
        longitude: latest.position!.lon,
        speed: typeof speedMs === "number" ? speedMs : null,
        accuracy: null,
      }),
    });

    const recordJson = await recordRes.json().catch(() => ({}));

    return respond({
      ok: recordRes.ok,
      points: validPoints.length,
      latest_ms: latestMs,
      position: (recordJson as any)?.position ?? null,
      record_status: recordRes.status,
      record_error: recordRes.ok ? null : (recordJson as any)?.error ?? null,
    });
  } catch (e) {
    return respond({
      ok: false,
      error: (e as Error).message ?? "Server error",
    });
  }
});
