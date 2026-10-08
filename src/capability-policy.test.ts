import { describe, expect, test } from 'bun:test';
import {
  type CapabilityGrant,
  type CapabilityRequest,
  authorizeCapability,
  effectiveCapabilities,
} from './capability-policy';

const now = 1_000_000;
const personalGrant: CapabilityGrant = {
  id: 'grant-personal',
  scope: 'personal',
  ownerId: 'person-a',
  capabilities: ['documents.read'],
  uses: 0,
};

function request(overrides: Partial<CapabilityRequest> = {}): CapabilityRequest {
  return {
    actorId: 'person-a',
    roomId: 'room-1',
    capability: 'documents.read',
    declaredCapabilities: ['documents.read'],
    roomCapabilities: ['documents.read'],
    turnCapabilities: ['documents.read'],
    grants: [personalGrant],
    now,
    ...overrides,
  };
}

describe('multiplayer capability policy', () => {
  test('allows an actor to use their own active personal grant', () => {
    expect(authorizeCapability(request())).toEqual({
      allowed: true,
      capability: 'documents.read',
      grantIds: ['grant-personal'],
    });
  });

  test('prevents one participant from using another participant’s grant', () => {
    expect(authorizeCapability(request({ actorId: 'person-b' }))).toEqual({
      allowed: false,
      capability: 'documents.read',
      reason: 'not-granted',
    });
  });

  test('allows an explicit grant bound to the room', () => {
    const roomGrant: CapabilityGrant = {
      id: 'grant-room',
      scope: 'room',
      ownerId: 'person-a',
      roomId: 'room-1',
      capabilities: ['documents.read'],
      uses: 0,
    };
    expect(
      authorizeCapability(request({ actorId: 'person-b', grants: [roomGrant] })),
    ).toMatchObject({ allowed: true, grantIds: ['grant-room'] });
  });

  test('rejects room grants from another room', () => {
    const roomGrant: CapabilityGrant = {
      id: 'grant-room',
      scope: 'room',
      ownerId: 'person-a',
      roomId: 'room-2',
      capabilities: ['documents.read'],
      uses: 0,
    };
    expect(authorizeCapability(request({ grants: [roomGrant] }))).toMatchObject({
      allowed: false,
      reason: 'not-granted',
    });
  });

  test('rejects expired, revoked, and exhausted grants', () => {
    const invalidGrants: CapabilityGrant[] = [
      { ...personalGrant, id: 'expired', expiresAt: now },
      { ...personalGrant, id: 'revoked', revokedAt: now - 1 },
      { ...personalGrant, id: 'exhausted', maxUses: 1, uses: 1 },
    ];
    expect(authorizeCapability(request({ grants: invalidGrants }))).toMatchObject({
      allowed: false,
      reason: 'not-granted',
    });
  });

  test('never broadens beyond tool, room, and turn intersections', () => {
    expect(
      effectiveCapabilities(
        ['documents.read', 'documents.write', 'machine.shell'],
        ['documents.read', 'documents.write'],
        ['documents.read'],
      ),
    ).toEqual(['documents.read']);
  });
});
