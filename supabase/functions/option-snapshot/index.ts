// option-snapshot — thin HTTP wrapper around _shared/getOptionSnapshot.ts.
// Exists so the client (Settings → Debug Drawer "Test Massive for this
// contract" button) can fetch a single canonical snapshot without going
// through portfolio-exit-eval. ALWAYS uses the shared module — no duplicate
// Massive client code.
import { getOptionSnapshot, getRecentRequestLog } from "../_shared/getOptionSnapshot.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // GET /option-snapshot/log → return the in-memory request ring buffer.
  const u = new URL(req.url);
  if (req.method === "GET" && u.pathname.endsWith("/log")) {
    return new Response(JSON.stringify({ ok: true, log: getRecentRequestLog() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: {
    underlying?: string;
    optionSymbol?: string;
    expiry?: string;
    isCall?: boolean;
    strike?: number;
  } = {};
  try { body = await req.json(); } catch { /* GET / no body */ }

  // Allow query-string for GET-style invocations.
  if (!body.underlying) body.underlying = u.searchParams.get("underlying") ?? undefined;
  if (!body.optionSymbol) body.optionSymbol = u.searchParams.get("optionSymbol") ?? undefined;
  if (!body.expiry) body.expiry = u.searchParams.get("expiry") ?? undefined;
  if (body.isCall == null) {
    const v = u.searchParams.get("isCall");
    if (v != null) body.isCall = v === "true";
  }
  if (body.strike == null) {
    const v = u.searchParams.get("strike");
    if (v != null && Number.isFinite(Number(v))) body.strike = Number(v);
  }

  if (!body.underlying) {
    return new Response(JSON.stringify({ ok: false, error: "underlying required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const snapshot = await getOptionSnapshot({
    underlying: body.underlying,
    optionSymbol: body.optionSymbol,
    expiry: body.expiry,
    isCall: body.isCall,
    strike: body.strike,
  });

  return new Response(JSON.stringify({ ok: true, snapshot }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
