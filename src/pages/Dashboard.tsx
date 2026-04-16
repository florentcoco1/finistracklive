import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Smartphone, Trophy, ShieldCheck } from "lucide-react";
import { StatusBadge } from "./Index";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface MyRegistration {
  id: string;
  bib_number: string;
  race: {
    id: string;
    name: string;
    start_time: string;
    distance_km: number | null;
    status: "upcoming" | "live" | "finished";
  };
}

export default function Dashboard() {
  const { user, loading, isOrganizer, roles } = useAuth();
  const navigate = useNavigate();
  const [registrations, setRegistrations] = useState<MyRegistration[]>([]);

  useEffect(() => {
    document.title = "Mon espace — LiveTrack";
  }, []);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("race_registrations")
      .select("id, bib_number, race:race_id ( id, name, start_time, distance_km, status )")
      .eq("runner_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => setRegistrations((data ?? []) as any));
  }, [user]);

  const becomeOrganizer = async () => {
    if (!user) return;
    const { error } = await supabase
      .from("user_roles")
      .insert({ user_id: user.id, role: "organizer" });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Tu es maintenant organisateur. Recharge la page.");
    setTimeout(() => window.location.reload(), 1000);
  };

  if (loading) return <main className="container py-12"><p className="text-muted-foreground">Chargement…</p></main>;
  if (!user) return <Navigate to="/auth" replace />;

  return (
    <main className="container py-10">
      <h1 className="font-display text-3xl md:text-4xl font-bold mb-2">Mon espace</h1>
      <p className="text-muted-foreground mb-8">
        {roles.includes("organizer") ? "Organisateur · Coureur" : "Coureur"}
      </p>

      <div className="grid md:grid-cols-3 gap-4 mb-10">
        <Card className="glass-card p-5">
          <Trophy className="h-5 w-5 text-primary-glow mb-2" />
          <p className="text-2xl font-bold">{registrations.length}</p>
          <p className="text-sm text-muted-foreground">Inscriptions</p>
        </Card>
        <Card className="glass-card p-5">
          <Smartphone className="h-5 w-5 text-primary-glow mb-2" />
          <p className="text-2xl font-bold">{registrations.filter(r => r.race?.status === "live").length}</p>
          <p className="text-sm text-muted-foreground">Courses en direct</p>
        </Card>
        <Card className="glass-card p-5">
          <ShieldCheck className="h-5 w-5 text-primary-glow mb-2" />
          {isOrganizer ? (
            <>
              <p className="text-base font-semibold">Organisateur</p>
              <Button asChild variant="link" className="px-0 h-auto"><Link to="/organizer/new-race">+ Créer une course</Link></Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-2">Tu veux organiser une course ?</p>
              <Button variant="glass" size="sm" onClick={becomeOrganizer}>Devenir organisateur</Button>
            </>
          )}
        </Card>
      </div>

      <h2 className="font-display text-2xl font-semibold mb-4">Mes courses</h2>
      {registrations.length === 0 ? (
        <Card className="glass-card p-10 text-center">
          <p className="text-muted-foreground mb-4">Tu n'es inscrit à aucune course.</p>
          <Button asChild variant="hero"><Link to="/races">Découvrir les courses</Link></Button>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {registrations.map((reg) => (
            <Card key={reg.id} className="glass-card p-5">
              <div className="flex items-center gap-2 mb-2">
                <StatusBadge status={reg.race.status} />
                <span className="ml-auto text-xs text-muted-foreground">Dossard #{reg.bib_number}</span>
              </div>
              <h3 className="font-display font-semibold text-lg mb-1">{reg.race.name}</h3>
              <p className="text-sm text-muted-foreground mb-3">
                {format(new Date(reg.race.start_time), "d MMM yyyy, HH:mm", { locale: fr })}
                {reg.race.distance_km && ` · ${reg.race.distance_km} km`}
              </p>
              <div className="flex gap-2">
                <Button asChild variant="hero" size="sm" className="flex-1">
                  <Link to={`/race/${reg.race.id}/track`}>Suivi GPS</Link>
                </Button>
                <Button asChild variant="glass" size="sm">
                  <Link to={`/races/${reg.race.id}`}>Voir</Link>
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
