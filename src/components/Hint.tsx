import { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface HintProps {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  delay?: number;
  asChild?: boolean;
}

/**
 * Lightweight tooltip wrapper for icon-only buttons and key actions.
 * TooltipProvider is mounted globally in App.tsx.
 */
export function Hint({
  label,
  children,
  side = "top",
  align = "center",
  asChild = true,
}: HintProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild={asChild}>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align} className="max-w-[240px] text-xs leading-snug">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
