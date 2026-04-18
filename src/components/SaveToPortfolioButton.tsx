import { Bookmark, Check, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAddPosition, type NewPosition } from "@/lib/portfolio";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface Props extends NewPosition {
  size?: "sm" | "xs";
  className?: string;
}

export function SaveToPortfolioButton({ size = "sm", className, ...pick }: Props) {
  const add = useAddPosition();
  const [settings] = useSettings();
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);
  const [contracts, setContracts] = useState<string>(String(pick.contracts ?? 1));
  const [premium, setPremium] = useState<string>(
    pick.entryPremium != null ? String(pick.entryPremium) : ""
  );

  const submit = (e: React.MouseEvent) => {
    e.stopPropagation();
    const n = Math.max(1, Math.floor(Number(contracts) || 1));
    const p = premium.trim() === "" ? null : Number(premium);
    add.mutate(
      { ...pick, contracts: n, entryPremium: Number.isFinite(p as number) ? (p as number) : null, isPaper: settings.paperMode },
      {
        onSuccess: () => {
          setSaved(true);
          setOpen(false);
        },
      },
    );
  };

  const cost =
    Number(premium) > 0 && Number(contracts) > 0
      ? (Number(premium) * Number(contracts) * 100).toFixed(0)
      : null;

  return (
    <Popover open={open} onOpenChange={(o) => !saved && setOpen(o)}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant={saved ? "secondary" : "outline"}
          className={cn(size === "xs" ? "h-6 px-2 text-[10px]" : "h-7 px-2 text-[11px]", className)}
          disabled={saved}
          onClick={(e) => e.stopPropagation()}
        >
          {saved ? <Check className="mr-1 h-3 w-3" /> : <Bookmark className="mr-1 h-3 w-3" />}
          {saved ? "Saved" : "Save"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" onClick={(e) => e.stopPropagation()} align="end">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {settings.paperMode ? "Save as paper trade" : "Save to portfolio"}
            </div>
            {settings.paperMode && (
              <span className="text-[9px] px-1.5 py-0.5 rounded border border-warning/40 bg-warning/10 text-warning flex items-center gap-1">
                <FlaskConical className="h-2.5 w-2.5" /> SIM
              </span>
            )}
          </div>
          <div className="font-mono text-xs">
            {pick.symbol} ${pick.strike}
            {pick.strikeShort ? `/${pick.strikeShort}` : ""} {pick.optionType.toUpperCase()} ·{" "}
            {pick.expiry}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Contracts
              </Label>
              <Input
                type="number"
                min={1}
                step={1}
                value={contracts}
                onChange={(e) => setContracts(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Entry $/contract
              </Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                value={premium}
                onChange={(e) => setPremium(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>
          {cost && (
            <div className="text-[10px] text-muted-foreground">
              Total cost: <span className="font-mono text-foreground">${cost}</span>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px]"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-[11px]"
              disabled={add.isPending}
              onClick={submit}
            >
              {add.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
