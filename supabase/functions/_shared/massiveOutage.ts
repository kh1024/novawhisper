// Shared Massive-outage kill-switch.
// Stored in kv_cache under key "massive:outage". When set, all Massive callers
// short-circuit (return null/empty) so we don't hammer a downed API. The
// hourly massive-ping function clears the flag when /v1/marketstatus/now
// responds 2xx — the existing 75 req/s throttle handles the ramp-up.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const KEY = "massive:outage";

interface OutageRow { down: boolean; reason?: string; since?: string }

let memo: { row: OutageRow; at: number } | null = null;
const MEMO_TTL_MS = 30_000; // re-check kv at most every 30s per warm instance

async function kvFetch(): Promise<OutageRow> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return { down: false };
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/kv_cache?key=eq.${encodeURIComponent(KEY)}&select=value`,
      { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
    );
    if (!r.ok) return { down: false };
    const rows = await r.json() as Array<{ value: OutageRow }>;
    return rows[0]?.value ?? { down: false };
  } catch { return { down: false }; }
}

async function kvWrite(row: OutageRow): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/kv_cache?on_conflict=key`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({ key: KEY, value: row }),
    });
  } catch { /* ignore */ }
}

/** True when Massive is currently flagged offline. Cached 30s per instance. */
export async function isMassiveDown(): Promise<boolean> {
  if (memo && Date.now() - memo.at < MEMO_TTL_MS) return memo.row.down;
  const row = await kvFetch();
  memo = { row, at: Date.now() };
  return row.down;
}

/** Flag Massive offline (called when a Massive call returns 5xx). */
export async function markMassiveDown(reason: string): Promise<void> {
  const row: OutageRow = { down: true, reason, since: new Date().toISOString() };
  memo = { row, at: Date.now() };
  await kvWrite(row);
}

/** Clear the offline flag — called by hourly massive-ping when API recovers. */
export async function markMassiveUp(): Promise<void> {
  const row: OutageRow = { down: false };
  memo = { row, at: Date.now() };
  await kvWrite(row);
}

/** Helper: classify a fetch Response as a Massive outage (5xx or network err). */
export function isOutageStatus(status: number): boolean {
  return status >= 500 && status < 600;
}
