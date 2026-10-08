export type LiveToolActivity = {
  id: string;
  name: string;
  status: 'running' | 'complete' | 'error';
  startedAt: string;
  completedAt?: string;
  arguments?: string;
  result?: string;
};

export type LiveFrame =
  | { type: 'ready'; cursor?: number }
  | { type: 'changed' }
  | { type: 'fleet'; event: { cursor: number; type: string; agentId: string } & Record<string, unknown> }
  | { type: 'progress'; messageId: string; text: string; tools: LiveToolActivity[] }
  | { type: 'closing'; code: number; reason: string };

export type SubscriberAttachment = {
  agentScope: string;
  expiresAt: number | null;
};

export function encodeFrame(frame: LiveFrame): string {
  return JSON.stringify(frame);
}

export function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket';
}

export type FleetLineage = ReadonlyMap<string, string | null>;

export function isWithinScope(scope: string, agentId: string, lineage: FleetLineage): boolean {
  let current: string | null | undefined = agentId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    if (current === scope) return true;
    visited.add(current);
    current = lineage.get(current);
  }
  return false;
}

export function subscriberSees(
  attachment: SubscriberAttachment,
  event: { agentId: string; payload?: Record<string, unknown> },
  lineage: FleetLineage = new Map(),
): boolean {
  if (attachment.agentScope === '*') return true;
  if (isWithinScope(attachment.agentScope, event.agentId, lineage)) return true;
  const parentId = event.payload?.parentId;
  return typeof parentId === 'string' && isWithinScope(attachment.agentScope, parentId, lineage);
}

export function subscriberExpired(attachment: SubscriberAttachment, now: number): boolean {
  return attachment.expiresAt !== null && attachment.expiresAt <= now;
}

export function parseCursor(value: string | null, latest: number): number {
  if (value === 'latest') return latest;
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function parseAttachment(value: unknown): SubscriberAttachment | null {
  if (typeof value !== 'object' || value === null) return null;
  const record: Record<string, unknown> = { ...value };
  if (typeof record.agentScope !== 'string') return null;
  const expiresAt = record.expiresAt;
  if (expiresAt !== null && typeof expiresAt !== 'number') return null;
  return { agentScope: record.agentScope, expiresAt };
}

export class FrameCoalescer {
  private readonly pending = new Map<string, LiveFrame>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly send: (frame: LiveFrame) => void,
    private readonly intervalMilliseconds = 50,
  ) {}

  push(key: string, frame: LiveFrame): void {
    this.pending.set(key, frame);
    this.timer ??= setTimeout(() => this.flush(), this.intervalMilliseconds);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const frames = [...this.pending.values()];
    this.pending.clear();
    for (const frame of frames) this.send(frame);
  }
}
