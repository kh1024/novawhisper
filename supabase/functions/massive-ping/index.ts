// Hourly Massive ping — checks if Massive is back online and clears the
// outage kill-switch when it is. Uses /v1/marketstatus/now which is a
// lightweight no-symbol endpoint (counts as 1 quota call, OK for hourly).
import { markMassiveDown, markMassiveUp, isOutageStatus } from "../_shared/massiveOutage.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const key = Deno.env.get("MASSIVE_API_KEY");
  if (!key) {
    return new Response(JSON.stringify({ ok: false, error: "MASSIVE_API_KEY missing" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  const start = Date.now();
  try {
    const r = await fetch(`https://api.massive.com/v1/marketstatus/now?apiKey=${key}`);
    const ms = Date.now() - start;
    if (r.ok) {
      await markMassiveUp();
      return new Response(JSON.stringify({ ok: true, status: "up", latencyMs: ms }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    if (isOutageStatus(r.status)) {
      await markMassiveDown(`ping HTTP ${r.status}`);
      return new Response(JSON.stringify({ ok: true, status: "down", httpStatus: r.status, latencyMs: ms }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    // 4xx (e.g. 429 rate-limit) is NOT an outage — leave flag as-is.
    return new Response(JSON.stringify({ ok: true, status: "degraded", httpStatus: r.status, latencyMs: ms }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    await markMassiveDown(e instanceof Error ? e.message : "network error");
    return new Response(JSON.stringify({ ok: true, status: "down", error: e instanceof Error ? e.message : "unknown" }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
