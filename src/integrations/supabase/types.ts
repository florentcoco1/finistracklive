export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      profiles: {
        Row: {
          birth_date: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          birth_date?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          birth_date?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      race_registrations: {
        Row: {
          bib_number: string
          category: string | null
          created_at: string
          finished_at: string | null
          id: string
          race_id: string
          runner_id: string
          started_at: string | null
          tracking_active: boolean
          updated_at: string
        }
        Insert: {
          bib_number: string
          category?: string | null
          created_at?: string
          finished_at?: string | null
          id?: string
          race_id: string
          runner_id: string
          started_at?: string | null
          tracking_active?: boolean
          updated_at?: string
        }
        Update: {
          bib_number?: string
          category?: string | null
          created_at?: string
          finished_at?: string | null
          id?: string
          race_id?: string
          runner_id?: string
          started_at?: string | null
          tracking_active?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_registrations_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      races: {
        Row: {
          created_at: string
          description: string | null
          distance_km: number | null
          gpx_geojson: Json | null
          gpx_url: string | null
          id: string
          name: string
          organizer_id: string
          route_points: Json | null
          start_time: string
          status: Database["public"]["Enums"]["race_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          distance_km?: number | null
          gpx_geojson?: Json | null
          gpx_url?: string | null
          id?: string
          name: string
          organizer_id: string
          route_points?: Json | null
          start_time: string
          status?: Database["public"]["Enums"]["race_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          distance_km?: number | null
          gpx_geojson?: Json | null
          gpx_url?: string | null
          id?: string
          name?: string
          organizer_id?: string
          route_points?: Json | null
          start_time?: string
          status?: Database["public"]["Enums"]["race_status"]
          updated_at?: string
        }
        Relationships: []
      }
      runner_positions: {
        Row: {
          accuracy: number | null
          distance_along_route_m: number | null
          id: string
          latitude: number
          longitude: number
          progress_percent: number | null
          recorded_at: string
          registration_id: string
          rolling_pace_sec_per_km: number | null
          rolling_speed_kmh: number | null
          speed: number | null
        }
        Insert: {
          accuracy?: number | null
          distance_along_route_m?: number | null
          id?: string
          latitude: number
          longitude: number
          progress_percent?: number | null
          recorded_at?: string
          registration_id: string
          rolling_pace_sec_per_km?: number | null
          rolling_speed_kmh?: number | null
          speed?: number | null
        }
        Update: {
          accuracy?: number | null
          distance_along_route_m?: number | null
          id?: string
          latitude?: number
          longitude?: number
          progress_percent?: number | null
          recorded_at?: string
          registration_id?: string
          rolling_pace_sec_per_km?: number | null
          rolling_speed_kmh?: number | null
          speed?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "runner_positions_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "live_leaderboard"
            referencedColumns: ["registration_id"]
          },
          {
            foreignKeyName: "runner_positions_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "race_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      live_leaderboard: {
        Row: {
          bib_number: string | null
          category: string | null
          distance_along_route_m: number | null
          finished_at: string | null
          first_name: string | null
          last_name: string | null
          last_position_at: string | null
          latitude: number | null
          longitude: number | null
          progress_percent: number | null
          race_id: string | null
          registration_id: string | null
          rolling_pace_sec_per_km: number | null
          rolling_speed_kmh: number | null
          runner_id: string | null
          started_at: string | null
          tracking_active: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "race_registrations_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "organizer" | "runner"
      race_status: "upcoming" | "live" | "finished"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["organizer", "runner"],
      race_status: ["upcoming", "live", "finished"],
    },
  },
} as const
