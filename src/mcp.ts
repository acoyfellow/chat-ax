import * as v from 'valibot';
import type { AccessIdentity } from './auth';
import type {
  CreatePersonRequestInput,
  PersonRequest,
  PersonRequestAction,
  PersonRequestActor,
} from './person-requests';
import { personRequestTaskStatus } from './person-requests';
import {
  callOrchestratorTool,
  orchestratorToolDescriptors,
  orchestratorTools,
  type FleetStore,
} from './orchestrator-mcp';
import {
  type UniversalMcpStore,
  universalMcpEvents,
  universalMcpResourceTemplates,
  universalMcpResources,
  universalMcpTool,
  universalMcpTools,
  validateUniversalMcpArguments,
} from './universal-mcp';

const modernProtocolVersion = '2026-07-28';
const legacyProtocolVersion = '2025-11-25';
const tasksExtension = 'io.modelcontextprotocol/tasks';

const toolArgumentSchema = v.record(v.string(), v.unknown());

const mcpMetaSchema = v.object({
  'io.modelcontextprotocol/protocolVersion': v.optional(v.string()),
  'io.modelcontextprotocol/clientCapabilities': v.optional(
    v.object({
      extensions: v.optional(
        v.object({
          'io.modelcontextprotocol/tasks': v.optional(v.object({})),
        }),
      ),
    }),
  ),
});

export const mcpRequestSchema = v.object({
  jsonrpc: v.literal('2.0'),
  id: v.optional(v.union([v.string(), v.number(), v.null()])),
  method: v.pipe(v.string(), v.minLength(1)),
  params: v.optional(
    v.object({
      _meta: v.optional(mcpMetaSchema),
      name: v.optional(v.string()),
      uri: v.optional(v.string()),
      arguments: v.optional(toolArgumentSchema),
      taskId: v.optional(v.string()),
      inputResponses: v.optional(
        v.object({
          decision: v.optional(
            v.object({
              action: v.optional(v.picklist(['accept', 'decline', 'cancel'])),
              content: v.optional(
                v.object({
                  action: v.optional(v.picklist(['accept', 'decline', 'respond'])),
                  response: v.optional(v.string()),
                }),
              ),
            }),
          ),
        }),
      ),
    }),
  ),
});

export type RpcRequest = v.InferOutput<typeof mcpRequestSchema>;
type ToolArguments = v.InferOutput<typeof toolArgumentSchema>;

type McpTask = {
  taskId: string;
  status: 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';
  ttlMs: number;
  createdAt: string;
  lastUpdatedAt: string;
  pollIntervalMs: number;
  statusMessage: string;
  inputRequests?: {
    decision: {
      method: 'elicitation/create';
      params: {
        mode: 'form';
        message: string;
        requestedSchema: object;
      };
    };
  };
  result?: { request: PersonRequest };
  error?: { code: number; message: string };
};

type McpResult = {
  resultType?: 'complete' | 'task';
  supportedVersions?: string[];
  capabilities?: {
    tools: object;
    resources?: object;
    extensions?: { 'io.modelcontextprotocol/tasks': object };
  };
  serverInfo?: { name: string; version: string };
  protocolVersion?: string;
  tools?: readonly object[];
  resources?: readonly object[];
  events?: readonly object[];
  resourceTemplates?: readonly object[];
  contents?: { uri: string; mimeType: 'application/json'; text: string }[];
  ttlMs?: number;
  cacheScope?: 'private';
  content?: { type: 'text'; text: string }[];
  structuredContent?: unknown;
  task?: McpTask;
  taskId?: string;
  status?: McpTask['status'];
  createdAt?: string;
  lastUpdatedAt?: string;
  pollIntervalMs?: number;
  statusMessage?: string;
  inputRequests?: McpTask['inputRequests'];
  result?: McpTask['result'];
  error?: McpTask['error'];
};

export interface PersonRequestStore {
  create(actor: PersonRequestActor, input: CreatePersonRequestInput): Promise<PersonRequest>;
  list(actor: PersonRequestActor): Promise<PersonRequest[]>;
  get(actor: PersonRequestActor, id: string): Promise<PersonRequest | null>;
  update(
    actor: PersonRequestActor,
    id: string,
    action: PersonRequestAction,
    response?: string,
  ): Promise<PersonRequest>;
}

const tools = [
  {
    name: 'request_person',
    title: 'Request help from a person',
    description: 'Send a durable request to a verified person by email.',
    inputSchema: {
      type: 'object',
      properties: {
        recipientEmail: { type: 'string', format: 'email' },
        recipientName: { type: 'string' },
        title: { type: 'string' },
        details: { type: 'string' },
      },
      required: ['recipientEmail', 'title', 'details'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_my_requests',
    title: 'List my requests',
    description: 'List requests you sent or received.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_request',
    title: 'Get a request',
    description: 'Get one request when you are its requester or recipient.',
    inputSchema: {
      type: 'object',
      properties: { requestId: { type: 'string' } },
      required: ['requestId'],
      additionalProperties: false,
    },
  },
  {
    name: 'respond_to_request',
    title: 'Respond to a request',
    description: 'Accept, decline, complete, or reply to a request assigned to you.',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        action: { type: 'string', enum: ['accept', 'decline', 'complete', 'respond'] },
        response: { type: 'string' },
      },
      required: ['requestId', 'action'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_request',
    title: 'Cancel a request',
    description: 'Cancel a request that you created.',
    inputSchema: {
      type: 'object',
      properties: { requestId: { type: 'string' } },
      required: ['requestId'],
      additionalProperties: false,
    },
  },
] as const;

function actorFromIdentity(identity: AccessIdentity): PersonRequestActor {
  return {
    id: identity.sub,
    email: identity.email.toLowerCase(),
    name: identity.name?.trim() || identity.email.split('@')[0],
  };
}

function errorResponse(id: RpcRequest['id'], code: number, message: string): Response {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

function resultResponse(id: RpcRequest['id'], result: McpResult, modern: boolean): Response {
  return Response.json({
    jsonrpc: '2.0',
    id: id ?? null,
    result: modern
      ? {
          ...result,
          _meta: {
            'io.modelcontextprotocol/serverInfo': { name: 'chat-ax', version: '1.0.0' },
          },
        }
      : result,
  });
}

function hasTasksCapability(params: RpcRequest['params']): boolean {
  return Boolean(
    params?._meta?.['io.modelcontextprotocol/clientCapabilities']?.extensions?.[
      'io.modelcontextprotocol/tasks'
    ],
  );
}

function isModern(params: RpcRequest['params']): boolean {
  return Boolean(params?._meta?.['io.modelcontextprotocol/protocolVersion']);
}

function taskFromRequest(request: PersonRequest, actor: PersonRequestActor): McpTask {
  const status = personRequestTaskStatus(request, actor);
  const common = {
    taskId: request.id,
    status,
    ttlMs: 7 * 24 * 60 * 60 * 1_000,
    createdAt: request.createdAt,
    lastUpdatedAt: request.updatedAt,
    pollIntervalMs: 5_000,
    statusMessage: `${request.title}: ${request.status}`,
  };
  if (status === 'input_required') {
    return {
      ...common,
      inputRequests: {
        decision: {
          method: 'elicitation/create',
          params: {
            mode: 'form',
            message: `${request.requesterName} asks: ${request.title}\n\n${request.details}`,
            requestedSchema: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['accept', 'decline', 'respond'] },
                response: { type: 'string' },
              },
              required: ['action'],
            },
          },
        },
      },
    };
  }
  if (status === 'completed') return { ...common, result: { request } };
  if (status === 'failed')
    return { ...common, error: { code: -32001, message: request.response || 'Declined' } };
  return common;
}

type PersonRequestToolValue = { request: PersonRequest } | { requests: PersonRequest[] };

function toolResult(value: unknown): McpResult {
  return {
    resultType: 'complete',
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function requiredArgument(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function rejectUnknownArguments(args: ToolArguments, allowed: string[]): void {
  if (Object.keys(args).some((key) => !allowed.includes(key)))
    throw new Error('Unknown tool argument');
}

async function callTool(
  name: string,
  args: ToolArguments,
  actor: PersonRequestActor,
  store: PersonRequestStore,
): Promise<{ value: PersonRequestToolValue; created?: PersonRequest }> {
  if (name === 'request_person') {
    rejectUnknownArguments(args, ['recipientEmail', 'recipientName', 'title', 'details']);
    const input: CreatePersonRequestInput = {
      recipientEmail: requiredArgument(args.recipientEmail, 'recipientEmail'),
      recipientName: typeof args.recipientName === 'string' ? args.recipientName : undefined,
      title: requiredArgument(args.title, 'title'),
      details: requiredArgument(args.details, 'details'),
    };
    const created = await store.create(actor, input);
    return { value: { request: created }, created };
  }
  if (name === 'list_my_requests') {
    rejectUnknownArguments(args, []);
    return { value: { requests: await store.list(actor) } };
  }
  if (name === 'get_request') {
    rejectUnknownArguments(args, ['requestId']);
    const request = await store.get(actor, requiredArgument(args.requestId, 'requestId'));
    if (!request) throw new Error('Request not found');
    return { value: { request } };
  }
  if (name === 'respond_to_request') {
    rejectUnknownArguments(args, ['requestId', 'action', 'response']);
    const action = v.parse(
      v.picklist(['accept', 'decline', 'complete', 'respond']),
      requiredArgument(args.action, 'action'),
    );
    return {
      value: {
        request: await store.update(
          actor,
          requiredArgument(args.requestId, 'requestId'),
          action,
          typeof args.response === 'string' ? args.response : undefined,
        ),
      },
    };
  }
  if (name === 'cancel_request') {
    rejectUnknownArguments(args, ['requestId']);
    return {
      value: {
        request: await store.update(actor, requiredArgument(args.requestId, 'requestId'), 'cancel'),
      },
    };
  }
  throw new Error('Unknown tool');
}

export async function handleMcpRequest(
  rpc: RpcRequest,
  identity: AccessIdentity,
  store: PersonRequestStore,
  fleetStore?: FleetStore,
  universalStore?: UniversalMcpStore,
): Promise<Response> {
  if (rpc.id === undefined) return new Response(null, { status: 202 });
  const modern = isModern(rpc.params);
  const actor = actorFromIdentity(identity);
  try {
    if (rpc.method === 'server/discover') {
      return resultResponse(
        rpc.id,
        {
          resultType: 'complete',
          supportedVersions: [modernProtocolVersion],
          capabilities: {
            tools: {},
            resources: {},
            extensions: { [tasksExtension]: {} },
          },
          serverInfo: { name: 'chat-ax', version: '1.0.0' },
        },
        true,
      );
    }
    if (rpc.method === 'initialize') {
      return resultResponse(
        rpc.id,
        {
          protocolVersion: legacyProtocolVersion,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'chat-ax', version: '1.0.0' },
        },
        false,
      );
    }
    if (rpc.method === 'tools/list') {
      return resultResponse(
        rpc.id,
        modern
          ? {
              resultType: 'complete',
              tools: [...tools, ...orchestratorToolDescriptors, ...universalMcpTools],
              ttlMs: 60_000,
              cacheScope: 'private',
            }
          : { tools: [...tools, ...orchestratorToolDescriptors, ...universalMcpTools] },
        modern,
      );
    }
    if (rpc.method === 'events/list')
      return resultResponse(rpc.id, { events: universalMcpEvents }, modern);
    if (rpc.method === 'resources/list')
      return resultResponse(rpc.id, { resources: universalMcpResources }, modern);
    if (rpc.method === 'resources/templates/list')
      return resultResponse(rpc.id, { resourceTemplates: universalMcpResourceTemplates }, modern);
    if (rpc.method === 'resources/read') {
      if (!universalStore) throw new Error('Product resources are unavailable');
      const uri = requiredArgument(rpc.params?.uri, 'uri');
      const value = await universalStore.read(uri, actor);
      return resultResponse(
        rpc.id,
        { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(value) }] },
        modern,
      );
    }
    if (rpc.method === 'tools/call') {
      const name = requiredArgument(rpc.params?.name, 'name');
      const universalOperation = universalMcpTool(name);
      if (universalOperation) {
        if (!universalStore) throw new Error('Product operations are unavailable');
        const args = rpc.params?.arguments ?? {};
        validateUniversalMcpArguments(universalOperation, args);
        return resultResponse(
          rpc.id,
          toolResult(await universalStore.execute(name, args, actor)),
          modern,
        );
      }
      if ((orchestratorTools as readonly string[]).includes(name)) {
        if (!fleetStore) throw new Error('Fleet orchestration is unavailable');
        return resultResponse(
          rpc.id,
          toolResult(await callOrchestratorTool(name, rpc.params?.arguments ?? {}, fleetStore)),
          modern,
        );
      }
      const outcome = await callTool(name, rpc.params?.arguments ?? {}, actor, store);
      if (outcome.created && modern && hasTasksCapability(rpc.params)) {
        return resultResponse(
          rpc.id,
          { resultType: 'task', task: taskFromRequest(outcome.created, actor) },
          true,
        );
      }
      return resultResponse(rpc.id, toolResult(outcome.value), modern);
    }
    if (rpc.method === 'tasks/get') {
      if (!modern || !hasTasksCapability(rpc.params))
        return errorResponse(rpc.id, -32021, 'MCP Tasks capability is required');
      const item = await store.get(actor, requiredArgument(rpc.params?.taskId, 'taskId'));
      if (!item) return errorResponse(rpc.id, -32602, 'Task not found');
      return resultResponse(
        rpc.id,
        { resultType: 'complete', ...taskFromRequest(item, actor) },
        true,
      );
    }
    if (rpc.method === 'tasks/update') {
      if (!modern || !hasTasksCapability(rpc.params))
        return errorResponse(rpc.id, -32021, 'MCP Tasks capability is required');
      const values = rpc.params?.inputResponses?.decision?.content;
      if (!values?.action) throw new Error('A decision is required');
      await store.update(
        actor,
        requiredArgument(rpc.params?.taskId, 'taskId'),
        values.action,
        values.response,
      );
      return resultResponse(rpc.id, { resultType: 'complete' }, true);
    }
    if (rpc.method === 'tasks/cancel') {
      if (!modern || !hasTasksCapability(rpc.params))
        return errorResponse(rpc.id, -32021, 'MCP Tasks capability is required');
      await store.update(actor, requiredArgument(rpc.params?.taskId, 'taskId'), 'cancel');
      return resultResponse(rpc.id, { resultType: 'complete' }, true);
    }
    return errorResponse(rpc.id, -32601, 'Method not found');
  } catch (error) {
    return errorResponse(rpc.id, -32602, error instanceof Error ? error.message : 'Invalid params');
  }
}
