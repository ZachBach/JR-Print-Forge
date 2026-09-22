/**
 * Ship-by date math. Weekends are skipped; public holidays are not modelled
 * yet, so the date is a floor rather than a promise — the firm quote confirms.
 */
export function addBusinessDays(from: Date, days: number): Date {
  const out = new Date(from.getTime());
  let added = 0;
  while (added < days) {
    out.setDate(out.getDate() + 1);
    const d = out.getDay();
    if (d !== 0 && d !== 6) added++;
  }
  return out;
}

export function formatShipBy(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
