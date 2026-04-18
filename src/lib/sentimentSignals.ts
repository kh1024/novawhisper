// Derives "Memory Supercycle" and "Energy Wall" sentiment signals from the
// existing news feed by counting keyword hits over the last ~12h of headlines.
// No new data source required — proxies real narratives from Finnhub news.
import { useNews } from "./liveData";
import { useMemo } from "react";

const MEMORY_TERMS = [
  "hbm", "hbm3e", "hbm4", "high-bandwidth memory", "memory chip",
  "micron", "mu ", "sk hynix", "samsung memory", "dram", "nand",
  "memory supercycle", "memory shortage", "memory pricing",
];

const ENERGY_TERMS = [
  "data center power", "grid", "power grid", "energy wall",
  "gigawatt", "power constraint", "electricity demand",
  "power shortage", "data center energy", "ai power",
  "transmission", "utility capacity",
];

const POSITIVE_HINTS = ["surge", "record", "demand", "boom", "raise", "raised", "beat", "tight", "shortage", "outpac"];
const NEGATIVE_HINTS = ["pullback", "warning", "constrain", "limit", "delay", "miss", "halt", "outage", "risk"];

export type SentimentTone = "good" | "ok" | "bad";

export interface SentimentSignal {
  tone: SentimentTone;
  status: string;       // big plain-English word
  meter: number;        // 0-100
  detail: string;       // small subtitle
  hits: number;
}

function scoreFeed(items: { headline: string; summary: string }[], terms: string[]): {
  hits: number;
  pos: number;
  neg: number;
  topHeadline?: string;
} {
  let hits = 0, pos = 0, neg = 0;
  let topHeadline: string | undefined;
  for (const it of items) {
    const text = `${it.headline} ${it.summary}`.toLowerCase();
    const matched = terms.some((t) => text.includes(t));
    if (!matched) continue;
    hits += 1;
    if (!topHeadline) topHeadline = it.headline;
    if (POSITIVE_HINTS.some((h) => text.includes(h))) pos += 1;
    if (NEGATIVE_HINTS.some((h) => text.includes(h))) neg += 1;
  }
  return { hits, pos, neg, topHeadline };
}

/** Pull the general news feed and derive Memory + Energy signals from it. */
export function useNarrativeSignals() {
  const { data: items = [], isLoading } = useNews({ category: "general", limit: 40 });

  return useMemo(() => {
    const memory = scoreFeed(items, MEMORY_TERMS);
    const energy = scoreFeed(items, ENERGY_TERMS);

    // Memory: hits=demand signal. More hits + positive lean = "Hot Tailwind".
    const memTone: SentimentTone =
      memory.hits >= 3 && memory.pos >= memory.neg ? "good" :
      memory.hits >= 1 ? "ok" : "bad";
    const memStatus =
      memTone === "good" ? "Hot Tailwind" :
      memTone === "ok" ? "Building" : "Quiet";
    const memSignal: SentimentSignal = {
      tone: memTone,
      status: memStatus,
      meter: Math.min(100, 25 + memory.hits * 18),
      detail: memory.topHeadline
        ? `${memory.hits} HBM/memory mentions · "${memory.topHeadline.slice(0, 60)}${memory.topHeadline.length > 60 ? "…" : ""}"`
        : `No memory-cycle headlines yet (HBM3E/HBM4/Micron)`,
      hits: memory.hits,
    };

    // Energy: hits=risk signal. More hits, especially negative = "Wall Pressure".
    const energyDanger = energy.neg >= 1 || energy.hits >= 3;
    const energyTone: SentimentTone =
      energyDanger ? "bad" :
      energy.hits >= 1 ? "ok" : "good";
    const energyStatus =
      energyTone === "bad" ? "Wall Pressure" :
      energyTone === "ok" ? "Watch" : "Clear";
    const energySignal: SentimentSignal = {
      tone: energyTone,
      status: energyStatus,
      meter: energyTone === "bad" ? 85 : energyTone === "ok" ? 50 : 18,
      detail: energy.topHeadline
        ? `${energy.hits} grid/power mentions · "${energy.topHeadline.slice(0, 60)}${energy.topHeadline.length > 60 ? "…" : ""}"`
        : `No grid/power constraint headlines today`,
      hits: energy.hits,
    };

    return { memory: memSignal, energy: energySignal, isLoading };
  }, [items, isLoading]);
}
