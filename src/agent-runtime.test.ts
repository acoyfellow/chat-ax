import { describe, expect, test } from 'bun:test';
import {
  claimAgentWork,
  createAgentRuntimeIdentity,
  enqueueAgentWork,
  type AgentQueueStorage,
  type AgentQueueTransaction,
  maximumAgentQueueDepth,
} from './agent-runtime';

class SerializedStorage implements AgentQueueStorage, AgentQueueTransaction {
  private readonly values = new Map<string, unknown>();
  private tail = Promise.resolve();

  async transaction<T>(closure: (transaction: AgentQueueTransaction) => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release = () => {};
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await closure(this);
    } finally {
      release();
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.values.get(key)) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
}

describe('per-agent runtime ownership', () => {
  test('creates a separate Pi session identity for every agent runtime', () => {
    const first = createAgentRuntimeIdentity('agent-a');
    const second = createAgentRuntimeIdentity('agent-b');
    expect(first.agentId).toBe('agent-a');
    expect(second.agentId).toBe('agent-b');
    expect(first.sessionId).not.toBe(second.sessionId);
  });

  test('concurrent claims cannot share queue ownership', async () => {
    const storage = new SerializedStorage();
    await enqueueAgentWork(storage, {
      id: 'work-1',
      enqueuedAt: new Date().toISOString(),
      payload: { prompt: 'run' },
    });
    const claims = await Promise.all([
      claimAgentWork(storage, 'worker-a'),
      claimAgentWork(storage, 'worker-b'),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)?.id).toBe('work-1');
    expect(['worker-a', 'worker-b']).toContain(claims.find(Boolean)?.owner);
  });

  test('two agent executions overlap without crossing transcripts', async () => {
    const transcripts = new Map<string, string[]>();
    let active = 0;
    let maximumActive = 0;
    const execute = async (agentId: string, prompt: string) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      transcripts.set(agentId, [prompt, `reply:${agentId}:${prompt}`]);
      active -= 1;
    };

    await Promise.all([execute('agent-a', 'alpha'), execute('agent-b', 'beta')]);

    expect(maximumActive).toBe(2);
    expect(transcripts.get('agent-a')).toEqual(['alpha', 'reply:agent-a:alpha']);
    expect(transcripts.get('agent-b')).toEqual(['beta', 'reply:agent-b:beta']);
    expect(transcripts.get('agent-a')?.join(' ')).not.toContain('beta');
    expect(transcripts.get('agent-b')?.join(' ')).not.toContain('alpha');
  });

  test('queues remain isolated between agent durable objects', async () => {
    const first = new SerializedStorage();
    const second = new SerializedStorage();
    await Promise.all([
      enqueueAgentWork(first, { id: 'first', enqueuedAt: new Date().toISOString(), payload: null }),
      enqueueAgentWork(second, { id: 'second', enqueuedAt: new Date().toISOString(), payload: null }),
    ]);
    expect((await claimAgentWork(first, 'owner'))?.id).toBe('first');
    expect((await claimAgentWork(second, 'owner'))?.id).toBe('second');
  });

  test('bounds queues and replaces duplicate work identifiers', async () => {
    const storage = new SerializedStorage();
    for (let index = 0; index <= maximumAgentQueueDepth; index += 1)
      await enqueueAgentWork(storage, {
        id: `work-${index}`,
        enqueuedAt: new Date().toISOString(),
        payload: index,
      });
    await enqueueAgentWork(storage, {
      id: `work-${maximumAgentQueueDepth}`,
      enqueuedAt: new Date().toISOString(),
      payload: 'replacement',
    });
    const claims = [];
    while (true) {
      const claim = await claimAgentWork(storage, 'worker');
      if (!claim) break;
      claims.push(claim);
    }
    expect(claims).toHaveLength(maximumAgentQueueDepth);
    expect(claims[0].id).toBe('work-1');
    expect(claims.at(-1)?.payload).toBe('replacement');
  });
});
