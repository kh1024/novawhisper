ALTER TABLE public.portfolio_positions
ADD COLUMN IF NOT EXISTS is_paper boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_portfolio_positions_owner_paper
ON public.portfolio_positions (owner_key, is_paper);