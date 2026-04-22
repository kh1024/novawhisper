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
      iv_history: {
        Row: {
          as_of: string
          created_at: string
          id: number
          iv: number
          symbol: string
        }
        Insert: {
          as_of: string
          created_at?: string
          id?: number
          iv: number
          symbol: string
        }
        Update: {
          as_of?: string
          created_at?: string
          id?: number
          iv?: number
          symbol?: string
        }
        Relationships: []
      }
      kv_cache: {
        Row: {
          created_at: string
          expires_at: string | null
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      learning_weights: {
        Row: {
          avg_return: number | null
          hit_rate: number | null
          id: string
          label: string
          multiplier: number
          rationale: string | null
          sample_size: number
          updated_at: string
        }
        Insert: {
          avg_return?: number | null
          hit_rate?: number | null
          id?: string
          label: string
          multiplier?: number
          rationale?: string | null
          sample_size?: number
          updated_at?: string
        }
        Update: {
          avg_return?: number | null
          hit_rate?: number | null
          id?: string
          label?: string
          multiplier?: number
          rationale?: string | null
          sample_size?: number
          updated_at?: string
        }
        Relationships: []
      }
      pick_outcomes: {
        Row: {
          evaluated_at: string
          exit_price: number
          id: string
          is_win: boolean
          return_pct: number
          snapshot_id: string
          window_days: number
        }
        Insert: {
          evaluated_at?: string
          exit_price: number
          id?: string
          is_win: boolean
          return_pct: number
          snapshot_id: string
          window_days: number
        }
        Update: {
          evaluated_at?: string
          exit_price?: number
          id?: string
          is_win?: boolean
          return_pct?: number
          snapshot_id?: string
          window_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "pick_outcomes_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "pick_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      pick_snapshots: {
        Row: {
          atr_pct: number | null
          bias: string
          created_at: string
          entry_price: number
          final_rank: number
          id: string
          iv_rank: number | null
          label: string
          options_score: number
          readiness_score: number
          rel_volume: number | null
          setup_score: number
          snapshot_date: string
          symbol: string
        }
        Insert: {
          atr_pct?: number | null
          bias: string
          created_at?: string
          entry_price: number
          final_rank: number
          id?: string
          iv_rank?: number | null
          label: string
          options_score: number
          readiness_score: number
          rel_volume?: number | null
          setup_score: number
          snapshot_date?: string
          symbol: string
        }
        Update: {
          atr_pct?: number | null
          bias?: string
          created_at?: string
          entry_price?: number
          final_rank?: number
          id?: string
          iv_rank?: number | null
          label?: string
          options_score?: number
          readiness_score?: number
          rel_volume?: number | null
          setup_score?: number
          snapshot_date?: string
          symbol?: string
        }
        Relationships: []
      }
      portfolio_positions: {
        Row: {
          close_premium: number | null
          closed_at: string | null
          contracts: number
          created_at: string
          current_price: number | null
          current_profit_pct: number | null
          direction: string
          entry_at: string
          entry_cost_total: number | null
          entry_premium: number | null
          entry_thesis: string | null
          entry_underlying: number | null
          exit_price: number | null
          exit_reason: string | null
          exit_recommendation: string
          exit_time: string | null
          expiry: string
          hard_stop_pct: number
          id: string
          initial_gates: Json | null
          initial_score: number | null
          is_paper: boolean
          last_evaluated_at: string | null
          last_quote_quality: string | null
          last_valid_mark: number | null
          last_valid_mark_at: string | null
          max_hold_days: number | null
          notes: string | null
          option_symbol: string | null
          option_type: string
          owner_key: string
          quote_history: Json
          realized_pnl: number | null
          risk_bucket: string | null
          source: string | null
          status: string
          stop_confirm_count: number
          stop_first_breach_at: string | null
          strike: number
          strike_short: number | null
          symbol: string
          target_1_pct: number
          target_2_pct: number
          thesis: string | null
          trade_stage: string
          updated_at: string
        }
        Insert: {
          close_premium?: number | null
          closed_at?: string | null
          contracts?: number
          created_at?: string
          current_price?: number | null
          current_profit_pct?: number | null
          direction: string
          entry_at?: string
          entry_cost_total?: number | null
          entry_premium?: number | null
          entry_thesis?: string | null
          entry_underlying?: number | null
          exit_price?: number | null
          exit_reason?: string | null
          exit_recommendation?: string
          exit_time?: string | null
          expiry: string
          hard_stop_pct?: number
          id?: string
          initial_gates?: Json | null
          initial_score?: number | null
          is_paper?: boolean
          last_evaluated_at?: string | null
          last_quote_quality?: string | null
          last_valid_mark?: number | null
          last_valid_mark_at?: string | null
          max_hold_days?: number | null
          notes?: string | null
          option_symbol?: string | null
          option_type: string
          owner_key: string
          quote_history?: Json
          realized_pnl?: number | null
          risk_bucket?: string | null
          source?: string | null
          status?: string
          stop_confirm_count?: number
          stop_first_breach_at?: string | null
          strike: number
          strike_short?: number | null
          symbol: string
          target_1_pct?: number
          target_2_pct?: number
          thesis?: string | null
          trade_stage?: string
          updated_at?: string
        }
        Update: {
          close_premium?: number | null
          closed_at?: string | null
          contracts?: number
          created_at?: string
          current_price?: number | null
          current_profit_pct?: number | null
          direction?: string
          entry_at?: string
          entry_cost_total?: number | null
          entry_premium?: number | null
          entry_thesis?: string | null
          entry_underlying?: number | null
          exit_price?: number | null
          exit_reason?: string | null
          exit_recommendation?: string
          exit_time?: string | null
          expiry?: string
          hard_stop_pct?: number
          id?: string
          initial_gates?: Json | null
          initial_score?: number | null
          is_paper?: boolean
          last_evaluated_at?: string | null
          last_quote_quality?: string | null
          last_valid_mark?: number | null
          last_valid_mark_at?: string | null
          max_hold_days?: number | null
          notes?: string | null
          option_symbol?: string | null
          option_type?: string
          owner_key?: string
          quote_history?: Json
          realized_pnl?: number | null
          risk_bucket?: string | null
          source?: string | null
          status?: string
          stop_confirm_count?: number
          stop_first_breach_at?: string | null
          strike?: number
          strike_short?: number | null
          symbol?: string
          target_1_pct?: number
          target_2_pct?: number
          thesis?: string | null
          trade_stage?: string
          updated_at?: string
        }
        Relationships: []
      }
      position_decision_log: {
        Row: {
          decision_path: Json
          evaluated_at: string
          id: string
          owner_key: string
          position_id: string
          profit_pct: number | null
          quote_ask: number | null
          quote_bid: number | null
          quote_last: number | null
          quote_mark: number | null
          quote_quality: string
          quote_source: string | null
          reason: string | null
          recommendation: string
          stop_confirm_count: number | null
          trade_stage: string
          underlying_price: number | null
          used_mark: number | null
        }
        Insert: {
          decision_path?: Json
          evaluated_at?: string
          id?: string
          owner_key: string
          position_id: string
          profit_pct?: number | null
          quote_ask?: number | null
          quote_bid?: number | null
          quote_last?: number | null
          quote_mark?: number | null
          quote_quality: string
          quote_source?: string | null
          reason?: string | null
          recommendation: string
          stop_confirm_count?: number | null
          trade_stage: string
          underlying_price?: number | null
          used_mark?: number | null
        }
        Update: {
          decision_path?: Json
          evaluated_at?: string
          id?: string
          owner_key?: string
          position_id?: string
          profit_pct?: number | null
          quote_ask?: number | null
          quote_bid?: number | null
          quote_last?: number | null
          quote_mark?: number | null
          quote_quality?: string
          quote_source?: string | null
          reason?: string | null
          recommendation?: string
          stop_confirm_count?: number | null
          trade_stage?: string
          underlying_price?: number | null
          used_mark?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "position_decision_log_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "portfolio_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_audit_log: {
        Row: {
          adjusted_score: number | null
          block_reasons: string[] | null
          budget_fit_label: string | null
          contract_symbol: string
          estimated_fill_cost: number | null
          human_summary: string | null
          id: string
          liquidity_score: number | null
          live_underlying_age_sec: number | null
          live_underlying_price: number | null
          live_underlying_source: string | null
          live_underlying_status: string | null
          option_age_sec: number | null
          option_ask: number | null
          option_bid: number | null
          option_delta: number | null
          option_iv: number | null
          option_last: number | null
          option_mid: number | null
          option_open_interest: number | null
          option_source: string | null
          option_spread_pct: number | null
          option_status: string | null
          option_volume: number | null
          provider_conflict_pct: number | null
          quote_confidence_label: string | null
          quote_confidence_score: number | null
          quote_penalty_applied: number | null
          required_recalc: boolean | null
          scan_run_id: string
          scanned_at: string
          score_before_penalty: number | null
          snapshot_score: number | null
          snapshot_underlying_price: number | null
          symbol: string
          tier_assigned: string | null
          underlying_move_pct: number | null
          user_budget_cap: number | null
          warn_reasons: string[] | null
        }
        Insert: {
          adjusted_score?: number | null
          block_reasons?: string[] | null
          budget_fit_label?: string | null
          contract_symbol: string
          estimated_fill_cost?: number | null
          human_summary?: string | null
          id?: string
          liquidity_score?: number | null
          live_underlying_age_sec?: number | null
          live_underlying_price?: number | null
          live_underlying_source?: string | null
          live_underlying_status?: string | null
          option_age_sec?: number | null
          option_ask?: number | null
          option_bid?: number | null
          option_delta?: number | null
          option_iv?: number | null
          option_last?: number | null
          option_mid?: number | null
          option_open_interest?: number | null
          option_source?: string | null
          option_spread_pct?: number | null
          option_status?: string | null
          option_volume?: number | null
          provider_conflict_pct?: number | null
          quote_confidence_label?: string | null
          quote_confidence_score?: number | null
          quote_penalty_applied?: number | null
          required_recalc?: boolean | null
          scan_run_id: string
          scanned_at?: string
          score_before_penalty?: number | null
          snapshot_score?: number | null
          snapshot_underlying_price?: number | null
          symbol: string
          tier_assigned?: string | null
          underlying_move_pct?: number | null
          user_budget_cap?: number | null
          warn_reasons?: string[] | null
        }
        Update: {
          adjusted_score?: number | null
          block_reasons?: string[] | null
          budget_fit_label?: string | null
          contract_symbol?: string
          estimated_fill_cost?: number | null
          human_summary?: string | null
          id?: string
          liquidity_score?: number | null
          live_underlying_age_sec?: number | null
          live_underlying_price?: number | null
          live_underlying_source?: string | null
          live_underlying_status?: string | null
          option_age_sec?: number | null
          option_ask?: number | null
          option_bid?: number | null
          option_delta?: number | null
          option_iv?: number | null
          option_last?: number | null
          option_mid?: number | null
          option_open_interest?: number | null
          option_source?: string | null
          option_spread_pct?: number | null
          option_status?: string | null
          option_volume?: number | null
          provider_conflict_pct?: number | null
          quote_confidence_label?: string | null
          quote_confidence_score?: number | null
          quote_penalty_applied?: number | null
          required_recalc?: boolean | null
          scan_run_id?: string
          scanned_at?: string
          score_before_penalty?: number | null
          snapshot_score?: number | null
          snapshot_underlying_price?: number | null
          symbol?: string
          tier_assigned?: string | null
          underlying_move_pct?: number | null
          user_budget_cap?: number | null
          warn_reasons?: string[] | null
        }
        Relationships: []
      }
      strategy_profiles: {
        Row: {
          owner_key: string
          profile: Json
          updated_at: string
        }
        Insert: {
          owner_key: string
          profile: Json
          updated_at?: string
        }
        Update: {
          owner_key?: string
          profile?: Json
          updated_at?: string
        }
        Relationships: []
      }
      verdict_alert_log: {
        Row: {
          created_at: string
          error: string | null
          from_signal: string
          id: string
          ok: boolean
          owner_key: string
          position_id: string | null
          source: string
          symbol: string
          to_signal: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          from_signal: string
          id?: string
          ok: boolean
          owner_key: string
          position_id?: string | null
          source?: string
          symbol: string
          to_signal: string
        }
        Update: {
          created_at?: string
          error?: string | null
          from_signal?: string
          id?: string
          ok?: boolean
          owner_key?: string
          position_id?: string | null
          source?: string
          symbol?: string
          to_signal?: string
        }
        Relationships: []
      }
      verdict_alert_state: {
        Row: {
          last_changed_at: string
          last_signal: string
          owner_key: string
          position_id: string
          symbol: string
          updated_at: string
        }
        Insert: {
          last_changed_at?: string
          last_signal: string
          owner_key: string
          position_id: string
          symbol: string
          updated_at?: string
        }
        Update: {
          last_changed_at?: string
          last_signal?: string
          owner_key?: string
          position_id?: string
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      verdict_cron_config: {
        Row: {
          alert_on_buy: boolean
          alert_on_wait: boolean
          alert_watchlist: boolean
          created_at: string
          enabled: boolean
          id: string
          last_run_at: string | null
          last_run_status: string | null
          owner_key: string
          updated_at: string
          webhook_url: string | null
        }
        Insert: {
          alert_on_buy?: boolean
          alert_on_wait?: boolean
          alert_watchlist?: boolean
          created_at?: string
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          last_run_status?: string | null
          owner_key: string
          updated_at?: string
          webhook_url?: string | null
        }
        Update: {
          alert_on_buy?: boolean
          alert_on_wait?: boolean
          alert_watchlist?: boolean
          created_at?: string
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          last_run_status?: string | null
          owner_key?: string
          updated_at?: string
          webhook_url?: string | null
        }
        Relationships: []
      }
      watchlist_items: {
        Row: {
          bias: string | null
          created_at: string
          direction: string
          entry_price: number | null
          expiry: string | null
          id: string
          last_signal: string | null
          last_signal_at: string | null
          meta: Json
          option_type: string
          owner_key: string
          premium_estimate: string | null
          probability: string | null
          risk: string | null
          source: string | null
          strategy: string | null
          strike: number | null
          strike_short: number | null
          symbol: string
          thesis: string | null
          tier: string | null
          updated_at: string
        }
        Insert: {
          bias?: string | null
          created_at?: string
          direction: string
          entry_price?: number | null
          expiry?: string | null
          id?: string
          last_signal?: string | null
          last_signal_at?: string | null
          meta?: Json
          option_type: string
          owner_key: string
          premium_estimate?: string | null
          probability?: string | null
          risk?: string | null
          source?: string | null
          strategy?: string | null
          strike?: number | null
          strike_short?: number | null
          symbol: string
          thesis?: string | null
          tier?: string | null
          updated_at?: string
        }
        Update: {
          bias?: string | null
          created_at?: string
          direction?: string
          entry_price?: number | null
          expiry?: string | null
          id?: string
          last_signal?: string | null
          last_signal_at?: string | null
          meta?: Json
          option_type?: string
          owner_key?: string
          premium_estimate?: string | null
          probability?: string | null
          risk?: string | null
          source?: string | null
          strategy?: string | null
          strike?: number | null
          strike_short?: number | null
          symbol?: string
          thesis?: string | null
          tier?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      web_picks: {
        Row: {
          bias: string | null
          created_at: string
          current_price: number | null
          direction: string
          entry_price: number | null
          evaluated_at: string | null
          expected_return: string | null
          expiry: string
          grade: string | null
          grade_rationale: string | null
          id: string
          option_type: string
          outcome: string | null
          play_at: number
          pnl_pct: number | null
          premium_estimate: string | null
          probability: string | null
          risk: string
          risk_level: string | null
          run_id: string
          source: string
          strategy: string
          strike: number
          strike_short: number | null
          symbol: string
          thesis: string
          tier: string
        }
        Insert: {
          bias?: string | null
          created_at?: string
          current_price?: number | null
          direction: string
          entry_price?: number | null
          evaluated_at?: string | null
          expected_return?: string | null
          expiry: string
          grade?: string | null
          grade_rationale?: string | null
          id?: string
          option_type: string
          outcome?: string | null
          play_at: number
          pnl_pct?: number | null
          premium_estimate?: string | null
          probability?: string | null
          risk: string
          risk_level?: string | null
          run_id: string
          source: string
          strategy: string
          strike: number
          strike_short?: number | null
          symbol: string
          thesis: string
          tier: string
        }
        Update: {
          bias?: string | null
          created_at?: string
          current_price?: number | null
          direction?: string
          entry_price?: number | null
          evaluated_at?: string | null
          expected_return?: string | null
          expiry?: string
          grade?: string | null
          grade_rationale?: string | null
          id?: string
          option_type?: string
          outcome?: string | null
          play_at?: number
          pnl_pct?: number | null
          premium_estimate?: string | null
          probability?: string | null
          risk?: string
          risk_level?: string | null
          run_id?: string
          source?: string
          strategy?: string
          strike?: number
          strike_short?: number | null
          symbol?: string
          thesis?: string
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "web_picks_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "web_picks_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      web_picks_runs: {
        Row: {
          created_at: string
          fetched_at: string
          id: string
          market_read: string | null
          pick_count: number
          source_count: number
          sources: Json
        }
        Insert: {
          created_at?: string
          fetched_at?: string
          id?: string
          market_read?: string | null
          pick_count?: number
          source_count?: number
          sources?: Json
        }
        Update: {
          created_at?: string
          fetched_at?: string
          id?: string
          market_read?: string | null
          pick_count?: number
          source_count?: number
          sources?: Json
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_owner_rows: { Args: { old_owner_key: string }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
