import { expect, test } from 'bun:test';
import { recordMcpExecution, type McpReceipt } from './mcp-receipts';

function receiptStore() {
  const records = new Map<string, McpReceipt>();
  const events: string[] = [];
  const storage = {
    put: async (key: string, value: McpReceipt) => { records.set(key, structuredClone(value)); events.push(value.status); },
    sync: async () => { events.push('synced'); },
  } as unknown as Pick<DurableObjectStorage, 'put' | 'sync'>;
  return { records, events, storage };
}

const scope = { operationId: 'request-a', invocationId: 'call-a', actorId: 'alice', toolName: 'lookup' };

test('receipt binds dispatched owner and commits intent before network', async () => {
  const store = receiptStore();
  const result = await recordMcpExecution(store.storage, scope, async () => {
    expect(store.events).toEqual(['started', 'synced']);
    return 'private result';
  });
  expect(result).toBe('private result');
  const [receipt] = store.records.values();
  expect(receipt.connectorOwnerId).toBe('alice');
  expect(receipt.operationId).toBe('request-a');
  expect(receipt.status).toBe('succeeded');
  expect(JSON.stringify(receipt)).not.toContain('private result');
});

test('tool error produces unknown outcome without persisting raw error', async () => {
  const store = receiptStore();
  await expect(recordMcpExecution(store.storage, scope, async () => { throw new Error('private credential detail'); })).rejects.toThrow();
  const [receipt] = store.records.values();
  expect(receipt.status).toBe('outcome-unknown');
  expect(JSON.stringify(receipt)).not.toContain('private credential detail');
});

test('failed intent persistence prevents execution', async () => {
  let dispatched = false;
  const storage = { put: async () => { throw new Error('storage unavailable'); }, sync: async () => {} } as unknown as Pick<DurableObjectStorage, 'put' | 'sync'>;
  await expect(recordMcpExecution(storage, scope, async () => { dispatched = true; })).rejects.toThrow();
  expect(dispatched).toBe(false);
});
