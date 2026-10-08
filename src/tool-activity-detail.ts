const maximumDetailCharacters = 4_000;
const maximumDepth = 6;
const maximumEntries = 50;
const sensitiveKey = /authorization|cookie|token|secret|password|passphrase|api[_-]?key|credential|grant|assertion|private[_-]?key|session[_-]?id/i;
const bearerValue = /\b(bearer|basic)\s+[a-z0-9._~+/=-]{8,}/gi;
const longSecretValue = /\b(?:[a-f0-9]{40,}|eyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,})\b/gi;

function redactText(value: string): string {
  return value.replace(bearerValue, '$1 [redacted]').replace(longSecretValue, '[redacted]');
}

function redact(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= maximumDepth) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, maximumEntries).map((entry) => redact(entry, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, maximumEntries)
      .map(([key, entry]) => [key, sensitiveKey.test(key) ? '[redacted]' : redact(entry, depth + 1)]),
  );
}

function bounded(text: string): string {
  return text.length > maximumDetailCharacters ? `${text.slice(0, maximumDetailCharacters)}\n… truncated` : text;
}

export function toolArgumentsDetail(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return bounded(JSON.stringify(redact(value), null, 2) ?? '');
}

type ToolResultLike = { content?: ReadonlyArray<{ type: string; text?: string }>; details?: unknown };

export function toolResultDetail(result: ToolResultLike | undefined): string | undefined {
  if (!result) return undefined;
  const text = (result.content ?? [])
    .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : `[${part.type}]`))
    .join('\n')
    .trim();
  if (text) return bounded(redactText(text));
  if (result.details === undefined || result.details === null) return undefined;
  return bounded(JSON.stringify(redact(result.details), null, 2) ?? '');
}
