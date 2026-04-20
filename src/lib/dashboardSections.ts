// Dashboard section visibility — shared between Dashboard (hide button) and
// Settings (restore list). One localStorage key holds every hidden section id
// across both the outer column and the right-rail SortableLists.
import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "nova_dashboard_hidden_sections";
const EVENT = "nova:hidden-sections-changed";

/** Friendly labels for every section id used on the dashboard. Keep in sync
 *  with the `items=[{id…}]` arrays inside Dashboard.tsx. */
export const SECTION_LABELS: Record<string, string> = {
  // Outer column
  futures: "Pre-Market Futures",
  "nova-status": "NOVA Status Strip",
  "nova-filter": "NOVA Filter Bar",
  hero: "Market Hero Cards",
  etfs: "Sector ETFs",
  watchlist: "Watchlist",
  "opportunities-grid": "Top Opportunities + Right Rail",
  // Right rail
  events: "Event Watch",
  "ai-summary": "AI Summary of the Day",
  tips: "Tips Rotator",
  playbook: "Playbook",
  news: "Reuters News",
  sectors: "Sector Breakdown",
};

function readHidden(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeHidden(ids: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Hook returns the current hidden-set + helpers. Re-renders when the set
 *  changes from any tab (storage event) or any component (custom event). */
export function useHiddenSections() {
  const [hidden, setHidden] = useState<string[]>(() => readHidden());

  useEffect(() => {
    const sync = () => setHidden(readHidden());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const hide = useCallback((id: string) => {
    const next = Array.from(new Set([...readHidden(), id]));
    writeHidden(next);
  }, []);

  const restore = useCallback((id: string) => {
    const next = readHidden().filter((x) => x !== id);
    writeHidden(next);
  }, []);

  const restoreAll = useCallback(() => writeHidden([]), []);

  return { hidden, hiddenSet: new Set(hidden), hide, restore, restoreAll };
}

export function labelFor(id: string): string {
  return SECTION_LABELS[id] ?? id;
}
