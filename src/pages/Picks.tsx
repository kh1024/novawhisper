import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Pick {
  ticker: string;
  grade: "A" | "B" | "C" | "D" | "F";
  score: number;
  price: number;
  chg: number;
  expiry: string;
  strike: number;
  last: number;
  bid: number;
  ask: number;
  oi: number;
  iv: number;
  analystTarget: number | null;
  upsideToTarget: number | null;
  reasons: string;
}

interface PicksResponse {
  calls: Pick[];
  puts: Pick[];
  generatedAt: string;
  cached?: boolean;
}

const REFRESH_MS = 5 * 60_000;

const PALETTE = {
  bg: "#0d0f14",
  card: "#13161e",
  cardAlt: "#1a1e28",
  border: "#252a36",
  text: "#e8eaf0",
  muted: "#8b93a8",
  accent: "#00d4aa",
  callHeader: "#1b5e20",
  putHeader: "#bf360c",
  gradeA: "#00c076",
  gradeB: "#1565c0",
  gradeC: "#e65100",
  gradeD: "#7e57c2",
  gradeF: "#546e7a",
  callRowA: "#0d1f0f",
  putRowA: "#1f0d0d",
};

const mono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
};

function GradePill({ g }: { g: Pick["grade"] }) {
  const bg =
    g === "A" ? PALETTE.gradeA :
    g === "B" ? PALETTE.gradeB :
    g === "C" ? PALETTE.gradeC :
    g === "D" ? PALETTE.gradeD : PALETTE.gradeF;
  return (
    <span
      style={{
        ...mono,
        background: bg,
        color: "#fff",
        padding: "2px 10px",
        borderRadius: 999,
        fontWeight: 700,
        fontSize: 12,
        display: "inline-block",
        minWidth: 24,
        textAlign: "center",
      }}
    >
      {g}
    </span>
  );
}

function fmtMoney(n: number | null | undefined, dash = "—") {
  if (n == null || !Number.isFinite(n)) return dash;
  return `$${n.toFixed(2)}`;
}

function ivColor(ivPct: number) {
  if (ivPct < 60) return "#00c076";
  if (ivPct <= 100) return "#f5b041";
  return "#ef5350";
}

function Skeleton({ w, h = 14 }: { w: number | string; h?: number }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        background: "linear-gradient(90deg,#1a1e28,#252a36,#1a1e28)",
        backgroundSize: "200% 100%",
        animation: "picksShimmer 1.4s infinite",
        borderRadius: 4,
      }}
    />
  );
}

function PicksTable({ rows, kind }: { rows: Pick[]; kind: "call" | "put" }) {
  const tintRow = kind === "call" ? PALETTE.callRowA : PALETTE.putRowA;
  return (
    <div style={{ overflowX: "auto", border: `1px solid ${PALETTE.border}`, borderRadius: 8 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", color: PALETTE.text, fontSize: 13 }}>
        <thead>
          <tr style={{ background: PALETTE.card, color: PALETTE.muted, textAlign: "left" }}>
            {[
              "Grade","Ticker","Score","Price","1D Chg%","Expiry","Strike","Last","Bid","Ask","OI","IV%","Analyst Target","Upside%","Why This Pick",
            ].map((h, i) => (
              <th
                key={h}
                style={{
                  padding: "10px 12px",
                  fontWeight: 600,
                  fontSize: 11,
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  position: i === 1 ? "sticky" : undefined,
                  left: i === 1 ? 0 : undefined,
                  background: i === 1 ? PALETTE.card : undefined,
                  zIndex: i === 1 ? 2 : undefined,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            const base = idx % 2 === 0 ? PALETTE.card : PALETTE.cardAlt;
            const bg = r.grade === "A" ? tintRow : base;
            const ivPct = r.iv * 100;
            return (
              <tr
                key={`${r.ticker}-${r.expiry}-${r.strike}-${idx}`}
                style={{ background: bg, transition: "background 150ms" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#202533")}
                onMouseLeave={(e) => (e.currentTarget.style.background = bg)}
              >
                <td style={{ padding: "10px 12px" }}><GradePill g={r.grade} /></td>
                <td style={{ ...mono, padding: "10px 12px", fontWeight: 700, color: PALETTE.accent, position: "sticky", left: 0, background: bg, zIndex: 1 }}>{r.ticker}</td>
                <td style={{ padding: "10px 12px", color: PALETTE.accent, fontWeight: 700 }}>{r.score}</td>
                <td style={{ ...mono, padding: "10px 12px" }}>{fmtMoney(r.price)}</td>
                <td style={{ ...mono, padding: "10px 12px", color: r.chg >= 0 ? "#00c076" : "#ef5350", fontWeight: 600 }}>
                  {r.chg >= 0 ? "↑" : "↓"} {Math.abs(r.chg).toFixed(1)}%
                </td>
                <td style={{ ...mono, padding: "10px 12px", color: PALETTE.muted }}>{r.expiry}</td>
                <td style={{ ...mono, padding: "10px 12px" }}>${r.strike}</td>
                <td style={{ ...mono, padding: "10px 12px" }}>{fmtMoney(r.last)}</td>
                <td style={{ ...mono, padding: "10px 12px", color: PALETTE.muted }}>{fmtMoney(r.bid)}</td>
                <td style={{ ...mono, padding: "10px 12px", color: PALETTE.muted }}>{fmtMoney(r.ask)}</td>
                <td style={{ ...mono, padding: "10px 12px", color: "#64b5f6", fontWeight: 600 }}>{r.oi.toLocaleString()}</td>
                <td style={{ ...mono, padding: "10px 12px", color: ivColor(ivPct), fontWeight: 600 }}>{ivPct.toFixed(1)}%</td>
                <td style={{ ...mono, padding: "10px 12px" }}>{fmtMoney(r.analystTarget)}</td>
                <td style={{ ...mono, padding: "10px 12px", color: r.upsideToTarget == null ? PALETTE.muted : r.upsideToTarget >= 0 ? "#00c076" : "#ef5350" }}>
                  {r.upsideToTarget == null ? "—" : `${r.upsideToTarget >= 0 ? "+" : ""}${r.upsideToTarget.toFixed(1)}%`}
                </td>
                <td
                  style={{ padding: "10px 12px", color: PALETTE.muted, fontSize: 12, maxWidth: 280, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  title={r.reasons}
                >
                  {r.reasons || "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Section({
  title,
  headerBg,
  rows,
  kind,
}: {
  title: string;
  headerBg: string;
  rows: Pick[];
  kind: "call" | "put";
}) {
  const [filter, setFilter] = useState<"All" | "A" | "B" | "C">("All");
  const filtered = filter === "All" ? rows : rows.filter((r) => r.grade === filter);
  return (
    <section style={{ marginTop: 24 }}>
      <div
        style={{
          background: headerBg,
          color: "#fff",
          padding: "10px 16px",
          borderRadius: "8px 8px 0 0",
          fontWeight: 700,
          letterSpacing: 1,
          fontSize: 13,
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", gap: 8, padding: "12px 0" }}>
        {(["All","A","B","C"] as const).map((f) => {
          const active = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "6px 14px",
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 6,
                border: `1px solid ${active ? PALETTE.accent : PALETTE.border}`,
                background: active ? PALETTE.accent : "transparent",
                color: active ? "#0d0f14" : PALETTE.text,
                cursor: "pointer",
              }}
            >
              {f}
            </button>
          );
        })}
      </div>
      <PicksTable rows={filtered} kind={kind} />
    </section>
  );
}

export default function Picks() {
  const [data, setData] = useState<PicksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const load = useCallback(async (force = false) => {
    setError(null);
    if (!data) setLoading(true);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const url = `https://${projectId}.functions.supabase.co/picks-engine${force ? "?refresh=1" : ""}`;
      const r = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${anon}`, apikey: anon },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const payload = (await r.json()) as PicksResponse;
      if (!payload || !Array.isArray(payload.calls)) throw new Error("Invalid response");
      setData(payload);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load picks");
    } finally {
      setLoading(false);
    }
  }, [data]);

  useEffect(() => {
    load();
    timerRef.current = window.setInterval(() => load(false), REFRESH_MS);
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = useMemo(() => {
    if (!data) return null;
    const topCall = data.calls[0];
    const topPut = data.puts[0];
    const aCalls = data.calls.filter((p) => p.grade === "A").length;
    const aPuts = data.puts.filter((p) => p.grade === "A").length;
    return { topCall, topPut, aCalls, aPuts };
  }, [data]);

  return (
    <div
      style={{
        background: PALETTE.bg,
        color: PALETTE.text,
        minHeight: "100vh",
        padding: "24px 28px",
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
      }}
    >
      <style>{`@keyframes picksShimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>

      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>⚡ AI Options Picks</h1>
          <div style={{ color: PALETTE.muted, fontSize: 13, marginTop: 4 }}>
            Scored across 38 tickers · 6-signal engine
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ ...mono, color: PALETTE.muted, fontSize: 12 }}>
            {data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : loading ? <Skeleton w={160} /> : "—"}
          </div>
          <button
            onClick={() => load(true)}
            disabled={loading}
            style={{
              background: PALETTE.accent,
              color: "#0d0f14",
              border: "none",
              padding: "8px 16px",
              borderRadius: 6,
              fontWeight: 700,
              fontSize: 13,
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            ↻ Refresh
          </button>
        </div>
      </header>

      {error && (
        <div style={{ marginTop: 16, padding: 12, background: "#3b1d1d", border: "1px solid #ef5350", borderRadius: 8, color: "#ffcdd2" }}>
          {error} · <button onClick={() => load(true)} style={{ marginLeft: 8, color: PALETTE.accent, background: "transparent", border: "none", cursor: "pointer", fontWeight: 700 }}>Retry</button>
        </div>
      )}

      {/* Summary strip */}
      <div
        style={{
          marginTop: 20,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        {[
          { label: "Top Call", value: summary?.topCall ? <><span style={{ ...mono, color: PALETTE.accent, fontWeight: 700, marginRight: 8 }}>{summary.topCall.ticker}</span><GradePill g={summary.topCall.grade} /></> : <Skeleton w={80} /> },
          { label: "Top Put", value: summary?.topPut ? <><span style={{ ...mono, color: PALETTE.accent, fontWeight: 700, marginRight: 8 }}>{summary.topPut.ticker}</span><GradePill g={summary.topPut.grade} /></> : <Skeleton w={80} /> },
          { label: "Grade A Calls", value: summary ? <span style={{ ...mono, fontSize: 22, fontWeight: 700, color: PALETTE.accent }}>{summary.aCalls}</span> : <Skeleton w={32} h={22} /> },
          { label: "Grade A Puts", value: summary ? <span style={{ ...mono, fontSize: 22, fontWeight: 700, color: PALETTE.accent }}>{summary.aPuts}</span> : <Skeleton w={32} h={22} /> },
        ].map((card) => (
          <div key={card.label} style={{ background: PALETTE.card, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: 14 }}>
            <div style={{ color: PALETTE.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>{card.label}</div>
            <div style={{ marginTop: 8, display: "flex", alignItems: "center" }}>{card.value}</div>
          </div>
        ))}
      </div>

      {!loading && data && data.calls.length === 0 && data.puts.length === 0 && (
        <div style={{ marginTop: 40, textAlign: "center", color: PALETTE.muted }}>
          No picks available — click Refresh to load.
        </div>
      )}

      {data && (
        <>
          <Section title="📈 TOP CALL PICKS" headerBg={PALETTE.callHeader} rows={data.calls} kind="call" />
          <Section title="📉 TOP PUT PICKS" headerBg={PALETTE.putHeader} rows={data.puts} kind="put" />
        </>
      )}
    </div>
  );
}
