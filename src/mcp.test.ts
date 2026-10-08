import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import type { AccessIdentity } from './auth';
import { type PersonRequestStore, handleMcpRequest } from './mcp';
import {
  type CreatePersonRequestInput,
  type PersonRequest,
  type PersonRequestAction,
  type PersonRequestActor,
  applyPersonRequestAction,
  canViewPersonRequest,
  createPersonRequest,
} from './person-requests';

class MemoryStore implements PersonRequestStore {
  items: PersonRequest[] = [];

  async create(actor: PersonRequestActor, input: CreatePersonRequestInput) {
    const item = createPersonRequest(actor, input, new Date(), 'task-1');
    this.items.push(item);
    return item;
  }

  async list(actor: PersonRequestActor) {
    return this.items.filter((item) => canViewPersonRequest(item, actor));
  }

  async get(actor: PersonRequestActor, id: string) {
    return this.items.find((item) => item.id === id && canViewPersonRequest(item, actor)) ?? null;
  }

  async update(
    actor: PersonRequestActor,
    id: string,
    action: PersonRequestAction,
    response?: string,
  ) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('Request not found');
    const item = applyPersonRequestAction(this.items[index], actor, action, response);
    this.items[index] = item;
    return item;
  }
}

const sam: AccessIdentity = { sub: 'sam-sub', email: 'sam@example.com', name: 'Sam Example' };
const jordan: AccessIdentity = {
  sub: 'jordan-sub',
  email: 'jordan@example.com',
  name: 'Jordan Example',
};
const michelle: AccessIdentity = {
  sub: 'michelle-sub',
  email: 'michelle@example.com',
  name: 'Michelle Example',
};

const modernMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {
    extensions: { 'io.modelcontextprotocol/tasks': {} },
  },
};

type RpcParams = {
  _meta?: typeof modernMeta;
  name?: string;
  arguments?: typeof createArguments;
  taskId?: string;
  inputResponses?: {
    decision: { action: 'accept'; content: { action: 'accept' } };
  };
};

function rpc(method: string, params: RpcParams, id = 1) {
  return { jsonrpc: '2.0' as const, id, method, params };
}

const responseSchema = v.object({
  result: v.optional(
    v.object({
      resultType: v.optional(v.string()),
      supportedVersions: v.optional(v.array(v.string())),
      capabilities: v.optional(
        v.object({
          extensions: v.optional(
            v.object({ 'io.modelcontextprotocol/tasks': v.optional(v.object({})) }),
          ),
        }),
      ),
      task: v.optional(v.object({ taskId: v.string(), status: v.string() })),
      status: v.optional(v.string()),
      inputRequests: v.optional(v.object({ decision: v.object({}) })),
    }),
  ),
  error: v.optional(v.object({ code: v.number(), message: v.string() })),
});

async function result(response: Response) {
  return v.parse(responseSchema, await response.json());
}

const createArguments = {
  recipientEmail: jordan.email,
  recipientName: jordan.name,
  title: 'Create an MR for ISSUE-123',
  details: 'Please prepare and open the merge request.',
};

describe('Chat AX MCP', () => {
  test('advertises the modern Tasks extension', async () => {
    const response = await handleMcpRequest(
      rpc('server/discover', { _meta: modernMeta }),
      sam,
      new MemoryStore(),
    );
    const body = await result(response);
    expect(body.result?.supportedVersions).toEqual(['2026-07-28']);
    expect(body.result?.capabilities?.extensions?.['io.modelcontextprotocol/tasks']).toEqual({});
  });

  test('returns a normal tool result when Tasks are not negotiated', async () => {
    const store = new MemoryStore();
    const body = await result(
      await handleMcpRequest(
        rpc('tools/call', { name: 'request_person', arguments: createArguments }),
        sam,
        store,
      ),
    );
    expect(body.result?.resultType).toBe('complete');
    expect(store.items).toHaveLength(1);
  });

  test('returns a durable task and resumes after another handler call', async () => {
    const store = new MemoryStore();
    const created = await result(
      await handleMcpRequest(
        rpc('tools/call', {
          _meta: modernMeta,
          name: 'request_person',
          arguments: createArguments,
        }),
        sam,
        store,
      ),
    );
    expect(created.result?.resultType).toBe('task');
    expect(created.result?.task?.taskId).toBe('task-1');

    const waiting = await result(
      await handleMcpRequest(
        rpc('tasks/get', { _meta: modernMeta, taskId: 'task-1' }),
        jordan,
        store,
      ),
    );
    expect(waiting.result?.status).toBe('input_required');
    expect(waiting.result?.inputRequests).toBeDefined();

    const accepted = await result(
      await handleMcpRequest(
        rpc('tasks/update', {
          _meta: modernMeta,
          taskId: 'task-1',
          inputResponses: {
            decision: { action: 'accept', content: { action: 'accept' } },
          },
        }),
        jordan,
        store,
      ),
    );
    expect(accepted.result?.resultType).toBe('complete');
    const afterAcceptance = await result(
      await handleMcpRequest(
        rpc('tasks/get', { _meta: modernMeta, taskId: 'task-1' }),
        jordan,
        store,
      ),
    );
    expect(afterAcceptance.result?.status).toBe('working');
  });

  test('does not expose or transfer the task to another person', async () => {
    const store = new MemoryStore();
    await handleMcpRequest(
      rpc('tools/call', {
        _meta: modernMeta,
        name: 'request_person',
        arguments: createArguments,
      }),
      sam,
      store,
    );
    const body = await result(
      await handleMcpRequest(
        rpc('tasks/get', { _meta: modernMeta, taskId: 'task-1' }),
        michelle,
        store,
      ),
    );
    expect(body.error?.message).toBe('Task not found');
  });

  test('only the requester can cancel through Tasks', async () => {
    const store = new MemoryStore();
    await handleMcpRequest(
      rpc('tools/call', {
        _meta: modernMeta,
        name: 'request_person',
        arguments: createArguments,
      }),
      sam,
      store,
    );
    const denied = await result(
      await handleMcpRequest(
        rpc('tasks/cancel', { _meta: modernMeta, taskId: 'task-1' }),
        jordan,
        store,
      ),
    );
    expect(denied.error?.message).toContain('Only the requester');
    const cancelled = await result(
      await handleMcpRequest(
        rpc('tasks/cancel', { _meta: modernMeta, taskId: 'task-1' }),
        sam,
        store,
      ),
    );
    expect(cancelled.result?.resultType).toBe('complete');
    const afterCancellation = await result(
      await handleMcpRequest(rpc('tasks/get', { _meta: modernMeta, taskId: 'task-1' }), sam, store),
    );
    expect(afterCancellation.result?.status).toBe('cancelled');
  });
});
