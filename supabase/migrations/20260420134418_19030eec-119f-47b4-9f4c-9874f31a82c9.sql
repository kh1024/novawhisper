-- Add exit-guidance and entry-snapshot fields to portfolio_positions.
ALTER TABLE public.portfolio_positions
  ADD COLUMN IF NOT EXISTS option_symbol text,
  ADD COLUMN IF NOT EXISTS entry_cost_total numeric,
  ADD COLUMN IF NOT EXISTS risk_bucket text,
  ADD COLUMN IF NOT EXISTS entry_thesis text,
  ADD COLUMN IF NOT EXISTS initial_score numeric,
  ADD COLUMN IF NOT EXISTS initial_gates jsonb,
  ADD COLUMN IF NOT EXISTS hard_stop_pct numeric NOT NULL DEFAULT -30,
  ADD COLUMN IF NOT EXISTS target_1_pct numeric NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS target_2_pct numeric NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS max_hold_days integer,
  ADD COLUMN IF NOT EXISTS current_price numeric,
  ADD COLUMN IF NOT EXISTS current_profit_pct numeric,
  ADD COLUMN IF NOT EXISTS exit_recommendation text NOT NULL DEFAULT 'NO_SIGNAL',
  ADD COLUMN IF NOT EXISTS exit_reason text,
  ADD COLUMN IF NOT EXISTS exit_price numeric,
  ADD COLUMN IF NOT EXISTS exit_time timestamptz,
  ADD COLUMN IF NOT EXISTS realized_pnl numeric,
  ADD COLUMN IF NOT EXISTS last_evaluated_at timestamptz;

-- Allow 'cancelled' as a valid status value (status is a text column, no enum).
-- Existing trigger function touch_updated_at already exists; attach it if not present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'portfolio_positions_touch_updated_at'
  ) THEN
    CREATE TRIGGER portfolio_positions_touch_updated_at
      BEFORE UPDATE ON public.portfolio_positions
      FOR EACH ROW
      EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;

-- Helpful indexes for the cron worker (only-open scans) and per-owner queries.
CREATE INDEX IF NOT EXISTS portfolio_positions_owner_status_idx
  ON public.portfolio_positions (owner_key, status);
CREATE INDEX IF NOT EXISTS portfolio_positions_open_eval_idx
  ON public.portfolio_positions (last_evaluated_at)
  WHERE status = 'open';