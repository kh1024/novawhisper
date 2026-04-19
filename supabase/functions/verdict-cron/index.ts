// Background verdict cron — runs every 5 min during market hours.
// Loads enabled cron configs, fetches each owner's open positions, calls
// portfolio-verdict, detects signal transitions vs verdict_alert_state, and
// POSTs a webhook + writes to verdict_alert_log.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Signal = "GO" | "WAIT" | "EXIT" | "NO";

interface VerdictCrl {
  verdict: "GO" | "WAIT" | "NO" | "EXIT" | "NEUTRAL";
  reason: string;
  stopLossTriggered: boolean;
}
interface Verdict {
  id: string;
  status: string;
  verdict: string;
  action: string;
  crl?: VerdictCrl;
}

function verdictToSignal(v: Verdict): Signal {
  if (v.crl) {
    if (v.crl.stopLossTriggered) return "EXIT";
    if (v.crl.verdict === "GO") return "GO";
    if (v.crl.verdict === "EXIT") return "EXIT";
    if (v.crl.verdict === "NO") return "NO";
    if (v.crl.verdict === "WAIT") return "WAIT";
  }
  if (v.action === "cut" || v.action === "take_profit") return "EXIT";
  if (v.status === "winning" || v.status === "running fine") return "GO";
  return "WAIT";
}

async function postWebhook(url: string, payload: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = new Date().toISOString();
  const summary: { ownerKey: string; positions: number; transitions: number; fired: number; error?: string }[] = [];

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // 1. All enabled configs.
    const { data: configs, error: cfgErr } = await admin
      .from("verdict_cron_config")
      .select("owner_key, webhook_url, alert_on_wait, alert_watchlist, alert_on_buy")
      .eq("enabled", true)
      .not("webhook_url", "is", null);
    if (cfgErr) throw cfgErr;

    for (const cfg of configs ?? []) {
      const ownerKey = cfg.owner_key as string;
      const webhookUrl = cfg.webhook_url as string;
      const alertOnWait = !!cfg.alert_on_wait;
      const alertWatchlist = cfg.alert_watchlist !== false; // default true
      const alertOnBuy = cfg.alert_on_buy !== false; // default true
      let positionCount = 0;
      let transitions = 0;
      let fired = 0;

      try {
        // 2. Open positions for this owner.
        const { data: positions, error: posErr } = await admin
          .from("portfolio_positions")
          .select("id, symbol, option_type, direction, strike, strike_short, expiry, contracts, entry_premium, entry_underlying, thesis")
          .eq("owner_key", ownerKey)
          .eq("status", "open");
        if (posErr) throw posErr;

        // 2b. Watchlist items — treat each as a pseudo-position (1 contract) so
        // the verdict engine produces a fresh Buy now / Wait / Avoid signal.
        type Row = {
          id: string; symbol: string; option_type: string; direction: string;
          strike: number | null; strike_short: number | null; expiry: string | null;
          contracts: number; entry_premium: number | null; entry_underlying: number | null;
          thesis: string | null; kind: "portfolio" | "watchlist";
        };
        const portfolioRows: Row[] = (positions ?? []).map((p) => ({
          id: p.id as string, symbol: p.symbol as string, option_type: p.option_type as string,
          direction: p.direction as string,
          strike: p.strike != null ? Number(p.strike) : null,
          strike_short: p.strike_short != null ? Number(p.strike_short) : null,
          expiry: p.expiry as string,
          contracts: (p.contracts as number) ?? 1,
          entry_premium: p.entry_premium != null ? Number(p.entry_premium) : null,
          entry_underlying: p.entry_underlying != null ? Number(p.entry_underlying) : null,
          thesis: (p.thesis as string) ?? null,
          kind: "portfolio",
        }));

        let watchRows: Row[] = [];
        if (alertWatchlist) {
          const { data: w } = await admin
            .from("watchlist_items")
            .select("id, symbol, option_type, direction, strike, strike_short, expiry, entry_price, thesis")
            .eq("owner_key", ownerKey);
          watchRows = (w ?? [])
            .filter((r) => r.strike != null && r.expiry != null)
            .map((r) => ({
              id: r.id as string, symbol: r.symbol as string, option_type: r.option_type as string,
              direction: r.direction as string,
              strike: Number(r.strike),
              strike_short: r.strike_short != null ? Number(r.strike_short) : null,
              expiry: r.expiry as string,
              contracts: 1,
              entry_premium: null,
              entry_underlying: r.entry_price != null ? Number(r.entry_price) : null,
              thesis: (r.thesis as string) ?? null,
              kind: "watchlist",
            }));
        }

        const allRows = [...portfolioRows, ...watchRows];
        positionCount = allRows.length;
        if (allRows.length === 0) {
          summary.push({ ownerKey, positions: 0, transitions: 0, fired: 0 });
          continue;
        }

        // 3. Get verdicts via existing edge function (works for both kinds).
        const verdictResp = await fetch(`${SUPABASE_URL}/functions/v1/portfolio-verdict`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            apikey: SUPABASE_ANON_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            positions: allRows.map((p) => ({
              id: p.id, symbol: p.symbol, optionType: p.option_type, direction: p.direction,
              strike: p.strike, strikeShort: p.strike_short,
              expiry: p.expiry, contracts: p.contracts,
              entryPremium: p.entry_premium,
              entryUnderlying: p.entry_underlying,
              thesis: p.thesis,
            })),
          }),
        });
        if (!verdictResp.ok) throw new Error(`portfolio-verdict ${verdictResp.status}`);
        const vJson = await verdictResp.json();
        const verdicts: Verdict[] = vJson.verdicts ?? [];

        // 4. Load prior state.
        const { data: stateRows } = await admin
          .from("verdict_alert_state")
          .select("position_id, last_signal")
          .eq("owner_key", ownerKey);
        const prior = new Map<string, Signal>((stateRows ?? []).map((r) => [r.position_id as string, r.last_signal as Signal]));

        const rowBy = new Map(allRows.map((p) => [p.id, p]));

        // 5. Detect transitions and dispatch.
        for (const v of verdicts) {
          const sig = verdictToSignal(v);
          const prev = prior.get(v.id);
          const row = rowBy.get(v.id);
          const symbol = row?.symbol ?? "?";
          const kind = row?.kind ?? "portfolio";
          const isFirst = prev === undefined;

          // Always upsert state.
          if (prev !== sig) {
            transitions++;
            await admin.from("verdict_alert_state").upsert({
              position_id: v.id,
              owner_key: ownerKey,
              symbol,
              last_signal: sig,
              last_changed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }, { onConflict: "position_id" });
            // Mirror onto the watchlist row so the UI can show last alerted signal.
            if (kind === "watchlist") {
              await admin.from("watchlist_items").update({
                last_signal: sig,
                last_signal_at: new Date().toISOString(),
              }).eq("id", v.id);
            }
          }

          if (prev === sig) continue;
          const isBuy = sig === "GO";
          const shouldFire =
            (isBuy && (kind === "portfolio" || alertOnBuy)) ||
            sig === "EXIT" || sig === "NO" ||
            (sig === "WAIT" && alertOnWait && !isFirst);
          if (!shouldFire) continue;
          if (isFirst && sig === "WAIT") continue;
          // For watchlist items, only fire on first-ever GO if alertOnBuy is on.
          if (isFirst && !isBuy && kind === "watchlist") continue;

          const tag = kind === "watchlist" ? "★ WATCHLIST" : "📊 POSITION";
          const headline =
            sig === "GO"   ? `🟢 BUY NOW — ${symbol} (${tag})` :
            sig === "EXIT" ? `🚨 EXIT — ${symbol} (broke 8-EMA)` :
            sig === "NO"   ? `⛔ AVOID — ${symbol} (time decay trap)` :
                             `⏳ WAIT — ${symbol}`;
          const payload = {
            event: "nova_verdict_transition",
            symbol,
            positionId: v.id,
            kind,
            from: prev ?? "NEW",
            to: sig,
            status: v.status,
            action: v.action,
            verdict: v.verdict,
            text: `${headline}\n${v.verdict}`,
            at: new Date().toISOString(),
            source: "cron",
          };
          const res = await postWebhook(webhookUrl, payload);
          fired++;
          await admin.from("verdict_alert_log").insert({
            owner_key: ownerKey,
            position_id: v.id,
            symbol,
            from_signal: prev ?? "NEW",
            to_signal: sig,
            ok: res.ok,
            error: res.error ?? null,
            source: kind === "watchlist" ? "watchlist-cron" : "cron",
          });
        }

        await admin.from("verdict_cron_config").update({
          last_run_at: new Date().toISOString(),
          last_run_status: `ok · ${positionCount} items · ${fired} fired`,
        }).eq("owner_key", ownerKey);

        summary.push({ ownerKey, positions: positionCount, transitions, fired });
      } catch (innerErr) {
        const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
        console.error(`[verdict-cron] owner ${ownerKey} failed`, msg);
        await admin.from("verdict_cron_config").update({
          last_run_at: new Date().toISOString(),
          last_run_status: `error: ${msg.slice(0, 200)}`,
        }).eq("owner_key", ownerKey);
        summary.push({ ownerKey, positions: positionCount, transitions, fired, error: msg });
      }
    }

    return new Response(JSON.stringify({ ok: true, startedAt, finishedAt: new Date().toISOString(), summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("verdict-cron fatal", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
