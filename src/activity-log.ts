export type ActivityOutcome = 'ok' | 'error' | 'held' | 'approved' | 'denied' | 'ran' | 'failed';

export type ActivityEntry = {
  id: string;
  at: string;
  kind: 'tool' | 'approval';
  toolName: string;
  speakerId: string | null;
  speakerEmail: string | null;
  source: 'person' | 'job' | 'agent';
  connectorOwnerEmail: string | null;
  argumentsJson: string;
  outcome: ActivityOutcome;
  durationMs?: number;
  approvalId?: string;
};

export type ActivityView = Omit<ActivityEntry, 'argumentsJson'> & {
  argumentsJson: string | null;
  private: boolean;
};

export const activityKeyPrefix = 'activity:';
export const activityLimit = 500;
const maximumArgumentsCharacters = 4000;
const redacted = '[redacted]';
const secretKey = new RegExp('token|secret|password|passwd|authorization|api[_-]?key|cookie|credential|private[_-]?key|session', 'i');
const secretValue = new RegExp('(^|\\s)(bearer\\s+\\S+|eyJ[\\w-]{8,}\\.[\\w-]{8,}\\.[\\w-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|glpat-[\\w-]{16,}|sk-[A-Za-z0-9_-]{16,}|xox[abprs]-[\\w-]{10,})', 'i');

function nestedJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function redactValue(value: unknown, key: string | undefined): unknown {
  if (key !== undefined && secretKey.test(key)) return redacted;
  if (typeof value === 'string') {
    const nested = nestedJson(value);
    if (nested !== undefined) return JSON.stringify(redactValue(nested, undefined));
    return secretValue.test(value) ? redacted : value;
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, undefined));
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey)]));
  return value;
}

export function redactedArguments(value: unknown): string {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = value;
    }
  }
  const text = JSON.stringify(redactValue(parsed ?? {}, undefined)) ?? '{}';
  return text.length > maximumArgumentsCharacters ? `${text.slice(0, maximumArgumentsCharacters)}… truncated` : text;
}

export function activityKey(entry: Pick<ActivityEntry, 'at' | 'id'>): string {
  return `${activityKeyPrefix}${entry.at}:${entry.id}`;
}

export function canSeeDetails(entry: ActivityEntry, viewer: { id: string; email: string }): boolean {
  const email = viewer.email.toLowerCase();
  return entry.speakerId === viewer.id || entry.speakerEmail === email || entry.connectorOwnerEmail === email || entry.source !== 'person';
}

export function activityFor(entries: readonly ActivityEntry[], viewer: { id: string; email: string }): ActivityView[] {
  return [...entries]
    .sort((left, right) => right.at.localeCompare(left.at))
    .map((entry) => {
      const visible = canSeeDetails(entry, viewer);
      return { ...entry, argumentsJson: visible ? entry.argumentsJson : null, private: !visible };
    });
}
