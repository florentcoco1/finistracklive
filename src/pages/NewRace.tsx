import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { parseGpx } from "@/lib/gpx";
import { Upload, MapPin } from "lucide-react";
import { DifficultyStars } from "@/components/DifficultyStars";

const formSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().max(2000).optional(),
  start_time: z.string().min(1),
  difficulty_level: z.coerce.number().int().min(1).max(5),
});

export default function NewRace() {
  const { user, isOrganizer, loading } = useAuth();
  const navigate = useNavigate();
  const [gpxFile, setGpxFile] = useState<File | null>(null);
  const [gpxPreview, setGpxPreview] = useState<{ distanceKm: number; points: number } | null>(null);
  const [difficultyLevel, setDifficultyLevel] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { document.title = "Créer une course — FinisTrackLive"; }, []);

  if (loading) return <main className="container py-12"><p className="text-muted-foreground">Chargement…</p></main>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!isOrganizer) {
    return (
      <main className="container py-12">
        <Card className="glass-card p-8 max-w-xl">
          <h1 className="font-display text-2xl font-bold mb-2">Espace organisateur</h1>
          <p className="text-muted-foreground mb-4">Tu dois avoir le rôle organisateur pour créer une course. Active-le depuis ton espace.</p>
          <Button variant="hero" onClick={() => navigate("/dashboard")}>Aller à mon espace</Button>
        </Card>
      </main>
    );
  }

  const handleGpxChange = async (file: File) => {
    setGpxFile(file);
    try {
      const text = await file.text();
      const { routePoints, distanceKm } = parseGpx(text);
      if (routePoints.length < 2) {
        toast.error("GPX invalide ou vide");
        setGpxPreview(null);
        return;
      }
      setGpxPreview({ distanceKm, points: routePoints.length });
    } catch {
      toast.error("Impossible de lire le fichier GPX");
      setGpxPreview(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!gpxFile) { toast.error("Charge un fichier GPX"); return; }

    const fd = new FormData(e.currentTarget);
    const parsed = formSchema.safeParse({
      name: fd.get("name"),
      description: fd.get("description") || undefined,
      start_time: fd.get("start_time"),
      difficulty_level: fd.get("difficulty_level"),
    });
    if (!parsed.success) { toast.error(parsed.error.errors[0].message); return; }

    setSubmitting(true);
    try {
      const text = await gpxFile.text();
      const { geojson, routePoints, distanceKm } = parseGpx(text);

      // Upload to storage: <userId>/<timestamp>-<name>
      const path = `${user.id}/${Date.now()}-${gpxFile.name.replace(/[^a-z0-9.-]/gi, "_")}`;
      const { error: upErr } = await supabase.storage
        .from("gpx-files")
        .upload(path, gpxFile, { contentType: "application/gpx+xml" });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from("gpx-files").getPublicUrl(path);

      const { data: race, error: insErr } = await supabase
        .from("races")
        .insert({
          organizer_id: user.id,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          start_time: new Date(parsed.data.start_time).toISOString(),
          gpx_url: pub.publicUrl,
          gpx_geojson: geojson as any,
          route_points: routePoints as any,
          distance_km: distanceKm,
          difficulty_level: parsed.data.difficulty_level,
          status: "upcoming",
        } as never)
        .select("id")
        .single();
      if (insErr) throw insErr;

      toast.success("Course créée !");
      navigate(`/races/${race.id}`);
    } catch (err: any) {
      toast.error(err.message ?? "Erreur lors de la création");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="container py-10 max-w-2xl">
      <h1 className="font-display text-3xl md:text-4xl font-bold mb-2">Créer une course</h1>
      <p className="text-muted-foreground mb-8">Charge le tracé GPX et publie ton événement</p>

      <Card className="glass-card p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <Label htmlFor="name">Nom de la course</Label>
            <Input id="name" name="name" required placeholder="Trail des collines 2026" maxLength={120} />
          </div>
          <div>
            <Label htmlFor="start_time">Date & heure de départ</Label>
            <Input id="start_time" name="start_time" type="datetime-local" required />
          </div>
          <div>
            <Label htmlFor="description">Description (optionnel)</Label>
            <Textarea id="description" name="description" rows={3} maxLength={2000} placeholder="Trail technique, 850m de D+, ravitaillement au km 15…" />
          </div>

          <div>
            <Label htmlFor="difficulty_level">Difficulté du parcours</Label>
            <select id="difficulty_level" name="difficulty_level" value={difficultyLevel} onChange={(e) => setDifficultyLevel(Number(e.target.value))} className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <option value="1">1 étoile — parcours facile</option>
              <option value="2">2 étoiles — parcours accessible</option>
              <option value="3">3 étoiles — parcours intermédiaire</option>
              <option value="4">4 étoiles — parcours difficile</option>
              <option value="5">5 étoiles — parcours très difficile</option>
            </select>
            <DifficultyStars level={difficultyLevel} className="mt-2" />
          </div>

          <div>
            <Label>Fichier GPX du parcours</Label>
            <label className="mt-1.5 flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-primary/50 transition-smooth bg-secondary/30">
              <Upload className="h-6 w-6 text-muted-foreground mb-2" />
              <span className="text-sm text-muted-foreground">
                {gpxFile ? gpxFile.name : "Clique pour choisir un .gpx"}
              </span>
              <input
                type="file"
                accept=".gpx,application/gpx+xml,application/xml,text/xml"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleGpxChange(e.target.files[0])}
              />
            </label>
            {gpxPreview && (
              <div className="mt-2 flex items-center gap-2 text-sm text-success">
                <MapPin className="h-4 w-4" />
                {gpxPreview.distanceKm} km · {gpxPreview.points} points
              </div>
            )}
          </div>

          <Button type="submit" variant="hero" size="lg" className="w-full" disabled={submitting}>
            {submitting ? "Création…" : "Créer la course"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
