-- 1) Add trade_stage + last_quote_quality + quote_history to portfolio_positions.
--    quote_history is a rolling list (last ~10 valid evaluations) used by the
--    stop-confirmation rule (≥2 consecutive VALID breaches required).
ALTER TABLE public.portfolio_positions
  ADD COLUMN IF NOT EXISTS trade_stage text NOT NULL DEFAULT 'OPEN_POSITION',
  ADD COLUMN IF NOT EXISTS last_quote_quality text,
  ADD COLUMN IF NOT EXISTS last_valid_mark numeric,
  ADD COLUMN IF NOT EXISTS last_valid_mark_at timestamptz,
  ADD COLUMN IF NOT EXISTS quote_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS stop_confirm_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stop_first_breach_at timestamptz;

-- Constrain trade_stage to known states.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'portfolio_positions_trade_stage_chk'
  ) THEN
    ALTER TABLE public.portfolio_positions
      ADD CONSTRAINT portfolio_positions_trade_stage_chk
      CHECK (trade_stage IN ('ENTRY_CONFIRMED','OPEN_POSITION','EXIT_MANAGEMENT','CLOSED'));
  END IF;
END $$;

-- 2) Decision log — every entry/exit evaluation writes a row. Powers the
--    "Decision Trace" drawer on /portfolio.
CREATE TABLE IF NOT EXISTS public.position_decision_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id uuid NOT NULL REFERENCES public.portfolio_positions(id) ON DELETE CASCADE,
  owner_key text NOT NULL,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  trade_stage text NOT NULL,
  quote_bid numeric,
  quote_ask numeric,
  quote_mark numeric,
  quote_last numeric,
  quote_quality text NOT NULL,
  quote_source text,
  underlying_price numeric,
  used_mark numeric,
  profit_pct numeric,
  recommendation text NOT NULL,
  reason text,
  stop_confirm_count integer,
  decision_path jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS position_decision_log_position_idx
  ON public.position_decision_log (position_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS position_decision_log_owner_idx
  ON public.position_decision_log (owner_key, evaluated_at DESC);

ALTER TABLE public.position_decision_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read position_decision_log" ON public.position_decision_log;
CREATE POLICY "Owners read position_decision_log"
  ON public.position_decision_log
  FOR SELECT TO authenticated
  USING (owner_key = (auth.uid())::text);

-- No client INSERT/UPDATE/DELETE: only the cron (service role) writes here.
