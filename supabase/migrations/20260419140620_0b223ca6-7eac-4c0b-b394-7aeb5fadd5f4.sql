-- Daily snapshot of every Scanner verdict
CREATE TABLE public.pick_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  symbol TEXT NOT NULL,
  label TEXT NOT NULL, -- BUY | WATCHLIST | WAIT | DON'T BUY
  final_rank INTEGER NOT NULL,
  setup_score INTEGER NOT NULL,
  readiness_score INTEGER NOT NULL,
  options_score INTEGER NOT NULL,
  bias TEXT NOT NULL,
  entry_price NUMERIC NOT NULL,
  iv_rank NUMERIC,
  rel_volume NUMERIC,
  atr_pct NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, symbol)
);

CREATE INDEX idx_pick_snapshots_date ON public.pick_snapshots (snapshot_date DESC);
CREATE INDEX idx_pick_snapshots_label ON public.pick_snapshots (label);
CREATE INDEX idx_pick_snapshots_symbol ON public.pick_snapshots (symbol);

ALTER TABLE public.pick_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Snapshots are publicly readable"
  ON public.pick_snapshots FOR SELECT
  USING (true);

-- Realized outcomes evaluated at 1d / 5d / 20d windows
CREATE TABLE public.pick_outcomes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_id UUID NOT NULL REFERENCES public.pick_snapshots(id) ON DELETE CASCADE,
  window_days INTEGER NOT NULL, -- 1, 5, or 20
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  exit_price NUMERIC NOT NULL,
  return_pct NUMERIC NOT NULL,
  is_win BOOLEAN NOT NULL,
  UNIQUE (snapshot_id, window_days)
);

CREATE INDEX idx_pick_outcomes_snapshot ON public.pick_outcomes (snapshot_id);
CREATE INDEX idx_pick_outcomes_window ON public.pick_outcomes (window_days);

ALTER TABLE public.pick_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Outcomes are publicly readable"
  ON public.pick_outcomes FOR SELECT
  USING (true);

-- Per-label score multipliers the ranker uses for self-tuning
CREATE TABLE public.learning_weights (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  label TEXT NOT NULL UNIQUE, -- BUY | WATCHLIST | WAIT | DON'T BUY
  multiplier NUMERIC NOT NULL DEFAULT 1.0 CHECK (multiplier BETWEEN 0.85 AND 1.15),
  sample_size INTEGER NOT NULL DEFAULT 0,
  hit_rate NUMERIC,            -- 0..1
  avg_return NUMERIC,          -- pct
  rationale TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.learning_weights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Learning weights are publicly readable"
  ON public.learning_weights FOR SELECT
  USING (true);

-- Seed the four labels with neutral multipliers so the ranker always has a row to read
INSERT INTO public.learning_weights (label, multiplier, rationale) VALUES
  ('BUY', 1.0, 'Initialized — no outcome data yet'),
  ('WATCHLIST', 1.0, 'Initialized — no outcome data yet'),
  ('WAIT', 1.0, 'Initialized — no outcome data yet'),
  ('DON''T BUY', 1.0, 'Initialized — no outcome data yet');

-- Touch updated_at on learning_weights changes
CREATE TRIGGER touch_learning_weights_updated_at
  BEFORE UPDATE ON public.learning_weights
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();