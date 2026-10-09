const minute = 60;
const hour = 60 * minute;
const day = 24 * hour;

export function relativeTime(occurredAt: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(occurredAt)) / 1_000));
  if (seconds < 10) return 'just now';
  if (seconds < minute) return `${seconds}s ago`;
  if (seconds < hour) return `${Math.floor(seconds / minute)}m ago`;
  if (seconds < day) return `${Math.floor(seconds / hour)}h ago`;
  if (seconds < 30 * day) return `${Math.floor(seconds / day)}d ago`;
  return new Date(occurredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
