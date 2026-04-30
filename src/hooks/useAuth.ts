import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

export type AppRole = "organizer" | "runner" | "admin";

export interface AuthState {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  loading: boolean;
}

export function useAuth(): AuthState & {
  isOrganizer: boolean;
  isRunner: boolean;
  isAdmin: boolean;
  signOut: () => Promise<void>;
} {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    roles: [],
    loading: true,
  });

  useEffect(() => {
    let active = true;

    const loadRoles = async (userId: string): Promise<AppRole[]> => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      return (data ?? []).map((r) => r.role as AppRole);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setState((s) => ({ ...s, user: session?.user ?? null, session }));
      if (session?.user) {
        // defer role fetch
        setTimeout(async () => {
          const roles = await loadRoles(session.user.id);
          if (active) setState((s) => ({ ...s, roles, loading: false }));
        }, 0);
      } else {
        setState((s) => ({ ...s, roles: [], loading: false }));
      }
    });

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!active) return;
      setState((s) => ({ ...s, user: session?.user ?? null, session }));
      if (session?.user) {
        const roles = await loadRoles(session.user.id);
        if (active) setState((s) => ({ ...s, roles, loading: false }));
      } else {
        setState((s) => ({ ...s, loading: false }));
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return {
    ...state,
    isOrganizer: state.roles.includes("organizer"),
    isRunner: state.roles.includes("runner"),
    isAdmin: state.roles.includes("admin"),
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };
}
