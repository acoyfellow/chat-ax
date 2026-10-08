export type AgentQueueRecord = {
  id: string;
  enqueuedAt: string;
  payload: unknown;
};

export type AgentQueueClaim = AgentQueueRecord & {
  claimedAt: string;
  owner: string;
};

export interface AgentQueueStorage {
  transaction<T>(closure: (transaction: AgentQueueTransaction) => Promise<T>): Promise<T>;
}

export interface AgentQueueTransaction {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

const pendingKey = 'resource:queue';
const claimPrefix = 'queue-claim:';
export const maximumAgentQueueDepth = 100;

export type AgentRuntimeIdentity = {
  agentId: string;
  sessionId: string;
  initializedAt: string;
};

export function createAgentRuntimeIdentity(agentId: string): AgentRuntimeIdentity {
  return {
    agentId,
    sessionId: crypto.randomUUID(),
    initializedAt: new Date().toISOString(),
  };
}

export async function enqueueAgentWork(
  storage: AgentQueueStorage,
  record: AgentQueueRecord,
): Promise<void> {
  await storage.transaction(async (transaction) => {
    const pending = (await transaction.get<AgentQueueRecord[]>(pendingKey)) ?? [];
    const bounded = pending.filter((item) => item.id !== record.id).slice(-(maximumAgentQueueDepth - 1));
    await transaction.put(pendingKey, [...bounded, record]);
  });
}

export async function claimAgentWork(
  storage: AgentQueueStorage,
  owner: string,
): Promise<AgentQueueClaim | null> {
  return storage.transaction(async (transaction) => {
    const pending = (await transaction.get<AgentQueueRecord[]>(pendingKey)) ?? [];
    const record = pending[0];
    if (!record) return null;
    const claim: AgentQueueClaim = {
      ...record,
      claimedAt: new Date().toISOString(),
      owner,
    };
    await transaction.put(pendingKey, pending.slice(1));
    await transaction.put(`${claimPrefix}${record.id}`, claim);
    return claim;
  });
}
