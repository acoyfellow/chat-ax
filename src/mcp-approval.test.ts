import { expect, test } from 'bun:test';
import { consumeMcpApproval, type McpApproval, type McpActionScope } from './mcp-approval';

const action: McpActionScope = { actorId: 'alice', operationId: 'request-1', toolName: 'read_resource', argumentsDigest: 'sha256-resource-a', resultVisibility: 'room' };
const grant: McpApproval = { ...action, id: 'approval-1', approvedBy: 'alice', expiresAt: 2000 };

test('exact approval can be consumed once and remains consumed after serialization', () => {
  const consumed = consumeMcpApproval(grant, action, 1000);
  expect(consumed.consumedAt).toBe(1000);
  expect(() => consumeMcpApproval(JSON.parse(JSON.stringify(consumed)), action, 1001)).toThrow();
});

for (const key of ['actorId', 'operationId', 'toolName', 'argumentsDigest'] as const) {
  test(`cannot reuse approval with changed ${key}`, () => {
    expect(() => consumeMcpApproval(grant, { ...action, [key]: 'different' }, 1000)).toThrow();
  });
}

test('expiry, revocation, absent grant and another approver fail closed', () => {
  expect(() => consumeMcpApproval(grant, action, 2000)).toThrow();
  expect(() => consumeMcpApproval({ ...grant, revokedAt: 999 }, action, 1000)).toThrow();
  expect(() => consumeMcpApproval(undefined, action, 1000)).toThrow();
  expect(() => consumeMcpApproval({ ...grant, approvedBy: 'bob' }, action, 1000)).toThrow();
  expect(() => consumeMcpApproval({ ...grant, expiresAt: NaN }, action, 1000)).toThrow();
});
