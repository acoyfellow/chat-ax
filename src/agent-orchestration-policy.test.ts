import { describe, expect, test } from 'bun:test';
import { canCommunicate, consumeGrant, switchMode, type CapabilityGrant } from './agent-orchestration-policy';

const parent = { id: 'parent', parentId: null };
const childA = { id: 'a', parentId: 'parent' };
const childB = { id: 'b', parentId: 'parent' };
const future = new Date(Date.now() + 60_000).toISOString();

describe('agent orchestration postures', () => {
  test('strict allows vertical communication and denies siblings', () => {
    expect(canCommunicate('strict', parent, childA)).toBe(true);
    expect(canCommunicate('strict', childA, childB)).toBe(false);
  });
  test('mesh requires an explicit valid grant for siblings', () => {
    const grant: CapabilityGrant = { capability: 'agent.message.send', fromAgentId: 'a', toAgentId: 'b', expiresAt: future, usesRemaining: 1 };
    expect(canCommunicate('mesh', childA, childB, grant)).toBe(true);
    expect(canCommunicate('mesh', childA, childB)).toBe(false);
    expect(consumeGrant(grant).usesRemaining).toBe(0);
  });
  test('expired grants and posture changes are explicit', () => {
    expect(canCommunicate('mesh', childA, childB, { capability: 'agent.message.send', fromAgentId: 'a', toAgentId: 'b', expiresAt: new Date(Date.now() - 1).toISOString(), usesRemaining: 1 })).toBe(false);
    expect(switchMode('strict', 'mesh').changed).toBe(true);
  });
});
