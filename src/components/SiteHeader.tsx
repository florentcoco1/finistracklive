import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { LogOut, Menu } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import logo from "@/assets/logo.png";

export function SiteHeader() {
  const { user, isOrganizer, isAdmin, signOut, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const links = [
    { to: "/events", label: "Épreuves" },
    { to: "/races", label: "Courses" },
    ...(user ? [{ to: "/results", label: "Résultats" }] : []),
    ...(user && !isOrganizer ? [{ to: "/dashboard", label: "Mon espace" }] : []),
    ...(isOrganizer ? [{ to: "/dashboard", label: "Administration" }] : []),
    ...(isOrganizer || isAdmin ? [{ to: "/organizer/live", label: "Suivi live" }] : []),
    ...(isOrganizer || isAdmin ? [{ to: "/organizer/manual-timing", label: "Chrono manuel" }] : []),
    ...(isOrganizer ? [{ to: "/organizer/new-event", label: "Créer une épreuve" }] : []),
    ...(isAdmin ? [{ to: "/admin", label: "Admin global" }] : []),
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="container flex h-20 items-center justify-between gap-4 font-medium text-xl">
        <Link to="/" className="flex items-center gap-3 font-display font-bold text-xl" aria-label="FinisTrackLive — accueil">
          <img src={logo} alt="Logo FinisTrackLive" className="h-14 w-14 object-contain" />
          <span className="text-gradient hidden sm:inline">FinisTrackLive</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={cn(
                "px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                location.pathname === l.to
                  ? "text-foreground bg-secondary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-2">
          {!loading && (user ? (
            <Button variant="ghost" size="sm" onClick={async () => { await signOut(); navigate("/"); }}>
              <LogOut className="h-4 w-4 mr-2" /> Déconnexion
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => navigate("/auth")}>Connexion</Button>
              <Button variant="hero" size="sm" onClick={() => navigate("/auth?mode=signup")}>S'inscrire</Button>
            </>
          ))}
        </div>

        <button
          className="md:hidden p-2 text-foreground"
          onClick={() => setOpen((v) => !v)}
          aria-label="Menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-border/60 bg-background/95 backdrop-blur-xl">
          <div className="container py-3 flex flex-col gap-1">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className="px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary"
              >
                {l.label}
              </Link>
            ))}
            <div className="pt-2 border-t border-border/60 mt-2 flex gap-2">
              {!loading && (user ? (
                <Button variant="ghost" className="flex-1" onClick={async () => { await signOut(); setOpen(false); navigate("/"); }}>
                  Déconnexion
                </Button>
              ) : (
                <>
                  <Button variant="ghost" className="flex-1" onClick={() => { setOpen(false); navigate("/auth"); }}>Connexion</Button>
                  <Button variant="hero" className="flex-1" onClick={() => { setOpen(false); navigate("/auth?mode=signup"); }}>S'inscrire</Button>
                </>
              ))}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
