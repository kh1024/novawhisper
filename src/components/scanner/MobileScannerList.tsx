// Mobile scanner list. We rely on React.memo inside MobileScannerCard so a
// single ticker price update only re-renders that one card — the bottleneck
// the user reported. With ~60 compact cards on a phone, plain rendering is
// smooth; full virtualization broke the in-card Accordion (fixed row heights
// caused expanded panels to clip the next card), so we skip it.
import { MobileScannerCard } from "./MobileScannerCard";
import type { SetupRow } from "@/lib/setupScore";
import type { VerdictResult } from "@/lib/verdictModel";
import type { ValidationResult } from "@/lib/gates";

type Contract = {
  symbol: string;
  optionType: "call" | "put";
  direction: string;
  strike: number;
  expiry: string;
};

interface Props {
  rows: SetupRow[];
  verdictByRow: Map<string, VerdictResult>;
  budgetByRow?: Map<string, ValidationResult>;
  guardBySymbol?: Map<string, any>;
  buildContract: (r: SetupRow) => Contract;
  onOpen: (symbol: string) => void;
}

export function MobileScannerList({ rows, verdictByRow, budgetByRow, guardBySymbol, buildContract, onOpen }: Props) {
  return (
    <div
      className="flex flex-col gap-3"
      style={{
        WebkitOverflowScrolling: "touch",
        overscrollBehavior: "contain",
      }}
    >
      {rows.map((r) => (
        <MobileScannerCard
          key={r.symbol}
          row={r}
          verdict={verdictByRow.get(r.symbol) ?? null}
          budgetCheck={budgetByRow?.get(r.symbol) ?? null}
          guard={guardBySymbol?.get(r.symbol) ?? null}
          contract={buildContract(r)}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
