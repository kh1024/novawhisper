-- iv_history: daily ATM implied-volatility snapshots per symbol.
-- Idempotent: safe to re-run. Drops the prior public read policy so only
-- service_role (and the postgres owner) can read/write.

CREATE TABLE IF NOT EXISTS public.iv_history (
  id          bigserial PRIMARY KEY,
  symbol      text        NOT NULL,
  as_of       date        NOT NULL,
  iv          numeric     NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT iv_history_symbol_as_of_key UNIQUE (symbol, as_of)
);

CREATE INDEX IF NOT EXISTS iv_history_symbol_as_of_idx
  ON public.iv_history (symbol, as_of DESC);

ALTER TABLE public.iv_history ENABLE ROW LEVEL SECURITY;

-- Remove any previously-created public policies; service_role bypasses RLS.
DROP POLICY IF EXISTS iv_history_public_read ON public.iv_history;
DROP POLICY IF EXISTS "iv_history are publicly readable" ON public.iv_history;