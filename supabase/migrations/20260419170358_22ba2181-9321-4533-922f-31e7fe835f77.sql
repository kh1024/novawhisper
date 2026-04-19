-- Watchlist items table
CREATE TABLE public.watchlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_key text NOT NULL,
  symbol text NOT NULL,
  direction text NOT NULL,
  option_type text NOT NULL,
  strike numeric,
  strike_short numeric,
  expiry date,
  bias text,
  strategy text,
  tier text,
  risk text,
  probability text,
  entry_price numeric,
  premium_estimate text,
  thesis text,
  source text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_signal text,
  last_signal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_watchlist_owner ON public.watchlist_items(owner_key);
CREATE INDEX idx_watchlist_symbol ON public.watchlist_items(symbol);

ALTER TABLE public.watchlist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read watchlist_items" ON public.watchlist_items
  FOR SELECT USING (true);

CREATE POLICY "Public insert watchlist_items" ON public.watchlist_items
  FOR INSERT WITH CHECK (owner_key IS NOT NULL AND length(owner_key) >= 16);

CREATE POLICY "Public update watchlist_items" ON public.watchlist_items
  FOR UPDATE USING (true);

CREATE POLICY "Public delete watchlist_items" ON public.watchlist_items
  FOR DELETE USING (true);

CREATE TRIGGER watchlist_items_touch
  BEFORE UPDATE ON public.watchlist_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Extend verdict_cron_config to also scan watchlist items
ALTER TABLE public.verdict_cron_config
  ADD COLUMN IF NOT EXISTS alert_watchlist boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS alert_on_buy boolean NOT NULL DEFAULT true;

-- Allow alert log to reference watchlist rows (position_id is already nullable; add source value 'watchlist' is just text)
