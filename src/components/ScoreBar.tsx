// Renders a single score (0-100) as a color-coded bar with label and note.
interface ScoreBarProps {
  label: string;
  score: number;
  note?: string;
  compact?: boolean;
}

export function ScoreBar({ label, score, note, compact = false }: ScoreBarProps) {
  const fillColor =
    score >= 80 ? "hsl(var(--success, 142 71% 45%))" :
    score >= 60 ? "hsl(var(--primary))" :
    score >= 40 ? "hsl(var(--warning, 38 92% 50%))" : "hsl(var(--destructive))";
  const barHeight = compact ? 6 : 8;

  return (
    <div style={{ marginBottom: compact ? 6 : 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
        <span className="text-muted-foreground" style={{ fontSize: compact ? 11 : 12, fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: compact ? 11 : 12, color: fillColor, fontWeight: 700 }}>{score}/100</span>
      </div>
      <div style={{ background: "hsl(var(--muted))", borderRadius: 4, height: barHeight, overflow: "hidden" }}>
        <div style={{ background: fillColor, width: `${Math.max(0, Math.min(100, score))}%`, height: "100%", borderRadius: 4, transition: "width 0.4s ease" }} />
      </div>
      {!compact && note && (
        <div className="text-muted-foreground" style={{ fontSize: 11, marginTop: 3, opacity: 0.8 }}>{note}</div>
      )}
    </div>
  );
}
