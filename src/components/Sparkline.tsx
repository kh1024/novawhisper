// Tiny inline-SVG sparkline. No axes, no labels, no deps.
// Color tracks direction: bullish if last > first, else bearish.
// Used on NovaVerdictCard to give a glanceable trend/exhaustion read.
import { useMemo } from "react";

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  /** Optional fixed band (e.g. [0,100] for RSI). Auto-fits otherwise. */
  domain?: [number, number];
  /** Optional reference lines (e.g. [30, 70] for RSI). */
  refs?: number[];
  className?: string;
  ariaLabel?: string;
}

export function Sparkline({
  values,
  width = 96,
  height = 28,
  domain,
  refs,
  className,
  ariaLabel,
}: SparklineProps) {
  const path = useMemo(() => {
    if (!values || values.length < 2) return null;
    const min = domain ? domain[0] : Math.min(...values);
    const max = domain ? domain[1] : Math.max(...values);
    const span = max - min || 1;
    const stepX = width / (values.length - 1);
    const pts = values.map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / span) * height;
      return [x, y] as const;
    });
    const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const areaD = `${d} L${width.toFixed(1)},${height} L0,${height} Z`;
    const refLines =
      refs && domain
        ? refs.map((r) => height - ((r - domain[0]) / span) * height)
        : [];
    return { d, areaD, refLines, last: pts[pts.length - 1] };
  }, [values, width, height, domain, refs]);

  if (!path) return null;
  const up = values[values.length - 1] >= values[0];
  const stroke = up ? "hsl(var(--bullish))" : "hsl(var(--bearish))";
  const fill = up ? "hsl(var(--bullish) / 0.12)" : "hsl(var(--bearish) / 0.12)";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={ariaLabel ?? "Trend sparkline"}
    >
      {path.refLines.map((y, i) => (
        <line
          key={i}
          x1={0}
          x2={width}
          y1={y}
          y2={y}
          stroke="hsl(var(--muted-foreground) / 0.25)"
          strokeDasharray="2 2"
          strokeWidth={0.5}
        />
      ))}
      <path d={path.areaD} fill={fill} />
      <path d={path.d} stroke={stroke} strokeWidth={1.25} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={path.last[0]} cy={path.last[1]} r={1.6} fill={stroke} />
    </svg>
  );
}
