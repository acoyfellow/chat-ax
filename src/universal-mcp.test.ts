import { describe, expect, test } from 'bun:test';
import type { AccessIdentity } from './auth';
import { type PersonRequestStore, handleMcpRequest } from './mcp';
import type { PersonRequestActor } from './person-requests';
import {
  type UniversalMcpStore,
  universalMcpOperations,
  universalMcpResources,
  universalMcpResourceTemplates,
  universalMcpTools,
  validateUniversalMcpArguments,
} from './universal-mcp';

const identity: AccessIdentity = {
  sub: 'verified-actor',
  email: 'verified@example.com',
  name: 'Verified Actor',
};

const personStore: PersonRequestStore = {
  async create() {
    throw new Error('unused');
  },
  async list() {
    return [];
  },
  async get() {
    return null;
  },
  async update() {
    throw new Error('unused');
  },
};

class MemoryUniversalStore implements UniversalMcpStore {
  actor?: PersonRequestActor;
  executions = new Map<string, { invocationId: string; replayed: boolean; receiptId: string; result: unknown }>();

  async read(uri: string, actor: PersonRequestActor) {
    this.actor = actor;
    return { uri, private: true };
  }

  async execute(name: string, args: Record<string, unknown>, actor: PersonRequestActor) {
    this.actor = actor;
    const invocationId = String(args.invocationId);
    const existing = this.executions.get(invocationId);
    if (existing) return { ...existing, replayed: true };
    const value = {
      invocationId,
      replayed: false,
      receiptId: `receipt-${invocationId}`,
      result: { name },
    };
    this.executions.set(invocationId, value);
    return value;
  }
}

function rpc(method: string, params: Record<string, unknown>, id = 1) {
  return { jsonrpc: '2.0' as const, id, method, params };
}

async function body(response: Response) {
  return response.json() as Promise<{
    result?: {
      tools?: Array<{ name: string; inputSchema: object }>;
      resources?: Array<{ uri: string }>;
      resourceTemplates?: Array<{ uriTemplate: string }>;
      contents?: Array<{ uri: string; text: string }>;
      structuredContent?: Record<string, unknown>;
    };
    error?: { code: number; message: string };
  }>;
}

describe('universal MCP product facade', () => {
  test('has a unique typed manifest with no permissive tool schemas', () => {
    expect(new Set(universalMcpOperations.map((operation) => operation.name)).size).toBe(
      universalMcpOperations.length,
    );
    expect(universalMcpTools.length).toBeGreaterThan(10);
    for (const tool of universalMcpTools) {
      expect(tool.inputSchema).toBeDefined();
      expect((tool.inputSchema as { additionalProperties?: boolean }).additionalProperties).toBeFalse();
    }
    expect(universalMcpResources.length).toBeGreaterThan(4);
    expect(universalMcpResourceTemplates.length).toBeGreaterThan(2);
  });

  test('advertises resources, templates, and tools through MCP', async () => {
    const tools = await body(
      await handleMcpRequest(rpc('tools/list', {}), identity, personStore),
    );
    expect(tools.result?.tools?.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(universalMcpTools.map((tool) => tool.name)),
    );
    const resources = await body(
      await handleMcpRequest(rpc('resources/list', {}), identity, personStore),
    );
    expect(resources.result?.resources).toHaveLength(universalMcpResources.length);
    const templates = await body(
      await handleMcpRequest(rpc('resources/templates/list', {}), identity, personStore),
    );
    expect(templates.result?.resourceTemplates).toHaveLength(universalMcpResourceTemplates.length);
  });

  test('binds resource reads to verified identity', async () => {
    const store = new MemoryUniversalStore();
    const response = await body(
      await handleMcpRequest(
        rpc('resources/read', { uri: 'chat-ax://agents/agent-1/conversation' }),
        identity,
        personStore,
        undefined,
        store,
      ),
    );
    expect(store.actor?.id).toBe(identity.sub);
    expect(JSON.parse(response.result?.contents?.[0]?.text ?? '{}')).toEqual({
      uri: 'chat-ax://agents/agent-1/conversation',
      private: true,
    });
  });

  test('requires strict invocation identity and returns replay receipts', async () => {
    const store = new MemoryUniversalStore();
    const missing = await body(
      await handleMcpRequest(
        rpc('tools/call', {
          name: 'chat_clear_history',
          arguments: { agentId: 'agent-1' },
        }),
        identity,
        personStore,
        undefined,
        store,
      ),
    );
    expect(missing.error?.message).toContain('schema');
    const args = { invocationId: 'invocation-1', agentId: 'agent-1' };
    const first = await body(
      await handleMcpRequest(
        rpc('tools/call', { name: 'chat_clear_history', arguments: args }),
        identity,
        personStore,
        undefined,
        store,
      ),
    );
    const replay = await body(
      await handleMcpRequest(
        rpc('tools/call', { name: 'chat_clear_history', arguments: args }),
        identity,
        personStore,
        undefined,
        store,
      ),
    );
    expect(first.result?.structuredContent?.replayed).toBeFalse();
    expect(replay.result?.structuredContent?.replayed).toBeTrue();
    expect(replay.result?.structuredContent?.receiptId).toBe(
      first.result?.structuredContent?.receiptId,
    );
  });

  test('rejects unknown properties and malformed bounded values', () => {
    const operation = universalMcpOperations.find(
      (candidate) => candidate.name === 'agent_state_create',
    );
    expect(operation).toBeDefined();
    expect(() =>
      validateUniversalMcpArguments(operation!, {
        invocationId: 'invocation-2',
        agentId: 'agent-1',
        key: 'key',
        value: 'value',
        rawToken: 'forbidden',
      }),
    ).toThrow();
    expect(() =>
      validateUniversalMcpArguments(operation!, {
        invocationId: 'short',
        agentId: 'agent-1',
        key: 'key',
        value: 'value',
      }),
    ).toThrow();
  });
});
