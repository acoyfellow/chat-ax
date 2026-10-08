export function agentObjectName(agentId: string): string {
  const normalized = agentId.trim();
  if (!normalized) throw new Error('agent id is required');
  return `agent:${normalized}`;
}
