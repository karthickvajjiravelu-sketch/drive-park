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
          created_at: string
          id: string
          name: string
          phone: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          phone?: string
          role?: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          phone?: string
          role?: Database["public"]["Enums"]["user_role"]
          user_id?: string
        }
        Relationships: []
      }
      reservations: {
        Row: {
          created_at: string
          driver_id: string
          end_time: string
          id: string
          rate_type: Database["public"]["Enums"]["rate_type"]
          slot_id: string
          start_time: string
          status: Database["public"]["Enums"]["reservation_status"]
          total_price: number
        }
        Insert: {
          created_at?: string
          driver_id: string
          end_time: string
          id?: string
          rate_type?: Database["public"]["Enums"]["rate_type"]
          slot_id: string
          start_time: string
          status?: Database["public"]["Enums"]["reservation_status"]
          total_price?: number
        }
        Update: {
          created_at?: string
          driver_id?: string
          end_time?: string
          id?: string
          rate_type?: Database["public"]["Enums"]["rate_type"]
          slot_id?: string
          start_time?: string
          status?: Database["public"]["Enums"]["reservation_status"]
          total_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "reservations_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          comment: string
          created_at: string
          driver_id: string
          id: string
          rating: number
          slot_id: string
        }
        Insert: {
          comment?: string
          created_at?: string
          driver_id: string
          id?: string
          rating: number
          slot_id: string
        }
        Update: {
          comment?: string
          created_at?: string
          driver_id?: string
          id?: string
          rating?: number
          slot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
      slot_notify: {
        Row: {
          created_at: string
          driver_id: string
          id: string
          slot_id: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          id?: string
          slot_id: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          id?: string
          slot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "slot_notify_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
      slots: {
        Row: {
          access_instructions: string
          approx_area: string
          cancellation_policy: string
          cctv: boolean
          covered: boolean
          created_at: string
          daily_rate: number
          disabled_access: boolean
          full_address: string
          height_limit_cm: number | null
          hourly_rate: number
          id: string
          lat: number
          lng: number
          monthly_rate: number
          name: string
          owner_id: string
          photos: string[]
          rating: number
          status: Database["public"]["Enums"]["slot_status"]
          vehicle_size_limit: string
          vehicle_type: Database["public"]["Enums"]["vehicle_type"]
          width_limit_cm: number | null
        }
        Insert: {
          access_instructions?: string
          approx_area: string
          cancellation_policy?: string
          cctv?: boolean
          covered?: boolean
          created_at?: string
          daily_rate?: number
          disabled_access?: boolean
          full_address: string
          height_limit_cm?: number | null
          hourly_rate?: number
          id?: string
          lat: number
          lng: number
          monthly_rate?: number
          name: string
          owner_id: string
          photos?: string[]
          rating?: number
          status?: Database["public"]["Enums"]["slot_status"]
          vehicle_size_limit?: string
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"]
          width_limit_cm?: number | null
        }
        Update: {
          access_instructions?: string
          approx_area?: string
          cancellation_policy?: string
          cctv?: boolean
          covered?: boolean
          created_at?: string
          daily_rate?: number
          disabled_access?: boolean
          full_address?: string
          height_limit_cm?: number | null
          hourly_rate?: number
          id?: string
          lat?: number
          lng?: number
          monthly_rate?: number
          name?: string
          owner_id?: string
          photos?: string[]
          rating?: number
          status?: Database["public"]["Enums"]["slot_status"]
          vehicle_size_limit?: string
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"]
          width_limit_cm?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      rate_type: "hourly" | "daily" | "monthly"
      reservation_status: "upcoming" | "active" | "completed" | "cancelled"
      slot_status: "open" | "full"
      user_role: "driver" | "landowner"
      vehicle_type: "car" | "bike" | "both"
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
      rate_type: ["hourly", "daily", "monthly"],
      reservation_status: ["upcoming", "active", "completed", "cancelled"],
      slot_status: ["open", "full"],
      user_role: ["driver", "landowner"],
      vehicle_type: ["car", "bike", "both"],
    },
  },
} as const
