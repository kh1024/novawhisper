// SEC EDGAR Form 4 insider activity panel — uses /edgar-insiders edge function.
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, FileText, AlertTriangle } from "lucide-react";
import { useInsiderFilings } from "@/lib/fundamentals";

interface Props {
  symbol: string | null;
}

export function InsiderActivityPanel({ symbol }: Props) {
  const { data, isLoading, error } = useInsiderFilings(symbol, 12);

  if (!symbol) return null;
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }
  if (error) {
    return (
      <Card className="glass-card p-4 border-warning/40 bg-warning/5">
        <div className="flex items-start gap-2 text-warning text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">SEC EDGAR unavailable</div>
            <div className="text-warning/80 mt-0.5">
              {error instanceof Error ? error.message : "Couldn't reach EDGAR."}
            </div>
          </div>
        </div>
      </Card>
    );
  }

  if (!data || data.filings.length === 0) {
    return (
      <Card className="glass-card p-4 text-center text-sm text-muted-foreground">
        No recent Form 4 filings on file for {symbol}.
        {!data?.cik && (
          <div className="text-[10px] mt-1">Ticker not mapped to a SEC registrant.</div>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{data.count} recent insider filing{data.count === 1 ? "" : "s"}</span>
        {data.cik && (
          <a
            href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${data.cik}&type=4&dateb=&owner=include&count=40`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            All on EDGAR <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {data.filings.map((f) => (
        <Card key={f.accessionNumber} className="glass-card p-3 flex items-center gap-3">
          <FileText className="h-4 w-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-[10px] border-primary/40 bg-primary/10 text-primary">
                Form {f.form}
              </Badge>
              <span className="text-xs text-foreground/90 truncate">{f.description}</span>
            </div>
            <div className="text-[11px] text-muted-foreground mono mt-0.5">
              Filed {f.filedAt}
              {f.reportingDate && f.reportingDate !== f.filedAt && ` · txn ${f.reportingDate}`}
            </div>
          </div>
          <Button asChild size="sm" variant="ghost" className="h-7 gap-1 text-[11px]">
            <a href={f.url} target="_blank" rel="noreferrer">
              View <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
        </Card>
      ))}

      <div className="text-[10px] text-muted-foreground text-right pt-1">
        Source: SEC EDGAR · cached 1h
      </div>
    </div>
  );
}
