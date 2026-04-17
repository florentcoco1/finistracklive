import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Activity } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const signupSchema = z.object({
  email: z.string().trim().email("Email invalide").max(255),
  password: z.string().min(8, "Mot de passe : 8 caractères minimum").max(72),
  first_name: z.string().trim().min(1, "Prénom requis").max(60),
  last_name: z.string().trim().min(1, "Nom requis").max(60),
  birth_date: z.string().min(1, "Date de naissance requise"),
  phone: z.string().trim().min(6, "Téléphone invalide").max(30),
});

const loginSchema = z.object({
  email: z.string().trim().email("Email invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

export default function AuthPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialTab = params.get("mode") === "signup" ? "signup" : "login";
  const [tab, setTab] = useState(initialTab);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate("/dashboard", { replace: true });
    });
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = loginSchema.safeParse({
      email: fd.get("email"),
      password: fd.get("password"),
    });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0].message);
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Connecté");
    navigate("/dashboard");
  };

  const handleSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = signupSchema.safeParse({
      email: fd.get("email"),
      password: fd.get("password"),
      first_name: fd.get("first_name"),
      last_name: fd.get("last_name"),
      birth_date: fd.get("birth_date"),
      phone: fd.get("phone"),
    });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0].message);
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: {
          first_name: parsed.data.first_name,
          last_name: parsed.data.last_name,
          birth_date: parsed.data.birth_date,
          phone: parsed.data.phone,
        },
      },
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Compte créé !");
    navigate("/dashboard");
  };

  return (
    <main className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md animate-fade-in-up">
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-primary shadow-glow mb-4">
            <Activity className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Bienvenue sur FinisTrackLive</h1>
          <p className="text-muted-foreground">Suivez et soyez suivi en direct</p>
        </div>

        <Card className="glass-card p-6">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="login">Connexion</TabsTrigger>
              <TabsTrigger value="signup">Inscription</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <Label htmlFor="login-email">Email</Label>
                  <Input id="login-email" name="email" type="email" required autoComplete="email" />
                </div>
                <div>
                  <Label htmlFor="login-password">Mot de passe</Label>
                  <Input id="login-password" name="password" type="password" required autoComplete="current-password" />
                </div>
                <Button type="submit" variant="hero" size="lg" className="w-full" disabled={submitting}>
                  {submitting ? "..." : "Se connecter"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="first_name">Prénom</Label>
                    <Input id="first_name" name="first_name" required maxLength={60} />
                  </div>
                  <div>
                    <Label htmlFor="last_name">Nom</Label>
                    <Input id="last_name" name="last_name" required maxLength={60} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="birth_date">Date de naissance</Label>
                  <Input id="birth_date" name="birth_date" type="date" required />
                </div>
                <div>
                  <Label htmlFor="phone">Téléphone</Label>
                  <Input id="phone" name="phone" type="tel" required maxLength={30} />
                </div>
                <div>
                  <Label htmlFor="signup-email">Email</Label>
                  <Input id="signup-email" name="email" type="email" required autoComplete="email" />
                </div>
                <div>
                  <Label htmlFor="signup-password">Mot de passe (8+ caractères)</Label>
                  <Input id="signup-password" name="password" type="password" required minLength={8} autoComplete="new-password" />
                </div>
                <Button type="submit" variant="hero" size="lg" className="w-full" disabled={submitting}>
                  {submitting ? "..." : "Créer mon compte"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </main>
  );
}
