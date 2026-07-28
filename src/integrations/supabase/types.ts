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
      favorites: {
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
            foreignKeyName: "favorites_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          created_at: string
          id: string
          read: boolean
          recipient_id: string
          reservation_id: string
          sender_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          read?: boolean
          recipient_id: string
          reservation_id: string
          sender_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          read?: boolean
          recipient_id?: string
          reservation_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read?: boolean
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      parking_lots: {
        Row: {
          created_at: string
          id: string
          lat: number
          lng: number
          name: string
          occupied_slots: number
          owner_id: string
          tier: Database["public"]["Enums"]["lot_tier"]
          total_slots: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          lat: number
          lng: number
          name: string
          occupied_slots?: number
          owner_id: string
          tier?: Database["public"]["Enums"]["lot_tier"]
          total_slots?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          lat?: number
          lng?: number
          name?: string
          occupied_slots?: number
          owner_id?: string
          tier?: Database["public"]["Enums"]["lot_tier"]
          total_slots?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          name: string
          phone: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
          verification_note: string | null
          verification_status: Database["public"]["Enums"]["verification_status"]
          verified: boolean
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          phone?: string
          role?: Database["public"]["Enums"]["user_role"]
          user_id: string
          verification_note?: string | null
          verification_status?: Database["public"]["Enums"]["verification_status"]
          verified?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          phone?: string
          role?: Database["public"]["Enums"]["user_role"]
          user_id?: string
          verification_note?: string | null
          verification_status?: Database["public"]["Enums"]["verification_status"]
          verified?: boolean
        }
        Relationships: []
      }
      public_holidays: {
        Row: {
          created_at: string
          date: string
          id: string
          name: string
          year: number
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          name: string
          year: number
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          name?: string
          year?: number
        }
        Relationships: []
      }
      reservations: {
        Row: {
          base_rate: number | null
          created_at: string
          driver_id: string
          end_time: string
          final_price_per_hour: number | null
          grand_total: number | null
          gst_amount: number | null
          id: string
          price_breakdown: Json | null
          rate_type: Database["public"]["Enums"]["rate_type"]
          slot_id: string
          start_time: string
          status: Database["public"]["Enums"]["reservation_status"]
          subtotal_amount: number | null
          total_price: number
          vehicle_id: string | null
          vehicle_plate: string | null
        }
        Insert: {
          base_rate?: number | null
          created_at?: string
          driver_id: string
          end_time: string
          final_price_per_hour?: number | null
          grand_total?: number | null
          gst_amount?: number | null
          id?: string
          price_breakdown?: Json | null
          rate_type?: Database["public"]["Enums"]["rate_type"]
          slot_id: string
          start_time: string
          status?: Database["public"]["Enums"]["reservation_status"]
          subtotal_amount?: number | null
          total_price?: number
          vehicle_id?: string | null
          vehicle_plate?: string | null
        }
        Update: {
          base_rate?: number | null
          created_at?: string
          driver_id?: string
          end_time?: string
          final_price_per_hour?: number | null
          grand_total?: number | null
          gst_amount?: number | null
          id?: string
          price_breakdown?: Json | null
          rate_type?: Database["public"]["Enums"]["rate_type"]
          slot_id?: string
          start_time?: string
          status?: Database["public"]["Enums"]["reservation_status"]
          subtotal_amount?: number | null
          total_price?: number
          vehicle_id?: string | null
          vehicle_plate?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
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
          reservation_id: string | null
          slot_id: string
        }
        Insert: {
          comment?: string
          created_at?: string
          driver_id: string
          id?: string
          rating: number
          reservation_id?: string | null
          slot_id: string
        }
        Update: {
          comment?: string
          created_at?: string
          driver_id?: string
          id?: string
          rating?: number
          reservation_id?: string | null
          slot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
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
          archived: boolean
          base_rate: number
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
          is_available: boolean
          lat: number
          lng: number
          lot_id: string | null
          monthly_rate: number
          name: string
          owner_id: string
          photos: string[]
          rating: number
          slot_type: Database["public"]["Enums"]["slot_type"]
          status: Database["public"]["Enums"]["slot_status"]
          vehicle_size_limit: string
          vehicle_type: Database["public"]["Enums"]["vehicle_type"]
          width_limit_cm: number | null
        }
        Insert: {
          access_instructions?: string
          approx_area: string
          archived?: boolean
          base_rate?: number
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
          is_available?: boolean
          lat: number
          lng: number
          lot_id?: string | null
          monthly_rate?: number
          name: string
          owner_id: string
          photos?: string[]
          rating?: number
          slot_type?: Database["public"]["Enums"]["slot_type"]
          status?: Database["public"]["Enums"]["slot_status"]
          vehicle_size_limit?: string
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"]
          width_limit_cm?: number | null
        }
        Update: {
          access_instructions?: string
          approx_area?: string
          archived?: boolean
          base_rate?: number
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
          is_available?: boolean
          lat?: number
          lng?: number
          lot_id?: string | null
          monthly_rate?: number
          name?: string
          owner_id?: string
          photos?: string[]
          rating?: number
          slot_type?: Database["public"]["Enums"]["slot_type"]
          status?: Database["public"]["Enums"]["slot_status"]
          vehicle_size_limit?: string
          vehicle_type?: Database["public"]["Enums"]["vehicle_type"]
          width_limit_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "slots_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "parking_lots"
            referencedColumns: ["id"]
          },
        ]
      }
      support_requests: {
        Row: {
          created_at: string
          id: string
          message: string
          status: string
          subject: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          status?: string
          subject: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          status?: string
          subject?: string
          user_id?: string
        }
        Relationships: []
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
      vehicles: {
        Row: {
          colour: string | null
          created_at: string
          id: string
          is_default: boolean
          make: string | null
          plate: string
          user_id: string
        }
        Insert: {
          colour?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          make?: string | null
          plate: string
          user_id: string
        }
        Update: {
          colour?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          make?: string | null
          plate?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
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
      app_role: "admin" | "moderator" | "user"
      lot_tier: "T1" | "T2" | "T3" | "T4"
      rate_type: "hourly" | "daily" | "monthly"
      reservation_status: "upcoming" | "active" | "completed" | "cancelled"
      slot_status: "open" | "full"
      slot_type:
        | "standard_car"
        | "compact_car"
        | "suv"
        | "two_wheeler"
        | "ev"
        | "premium_covered"
        | "valet_handicapped"
      user_role: "driver" | "landowner"
      vehicle_type: "car" | "bike" | "both"
      verification_status: "unverified" | "pending" | "approved" | "rejected"
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
      app_role: ["admin", "moderator", "user"],
      lot_tier: ["T1", "T2", "T3", "T4"],
      rate_type: ["hourly", "daily", "monthly"],
      reservation_status: ["upcoming", "active", "completed", "cancelled"],
      slot_status: ["open", "full"],
      slot_type: [
        "standard_car",
        "compact_car",
        "suv",
        "two_wheeler",
        "ev",
        "premium_covered",
        "valet_handicapped",
      ],
      user_role: ["driver", "landowner"],
      vehicle_type: ["car", "bike", "both"],
      verification_status: ["unverified", "pending", "approved", "rejected"],
    },
  },
} as const
