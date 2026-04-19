ALTER TABLE public.web_picks
  ADD COLUMN IF NOT EXISTS bias text,
  ADD COLUMN IF NOT EXISTS expected_return text,
  ADD COLUMN IF NOT EXISTS probability text,
  ADD COLUMN IF NOT EXISTS risk_level text,
  ADD COLUMN IF NOT EXISTS grade text,
  ADD COLUMN IF NOT EXISTS grade_rationale text;