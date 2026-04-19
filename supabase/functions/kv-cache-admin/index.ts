// Tiny admin endpoint for the kv_cache table.
// Service-role-only table → must be proxied through this function.
// Actions: list (default) | delete (requires `key`)
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

interface Body {
  action?: "list" | "delete";
  key?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return new Response(JSON.stringify({ error: "service role not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Body = {};
  if (req.method === "POST") {
    body = await req.json().catch(() => ({}));
  }
  const action = body.action ?? "list";

  try {
    if (action === "delete") {
      if (!body.key || typeof body.key !== "string" || body.key.length > 200) {
        return new Response(JSON.stringify({ error: "valid key required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/kv_cache?key=eq.${encodeURIComponent(body.key)}`,
        {
          method: "DELETE",
          headers: {
            apikey: SERVICE_ROLE,
            Authorization: `Bearer ${SERVICE_ROLE}`,
            Prefer: "return=minimal",
          },
        },
      );
      await r.text().catch(() => "");
      return new Response(JSON.stringify({ ok: r.ok, key: body.key }), {
        status: r.ok ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // list — return key + expires_at + updated_at + small value preview
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/kv_cache?select=key,expires_at,updated_at&order=updated_at.desc&limit=200`,
      { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
    );
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return new Response(JSON.stringify({ error: `list HTTP ${r.status}`, detail }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const rows = await r.json();
    return new Response(JSON.stringify({ entries: rows, fetchedAt: new Date().toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("kv-cache-admin fatal", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
