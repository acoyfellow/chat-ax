export type McpReceipt = {
  id: string;
  operationId: string;
  invocationId: string;
  actorId: string;
  connectorOwnerId: string;
  toolName: string;
  status: 'started' | 'succeeded' | 'outcome-unknown';
  startedAt: string;
  finishedAt?: string;
};

export async function recordMcpExecution<T>(
  storage: Pick<DurableObjectStorage, 'put' | 'sync'>,
  scope: Pick<McpReceipt, 'operationId' | 'invocationId' | 'actorId' | 'toolName'>,
  execute: () => Promise<T>,
): Promise<T> {
  const receipt: McpReceipt = {
    ...scope,
    id: crypto.randomUUID(),
    connectorOwnerId: scope.actorId,
    status: 'started',
    startedAt: new Date().toISOString(),
  };
  const key = `mcp-receipt:${receipt.id}`;
  await storage.put(key, receipt);
  await storage.sync();
  try {
    const result = await execute();
    await storage.put(key, { ...receipt, status: 'succeeded', finishedAt: new Date().toISOString() });
    return result;
  } catch (error) {
    await storage.put(key, { ...receipt, status: 'outcome-unknown', finishedAt: new Date().toISOString() });
    throw error;
  }
}
