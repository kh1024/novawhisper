CREATE TABLE IF NOT EXISTS public.kv_cache (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.kv_cache ENABLE ROW LEVEL SECURITY;

-- No public policies: only service_role (which bypasses RLS) can read/write.

CREATE TRIGGER kv_cache_touch_updated_at
BEFORE UPDATE ON public.kv_cache
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS kv_cache_expires_at_idx ON public.kv_cache (expires_at);