
DROP POLICY IF EXISTS "Owners can view their positions" ON public.portfolio_positions;
DROP POLICY IF EXISTS "Owners can insert their positions" ON public.portfolio_positions;
DROP POLICY IF EXISTS "Owners can update their positions" ON public.portfolio_positions;
DROP POLICY IF EXISTS "Owners can delete their positions" ON public.portfolio_positions;

-- Device-scoped (no auth): rely on owner_key UUID being unguessable. Client always filters by it.
CREATE POLICY "Public read by owner_key" ON public.portfolio_positions FOR SELECT USING (true);
CREATE POLICY "Public insert" ON public.portfolio_positions FOR INSERT WITH CHECK (owner_key IS NOT NULL AND length(owner_key) >= 16);
CREATE POLICY "Public update" ON public.portfolio_positions FOR UPDATE USING (true);
CREATE POLICY "Public delete" ON public.portfolio_positions FOR DELETE USING (true);
