import { Bookmark, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAddPosition, type NewPosition } from "@/lib/portfolio";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface Props extends NewPosition {
  size?: "sm" | "xs";
  className?: string;
}

export function SaveToPortfolioButton({ size = "sm", className, ...pick }: Props) {
  const add = useAddPosition();
  const [saved, setSaved] = useState(false);
  return (
    <Button
      size="sm"
      variant={saved ? "secondary" : "outline"}
      className={cn(size === "xs" ? "h-6 px-2 text-[10px]" : "h-7 px-2 text-[11px]", className)}
      disabled={add.isPending || saved}
      onClick={(e) => {
        e.stopPropagation();
        add.mutate(pick, { onSuccess: () => setSaved(true) });
      }}
    >
      {saved ? <Check className="mr-1 h-3 w-3" /> : <Bookmark className="mr-1 h-3 w-3" />}
      {saved ? "Saved" : add.isPending ? "Saving…" : "Save"}
    </Button>
  );
}
