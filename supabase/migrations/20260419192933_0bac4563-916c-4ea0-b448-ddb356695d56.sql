-- Drop old permissive policies (USING true) on user-owned tables and replace
-- with strict per-user rules keyed off auth.uid()::text == owner_key.

-- ─── watchlist_items ────────────────────────────────────────────────
drop policy if exists "Public read watchlist_items" on public.watchlist_items;
drop policy if exists "Public insert watchlist_items" on public.watchlist_items;
drop policy if exists "Public update watchlist_items" on public.watchlist_items;
drop policy if exists "Public delete watchlist_items" on public.watchlist_items;

create policy "Owners read watchlist_items"
  on public.watchlist_items for select to authenticated
  using (owner_key = auth.uid()::text);
create policy "Owners insert watchlist_items"
  on public.watchlist_items for insert to authenticated
  with check (owner_key = auth.uid()::text);
create policy "Owners update watchlist_items"
  on public.watchlist_items for update to authenticated
  using (owner_key = auth.uid()::text)
  with check (owner_key = auth.uid()::text);
create policy "Owners delete watchlist_items"
  on public.watchlist_items for delete to authenticated
  using (owner_key = auth.uid()::text);

-- ─── portfolio_positions ────────────────────────────────────────────
drop policy if exists "Public read by owner_key" on public.portfolio_positions;
drop policy if exists "Public insert" on public.portfolio_positions;
drop policy if exists "Public update" on public.portfolio_positions;
drop policy if exists "Public delete" on public.portfolio_positions;

create policy "Owners read portfolio_positions"
  on public.portfolio_positions for select to authenticated
  using (owner_key = auth.uid()::text);
create policy "Owners insert portfolio_positions"
  on public.portfolio_positions for insert to authenticated
  with check (owner_key = auth.uid()::text);
create policy "Owners update portfolio_positions"
  on public.portfolio_positions for update to authenticated
  using (owner_key = auth.uid()::text)
  with check (owner_key = auth.uid()::text);
create policy "Owners delete portfolio_positions"
  on public.portfolio_positions for delete to authenticated
  using (owner_key = auth.uid()::text);

-- ─── verdict_alert_state ────────────────────────────────────────────
drop policy if exists "Public read verdict_alert_state" on public.verdict_alert_state;
drop policy if exists "Public insert verdict_alert_state" on public.verdict_alert_state;
drop policy if exists "Public update verdict_alert_state" on public.verdict_alert_state;
drop policy if exists "Public delete verdict_alert_state" on public.verdict_alert_state;

create policy "Owners read verdict_alert_state"
  on public.verdict_alert_state for select to authenticated
  using (owner_key = auth.uid()::text);
create policy "Owners insert verdict_alert_state"
  on public.verdict_alert_state for insert to authenticated
  with check (owner_key = auth.uid()::text);
create policy "Owners update verdict_alert_state"
  on public.verdict_alert_state for update to authenticated
  using (owner_key = auth.uid()::text)
  with check (owner_key = auth.uid()::text);
create policy "Owners delete verdict_alert_state"
  on public.verdict_alert_state for delete to authenticated
  using (owner_key = auth.uid()::text);

-- ─── verdict_cron_config ────────────────────────────────────────────
drop policy if exists "Public read verdict_cron_config" on public.verdict_cron_config;
drop policy if exists "Public insert verdict_cron_config" on public.verdict_cron_config;
drop policy if exists "Public update verdict_cron_config" on public.verdict_cron_config;
drop policy if exists "Public delete verdict_cron_config" on public.verdict_cron_config;

create policy "Owners read verdict_cron_config"
  on public.verdict_cron_config for select to authenticated
  using (owner_key = auth.uid()::text);
create policy "Owners insert verdict_cron_config"
  on public.verdict_cron_config for insert to authenticated
  with check (owner_key = auth.uid()::text);
create policy "Owners update verdict_cron_config"
  on public.verdict_cron_config for update to authenticated
  using (owner_key = auth.uid()::text)
  with check (owner_key = auth.uid()::text);
create policy "Owners delete verdict_cron_config"
  on public.verdict_cron_config for delete to authenticated
  using (owner_key = auth.uid()::text);

-- ─── verdict_alert_log ──────────────────────────────────────────────
drop policy if exists "Public read verdict_alert_log" on public.verdict_alert_log;
drop policy if exists "Public insert verdict_alert_log" on public.verdict_alert_log;
drop policy if exists "Public delete verdict_alert_log" on public.verdict_alert_log;

create policy "Owners read verdict_alert_log"
  on public.verdict_alert_log for select to authenticated
  using (owner_key = auth.uid()::text);
create policy "Owners insert verdict_alert_log"
  on public.verdict_alert_log for insert to authenticated
  with check (owner_key = auth.uid()::text);
create policy "Owners delete verdict_alert_log"
  on public.verdict_alert_log for delete to authenticated
  using (owner_key = auth.uid()::text);

-- ─── Auto-claim helper ──────────────────────────────────────────────
-- Allows a logged-in user to re-key any row that still carries their
-- pre-auth device owner_key over to their auth.uid(). Security definer
-- so it bypasses RLS, but only operates on rows whose owner_key matches
-- the supplied old_owner_key — caller proves possession by passing the
-- key from their localStorage. We also require the key be at least 16
-- chars (matches the prior insert policy) to prevent trivial guessing.
create or replace function public.claim_owner_rows(old_owner_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid_text text := auth.uid()::text;
  wl_count int := 0;
  pp_count int := 0;
  vas_count int := 0;
  vcc_count int := 0;
  val_count int := 0;
begin
  if uid_text is null then
    raise exception 'must be authenticated';
  end if;
  if old_owner_key is null or length(old_owner_key) < 16 then
    return jsonb_build_object('claimed', false, 'reason', 'invalid_old_owner_key');
  end if;
  if old_owner_key = uid_text then
    return jsonb_build_object('claimed', false, 'reason', 'already_owned');
  end if;

  update public.watchlist_items set owner_key = uid_text
   where owner_key = old_owner_key;
  get diagnostics wl_count = row_count;

  update public.portfolio_positions set owner_key = uid_text
   where owner_key = old_owner_key;
  get diagnostics pp_count = row_count;

  update public.verdict_alert_state set owner_key = uid_text
   where owner_key = old_owner_key;
  get diagnostics vas_count = row_count;

  update public.verdict_cron_config set owner_key = uid_text
   where owner_key = old_owner_key;
  get diagnostics vcc_count = row_count;

  update public.verdict_alert_log set owner_key = uid_text
   where owner_key = old_owner_key;
  get diagnostics val_count = row_count;

  return jsonb_build_object(
    'claimed', true,
    'watchlist', wl_count,
    'portfolio', pp_count,
    'verdict_state', vas_count,
    'verdict_config', vcc_count,
    'verdict_log', val_count
  );
end;
$$;

revoke all on function public.claim_owner_rows(text) from public;
grant execute on function public.claim_owner_rows(text) to authenticated;