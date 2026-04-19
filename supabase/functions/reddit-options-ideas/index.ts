// Reddit Options Ideas — calls reddit-pulse, then filters posts to only
// those that include concrete option details: a ticker AND at least one of
// (strike, expiry, calls/puts). Parses out side, strike, expiry, sentiment.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

interface PulsePost {
  id: string;
  title: string;
  excerpt: string;
  url: string;
  sub: string;
  score: number;
  comments: number;
  author: string;
  flair: string | null;
  upvoteRatio: number | null;
  publishedAt: string;
  tickers: string[];
  sentiment: "bull" | "bear" | "neutral";
}

type Side = "call" | "put" | "unknown";

interface OptionIdea {
  id: string;
  symbol: string;
  side: Side;
  strike: number | null;
  expiry: string | null;       // ISO date or natural ("Jan 17", "0DTE", "weekly")
  dteHint: string | null;      // friendly horizon
  sentiment: "bull" | "bear" | "neutral";
  title: string;
  excerpt: string;
  url: string;
  sub: string;
  score: number;
  comments: number;
  author: string;
  publishedAt: string;
  matchedPhrases: string[];    // why we picked it
}

const CALLS_RE = /\b(calls?|long\s+calls?|bought\s+calls?)\b/i;
const PUTS_RE = /\b(puts?|long\s+puts?|bought\s+puts?)\b/i;
// strike: $250c / 250 calls / 250C / strike 250
const STRIKE_RE = /\$?(\d{1,5}(?:\.\d{1,2})?)\s*([cp])\b|\b(\d{1,5}(?:\.\d{1,2})?)\s*(call|put)s?\b|\bstrike\s*\$?(\d{1,5}(?:\.\d{1,2})?)/i;
// expiry: 12/15, 2025-01-17, Jan 17, Friday, weekly, 0DTE, 30dte, exp 1/17
const EXPIRY_RE = /\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b|\b(\d{4}-\d{2}-\d{2})\b|\b(0\s?dte|\d{1,3}\s?dte|weeklies?|weekly|monthly|leaps?)\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,?\s*\d{2,4})?\b/i;

function parseSide(text: string): Side {
  const c = CALLS_RE.test(text);
  const p = PUTS_RE.test(text);
  if (c && !p) return "call";
  if (p && !c) return "put";
  return "unknown";
}

function parseStrike(text: string): number | null {
  const m = text.match(STRIKE_RE);
  if (!m) return null;
  const raw = m[1] ?? m[3] ?? m[5];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

function parseExpiry(text: string): { expiry: string | null; dteHint: string | null } {
  const m = text.match(EXPIRY_RE);
  if (!m) return { expiry: null, dteHint: null };
  const raw = (m[0] ?? "").trim();
  if (/0\s?dte/i.test(raw)) return { expiry: raw, dteHint: "0DTE" };
  if (/\d+\s?dte/i.test(raw)) return { expiry: raw, dteHint: raw.toUpperCase() };
  if (/weekl/i.test(raw)) return { expiry: raw, dteHint: "weekly (~7DTE)" };
  if (/monthly/i.test(raw)) return { expiry: raw, dteHint: "monthly (~30DTE)" };
  if (/leap/i.test(raw)) return { expiry: raw, dteHint: "LEAPS (>180DTE)" };
  return { expiry: raw, dteHint: null };
}

function matchedPhrases(text: string): string[] {
  const out: string[] = [];
  if (CALLS_RE.test(text)) out.push("calls");
  if (PUTS_RE.test(text)) out.push("puts");
  const sm = text.match(STRIKE_RE);
  if (sm) out.push(`strike: ${sm[0].trim()}`);
  const em = text.match(EXPIRY_RE);
  if (em) out.push(`expiry: ${em[0].trim()}`);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const subs: string[] = Array.isArray(body.subs) && body.subs.length ? body.subs : [
      "wallstreetbets", "options", "thetagang", "optionstrading",
      "stocks", "investing", "swingtrading",
    ];
    const limit: number = Math.min(50, Number(body.limit ?? 30));

    // Reuse reddit-pulse (handles JSON+RSS fallback, ticker extraction).
    const pulseResp = await fetch(`${SUPABASE_URL}/functions/v1/reddit-pulse`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ subs, sort: ["hot", "rising"], limit }),
    });
    if (!pulseResp.ok) {
      throw new Error(`reddit-pulse ${pulseResp.status}`);
    }
    const pulse = await pulseResp.json();
    const posts: PulsePost[] = pulse.posts ?? [];

    const ideas: OptionIdea[] = [];
    for (const p of posts) {
      const text = `${p.title}\n${p.excerpt}`;
      // Need a ticker
      if (!p.tickers || p.tickers.length === 0) continue;
      // Need at least 2 of: side / strike / expiry — concrete enough to act on.
      const side = parseSide(text);
      const strike = parseStrike(text);
      const exp = parseExpiry(text);
      const concrete = [side !== "unknown", strike != null, exp.expiry != null].filter(Boolean).length;
      if (concrete < 2) continue;

      // Use the first / most-prominent ticker mentioned.
      const symbol = p.tickers[0];
      ideas.push({
        id: p.id,
        symbol,
        side,
        strike,
        expiry: exp.expiry,
        dteHint: exp.dteHint,
        sentiment: p.sentiment,
        title: p.title,
        excerpt: p.excerpt,
        url: p.url,
        sub: p.sub,
        score: p.score,
        comments: p.comments,
        author: p.author,
        publishedAt: p.publishedAt,
        matchedPhrases: matchedPhrases(text),
      });
    }

    // Rank by score, then recency.
    ideas.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");
    });

    return new Response(
      JSON.stringify({
        subs,
        scanned: posts.length,
        ideaCount: ideas.length,
        ideas: ideas.slice(0, 40),
        fetchedAt: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("reddit-options-ideas error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
