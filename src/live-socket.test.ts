import { describe, expect, test } from 'bun:test';
import {
  FrameCoalescer,
  type LiveFrame,
  isWebSocketUpgrade,
  parseAttachment,
  parseCursor,
  subscriberExpired,
  subscriberSees,
} from './live-socket';

describe('live socket', () => {
  test('recognises WebSocket upgrades only', () => {
    expect(isWebSocketUpgrade(new Request('https://x/', { headers: { upgrade: 'WebSocket' } }))).toBe(true);
    expect(isWebSocketUpgrade(new Request('https://x/'))).toBe(false);
  });

  test('scoped subscribers see their agent and its new children, wildcard sees all', () => {
    expect(subscriberSees({ agentScope: '*', expiresAt: null }, { agentId: 'a' })).toBe(true);
    expect(subscriberSees({ agentScope: 'a', expiresAt: null }, { agentId: 'a' })).toBe(true);
    expect(subscriberSees({ agentScope: 'a', expiresAt: null }, { agentId: 'child', payload: { parentId: 'a' } })).toBe(true);
    expect(subscriberSees({ agentScope: 'a', expiresAt: null }, { agentId: 'b' })).toBe(false);
    expect(subscriberSees({ agentScope: 'a', expiresAt: null }, { agentId: 'c', payload: { parentId: 'b' } })).toBe(false);
  });

  test('scoped subscribers see changes anywhere beneath their agent, never above or beside it', () => {
    const lineage = new Map<string, string | null>([['root', null], ['a', 'root'], ['a1', 'a'], ['a1x', 'a1'], ['b', 'root']]);
    const scoped = { agentScope: 'a', expiresAt: null };
    expect(subscriberSees(scoped, { agentId: 'a1x' }, lineage)).toBe(true);
    expect(subscriberSees(scoped, { agentId: 'root' }, lineage)).toBe(false);
    expect(subscriberSees(scoped, { agentId: 'b' }, lineage)).toBe(false);
    expect(subscriberSees(scoped, { agentId: 'gone', payload: { parentId: 'a1' } }, lineage)).toBe(true);
    const cycle = new Map<string, string | null>([['x', 'y'], ['y', 'x']]);
    expect(subscriberSees(scoped, { agentId: 'x' }, cycle)).toBe(false);
  });

  test('capability subscribers expire, browser subscribers do not', () => {
    expect(subscriberExpired({ agentScope: 'a', expiresAt: 100 }, 100)).toBe(true);
    expect(subscriberExpired({ agentScope: 'a', expiresAt: 101 }, 100)).toBe(false);
    expect(subscriberExpired({ agentScope: '*', expiresAt: null }, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  test('cursors resume from a number or the latest event and reject garbage', () => {
    expect(parseCursor('latest', 42)).toBe(42);
    expect(parseCursor('7', 42)).toBe(7);
    expect(parseCursor('-1', 42)).toBe(0);
    expect(parseCursor('nope', 42)).toBe(0);
    expect(parseCursor(null, 42)).toBe(0);
  });

  test('attachments survive hibernation round trips and reject malformed values', () => {
    expect(parseAttachment({ agentScope: 'a', expiresAt: 5 })).toEqual({ agentScope: 'a', expiresAt: 5 });
    expect(parseAttachment({ agentScope: '*', expiresAt: null })).toEqual({ agentScope: '*', expiresAt: null });
    expect(parseAttachment({ agentScope: 1, expiresAt: null })).toBeNull();
    expect(parseAttachment(null)).toBeNull();
  });

  test('coalescing keeps only the newest frame per key and flushes in order', async () => {
    const sent: LiveFrame[] = [];
    const coalescer = new FrameCoalescer((frame) => sent.push(frame), 5);
    coalescer.push('m1', { type: 'progress', messageId: 'm1', text: 'H', tools: [] });
    coalescer.push('m1', { type: 'progress', messageId: 'm1', text: 'Hello', tools: [] });
    coalescer.push('m2', { type: 'progress', messageId: 'm2', text: 'x', tools: [] });
    expect(sent).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent.map((frame) => (frame.type === 'progress' ? frame.text : ''))).toEqual(['Hello', 'x']);
  });
});
