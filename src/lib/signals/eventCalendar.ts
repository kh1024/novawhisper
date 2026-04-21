/**
 * eventCalendar.ts
 * Detects US market event days that increase tail risk for short vol strategies.
 * Used by signal engine + adapter to block or warn on scale-in entries.
 *
 * Sources:
 *   - SPY IC Scale-In strategy: reddit.com/r/options/comments/1rgiezk
 *   - Hold-to-Expiry research:  reddit.com/r/options/comments/1r0hoqa
 */

/** Returns the Nth occurrence of a given weekday in a month.
 *  weekday: 0=Sun, 1=Mon, ..., 5=Fri */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  const dayOffset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + dayOffset + (n - 1) * 7);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** FOMC meeting dates 2025/2026 — published Federal Reserve schedule. */
const FOMC_DATES_2025: [number, number][] = [
  [0, 29], [2, 19], [4, 7], [5, 18], [6, 30], [8, 17], [9, 29], [11, 10],
];
const FOMC_DATES_2026: [number, number][] = [
  [0, 28], [2, 18], [4, 6], [5, 17], [7, 29], [8, 16], [9, 28], [11, 9],
];

function isFomcDay(date: Date): boolean {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const schedule = year === 2025 ? FOMC_DATES_2025 : year === 2026 ? FOMC_DATES_2026 : null;
  if (!schedule) {
    // Fallback approximation: 2nd Wednesday of every other month.
    const approxMonths = [0, 2, 4, 5, 6, 8, 9, 11];
    if (!approxMonths.includes(month)) return false;
    const candidate = nthWeekdayOfMonth(year, month, 3, 2);
    return sameDay(date, candidate);
  }
  return schedule.some(([m, d]) => m === month && d === day);
}

/** NFP = first Friday of every month. */
function isNfpDay(date: Date): boolean {
  const firstFriday = nthWeekdayOfMonth(date.getFullYear(), date.getMonth(), 5, 1);
  return sameDay(date, firstFriday);
}

/** CPI release: 2nd OR 3rd Wednesday approximation (BLS varies). */
function isCpiDay(date: Date): boolean {
  const secondWed = nthWeekdayOfMonth(date.getFullYear(), date.getMonth(), 3, 2);
  const thirdWed = nthWeekdayOfMonth(date.getFullYear(), date.getMonth(), 3, 3);
  return sameDay(date, secondWed) || sameDay(date, thirdWed);
}

const US_HOLIDAYS_2025: string[] = [
  "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18",
  "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01",
  "2025-11-27", "2025-12-25",
];
const US_HOLIDAYS_2026: string[] = [
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03",
  "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07",
  "2026-11-26", "2026-12-25",
];

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Extended weekend: Friday before a Monday US holiday. */
function isExtendedWeekendFriday(date: Date): boolean {
  if (date.getDay() !== 5) return false;
  const nextMonday = new Date(date);
  nextMonday.setDate(date.getDate() + 3);
  const allHolidays = [...US_HOLIDAYS_2025, ...US_HOLIDAYS_2026];
  return allHolidays.includes(toYMD(nextMonday));
}

/** True on any day that elevates short-vol tail risk. */
export function isEventDay(date?: Date): boolean {
  const d = date ?? new Date();
  return isFomcDay(d) || isNfpDay(d) || isCpiDay(d) || isExtendedWeekendFriday(d);
}

/** Human-readable warning string, or null when not an event day. */
export function getEventWarning(date?: Date): string | null {
  const d = date ?? new Date();
  const labels: string[] = [];
  if (isFomcDay(d)) labels.push("FOMC decision day");
  if (isNfpDay(d)) labels.push("NFP release (first Friday)");
  if (isCpiDay(d)) labels.push("CPI release day");
  if (isExtendedWeekendFriday(d)) labels.push("extended weekend Friday");
  return labels.length > 0 ? labels.join(" + ") : null;
}
