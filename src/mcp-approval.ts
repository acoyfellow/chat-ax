export type McpActionScope = {
  actorId: string;
  operationId: string;
  toolName: string;
  argumentsDigest: string;
  resultVisibility: 'room';
};

export type PendingMcpAction = McpActionScope & {
  id: string;
  requesterId: string;
  requesterEmail: string;
  connectorOwnerEmail: string;
  argumentsJson: string;
  expiresAt: number;
  kind?: 'connector' | 'agent-tool';
  status: 'pending' | 'denied' | 'not-executed' | 'outcome-unknown' | 'succeeded' | 'running' | 'failed';
};

export type McpApproval = McpActionScope & {
  id: string;
  approvedBy: string;
  expiresAt: number;
  consumedAt?: number;
  revokedAt?: number;
};

export function consumeMcpApproval(grant: McpApproval | undefined, action: McpActionScope, now: number): McpApproval {
  if (!grant || !Number.isFinite(now) || !Number.isFinite(grant.expiresAt)) throw new Error('Approval unavailable');
  if (grant.consumedAt !== undefined || grant.revokedAt !== undefined || grant.expiresAt <= now) {
    throw new Error('Approval expired, revoked, or consumed');
  }
  if (grant.approvedBy !== action.actorId) throw new Error('Approval belongs to another person');
  for (const key of ['actorId', 'operationId', 'toolName', 'argumentsDigest', 'resultVisibility'] as const) {
    if (!action[key] || grant[key] !== action[key]) throw new Error('Approval scope mismatch');
  }
  return { ...grant, consumedAt: now };
}

export async function claimMcpApproval(storage: DurableObjectStorage, approvalId: string, action: McpActionScope, now = Date.now()) {
  const claimed = await storage.transaction(async transaction => {
    const key = `mcp-approval:${approvalId}`;
    const grant = await transaction.get<McpApproval>(key);
    const consumed = consumeMcpApproval(grant, action, now);
    await transaction.put(key, consumed);
    return consumed;
  });
  await storage.sync();
  return claimed;
}
