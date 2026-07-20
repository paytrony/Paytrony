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
      nft_favorites: {
        Row: {
          created_at: string
          purchase_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          purchase_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          purchase_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nft_favorites_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_reads: {
        Row: {
          category: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          category: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          category?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: []
      }
      payment_intents: {
        Row: {
          address: string
          chain: string
          created_at: string
          evm_chain: string | null
          expected_amount: number
          expires_at: string
          from_address: string | null
          id: string
          method: string
          paid_at: string | null
          purchase_id: string | null
          status: Database["public"]["Enums"]["payment_intent_status"]
          stripe_session_id: string | null
          tier: number
          tx_hash: string | null
          user_id: string
        }
        Insert: {
          address: string
          chain?: string
          created_at?: string
          evm_chain?: string | null
          expected_amount: number
          expires_at: string
          from_address?: string | null
          id?: string
          method?: string
          paid_at?: string | null
          purchase_id?: string | null
          status?: Database["public"]["Enums"]["payment_intent_status"]
          stripe_session_id?: string | null
          tier: number
          tx_hash?: string | null
          user_id: string
        }
        Update: {
          address?: string
          chain?: string
          created_at?: string
          evm_chain?: string | null
          expected_amount?: number
          expires_at?: string
          from_address?: string | null
          id?: string
          method?: string
          paid_at?: string | null
          purchase_id?: string | null
          status?: Database["public"]["Enums"]["payment_intent_status"]
          stripe_session_id?: string | null
          tier?: number
          tx_hash?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_intents_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_methods: {
        Row: {
          created_at: string
          details: Json
          id: string
          is_default: boolean
          kind: Database["public"]["Enums"]["payout_method_kind"]
          label: string
          user_id: string
        }
        Insert: {
          created_at?: string
          details?: Json
          id?: string
          is_default?: boolean
          kind: Database["public"]["Enums"]["payout_method_kind"]
          label: string
          user_id: string
        }
        Update: {
          created_at?: string
          details?: Json
          id?: string
          is_default?: boolean
          kind?: Database["public"]["Enums"]["payout_method_kind"]
          label?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          deletion_requested_at: string | null
          display_name: string | null
          email: string
          id: string
          nft_tier: number | null
          referral_code: string
          referred_by: string | null
        }
        Insert: {
          created_at?: string
          deletion_requested_at?: string | null
          display_name?: string | null
          email: string
          id: string
          nft_tier?: number | null
          referral_code: string
          referred_by?: string | null
        }
        Update: {
          created_at?: string
          deletion_requested_at?: string | null
          display_name?: string | null
          email?: string
          id?: string
          nft_tier?: number | null
          referral_code?: string
          referred_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          amount: number
          created_at: string
          id: string
          idempotency_key: string | null
          nft_tier: number
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          idempotency_key?: string | null
          nft_tier: number
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          idempotency_key?: string | null
          nft_tier?: number
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount: number
          created_at: string
          id: string
          note: string | null
          related_purchase_id: string | null
          related_withdrawal_id: string | null
          type: Database["public"]["Enums"]["txn_type"]
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          note?: string | null
          related_purchase_id?: string | null
          related_withdrawal_id?: string | null
          type: Database["public"]["Enums"]["txn_type"]
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          note?: string | null
          related_purchase_id?: string | null
          related_withdrawal_id?: string | null
          type?: Database["public"]["Enums"]["txn_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_related_purchase_id_fkey"
            columns: ["related_purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawal_limits: {
        Row: {
          cooldown_minutes: number
          daily_cap: number
          id: boolean
          min_amount: number
          updated_at: string
        }
        Insert: {
          cooldown_minutes?: number
          daily_cap?: number
          id?: boolean
          min_amount?: number
          updated_at?: string
        }
        Update: {
          cooldown_minutes?: number
          daily_cap?: number
          id?: boolean
          min_amount?: number
          updated_at?: string
        }
        Relationships: []
      }
      withdrawals: {
        Row: {
          admin_note: string | null
          amount: number
          created_at: string
          id: string
          idempotency_key: string | null
          payout_note: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["withdrawal_status"]
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          amount: number
          created_at?: string
          id?: string
          idempotency_key?: string | null
          payout_note?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["withdrawal_status"]
          user_id: string
        }
        Update: {
          admin_note?: string | null
          amount?: number
          created_at?: string
          id?: string
          idempotency_key?: string | null
          payout_note?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["withdrawal_status"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_expire_intent: { Args: { _intent_id: string }; Returns: undefined }
      admin_mark_intent_paid: {
        Args: { _intent_id: string; _tx_hash?: string }
        Returns: Json
      }
      gen_referral_code: { Args: never; Returns: string }
      get_referred_users: {
        Args: never
        Returns: {
          created_at: string
          id: string
          nft_tier: number
          referral_code: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      mark_notifications_read: {
        Args: { _category: string }
        Returns: undefined
      }
      purchase_package: {
        Args: { _amount: number; _idempotency_key?: string; _user_id: string }
        Returns: Json
      }
      request_account_deletion: {
        Args: { _user_id: string }
        Returns: undefined
      }
      request_withdrawal: {
        Args: {
          _amount: number
          _idempotency_key?: string
          _note: string
          _payout_method_id?: string
          _user_id: string
        }
        Returns: string
      }
      resolve_withdrawal: {
        Args: {
          _admin_id: string
          _admin_note: string
          _approve: boolean
          _withdrawal_id: string
        }
        Returns: undefined
      }
      test_e2e_flow: { Args: never; Returns: string }
      test_evm_webhook_flow: { Args: never; Returns: string }
    }
    Enums: {
      app_role: "admin" | "user"
      payment_intent_status:
        | "pending"
        | "paid"
        | "expired"
        | "cancelled"
        | "failed"
      payout_method_kind:
        | "bank"
        | "upi"
        | "crypto"
        | "paypal"
        | "binance"
        | "bybit"
        | "wallet_address"
      txn_type: "referral_credit" | "withdrawal"
      withdrawal_status: "pending" | "approved" | "rejected"
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
      app_role: ["admin", "user"],
      payment_intent_status: [
        "pending",
        "paid",
        "expired",
        "cancelled",
        "failed",
      ],
      payout_method_kind: [
        "bank",
        "upi",
        "crypto",
        "paypal",
        "binance",
        "bybit",
        "wallet_address",
      ],
      txn_type: ["referral_credit", "withdrawal"],
      withdrawal_status: ["pending", "approved", "rejected"],
    },
  },
} as const
