import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft, Upload, Trash2, X, ImageIcon, Video, ExternalLink, Save } from "lucide-react";

import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Photo {
  id: string;
  race_id: string;
  checkpoint_id: string | null;
  storage_path: string;
  caption: string | null;
  created_at: string;
}

interface Checkpoint {
  id: string;
  name: string;
  distance_km: number | null;
  position: number;
  live_video_url: string | null;
}


const BUCKET = "checkpoint-photos";

const publicUrl = (path: string) =>
  supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

export default function CheckpointPhotos() {
  const { id: raceId } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const [raceName, setRaceName] = useState<string>("");
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedCp, setSelectedCp] = useState<string>("none");
  const [filterCp, setFilterCp] = useState<string>("all");
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const reload = useCallback(async () => {
    if (!raceId) return;
    // Ensure schema (adds live_video_url column on legacy DBs)
    await supabase.functions.invoke("ensure-checkpoints-schema").catch(() => null);
    const [{ data: race }, { data: cps }, { data: ph }] = await Promise.all([
      supabase.from("races").select("name, organizer_id").eq("id", raceId).maybeSingle(),
      (supabase as any)
        .from("race_checkpoints")
        .select("id, name, distance_km, position, live_video_url")
        .eq("race_id", raceId)
        .order("position", { ascending: true }),
      (supabase as any)
        .from("checkpoint_photos")
        .select("*")
        .eq("race_id", raceId)
        .order("created_at", { ascending: false }),
    ]);
    setRaceName(race?.name ?? "");
    setIsOrganizer(!!user && race?.organizer_id === user.id);
    setCheckpoints((cps as Checkpoint[] | null) ?? []);
    setPhotos((ph as Photo[] | null) ?? []);
  }, [raceId, user]);


  useEffect(() => {
    reload();
  }, [reload]);

  const filteredPhotos = useMemo(() => {
    if (filterCp === "all") return photos;
    if (filterCp === "none") return photos.filter((p) => !p.checkpoint_id);
    return photos.filter((p) => p.checkpoint_id === filterCp);
  }, [photos, filterCp]);

  const cpName = useCallback(
    (id: string | null) => {
      if (!id) return "Sans intermédiaire";
      const cp = checkpoints.find((c) => c.id === id);
      return cp ? cp.name : "—";
    },
    [checkpoints]
  );

  const handleUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || !raceId || !user) return;
      setUploading(true);
      try {
        let ok = 0;
        for (const file of Array.from(files)) {
          const ext = file.name.split(".").pop() ?? "jpg";
          const path = `${raceId}/${crypto.randomUUID()}.${ext}`;
          const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
            contentType: file.type || "image/jpeg",
            upsert: false,
          });
          if (upErr) {
            console.error(upErr);
            toast.error(`Échec upload ${file.name}: ${upErr.message}`);
            continue;
          }
          const { error: insErr } = await (supabase as any).from("checkpoint_photos").insert({
            race_id: raceId,
            checkpoint_id: selectedCp === "none" ? null : selectedCp,
            uploaded_by: user.id,
            storage_path: path,
            caption: caption || null,
          });
          if (insErr) {
            console.error(insErr);
            toast.error(`Erreur DB: ${insErr.message}`);
            await supabase.storage.from(BUCKET).remove([path]);
            continue;
          }
          ok++;
        }
        if (ok > 0) {
          toast.success(`${ok} photo(s) ajoutée(s)`);
          setCaption("");
          await reload();
        }
      } finally {
        setUploading(false);
      }
    },
    [raceId, user, selectedCp, caption, reload]
  );

  const handleDelete = useCallback(
    async (p: Photo) => {
      if (!confirm("Supprimer cette photo ?")) return;
      const { error } = await (supabase as any).from("checkpoint_photos").delete().eq("id", p.id);
      if (error) {
        toast.error(error.message);
        return;
      }
      await supabase.storage.from(BUCKET).remove([p.storage_path]);
      toast.success("Photo supprimée");
      reload();
    },
    [reload]
  );

  // Lightbox keyboard navigation
  useEffect(() => {
    if (lightboxIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxIdx(null);
      if (e.key === "ArrowRight")
        setLightboxIdx((i) => (i === null ? null : Math.min(filteredPhotos.length - 1, i + 1)));
      if (e.key === "ArrowLeft")
        setLightboxIdx((i) => (i === null ? null : Math.max(0, i - 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIdx, filteredPhotos.length]);

  if (authLoading) return null;

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <div className="flex items-center gap-2 mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link to={raceId ? `/organizer/races/${raceId}/admin` : "/dashboard"}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Retour administration
          </Link>
        </Button>
      </div>

      <div className="mb-6">
        <h1 className="font-display text-2xl md:text-3xl font-bold">Photos des intermédiaires</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {raceName ? `Course : ${raceName}` : ""}
        </p>
      </div>

      {isOrganizer && (
        <Card className="glass-card p-5 mb-6 space-y-4">
          <h2 className="font-display text-lg font-semibold flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary-glow" /> Ajouter des photos
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Intermédiaire associé</Label>
              <Select value={selectedCp} onValueChange={setSelectedCp}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sans intermédiaire</SelectItem>
                  {checkpoints.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}{c.distance_km != null ? ` · ${c.distance_km} km` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="caption">Légende (optionnelle)</Label>
              <Input id="caption" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Ex: passage du peloton" />
            </div>
          </div>
          <div>
            <Label htmlFor="file-upload" className="cursor-pointer">
              <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-colors">
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm font-medium">
                  {uploading ? "Envoi en cours..." : "Cliquez ou déposez vos photos ici"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WEBP — plusieurs fichiers possibles</p>
              </div>
              <input
                id="file-upload"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  handleUpload(e.target.files);
                  e.target.value = "";
                }}
              />
            </Label>
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Filtrer :</Label>
          <Select value={filterCp} onValueChange={setFilterCp}>
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les intermédiaires</SelectItem>
              <SelectItem value="none">Sans intermédiaire</SelectItem>
              {checkpoints.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="text-sm text-muted-foreground">{filteredPhotos.length} photo(s)</span>
      </div>

      {filteredPhotos.length === 0 ? (
        <Card className="glass-card p-10 text-center text-muted-foreground">
          <ImageIcon className="h-10 w-10 mx-auto mb-3 opacity-50" />
          <p>Aucune photo pour le moment</p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filteredPhotos.map((p, idx) => (
            <div
              key={p.id}
              className="group relative aspect-square rounded-lg overflow-hidden bg-secondary/30 cursor-zoom-in"
              onClick={() => setLightboxIdx(idx)}
            >
              <img
                src={publicUrl(p.storage_path)}
                alt={p.caption ?? cpName(p.checkpoint_id)}
                loading="lazy"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-white text-xs">
                <div className="truncate font-medium">{cpName(p.checkpoint_id)}</div>
                {p.caption && <div className="truncate opacity-80">{p.caption}</div>}
              </div>
              {isOrganizer && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(p);
                  }}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-destructive transition"
                  aria-label="Supprimer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {lightboxIdx !== null && filteredPhotos[lightboxIdx] && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4"
          onClick={() => setLightboxIdx(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxIdx(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
          {lightboxIdx > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setLightboxIdx(lightboxIdx - 1); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 text-2xl leading-none"
              aria-label="Précédent"
            >‹</button>
          )}
          {lightboxIdx < filteredPhotos.length - 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setLightboxIdx(lightboxIdx + 1); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 text-2xl leading-none"
              aria-label="Suivant"
            >›</button>
          )}
          <figure className="max-w-[95vw] max-h-[90vh] flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <img
              src={publicUrl(filteredPhotos[lightboxIdx].storage_path)}
              alt={filteredPhotos[lightboxIdx].caption ?? ""}
              className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
            />
            <figcaption className="text-white text-sm text-center">
              <div className="font-medium">{cpName(filteredPhotos[lightboxIdx].checkpoint_id)}</div>
              {filteredPhotos[lightboxIdx].caption && (
                <div className="opacity-80">{filteredPhotos[lightboxIdx].caption}</div>
              )}
              <div className="opacity-60 text-xs mt-1">
                {lightboxIdx + 1} / {filteredPhotos.length}
              </div>
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}
