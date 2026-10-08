import { describe, expect, test } from 'bun:test';
import type { CommunicationEvent } from './agent-communication';
import { boundedCommunicationEvents, contextRadius, createFleetLayout } from './fleet-operations';

const agents = [
  {
    id: 'root',
    parentId: null,
    title: 'Root',
    avatarSeed: 'r',
    status: 'active' as const,
    context: { used: 4, capacity: 8, ratio: 0.5 },
  },
  {
    id: 'child',
    parentId: 'root',
    title: 'Child',
    avatarSeed: 'c',
    status: 'idle' as const,
    context: { used: 1, capacity: 8, ratio: 0.125 },
  },
];

describe('fleet operations layout', () => {
  test('is deterministic and bounded by the viewport', () => {
    const first = createFleetLayout(agents, 800, 500);
    expect(createFleetLayout([...agents].reverse(), 800, 500)).toEqual(first);
    expect(
      first.every((point) => point.x >= 54 && point.x <= 746 && point.y >= 54 && point.y <= 446),
    ).toBe(true);
  });

  test('fits a non-overlapping dense force graph', () => {
    const dense = Array.from({ length: 80 }, (_, index) => ({
      ...agents[1],
      id: `agent-${index}`,
      parentId: index === 0 ? null : 'agent-0',
    }));
    const points = createFleetLayout(dense, 300, 200);
    expect(
      points.every((point, index) =>
        points
          .slice(index + 1)
          .every(
            (other) =>
              Math.hypot(point.x - other.x, point.y - other.y) >= point.radius + other.radius + 4,
          ),
      ),
    ).toBe(true);
  });

  test('clamps context radius', () => {
    expect(contextRadius(-1)).toBe(26);
    expect(contextRadius(0.5)).toBe(34);
    expect(contextRadius(2)).toBe(42);
  });

  test('bounds and strips communication details', () => {
    const events: CommunicationEvent[] = Array.from({ length: 120 }, (_, index) => ({
      id: String(index),
      type: 'communication.sent',
      fromAgentId: 'root',
      toAgentId: 'child',
      action: 'message',
      occurredAt: new Date(index * 1000).toISOString(),
      reason: 'private detail',
    }));
    const result = boundedCommunicationEvents(events, new Set(['root', 'child']), 500);
    expect(result).toHaveLength(100);
    expect(result[0]?.id).toBe('119');
    expect('reason' in (result[0] ?? {})).toBe(false);
  });
});
