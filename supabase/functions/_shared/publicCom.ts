// Shared Public.com brokerage API auth helper.
//
// Public's flow per https://public.com/api/docs/quickstart:
//   1. PUBLIC_COM_API_KEY (long-lived secret from /settings/v2/api)
//   2. → POST /userapiauthservice/personal/access-tokens → short-lived bearer
//   3. GET /userapigateway/trading/account → first accountId
//   4. Use { accessToken, accountId } for all subsequent calls.
//
// State is kept module-level (warm-instance cache) — same lifetime as a single
// edge function instance. The ~50 min token refresh window means typical
// traffic only mints once per instance lifetime.
export const PUBLIC_BASE = "https://api.public.com";
const TOKEN_TTL_MIN = 60;
const REFRESH_BEFORE_MS = 10 * 60 * 1000;

let cachedToken: { value: string; expiresAt: number } | null = null;
let cachedAccountId: string | null = null;

async function mintToken(secret: string): Promise<string> {
  const r = await fetch(`${PUBLIC_BASE}/userapiauthservice/personal/access-tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "nova-options" },
    body: JSON.stringify({ validityInMinutes: TOKEN_TTL_MIN, secret }),
  });
  if (!r.ok) throw new Error(`Public.com auth ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json() as { accessToken?: string };
  if (!j.accessToken) throw new Error("Public.com auth: missing accessToken in response");
  cachedToken = { value: j.accessToken, expiresAt: Date.now() + TOKEN_TTL_MIN * 60_000 - REFRESH_BEFORE_MS };
  return j.accessToken;
}

export async function getPublicToken(): Promise<string> {
  const secret = Deno.env.get("PUBLIC_COM_API_KEY");
  if (!secret) throw new Error("PUBLIC_COM_API_KEY is not configured");
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;
  return mintToken(secret);
}

export async function getPublicAccountId(token: string): Promise<string> {
  if (cachedAccountId) return cachedAccountId;
  const url = `${PUBLIC_BASE}/userapigateway/trading/account`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "nova-options",
    },
  });
  // 404 here usually means the API agreement hasn't been accepted on the
  // Public.com account, the secret is for a different env, or the trading
  // entitlement isn't on. Surface the body so the user can act on it.
  if (!r.ok) {
    const body = (await r.text()).slice(0, 400);
    throw new Error(`Public.com accounts ${r.status} (GET ${url}): ${body || "(empty body — verify API access is enabled at public.com/settings/v2/api)"}`);
  }
  const j = await r.json() as { accounts?: { accountId: string; accountType?: string }[] };
  // Prefer a regular brokerage account; fall back to whatever's first.
  const id = j.accounts?.find((a) => a.accountType === "BROKERAGE")?.accountId ?? j.accounts?.[0]?.accountId;
  if (!id) throw new Error("Public.com accounts: response had no accounts");
  cachedAccountId = id;
  return id;
}

export const PUBLIC_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
