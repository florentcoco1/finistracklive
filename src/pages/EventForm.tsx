import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Upload } from "lucide-react";

interface UntypedQuery {
  select: (c: string) => { eq: (col: string, val: string) => { single: () => Promise<{ data: unknown | null; error: unknown }> } };
  insert: (row: unknown) => { select: (c: string) => { single: () => Promise<{ data: unknown | null; error: unknown }> } };
  update: (row: unknown) => { eq: (col: string, val: string) => Promise<{ error: unknown }> };
}

const schema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().max(4000).optional().or(z.literal("")),
  location: z.string().max(200).optional().or(z.literal("")),
  start_date: z.string().optional().or(z.literal("")),
  end_date: z.string().optional().or(z.literal("")),
  website_url: z.string().url().optional().or(z.literal("")),
  contact_email: z.string().email().optional().or(z.literal("")),
  contact_phone: z.string().max(40).optional().or(z.literal("")),
  facebook_url: z.string().url().optional().or(z.literal("")),
  instagram_url: z.string().url().optional().or(z.literal("")),
  twitter_url: z.string().url().optional().or(z.literal("")),
});

interface EventForm {
  name: string;
  description: string;
  location: string;
  start_date: string;
  end_date: string;
  website_url: string;
  contact_email: string;
  contact_phone: string;
  facebook_url: string;
  instagram_url: string;
  twitter_url: string;
  poster_url: string | null;
}

const empty: EventForm = {
  name: "", description: "", location: "", start_date: "", end_date: "",
  website_url: "", contact_email: "", contact_phone: "",
  facebook_url: "", instagram_url: "", twitter_url: "", poster_url: null,
};

export default function EventFormPage({ mode }: { mode: "create" | "edit" }) {
  const { user, isOrganizer, loading } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [form, setForm] = useState<EventForm>(empty);
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingEvent, setLoadingEvent] = useState(mode === "edit");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = (mode === "create" ? "Créer une épreuve" : "Modifier l'épreuve") + " — FinisTrackLive";
  }, [mode]);

  useEffect(() => {
    if (mode !== "edit" || !id) return;
    (supabase.from as unknown as (t: string) => UntypedQuery)("events")
      .select("*")
      .eq("id", id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          toast.error("Épreuve introuvable");
          navigate("/dashboard");
          return;
        }
        const e = data as Partial<EventForm>;
        setForm({
          name: e.name ?? "",
          description: e.description ?? "",
          location: e.location ?? "",
          start_date: e.start_date ?? "",
          end_date: e.end_date ?? "",
          website_url: e.website_url ?? "",
          contact_email: e.contact_email ?? "",
          contact_phone: e.contact_phone ?? "",
          facebook_url: e.facebook_url ?? "",
          instagram_url: e.instagram_url ?? "",
          twitter_url: e.twitter_url ?? "",
          poster_url: e.poster_url ?? null,
        });
        setLoadingEvent(false);
      });
  }, [mode, id, navigate]);

  if (loading || loadingEvent) return <main className="container py-12"><p className="text-muted-foreground">Chargement…</p></main>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!isOrganizer) return <Navigate to="/dashboard" replace />;

  const update = (k: keyof EventForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) { toast.error(parsed.error.errors[0].message); return; }
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      toast.error("La date de fin doit être après la date de début"); return;
    }
    setSubmitting(true);
    try {
      let posterUrl = form.poster_url;
      if (posterFile) {
        // Ensure bucket exists (created on demand by edge function)
        await supabase.functions.invoke("ensure-event-posters-bucket");
        const path = `${user.id}/${Date.now()}-${posterFile.name.replace(/[^a-z0-9.-]/gi, "_")}`;
        const { error: upErr } = await supabase.storage
          .from("event-posters")
          .upload(path, posterFile, { contentType: posterFile.type, upsert: false });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("event-posters").getPublicUrl(path);
        posterUrl = pub.publicUrl;
      }

      const payload = {
        name: form.name.trim(),
        description: form.description || null,
        location: form.location || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        website_url: form.website_url || null,
        contact_email: form.contact_email || null,
        contact_phone: form.contact_phone || null,
        facebook_url: form.facebook_url || null,
        instagram_url: form.instagram_url || null,
        twitter_url: form.twitter_url || null,
        poster_url: posterUrl,
      };

      const table = (supabase.from as unknown as (t: string) => UntypedQuery)("events");
      if (mode === "create") {
        const { data, error } = await table
          .insert({ ...payload, organizer_id: user.id })
          .select("id")
          .single();
        if (error) throw error;
        toast.success("Épreuve créée");
        navigate(`/events/${(data as { id: string }).id}`);
      } else if (id) {
        const { error } = await table.update(payload).eq("id", id);
        if (error) throw error;
        toast.success("Épreuve mise à jour");
        navigate(`/events/${id}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de l'enregistrement");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="container py-10 max-w-3xl">
      <h1 className="font-display text-3xl md:text-4xl font-bold mb-2">
        {mode === "create" ? "Créer une épreuve" : "Modifier l'épreuve"}
      </h1>
      <p className="text-muted-foreground mb-8">Une épreuve regroupe plusieurs courses (différentes distances, formats…)</p>

      <Card className="glass-card p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <Label>Affiche de l'épreuve</Label>
            <label className="mt-1.5 flex items-center justify-center w-full aspect-[3/4] max-w-xs border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-primary/50 transition-smooth bg-secondary/30 overflow-hidden">
              {posterFile ? (
                <img src={URL.createObjectURL(posterFile)} alt="Aperçu" className="w-full h-full object-cover" />
              ) : form.poster_url ? (
                <img src={form.poster_url} alt="Affiche actuelle" className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center text-muted-foreground">
                  <Upload className="h-6 w-6 mb-2" />
                  <span className="text-sm">Choisir une image (JPG/PNG)</span>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 5 * 1024 * 1024) { toast.error("Image trop lourde (max 5 Mo)"); return; }
                  setPosterFile(f);
                }}
              />
            </label>
          </div>

          <div>
            <Label htmlFor="name">Nom de l'épreuve *</Label>
            <Input id="name" value={form.name} onChange={(e) => update("name", e.target.value)} required maxLength={160} />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={4} value={form.description} onChange={(e) => update("description", e.target.value)} maxLength={4000} />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="start_date">Date de début</Label>
              <Input id="start_date" type="date" value={form.start_date} onChange={(e) => update("start_date", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="end_date">Date de fin</Label>
              <Input id="end_date" type="date" value={form.end_date} onChange={(e) => update("end_date", e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="location">Lieu</Label>
            <Input id="location" value={form.location} onChange={(e) => update("location", e.target.value)} maxLength={200} placeholder="Ville, département…" />
          </div>

          <div className="pt-2 border-t border-border/60">
            <h3 className="font-semibold mb-3">Contact & liens</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="website_url">Site web</Label>
                <Input id="website_url" type="url" value={form.website_url} onChange={(e) => update("website_url", e.target.value)} placeholder="https://…" />
              </div>
              <div>
                <Label htmlFor="contact_email">Email de contact</Label>
                <Input id="contact_email" type="email" value={form.contact_email} onChange={(e) => update("contact_email", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="contact_phone">Téléphone</Label>
                <Input id="contact_phone" value={form.contact_phone} onChange={(e) => update("contact_phone", e.target.value)} />
              </div>
              <div>
                <Label htmlFor="facebook_url">Facebook</Label>
                <Input id="facebook_url" type="url" value={form.facebook_url} onChange={(e) => update("facebook_url", e.target.value)} placeholder="https://facebook.com/…" />
              </div>
              <div>
                <Label htmlFor="instagram_url">Instagram</Label>
                <Input id="instagram_url" type="url" value={form.instagram_url} onChange={(e) => update("instagram_url", e.target.value)} placeholder="https://instagram.com/…" />
              </div>
              <div>
                <Label htmlFor="twitter_url">Twitter / X</Label>
                <Input id="twitter_url" type="url" value={form.twitter_url} onChange={(e) => update("twitter_url", e.target.value)} placeholder="https://x.com/…" />
              </div>
            </div>
          </div>

          <Button type="submit" variant="hero" size="lg" className="w-full" disabled={submitting}>
            {submitting ? "Enregistrement…" : mode === "create" ? "Créer l'épreuve" : "Enregistrer"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
