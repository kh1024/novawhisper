// NOVA AI Filter Bar — natural-language pick filter shared across
// Dashboard, Scanner, and Web Picks. Sends the query to the `nova-filter`
// edge function which returns a structured spec, then broadcasts it via
// the novaFilter store. Visible everywhere via AppLayout.
import { useState } from "react";
import { Sparkles, X, Loader2, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useNovaFilter, isFilterActive, type NovaFilterSpec } from "@/lib/novaFilter";
import { toast } from "sonner";

const EXAMPLES = [
  "picks for Monday, I have $500",
  "safe calls under $300 expiring this week",
  "bullish leaps on tech",
  "no earnings, aggressive puts under $200",
];

export function NovaFilterBar() {
  const [spec, setSpec, clear] = useNovaFilter();
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  async function run(query: string) {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("nova-filter", { body: { query } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const next: NovaFilterSpec = data?.spec ?? {};
      setSpec(next);
      toast.success("NOVA filter applied", { description: next.rationale ?? "Filter active across all pick lists." });
    } catch (e: any) {
      toast.error("Couldn't parse that ask", { description: e?.message ?? "Try rephrasing — e.g. 'safe calls under $500'." });
    } finally {
      setLoading(false);
    }
  }

  const active = isFilterActive(spec);

  return (
    <Card className="glass-card p-3 space-y-2">
      <form
        onSubmit={(e) => { e.preventDefault(); run(q); }}
        className="flex items-center gap-2"
      >
        <Sparkles className="h-4 w-4 text-primary shrink-0 ml-1" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='Ask NOVA to filter… e.g. "picks for Monday, I have $500"'
          className="bg-surface/40 border-border/60 h-9"
          disabled={loading}
        />
        <Button type="submit" size="sm" disabled={loading || !q.trim()} className="gap-1.5">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Filter
        </Button>
        {active && (
          <Button type="button" size="sm" variant="ghost" onClick={() => { clear(); setQ(""); }} className="gap-1.5">
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </form>

      {active ? (
        <ActiveSpec spec={spec} />
      ) : (
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Try:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => { setQ(ex); run(ex); }}
              className="text-[11px] px-2 py-0.5 rounded border border-border/60 bg-surface/40 hover:border-primary/40 hover:text-foreground text-muted-foreground transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function ActiveSpec({ spec }: { spec: NovaFilterSpec }) {
  const chips: { label: string; tone?: "primary" | "warn" }[] = [];
  if (spec.budget) chips.push({ label: `≤ $${spec.budget} / contract`, tone: "warn" });
  spec.riskBuckets?.forEach((r) => chips.push({ label: r }));
  spec.bias?.forEach((b) => chips.push({ label: b }));
  spec.optionTypes?.forEach((o) => chips.push({ label: o.toUpperCase() }));
  spec.strategies?.forEach((s) => chips.push({ label: s }));
  if (spec.expiryFrom || spec.expiryTo) chips.push({ label: `exp ${spec.expiryFrom ?? "…"} → ${spec.expiryTo ?? "…"}` });
  if (spec.maxDte != null) chips.push({ label: `≤ ${spec.maxDte}d` });
  if (spec.minDte != null) chips.push({ label: `≥ ${spec.minDte}d` });
  if (spec.minScore != null) chips.push({ label: `score ≥ ${spec.minScore}` });
  if (spec.minAnnualized != null) chips.push({ label: `ann ≥ ${spec.minAnnualized}%` });
  if (spec.excludeEarnings) chips.push({ label: "no earnings ≤ 7d" });
  spec.symbols?.forEach((s) => chips.push({ label: s, tone: "primary" }));
  spec.excludeSymbols?.forEach((s) => chips.push({ label: `≠ ${s}` }));

  return (
    <div className="px-1 space-y-1.5">
      {spec.rationale && (
        <p className="text-[11px] text-foreground/80 leading-snug">
          <Sparkles className="inline h-3 w-3 text-primary mr-1" />
          {spec.rationale}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {spec.budget != null && (
          <Badge variant="outline" className="text-[10px] gap-1 border-warning/40 bg-warning/10 text-warning">
            <Wallet className="h-2.5 w-2.5" /> Budget ${spec.budget}
          </Badge>
        )}
        {chips.filter((c) => !c.label.startsWith("≤ $")).map((c, i) => (
          <Badge
            key={i}
            variant="outline"
            className={
              c.tone === "primary" ? "text-[10px] border-primary/40 bg-primary/10 text-primary" :
              "text-[10px] border-border/60 bg-surface/60"
            }
          >
            {c.label}
          </Badge>
        ))}
      </div>
    </div>
  );
}
