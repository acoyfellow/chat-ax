export type DurableMcpExecution = {
  status: 'not-executed' | 'outcome-unknown' | 'succeeded';
  result?: string;
};

export async function executeMcpOnce(
  storage: DurableObjectStorage,
  key: string,
  execute: () => Promise<string>,
): Promise<DurableMcpExecution> {
  const admitted = await storage.transaction(async transaction => {
    const current = await transaction.get<DurableMcpExecution>(key);
    if (!current || current.status !== 'not-executed') return false;
    await transaction.put(key, { status: 'outcome-unknown' } satisfies DurableMcpExecution);
    return true;
  });
  if (!admitted) throw new Error('Action already dispatched or unavailable; do not retry');
  await storage.sync();
  const result = await execute();
  const completed: DurableMcpExecution = { status: 'succeeded', result };
  await storage.put(key, completed);
  await storage.sync();
  return completed;
}
