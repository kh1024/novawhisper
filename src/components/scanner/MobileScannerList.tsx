// Virtualized list for the mobile scanner. Uses react-window v2 so we only
// render the ~5 cards visible on screen instead of all 50+. Each card is
// memoized inside MobileScannerCard so price ticks don't re-render the list.
import { List, type RowComponentProps } from "react-window";
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

// Row height — collapsed card. Accordion expands inside the card; on mobile
// the page itself scrolls so the expanded body is reachable below the list.
const ROW_HEIGHT = 188;

type RowProps = {
  rows: SetupRow[];
  verdictByRow: Map<string, VerdictResult>;
  budgetByRow?: Map<string, ValidationResult>;
  guardBySymbol?: Map<string, any>;
  buildContract: (r: SetupRow) => Contract;
  onOpen: (symbol: string) => void;
};

function Row({ index, style, rows, verdictByRow, budgetByRow, guardBySymbol, buildContract, onOpen }: RowComponentProps<RowProps>) {
  const r = rows[index];
  if (!r) return null;
  const contract = buildContract(r);
  return (
    <div style={{ ...style, paddingBottom: 12 }}>
      <MobileScannerCard
        row={r}
        verdict={verdictByRow.get(r.symbol) ?? null}
        budgetCheck={budgetByRow?.get(r.symbol) ?? null}
        guard={guardBySymbol?.get(r.symbol) ?? null}
        contract={contract}
        onOpen={onOpen}
      />
    </div>
  );
}

export function MobileScannerList({ rows, verdictByRow, budgetByRow, guardBySymbol, buildContract, onOpen }: Props) {
  return (
    <div
      // Smooth momentum scrolling on iOS / Android.
      style={{
        WebkitOverflowScrolling: "touch",
        overscrollBehavior: "contain",
        height: "calc(100vh - 16px)",
        maxHeight: "75vh",
      }}
    >
      <List
        rowComponent={Row}
        rowCount={rows.length}
        rowHeight={ROW_HEIGHT}
        overscanCount={3}
        rowProps={{ rows, verdictByRow, budgetByRow, guardBySymbol, buildContract, onOpen }}
        style={{ WebkitOverflowScrolling: "touch", height: "100%" }}
      />
    </div>
  );
}
