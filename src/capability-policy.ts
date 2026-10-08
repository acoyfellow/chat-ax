export type CapabilityGrant = {
  id: string;
  scope: 'personal' | 'room';
  ownerId: string;
  roomId?: string;
  capabilities: string[];
  expiresAt?: number;
  maxUses?: number;
  uses: number;
  revokedAt?: number;
};

export type CapabilityRequest = {
  actorId: string;
  roomId: string;
  capability: string;
  declaredCapabilities: string[];
  roomCapabilities: string[];
  turnCapabilities: string[];
  grants: CapabilityGrant[];
  now: number;
};

export type CapabilityDecision =
  | { allowed: true; capability: string; grantIds: string[] }
  | {
      allowed: false;
      capability: string;
      reason: 'unknown-capability' | 'room-policy-denied' | 'turn-budget-denied' | 'not-granted';
    };

export function authorizeCapability(request: CapabilityRequest): CapabilityDecision {
  if (!request.declaredCapabilities.includes(request.capability)) {
    return denied(request.capability, 'unknown-capability');
  }
  if (!request.roomCapabilities.includes(request.capability)) {
    return denied(request.capability, 'room-policy-denied');
  }
  if (!request.turnCapabilities.includes(request.capability)) {
    return denied(request.capability, 'turn-budget-denied');
  }

  const grantIds = request.grants
    .filter((grant) => grant.capabilities.includes(request.capability))
    .filter((grant) => grant.revokedAt === undefined)
    .filter((grant) => grant.expiresAt === undefined || grant.expiresAt > request.now)
    .filter((grant) => grant.maxUses === undefined || grant.uses < grant.maxUses)
    .filter((grant) =>
      grant.scope === 'personal'
        ? grant.ownerId === request.actorId
        : grant.roomId === request.roomId,
    )
    .map((grant) => grant.id);

  return grantIds.length > 0
    ? { allowed: true, capability: request.capability, grantIds }
    : denied(request.capability, 'not-granted');
}

export function effectiveCapabilities(
  declaredCapabilities: string[],
  roomCapabilities: string[],
  turnCapabilities: string[],
): string[] {
  const room = new Set(roomCapabilities);
  const turn = new Set(turnCapabilities);
  return [...new Set(declaredCapabilities)]
    .filter((capability) => room.has(capability) && turn.has(capability))
    .sort();
}

function denied(
  capability: string,
  reason: Extract<CapabilityDecision, { allowed: false }>['reason'],
): CapabilityDecision {
  return { allowed: false, capability, reason };
}
