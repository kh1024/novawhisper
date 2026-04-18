
-- Web Picks history: one row per scout run, many rows per pick
CREATE TABLE public.web_picks_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  market_read TEXT,
  source_count INTEGER NOT NULL DEFAULT 0,
  pick_count INTEGER NOT NULL DEFAULT 0,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.web_picks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.web_picks_runs(id) ON DELETE CASCADE,
  tier TEXT NOT NULL CHECK (tier IN ('safe','mild','aggressive')),
  symbol TEXT NOT NULL,
  strategy TEXT NOT NULL,
  option_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  strike NUMERIC NOT NULL,
  strike_short NUMERIC,
  expiry DATE NOT NULL,
  play_at NUMERIC NOT NULL,
  premium_estimate TEXT,
  thesis TEXT NOT NULL,
  risk TEXT NOT NULL,
  source TEXT NOT NULL,
  -- performance tracking (filled in later by a separate job)
  entry_price NUMERIC,
  current_price NUMERIC,
  pnl_pct NUMERIC,
  outcome TEXT CHECK (outcome IN ('open','win','loss','expired','cancelled')),
  evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_web_picks_run ON public.web_picks(run_id);
CREATE INDEX idx_web_picks_symbol ON public.web_picks(symbol);
CREATE INDEX idx_web_picks_runs_fetched ON public.web_picks_runs(fetched_at DESC);

ALTER TABLE public.web_picks_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_picks ENABLE ROW LEVEL SECURITY;

-- These are public research outputs (no per-user data) — anyone can read.
CREATE POLICY "Web picks runs are public" ON public.web_picks_runs FOR SELECT USING (true);
CREATE POLICY "Web picks are public" ON public.web_picks FOR SELECT USING (true);
-- No insert/update/delete policies — only the edge function with the service role key can write.
