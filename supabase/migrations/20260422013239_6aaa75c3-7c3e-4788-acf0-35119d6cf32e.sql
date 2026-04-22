CREATE TABLE IF NOT EXISTS public.quote_audit_log (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_run_id                uuid NOT NULL,
  symbol                     text NOT NULL,
  contract_symbol            text NOT NULL,

  snapshot_underlying_price  numeric,
  snapshot_score             integer,

  live_underlying_price      numeric,
  live_underlying_source     text,
  live_underlying_age_sec    numeric,
  live_underlying_status     text,

  option_bid                 numeric,
  option_ask                 numeric,
  option_mid                 numeric,
  option_last                numeric,
  option_spread_pct          numeric,
  option_iv                  numeric,
  option_delta               numeric,
  option_volume              integer,
  option_open_interest       integer,
  option_source              text,
  option_age_sec             numeric,
  option_status              text,

  quote_confidence_score     integer,
  quote_confidence_label     text,
  liquidity_score            integer,
  provider_conflict_pct      numeric,
  underlying_move_pct        numeric,
  required_recalc            boolean,

  score_before_penalty       integer,
  quote_penalty_applied      integer,
  adjusted_score             integer,
  tier_assigned              text,
  block_reasons              text[],
  warn_reasons               text[],
  human_summary              text,

  user_budget_cap            numeric,
  estimated_fill_cost        numeric,
  budget_fit_label           text,

  scanned_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quote_audit_symbol      ON public.quote_audit_log(symbol);
CREATE INDEX IF NOT EXISTS idx_quote_audit_scan_run_id ON public.quote_audit_log(scan_run_id);
CREATE INDEX IF NOT EXISTS idx_quote_audit_scanned_at  ON public.quote_audit_log(scanned_at);

ALTER TABLE public.quote_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Quote audit log is publicly readable"
  ON public.quote_audit_log
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert quote audit log rows"
  ON public.quote_audit_log
  FOR INSERT
  WITH CHECK (true);