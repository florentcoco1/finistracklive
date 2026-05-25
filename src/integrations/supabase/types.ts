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
      events: {
        Row: {
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          description: string | null
          end_date: string | null
          facebook_url: string | null
          id: string
          instagram_url: string | null
          location: string | null
          name: string
          organizer_id: string
          poster_url: string | null
          start_date: string | null
          twitter_url: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          facebook_url?: string | null
          id?: string
          instagram_url?: string | null
          location?: string | null
          name: string
          organizer_id: string
          poster_url?: string | null
          start_date?: string | null
          twitter_url?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          facebook_url?: string | null
          id?: string
          instagram_url?: string | null
          location?: string | null
          name?: string
          organizer_id?: string
          poster_url?: string | null
          start_date?: string | null
          twitter_url?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: []
      }
      gmcap_import_sources: {
        Row: {
          created_at: string
          enabled: boolean
          file_name: string | null
          id: string
          last_import_at: string | null
          last_import_message: string | null
          last_import_status: string | null
          pending_content: string | null
          pending_import_at: string | null
          race_id: string
          schema_checked_at: string | null
          source_type: string
          source_url: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          file_name?: string | null
          id?: string
          last_import_at?: string | null
          last_import_message?: string | null
          last_import_status?: string | null
          pending_content?: string | null
          pending_import_at?: string | null
          race_id: string
          schema_checked_at?: string | null
          source_type?: string
          source_url?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          file_name?: string | null
          id?: string
          last_import_at?: string | null
          last_import_message?: string | null
          last_import_status?: string | null
          pending_content?: string | null
          pending_import_at?: string | null
          race_id?: string
          schema_checked_at?: string | null
          source_type?: string
          source_url?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gmcap_import_sources_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: true
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      gmcap_results: {
        Row: {
          bib_number: string
          birth_date: string | null
          category: string | null
          category_rank: number | null
          club: string | null
          created_at: string
          first_name: string | null
          gender: string | null
          gender_rank: number | null
          id: string
          imported_at: string
          last_name: string | null
          official_time_seconds: number | null
          official_time_text: string | null
          race_id: string
          scratch_rank: number | null
          split_payload: Json | null
          status: string | null
          updated_at: string
        }
        Insert: {
          bib_number: string
          birth_date?: string | null
          category?: string | null
          category_rank?: number | null
          club?: string | null
          created_at?: string
          first_name?: string | null
          gender?: string | null
          gender_rank?: number | null
          id?: string
          imported_at?: string
          last_name?: string | null
          official_time_seconds?: number | null
          official_time_text?: string | null
          race_id: string
          scratch_rank?: number | null
          split_payload?: Json | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          bib_number?: string
          birth_date?: string | null
          category?: string | null
          category_rank?: number | null
          club?: string | null
          created_at?: string
          first_name?: string | null
          gender?: string | null
          gender_rank?: number | null
          id?: string
          imported_at?: string
          last_name?: string | null
          official_time_seconds?: number | null
          official_time_text?: string | null
          race_id?: string
          scratch_rank?: number | null
          split_payload?: Json | null
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gmcap_results_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
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
      race_checkpoints: {
        Row: {
          created_at: string
          detector_id: number | null
          distance_km: number | null
          id: string
          live_video_url: string | null
          name: string
          position: number
          race_id: string
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          detector_id?: number | null
          distance_km?: number | null
          id?: string
          live_video_url?: string | null
          name: string
          position?: number
          race_id: string
          source?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          detector_id?: number | null
          distance_km?: number | null
          id?: string
          live_video_url?: string | null
          name?: string
          position?: number
          race_id?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_checkpoints_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_registrations: {
        Row: {
          bib_number: string
          category: string | null
          created_at: string
          dnf_reason: string | null
          emergency_phone: string | null
          finished_at: string | null
          id: string
          problem_description: string | null
          race_id: string
          runner_id: string
          runner_status: Database["public"]["Enums"]["runner_status"]
          started_at: string | null
          tracking_active: boolean
          updated_at: string
        }
        Insert: {
          bib_number: string
          category?: string | null
          created_at?: string
          dnf_reason?: string | null
          emergency_phone?: string | null
          finished_at?: string | null
          id?: string
          problem_description?: string | null
          race_id: string
          runner_id: string
          runner_status?: Database["public"]["Enums"]["runner_status"]
          started_at?: string | null
          tracking_active?: boolean
          updated_at?: string
        }
        Update: {
          bib_number?: string
          category?: string | null
          created_at?: string
          dnf_reason?: string | null
          emergency_phone?: string | null
          finished_at?: string | null
          id?: string
          problem_description?: string | null
          race_id?: string
          runner_id?: string
          runner_status?: Database["public"]["Enums"]["runner_status"]
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
          event_id: string | null
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
          event_id?: string | null
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
          event_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "races_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      runner_checkpoint_times: {
        Row: {
          checkpoint_id: string
          created_at: string
          id: string
          recorded_at: string
          registration_id: string
          time_seconds: number | null
          time_text: string | null
          updated_at: string
        }
        Insert: {
          checkpoint_id: string
          created_at?: string
          id?: string
          recorded_at?: string
          registration_id: string
          time_seconds?: number | null
          time_text?: string | null
          updated_at?: string
        }
        Update: {
          checkpoint_id?: string
          created_at?: string
          id?: string
          recorded_at?: string
          registration_id?: string
          time_seconds?: number | null
          time_text?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "runner_checkpoint_times_checkpoint_id_fkey"
            columns: ["checkpoint_id"]
            isOneToOne: false
            referencedRelation: "race_checkpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runner_checkpoint_times_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "live_leaderboard"
            referencedColumns: ["registration_id"]
          },
          {
            foreignKeyName: "runner_checkpoint_times_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "race_registrations"
            referencedColumns: ["id"]
          },
        ]
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
          dnf_reason: string | null
          emergency_phone: string | null
          finished_at: string | null
          first_name: string | null
          last_name: string | null
          last_position_at: string | null
          latitude: number | null
          longitude: number | null
          problem_description: string | null
          progress_percent: number | null
          race_id: string | null
          registration_id: string | null
          rolling_pace_sec_per_km: number | null
          rolling_speed_kmh: number | null
          runner_id: string | null
          runner_status: Database["public"]["Enums"]["runner_status"] | null
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
      app_role: "organizer" | "runner" | "admin"
      race_status: "upcoming" | "live" | "finished"
      runner_status: "running" | "dnf" | "problem"
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
      app_role: ["organizer", "runner", "admin"],
      race_status: ["upcoming", "live", "finished"],
      runner_status: ["running", "dnf", "problem"],
    },
  },
} as const
