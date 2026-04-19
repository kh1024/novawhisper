// Owner-key resolution. Pre-auth, every device generated a random UUID stored
// in localStorage and used it as `owner_key` on watchlist / portfolio rows.
// Now that accounts exist, the rule is:
//
//   • Logged in  → owner_key === auth.uid()
//   • Logged out → no owner_key (UI must require sign-in to read/write)
//
// We still keep the legacy device key around so we can call claim_owner_rows()
// once on first sign-in to migrate any orphaned anon data into the account.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const LEGACY_DEVICE_KEY = "nova.portfolio.owner";
const CLAIM_SENTINEL_PREFIX = "nova.owner.claimed_for:"; // + user.id

/** Legacy device-scoped owner key, if one was ever generated on this browser. */
export function getLegacyDeviceOwnerKey(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(LEGACY_DEVICE_KEY);
  } catch {
    return null;
  }
}

/**
 * Returns the owner_key to use for queries/inserts. `null` when logged out —
 * callers MUST handle this (e.g. by requiring auth before rendering the page).
 */
export function useOwnerKey(): string | null {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    const apply = (uid: string | null | undefined) => setKey(uid ?? null);
    supabase.auth.getSession().then(({ data }) => apply(data.session?.user?.id));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => apply(s?.user?.id));
    return () => sub.subscription.unsubscribe();
  }, []);
  return key;
}

/**
 * Synchronous fallback for legacy callers that read the key during render.
 * Returns auth.uid() if a session is currently cached in localStorage by
 * supabase-js, otherwise null. Prefer useOwnerKey() in new code.
 */
export function getOwnerKeySync(): string | null {
  try {
    // supabase-js v2 stores session under sb-<ref>-auth-token. Cheaper than
    // calling getSession() (which is async) for hot paths.
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith("sb-") || !k.endsWith("-auth-token")) continue;
      const raw = window.localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const uid = parsed?.user?.id ?? parsed?.currentSession?.user?.id;
      if (typeof uid === "string" && uid.length > 0) return uid;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Run once per (device, account) pair after sign-in. Re-keys any rows that
 * still carry the legacy anonymous device key over to the user's account so
 * existing watchlist/portfolio data isn't orphaned.
 */
export async function claimLegacyRowsOnce(userId: string): Promise<void> {
  const legacy = getLegacyDeviceOwnerKey();
  if (!legacy || legacy === userId) return;
  const sentinel = CLAIM_SENTINEL_PREFIX + userId;
  if (window.localStorage.getItem(sentinel)) return;
  try {
    await supabase.rpc("claim_owner_rows" as never, { old_owner_key: legacy } as never);
  } catch {
    // Best effort — don't block the UI if the RPC fails.
  } finally {
    window.localStorage.setItem(sentinel, new Date().toISOString());
  }
}
