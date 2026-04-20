CREATE TABLE public.strategy_profiles (
  owner_key text PRIMARY KEY,
  profile jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.strategy_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read strategy_profiles" ON public.strategy_profiles
  FOR SELECT USING (true);

CREATE POLICY "Public insert strategy_profiles" ON public.strategy_profiles
  FOR INSERT WITH CHECK (owner_key IS NOT NULL AND length(owner_key) >= 16);

CREATE POLICY "Public update strategy_profiles" ON public.strategy_profiles
  FOR UPDATE USING (true) WITH CHECK (owner_key IS NOT NULL AND length(owner_key) >= 16);

CREATE TRIGGER strategy_profiles_touch_updated_at
  BEFORE UPDATE ON public.strategy_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();