export type ExpiringRecord = { expiresAt: number };

export function expiringRecordKeysToDelete<T extends ExpiringRecord>(
  records: ReadonlyArray<readonly [string, T]>,
  now: number,
  capacity: number,
): string[] {
  const expired = records.filter(([, record]) => record.expiresAt <= now).map(([key]) => key);
  const live = records.filter(([, record]) => record.expiresAt > now).map(([key]) => key);
  return [...expired, ...live.slice(0, Math.max(0, live.length - capacity))];
}
