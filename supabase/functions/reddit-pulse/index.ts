// Reddit Pulse — pulls hot/rising posts from finance subs (no key required).
// Extracts ticker mentions ($TSLA, NVDA, etc.), upvotes, comment counts,
// and a quick sentiment hint based on title keywords.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const SUBS_DEFAULT = [
  "wallstreetbets",
  "options",
  "options_trading",
  "optionstrading",
  "thetagang",
  "stocks",
  "investing",
  "stockmarket",
  "smallstreetbets",
  "daytrading",
  "swingtrading",
  "pennystocks",
];
const UA = "NovaTerminal/1.0 (planning aggregator)";

const POS = ["calls", "moon", "rip", "squeeze", "breakout", "buy", "long", "bull", "beat", "raise", "rally", "pump"];
const NEG = ["puts", "dump", "crash", "drop", "bear", "short", "miss", "warn", "tank", "sell", "downgrade"];

// Common tickers we care about — used to disambiguate noisy $WORDS.
const KNOWN = new Set([
  "SPY","QQQ","IWM","DIA","VIX","TSLA","NVDA","AAPL","MSFT","GOOGL","GOOG","META","AMZN",
  "AMD","INTC","NFLX","DIS","BA","JPM","BAC","WFC","GS","MS","V","MA","PYPL","SQ","COIN",
  "PLTR","SOFI","HOOD","RIVN","LCID","F","GM","UBER","LYFT","ABNB","SNAP","PINS","CRM",
  "ORCL","ADBE","AVGO","QCOM","MU","SMCI","ARM","DELL","HPQ","SHOP","BABA","JD","PDD",
  "NIO","XPEV","LI","BIDU","TSM","ASML","NKE","SBUX","MCD","KO","PEP","WMT","TGT","COST",
  "HD","LOW","CVS","WBA","UNH","JNJ","PFE","MRK","ABBV","LLY","MRNA","BNTX","XOM","CVX",
  "OXY","COP","SLB","HAL","DVN","FCX","GLD","SLV","TLT","HYG","BITO","MARA","RIOT","MSTR",
  "GME","AMC","BBBY","BB","NOK","CHWY","DKNG","PENN","RKT","UPST","AFRM","ROKU","SNOW",
  "DDOG","NET","CRWD","ZS","PANW","FTNT","S","DOCU","ZM","TWLO","ETSY","EBAY","TTD","RBLX",
]);

const STOPWORDS = new Set(["A","I","TO","BE","DO","ON","OR","IT","AT","IS","IN","OF","AS","AN","SO","NO","WE","ME","MY","BY","UP"]);

function extractTickers(text: string): string[] {
  const found = new Set<string>();
  const re = /\$([A-Z]{1,5})\b|\b([A-Z]{2,5})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const t = (m[1] ?? m[2] ?? "").toUpperCase();
    if (!t || STOPWORDS.has(t)) continue;
    // $XYZ always counts. Bare uppercase only if known ticker.
    if (m[1] || KNOWN.has(t)) found.add(t);
  }
  return [...found];
}

function sentimentOf(text: string): "bull" | "bear" | "neutral" {
  const t = text.toLowerCase();
  let p = 0, n = 0;
  for (const w of POS) if (t.includes(w)) p++;
  for (const w of NEG) if (t.includes(w)) n++;
  if (p > n + 1) return "bull";
  if (n > p + 1) return "bear";
  return "neutral";
}

interface RedditChild {
  data: {
    id: string;
    title: string;
    selftext?: string;
    permalink: string;
    score: number;
    num_comments: number;
    created_utc: number;
    author: string;
    subreddit: string;
    link_flair_text?: string | null;
    upvote_ratio?: number;
    stickied?: boolean;
  };
}

async function fetchSub(sub: string, sort: string, limit: number) {
  const url = `https://www.reddit.com/r/${sub}/${sort}.json?limit=${limit}&t=day`;
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) {
    console.warn(`[reddit] ${sub}/${sort} ${r.status}`);
    return [];
  }
  const j = await r.json();
  const children: RedditChild[] = j?.data?.children ?? [];
  return children.filter((c) => !c.data.stickied).map((c) => c.data);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const subs: string[] = Array.isArray(body.subs) && body.subs.length ? body.subs : SUBS_DEFAULT;
    const sortsRaw = body.sort ?? ["hot", "rising"];
    const sorts: string[] = Array.isArray(sortsRaw) ? sortsRaw : [sortsRaw];
    const limit: number = Math.min(50, Number(body.limit ?? 30));

    const tasks = subs.flatMap((s) => sorts.map((sort) => fetchSub(s, sort, limit)));
    const all = (await Promise.all(tasks)).flat();

    // Dedupe by post id (a post can show in both hot and rising)
    const seen = new Set<string>();
    const dedup = all.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));

    // Build per-ticker rollup
    const tickers = new Map<string, {
      symbol: string;
      mentions: number;
      score: number;       // sum of upvotes
      comments: number;
      bull: number;
      bear: number;
      neutral: number;
      topPost?: { title: string; url: string; score: number; comments: number; sub: string };
    }>();

    const posts = dedup.map((p) => {
      const text = `${p.title} ${p.selftext ?? ""}`;
      const ts = extractTickers(text);
      const sent = sentimentOf(text);
      for (const t of ts) {
        const cur = tickers.get(t) ?? { symbol: t, mentions: 0, score: 0, comments: 0, bull: 0, bear: 0, neutral: 0 };
        cur.mentions += 1;
        cur.score += p.score;
        cur.comments += p.num_comments;
        if (sent === "bull") cur.bull += 1;
        else if (sent === "bear") cur.bear += 1;
        else cur.neutral += 1;
        if (!cur.topPost || p.score > cur.topPost.score) {
          cur.topPost = {
            title: p.title,
            url: `https://www.reddit.com${p.permalink}`,
            score: p.score,
            comments: p.num_comments,
            sub: p.subreddit,
          };
        }
        tickers.set(t, cur);
      }
      return {
        id: p.id,
        title: p.title,
        excerpt: (p.selftext ?? "").slice(0, 240),
        url: `https://www.reddit.com${p.permalink}`,
        sub: p.subreddit,
        score: p.score,
        comments: p.num_comments,
        author: p.author,
        flair: p.link_flair_text ?? null,
        upvoteRatio: p.upvote_ratio ?? null,
        publishedAt: new Date(p.created_utc * 1000).toISOString(),
        tickers: ts,
        sentiment: sent,
      };
    });

    const ranked = [...tickers.values()]
      .map((t) => ({
        ...t,
        bias: t.bull > t.bear ? "bull" : t.bear > t.bull ? "bear" : "neutral",
        // weighted heat: mentions × log-upvotes
        heat: Math.round(t.mentions * Math.log(2 + t.score)),
      }))
      .sort((a, b) => b.heat - a.heat);

    return new Response(
      JSON.stringify({
        subs,
        sorts,
        postCount: dedup.length,
        posts: posts.sort((a, b) => b.score - a.score).slice(0, 80),
        tickers: ranked.slice(0, 40),
        fetchedAt: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("reddit-pulse error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
