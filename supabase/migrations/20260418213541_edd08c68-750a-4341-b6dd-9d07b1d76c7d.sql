
CREATE TABLE public.portfolio_positions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_key TEXT NOT NULL,
  symbol TEXT NOT NULL,
  option_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  strike NUMERIC NOT NULL,
  strike_short NUMERIC,
  expiry DATE NOT NULL,
  contracts INTEGER NOT NULL DEFAULT 1,
  entry_premium NUMERIC,
  entry_underlying NUMERIC,
  entry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  thesis TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','expired')),
  close_premium NUMERIC,
  closed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_portfolio_owner ON public.portfolio_positions(owner_key, status);
CREATE INDEX idx_portfolio_symbol ON public.portfolio_positions(symbol);

ALTER TABLE public.portfolio_positions ENABLE ROW LEVEL SECURITY;

-- Owner-key based RLS (no auth — owner_key is a UUID stored in the browser).
CREATE POLICY "Owners can view their positions"
  ON public.portfolio_positions FOR SELECT
  USING (owner_key = current_setting('request.headers', true)::json->>'x-owner-key');

CREATE POLICY "Owners can insert their positions"
  ON public.portfolio_positions FOR INSERT
  WITH CHECK (owner_key = current_setting('request.headers', true)::json->>'x-owner-key');

CREATE POLICY "Owners can update their positions"
  ON public.portfolio_positions FOR UPDATE
  USING (owner_key = current_setting('request.headers', true)::json->>'x-owner-key');

CREATE POLICY "Owners can delete their positions"
  ON public.portfolio_positions FOR DELETE
  USING (owner_key = current_setting('request.headers', true)::json->>'x-owner-key');

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER portfolio_positions_touch
  BEFORE UPDATE ON public.portfolio_positions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
