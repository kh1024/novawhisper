// YouTube Chatter — searches recent finance creator videos and their top comments.
// Uses YOUTUBE_API_KEY (Data API v3). Falls back to empty array on quota errors.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const YT_KEY = Deno.env.get("YOUTUBE_API_KEY");

const POS = ["calls", "long", "bullish", "buy", "breakout", "rally", "beat", "rip", "squeeze", "moon"];
const NEG = ["puts", "short", "bearish", "sell", "crash", "drop", "miss", "warn", "tank", "downgrade"];

const KNOWN = new Set([
  "SPY","QQQ","IWM","DIA","VIX","TSLA","NVDA","AAPL","MSFT","GOOGL","GOOG","META","AMZN",
  "AMD","INTC","NFLX","DIS","BA","JPM","BAC","COIN","PLTR","SOFI","HOOD","SMCI","ARM",
  "AVGO","QCOM","MU","SHOP","BABA","TSM","ASML","XOM","CVX","GLD","TLT","MARA","RIOT",
  "MSTR","GME","AMC","SNOW","CRWD","NET","DDOG","PANW","ROKU","RBLX","UBER","ABNB",
]);
const STOP = new Set(["A","I","TO","BE","DO","ON","OR","IT","AT","IS","IN","OF","AS","AN","SO","NO","WE","ME","MY","BY","UP","CEO","CFO","ETF","USA","USD","FED","CPI","GDP","NEW","NOW","WSJ","CNBC","FOMC"]);

function extractTickers(text: string): string[] {
  const out = new Set<string>();
  const re = /\$([A-Z]{1,5})\b|\b([A-Z]{2,5})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const t = (m[1] ?? m[2] ?? "").toUpperCase();
    if (!t || STOP.has(t)) continue;
    if (m[1] || KNOWN.has(t)) out.add(t);
  }
  return [...out];
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

async function ytFetch(path: string, params: Record<string, string>) {
  const u = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  u.searchParams.set("key", YT_KEY!);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u);
  if (!r.ok) {
    const t = await r.text();
    console.warn(`[youtube] ${path} ${r.status}: ${t.slice(0, 200)}`);
    return null;
  }
  return await r.json();
}

interface SearchItem {
  id: { videoId: string };
  snippet: {
    title: string;
    description: string;
    channelTitle: string;
    publishedAt: string;
    thumbnails: { medium?: { url: string } };
  };
}
interface VideoStats {
  id: string;
  statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
  snippet: { title: string; description: string; channelTitle: string; publishedAt: string; thumbnails: { medium?: { url: string } } };
}
interface CommentThread {
  snippet: {
    topLevelComment: {
      snippet: { textDisplay: string; authorDisplayName: string; likeCount: number; publishedAt: string };
    };
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!YT_KEY) throw new Error("YOUTUBE_API_KEY not configured");
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const query: string = body.query ?? "stock market today options trading";
    const maxVideos: number = Math.min(20, Number(body.maxVideos ?? 10));
    const commentsPerVideo: number = Math.min(10, Number(body.commentsPerVideo ?? 5));

    // 1) Search recent videos (last 2 days, by viewCount)
    const publishedAfter = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const search = await ytFetch("search", {
      part: "snippet",
      q: query,
      type: "video",
      order: "viewCount",
      publishedAfter,
      relevanceLanguage: "en",
      maxResults: String(maxVideos),
    });
    const items: SearchItem[] = search?.items ?? [];
    const videoIds = items.map((i) => i.id.videoId).filter(Boolean);

    let stats: VideoStats[] = [];
    if (videoIds.length) {
      const vs = await ytFetch("videos", { part: "snippet,statistics", id: videoIds.join(",") });
      stats = vs?.items ?? [];
    }
    const statMap = new Map(stats.map((s) => [s.id, s]));

    // 2) For each video, fetch top comments in parallel
    const videos = await Promise.all(
      videoIds.map(async (vid) => {
        const v = statMap.get(vid);
        if (!v) return null;
        const ct = await ytFetch("commentThreads", {
          part: "snippet",
          videoId: vid,
          order: "relevance",
          maxResults: String(commentsPerVideo),
          textFormat: "plainText",
        });
        const threads: CommentThread[] = ct?.items ?? [];
        const comments = threads.map((t) => {
          const c = t.snippet.topLevelComment.snippet;
          return {
            text: c.textDisplay.slice(0, 320),
            author: c.authorDisplayName,
            likes: c.likeCount,
            publishedAt: c.publishedAt,
            tickers: extractTickers(c.textDisplay),
            sentiment: sentimentOf(c.textDisplay),
          };
        });
        const text = `${v.snippet.title} ${v.snippet.description}`;
        return {
          id: vid,
          title: v.snippet.title,
          channel: v.snippet.channelTitle,
          publishedAt: v.snippet.publishedAt,
          thumbnail: v.snippet.thumbnails.medium?.url ?? "",
          url: `https://www.youtube.com/watch?v=${vid}`,
          views: Number(v.statistics.viewCount ?? 0),
          likes: Number(v.statistics.likeCount ?? 0),
          commentCount: Number(v.statistics.commentCount ?? 0),
          tickers: extractTickers(text),
          sentiment: sentimentOf(text),
          comments,
        };
      }),
    );
    const cleanVideos = videos.filter((v): v is NonNullable<typeof v> => v !== null);

    // 3) Roll up tickers across videos + comments
    const rollup = new Map<string, { symbol: string; mentions: number; bull: number; bear: number; neutral: number; views: number; topVideo?: { title: string; url: string; views: number; channel: string } }>();
    for (const v of cleanVideos) {
      const seen = new Set<string>(v.tickers);
      for (const c of v.comments) for (const t of c.tickers) seen.add(t);
      for (const t of seen) {
        const cur = rollup.get(t) ?? { symbol: t, mentions: 0, bull: 0, bear: 0, neutral: 0, views: 0 };
        cur.mentions += 1;
        cur.views += v.views;
        if (v.sentiment === "bull") cur.bull += 1;
        else if (v.sentiment === "bear") cur.bear += 1;
        else cur.neutral += 1;
        if (!cur.topVideo || v.views > cur.topVideo.views) {
          cur.topVideo = { title: v.title, url: v.url, views: v.views, channel: v.channel };
        }
        rollup.set(t, cur);
      }
    }
    const tickers = [...rollup.values()]
      .map((t) => ({ ...t, bias: t.bull > t.bear ? "bull" : t.bear > t.bull ? "bear" : "neutral", heat: Math.round(t.mentions * Math.log(2 + t.views / 1000)) }))
      .sort((a, b) => b.heat - a.heat);

    return new Response(
      JSON.stringify({ query, videos: cleanVideos, tickers: tickers.slice(0, 30), fetchedAt: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("youtube-chatter error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
