import { describe, expect, test } from 'bun:test';
import {
  type CommunicationGrant,
  authorizeCommunication,
  communicationRequestSchema,
} from './agent-communication';

const topology = new Map<string, string | null>([
  ['root', null],
  ['parent', 'root'],
  ['child', 'parent'],
  ['sibling', 'root'],
]);
const grant = (overrides: Partial<CommunicationGrant> = {}): CommunicationGrant => ({
  id: '38ea02df-451c-42d7-88ba-83c0b4ef4ad5',
  fromAgentId: 'parent',
  toAgentId: 'sibling',
  actions: ['message'],
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  createdAt: new Date().toISOString(),
  createdBy: 'person',
  ...overrides,
});

describe('agent communication authority', () => {
  test('allows only direct parent and child without a grant', () => {
    expect(authorizeCommunication(topology, 'parent', 'child', 'message', 'strict', [])).toBeUndefined();
    expect(authorizeCommunication(topology, 'child', 'parent', 'file', 'strict', [])).toBeUndefined();
    expect(() => authorizeCommunication(topology, 'parent', 'sibling', 'message', 'strict', [])).toThrow(
      'strict posture denies lateral communication',
    );
  });

  test('requires a narrow live room grant for mesh communication', () => {
    expect(authorizeCommunication(topology, 'parent', 'sibling', 'message', 'mesh', [grant()])?.id).toBe(
      grant().id,
    );
    expect(() =>
      authorizeCommunication(topology, 'parent', 'sibling', 'file', 'mesh', [grant()]),
    ).toThrow();
    expect(() =>
      authorizeCommunication(topology, 'parent', 'sibling', 'message', 'mesh', [
        grant({ revokedAt: new Date().toISOString() }),
      ]),
    ).toThrow();
    expect(() =>
      authorizeCommunication(topology, 'parent', 'sibling', 'message', 'mesh', [
        grant({ expiresAt: new Date(0).toISOString() }),
      ]),
    ).toThrow();
    expect(() =>
      authorizeCommunication(topology, 'parent', 'sibling', 'message', 'mesh', [
        grant({ usedAt: new Date().toISOString() }),
      ]),
    ).toThrow();
  });

  test('validates bounded operation-specific payloads', () => {
    expect(
      communicationRequestSchema.parse({
        fromAgentId: 'parent',
        toAgentId: 'child',
        action: 'message',
        message: 'hello',
      }).message,
    ).toBe('hello');
    expect(() =>
      communicationRequestSchema.parse({
        fromAgentId: 'parent',
        toAgentId: 'child',
        action: 'message',
      }),
    ).toThrow();
    expect(() =>
      communicationRequestSchema.parse({
        fromAgentId: 'parent',
        toAgentId: 'child',
        action: 'file',
        fileId: 'x',
        ambientPath: '/secret',
      }),
    ).toThrow();
  });
});
