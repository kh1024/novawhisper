import { Card } from "@/components/ui/card";
import { Construction } from "lucide-react";

export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-8 max-w-[1600px] mx-auto">
      <h1 className="text-2xl font-semibold tracking-tight mb-1">{title}</h1>
      <p className="text-sm text-muted-foreground mb-6">{description}</p>
      <Card className="glass-card-elevated p-12 text-center">
        <div className="inline-flex h-14 w-14 rounded-full bg-primary/10 items-center justify-center mb-4">
          <Construction className="h-6 w-6 text-primary" />
        </div>
        <h2 className="text-lg font-semibold mb-2">Workspace coming next</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          The foundation, design system, ticker tape, Dashboard, Market Scanner, and Research drawer are live.
          This workspace is scaffolded and ready to be built out in the next pass.
        </p>
      </Card>
    </div>
  );
}
