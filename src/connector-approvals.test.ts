import { expect, test } from 'bun:test';
import { approvalLogLine, argumentsDigest, canonicalArguments, decisionRefusal } from './connector-approvals';
import type { PendingMcpAction } from './mcp-approval';

const jordan = { id: 'dev-jordan@example.com', email: 'jordan@example.com', name: 'Jordan' };
const sam = { id: 'dev-sam@example.com', email: 'sam@example.com', name: 'Sam' };
const pending = (overrides: Partial<PendingMcpAction> = {}): PendingMcpAction => ({
  id: 'approval-1',
  operationId: 'turn-1',
  actorId: jordan.id,
  requesterId: sam.id,
  requesterEmail: sam.email,
  connectorOwnerEmail: jordan.email,
  toolName: 'whoami',
  argumentsJson: '{}',
  argumentsDigest: 'digest',
  resultVisibility: 'room',
  expiresAt: 2_000,
  status: 'pending',
  ...overrides,
});

test('only the connector owner can decide, once, before it expires', () => {
  expect(decisionRefusal(pending(), jordan, 1_000)).toBeNull();
  expect(decisionRefusal(pending(), sam, 1_000)).toBe('Only the connector owner can decide this request');
  expect(decisionRefusal(pending(), { ...jordan, email: 'jordan@evil.example' }, 1_000)).toBe('Only the connector owner can decide this request');
  expect(decisionRefusal(pending({ status: 'succeeded' }), jordan, 1_000)).toBe('This request was already decided');
  expect(decisionRefusal(pending({ status: 'denied' }), jordan, 1_000)).toBe('This request was already decided');
  expect(decisionRefusal(pending(), jordan, 2_000)).toBe('This request expired');
  expect(decisionRefusal(undefined, jordan, 1_000)).toBe('Approval not found');
});

test('a changed argument produces a different digest', async () => {
  const original = await argumentsDigest(canonicalArguments('{"repo":"team/app"}'));
  expect(await argumentsDigest(canonicalArguments('{"repo":"team/app"}'))).toBe(original);
  expect(await argumentsDigest(canonicalArguments('{"repo":"team/secret"}'))).not.toBe(original);
  expect(() => canonicalArguments('[1]')).toThrow('Tool arguments must be a JSON object');
});

test('every stage leaves a readable line naming requester, owner and tool', () => {
  const action = pending();
  for (const stage of ['requested', 'approved', 'denied', 'ran', 'failed'] as const) {
    const line = approvalLogLine(action, stage);
    expect(line).toContain('sam@example.com');
    expect(line).toContain('jordan@example.com');
    expect(line).toContain('whoami');
  }
  expect(approvalLogLine(action, 'denied')).toContain('Nothing ran');
  expect(approvalLogLine(action, 'requested')).toContain('Nothing has run');
});
