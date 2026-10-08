export type OrchestrationMode = 'strict' | 'mesh';
export type AgentCapability = 'graph.read' | 'agent.message.send' | 'agent.session.read' | 'agent.context.edit';
export type CapabilityGrant = { capability: AgentCapability; fromAgentId: string; toAgentId: string; expiresAt: string; usesRemaining: number };
export type AgentRelation = { id: string; parentId: string | null };

export function canCommunicate(mode: OrchestrationMode, from: AgentRelation, to: AgentRelation, grant: CapabilityGrant | undefined, now = Date.now()): boolean {
  if (from.id === to.id || from.parentId === to.id || to.parentId === from.id) return true;
  if (mode === 'strict') return false;
  return Boolean(grant && grant.capability === 'agent.message.send' && grant.fromAgentId === from.id && grant.toAgentId === to.id && grant.usesRemaining > 0 && Date.parse(grant.expiresAt) > now);
}

export function consumeGrant(grant: CapabilityGrant, now = Date.now()): CapabilityGrant {
  if (grant.usesRemaining <= 0 || Date.parse(grant.expiresAt) <= now) throw new Error('capability grant is expired or exhausted');
  return { ...grant, usesRemaining: grant.usesRemaining - 1 };
}

export function switchMode(current: OrchestrationMode, next: OrchestrationMode): { from: OrchestrationMode; to: OrchestrationMode; changed: boolean; changedAt: string } {
  return { from: current, to: next, changed: current !== next, changedAt: new Date().toISOString() };
}
