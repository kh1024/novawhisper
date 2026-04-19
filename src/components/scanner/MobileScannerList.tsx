// Virtualized list for the mobile scanner. Uses react-window so we only render
// the ~5 cards visible on screen instead of all 50+. Each card is memoized
// inside MobileScannerCard so price ticks don't re-render the entire list.
import { useEffect, useRef, useState, useMemo } from "react";
import { VariableSizeList as List } from "react-window";
import { MobileScannerCard } from "./MobileScannerCard";
import type { SetupRow } from "@/lib/setupScore";
import type { VerdictResult } from "@/lib/verdictModel";
import type { ValidationResult } from "@/lib/gates";

interface Props {
  rows: SetupRow[];
  verdictByRow: Map<string, VerdictResult>;
  budgetByRow?: Map<string, ValidationResult>;
  guardBySymbol?: Map<string, any>;
  buildContract: (r: SetupRow) => {
    symbol: string;
    optionType: "call" | "put";
    direction: string;
    strike: number;
    expiry: string;
  };
  onOpen: (symbol: string) => void;
}

// Approximate heights — collapsed card vs. expanded. Real layout still works
// because react-window only uses these as scroll math; visual layout is
// unchanged by the estimate.
const COLLAPSED_H = 168;
const GAP = 12;

export function MobileScannerList({ rows, verdictByRow, budgetByRow, guardBySymbol, buildContract, onOpen }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<List>(null);
  const [height, setHeight] = useState(600);
  const [width, setWidth] = useState(360);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth);
      // Use viewport minus a comfortable buffer so the list scrolls inside the
      // page but the page itself still scrolls naturally above/below.
      const vh = window.innerHeight;
      const top = el.getBoundingClientRect().top;
      setHeight(Math.max(400, vh - top - 16));
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    const vh = window.innerHeight;
    const top = el.getBoundingClientRect().top;
    setHeight(Math.max(400, vh - top - 16));
    return () => ro.disconnect();
  }, []);

  const itemSize = (_: number) => COLLAPSED_H + GAP;

  // Reset cached sizes when row count changes.
  useMemo(() => {
    listRef.current?.resetAfterIndex(0);
  }, [rows.length]);

  return (
    <div
      ref={containerRef}
      // Smooth momentum scrolling on iOS / Android.
      style={{
        WebkitOverflowScrolling: "touch",
        overscrollBehavior: "contain",
      }}
    >
      <List
        ref={listRef}
        height={height}
        width={width}
        itemCount={rows.length}
        itemSize={itemSize}
        overscanCount={3}
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {({ index, style }) => {
          const r = rows[index];
          const contract = buildContract(r);
          return (
            <div style={{ ...style, paddingBottom: GAP }}>
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
        }}
      </List>
    </div>
  );
}
