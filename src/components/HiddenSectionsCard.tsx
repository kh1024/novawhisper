// Settings card — lists every dashboard section the user has hidden.
// Click the section name to bring it back (animates in on the dashboard).
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EyeOff, Eye, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useHiddenSections, labelFor } from "@/lib/dashboardSections";
import { toast } from "sonner";

export function HiddenSectionsCard() {
  const { hidden, restore, restoreAll } = useHiddenSections();

  return (
    <Card className="glass-card p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <EyeOff className="h-4 w-4 text-primary" /> Hidden Dashboard Sections
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-md">
            Sections you've hidden from the dashboard. Click any name below to bring it back.
          </p>
        </div>
        {hidden.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => { restoreAll(); toast.success("All sections restored"); }}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Restore all
          </Button>
        )}
      </div>

      {hidden.length === 0 ? (
        <div className="text-xs text-muted-foreground rounded-md border border-dashed border-border/60 bg-surface/30 p-4 text-center">
          Nothing hidden — every dashboard section is visible.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <AnimatePresence mode="popLayout">
            {hidden.map((id) => (
              <motion.button
                key={id}
                layout
                initial={{ opacity: 0, scale: 0.85, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.7, y: 8 }}
                transition={{ type: "spring", stiffness: 360, damping: 26 }}
                onClick={() => { restore(id); toast.success(`${labelFor(id)} restored`); }}
                className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-surface/40 hover:border-primary/60 hover:bg-primary/10 hover:text-primary transition-colors text-xs"
                title="Click to restore on the dashboard"
              >
                <Eye className="h-3 w-3 opacity-60 group-hover:opacity-100" />
                {labelFor(id)}
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}
    </Card>
  );
}
