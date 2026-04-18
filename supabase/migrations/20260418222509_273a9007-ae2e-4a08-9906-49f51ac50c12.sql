-- ─── Verdict cron: server-side state for background alerts ───────────────────

-- 1. Single-row config table (webhook URL, on/off, alert-on-WAIT, owner_key).
CREATE TABLE public.verdict_cron_config (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_key text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  webhook_url text,
  alert_on_wait boolean NOT NULL DEFAULT false,
  last_run_at timestamptz,
  last_run_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.verdict_cron_config ENABLE ROW LEVEL SECURITY;

-- Public access by owner_key (matches existing portfolio_positions pattern in this app).
CREATE POLICY "Public read verdict_cron_config" ON public.verdict_cron_config
  FOR SELECT USING (true);
CREATE POLICY "Public insert verdict_cron_config" ON public.verdict_cron_config
  FOR INSERT WITH CHECK (owner_key IS NOT NULL AND length(owner_key) >= 16);
CREATE POLICY "Public update verdict_cron_config" ON public.verdict_cron_config
  FOR UPDATE USING (true);
CREATE POLICY "Public delete verdict_cron_config" ON public.verdict_cron_config
  FOR DELETE USING (true);

CREATE TRIGGER touch_verdict_cron_config_updated_at
  BEFORE UPDATE ON public.verdict_cron_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. Per-position last-known signal (replaces localStorage on the cron path).
CREATE TABLE public.verdict_alert_state (
  position_id uuid NOT NULL PRIMARY KEY,
  owner_key text NOT NULL,
  symbol text NOT NULL,
  last_signal text NOT NULL,
  last_changed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_verdict_alert_state_owner ON public.verdict_alert_state(owner_key);

ALTER TABLE public.verdict_alert_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read verdict_alert_state" ON public.verdict_alert_state
  FOR SELECT USING (true);
CREATE POLICY "Public insert verdict_alert_state" ON public.verdict_alert_state
  FOR INSERT WITH CHECK (owner_key IS NOT NULL AND length(owner_key) >= 16);
CREATE POLICY "Public update verdict_alert_state" ON public.verdict_alert_state
  FOR UPDATE USING (true);
CREATE POLICY "Public delete verdict_alert_state" ON public.verdict_alert_state
  FOR DELETE USING (true);

-- 3. Append-only log of cron-fired alerts (visible in Settings).
CREATE TABLE public.verdict_alert_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_key text NOT NULL,
  position_id uuid,
  symbol text NOT NULL,
  from_signal text NOT NULL,
  to_signal text NOT NULL,
  ok boolean NOT NULL,
  error text,
  source text NOT NULL DEFAULT 'cron',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_verdict_alert_log_owner_at ON public.verdict_alert_log(owner_key, created_at DESC);

ALTER TABLE public.verdict_alert_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read verdict_alert_log" ON public.verdict_alert_log
  FOR SELECT USING (true);
CREATE POLICY "Public insert verdict_alert_log" ON public.verdict_alert_log
  FOR INSERT WITH CHECK (owner_key IS NOT NULL AND length(owner_key) >= 16);
CREATE POLICY "Public delete verdict_alert_log" ON public.verdict_alert_log
  FOR DELETE USING (true);

-- 4. Enable cron + http extensions for the schedule.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;