import type { PersonRequestActor } from './person-requests';

export type UniversalMcpOwner = 'agent' | 'room' | 'vault';
export type UniversalMcpVisibility = 'private' | 'room' | 'redacted';

type JsonSchema = {
  type?: string;
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  maxItems?: number;
  pattern?: string;
};

export type UniversalMcpOperation = {
  name: string;
  kind: 'tool' | 'resource' | 'resource-template' | 'event';
  owner: UniversalMcpOwner;
  authority: string;
  idempotency: 'natural' | 'invocation';
  receipt: 'none' | 'read' | 'mutation';
  visibility: UniversalMcpVisibility;
  inputSchema?: JsonSchema;
  uri?: string;
  uriTemplate?: string;
};

const invocation = {
  invocationId: { type: 'string', minLength: 8, maxLength: 200 },
};
const agent = {
  agentId: { type: 'string', minLength: 1, maxLength: 200 },
};
const identifier = {
  id: { type: 'string', minLength: 1, maxLength: 200 },
};

export const universalMcpOperations: readonly UniversalMcpOperation[] = [
  {
    name: 'room_summary',
    kind: 'resource',
    owner: 'room',
    authority: 'room.read',
    idempotency: 'natural',
    receipt: 'none',
    visibility: 'room',
    uri: 'chat-ax://room',
  },
  {
    name: 'fleet_agents',
    kind: 'resource',
    owner: 'room',
    authority: 'fleet.read',
    idempotency: 'natural',
    receipt: 'none',
    visibility: 'room',
    uri: 'chat-ax://fleet/agents',
  },
  {
    name: 'fleet_activity',
    kind: 'resource',
    owner: 'room',
    authority: 'fleet.read',
    idempotency: 'natural',
    receipt: 'none',
    visibility: 'redacted',
    uri: 'chat-ax://fleet/activity',
  },
  {
    name: 'fleet_deletions',
    kind: 'resource',
    owner: 'room',
    authority: 'fleet.audit',
    idempotency: 'natural',
    receipt: 'none',
    visibility: 'redacted',
    uri: 'chat-ax://fleet/deletions',
  },
  {
    name: 'orchestration',
    kind: 'resource',
    owner: 'room',
    authority: 'orchestration.read',
    idempotency: 'natural',
    receipt: 'none',
    visibility: 'room',
    uri: 'chat-ax://orchestration',
  },
  {
    name: 'reviews',
    kind: 'resource',
    owner: 'room',
    authority: 'reviews.read.self',
    idempotency: 'natural',
    receipt: 'none',
    visibility: 'private',
    uri: 'chat-ax://reviews',
  },
  {
    name: 'operation_receipts',
    kind: 'resource',
    owner: 'room',
    authority: 'receipts.read.self',
    idempotency: 'natural',
    receipt: 'none',
    visibility: 'redacted',
    uri: 'chat-ax://receipts',
  },
  {
    name: 'proof_readiness',
    kind: 'resource',
    owner: 'room',
    authority: 'proof.read',
    idempotency: 'natural',
    receipt: 'none',
    visibility: 'room',
    uri: 'chat-ax://proof/readiness',
  },
  {
    name: 'agent_snapshot',
    kind: 'resource-template',
    owner: 'agent',
    authority: 'agent.read',
    idempotency: 'natural',
    receipt: 'none',
    visibility: 'private',
    uriTemplate: 'chat-ax://agents/{agentId}',
  },
  {
    name: 'agent_conversation',
    kind: 'resource-template',
    owner: 'agent',
    authority: 'conversation.read',
    idempotency: 'natural',
    receipt: 'none',
    visibility: 'private',
    uriTemplate: 'chat-ax://agents/{agentId}/conversation',
  },
  {
    name: 'agent_work',
    kind: 'resource-template',
    owner: 'agent',
    authority: 'work.read',
    idempotency: 'natural',
    receipt: 'none',
    visibility: 'private',
    uriTemplate: 'chat-ax://agents/{agentId}/work',
  },
  {
    name: 'agent_file_content',
    kind: 'resource-template',
    owner: 'agent',
    authority: 'agent.files.read',
    idempotency: 'natural',
    receipt: 'none',
    visibility: 'private',
    uriTemplate: 'chat-ax://agents/{agentId}/files/{fileId}',
  },
  {
    name: 'agent_receipts',
    kind: 'resource-template',
    owner: 'agent',
    authority: 'receipts.read.self',
    idempotency: 'natural',
    receipt: 'none',
    visibility: 'redacted',
    uriTemplate: 'chat-ax://agents/{agentId}/receipts',
  },
  {
    name: 'chat_send_message',
    kind: 'tool',
    owner: 'agent',
    authority: 'conversation.write',
    idempotency: 'invocation',
    receipt: 'mutation',
    visibility: 'private',
    inputSchema: {
      type: 'object',
      properties: {
        ...invocation,
        ...agent,
        text: { type: 'string', minLength: 1, maxLength: 8000 },
      },
      required: ['invocationId', 'agentId', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'chat_cancel_message',
    kind: 'tool',
    owner: 'agent',
    authority: 'conversation.cancel',
    idempotency: 'invocation',
    receipt: 'mutation',
    visibility: 'private',
    inputSchema: {
      type: 'object',
      properties: {
        ...invocation,
        ...agent,
        messageId: { type: 'string', minLength: 1, maxLength: 200 },
      },
      required: ['invocationId', 'agentId', 'messageId'],
      additionalProperties: false,
    },
  },
  {
    name: 'chat_clear_history',
    kind: 'tool',
    owner: 'agent',
    authority: 'conversation.history.clear',
    idempotency: 'invocation',
    receipt: 'mutation',
    visibility: 'private',
    inputSchema: {
      type: 'object',
      properties: { ...invocation, ...agent },
      required: ['invocationId', 'agentId'],
      additionalProperties: false,
    },
  },
  {
    name: 'chat_compact_context',
    kind: 'tool',
    owner: 'agent',
    authority: 'conversation.context.compact',
    idempotency: 'invocation',
    receipt: 'mutation',
    visibility: 'private',
    inputSchema: {
      type: 'object',
      properties: { ...invocation, ...agent },
      required: ['invocationId', 'agentId'],
      additionalProperties: false,
    },
  },
  {
    name: 'agent_settings_update',
    kind: 'tool',
    owner: 'agent',
    authority: 'agent.settings.write',
    idempotency: 'invocation',
    receipt: 'mutation',
    visibility: 'private',
    inputSchema: {
      type: 'object',
      properties: {
        ...invocation,
        ...agent,
        settings: {
          type: 'object',
          additionalProperties: false,
          properties: {
            model: {
              type: 'string',
              enum: [
                'gpt-5.6-luna',
                'gpt-5.6-sol',
                'gpt-5.6-terra',
                'anthropic/claude-opus-5-5',
                '@cf/moonshotai/kimi-k3',
                '@cf/zai-org/glm-5.3',
              ],
            },
            thinkingLevel: {
              type: 'string',
              enum: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
            },
            systemPrompt: { type: 'string', maxLength: 32000 },
            agentAvatarSeed: { type: 'string', maxLength: 200 },
          },
        },
      },
      required: ['invocationId', 'agentId', 'settings'],
      additionalProperties: false,
    },
  },
  {
    name: 'agent_state_create',
    kind: 'tool',
    owner: 'agent',
    authority: 'agent.state.write',
    idempotency: 'invocation',
    receipt: 'mutation',
    visibility: 'private',
    inputSchema: {
      type: 'object',
      properties: {
        ...invocation,
        ...agent,
        key: { type: 'string', minLength: 1, maxLength: 80, pattern: '^[A-Za-z0-9._-]+$' },
        value: { type: 'string', minLength: 1, maxLength: 8000, pattern: '\\S' },
      },
      required: ['invocationId', 'agentId', 'key', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'agent_state_update',
    kind: 'tool',
    owner: 'agent',
    authority: 'agent.state.write',
    idempotency: 'invocation',
    receipt: 'mutation',
    visibility: 'private',
    inputSchema: {
      type: 'object',
      properties: {
        ...invocation,
        ...agent,
        ...identifier,
        key: { type: 'string', minLength: 1, maxLength: 80, pattern: '^[A-Za-z0-9._-]+$' },
        value: { type: 'string', minLength: 1, maxLength: 8000, pattern: '\\S' },
      },
      required: ['invocationId', 'agentId', 'id', 'key', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'agent_state_delete',
    kind: 'tool',
    owner: 'agent',
    authority: 'agent.state.write',
    idempotency: 'invocation',
    receipt: 'mutation',
    visibility: 'private',
    inputSchema: {
      type: 'object',
      properties: { ...invocation, ...agent, ...identifier },
      required: ['invocationId', 'agentId', 'id'],
      additionalProperties: false,
    },
  },
  {
    name: 'agent_skill_create',
    kind: 'tool',
    owner: 'agent',
    authority: 'agent.skills.write',
    idempotency: 'invocation',
    receipt: 'mutation',
    visibility: 'private',
    inputSchema: {
      type: 'object',
      properties: {
        ...invocation,
        ...agent,
        name: { type: 'string', minLength: 1, maxLength: 200 },
        description: { type: 'string', maxLength: 2000 },
        body: { type: 'string', maxLength: 32000 },
      },
      required: ['invocationId', 'agentId', 'name', 'description', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'agent_skill_update',
    kind: 'tool',
    owner: 'agent',
    authority: 'agent.skills.write',
    idempotency: 'invocation',
    receipt: 'mutation',
    visibility: 'private',
    inputSchema: {
      type: 'object',
      properties: {
        ...invocation,
        ...agent,
        name: { type: 'string', minLength: 1, maxLength: 200 },
        description: { type: 'string', maxLength: 2000 },
        body: { type: 'string', maxLength: 32000 },
      },
      required: ['invocationId', 'agentId', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'agent_skill_delete',
    kind: 'tool',
    owner: 'agent',
    authority: 'agent.skills.write',
    idempotency: 'invocation',
    receipt: 'mutation',
    visibility: 'private',
    inputSchema: {
      type: 'object',
      properties: {
        ...invocation,
        ...agent,
        name: { type: 'string', minLength: 1, maxLength: 200 },
      },
      required: ['invocationId', 'agentId', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'agent_job_create',
    kind: 'tool',
    owner: 'agent',
    authority: 'agent.jobs.write',
    idempotency: 'invocation',
    receipt: 'mutation',
    visibility: 'private',
    inputSchema: {
      type: 'object',
      properties: {
        ...invocation,
        ...agent,
        name: { type: 'string', minLength: 1, maxLength: 200 },
        prompt: { type: 'string', minLength: 1, maxLength: 8000 },
        intervalSeconds: { type: 'integer', minimum: 60, maximum: 31536000 },
        repeat: { type: 'boolean' },
      },
      required: ['invocationId', 'agentId', 'name', 'prompt', 'intervalSeconds'],
      additionalProperties: false,
    },
  },
  {
    name: 'agent_job_update',
    kind: 'tool',
    owner: 'agent',
    authority: 'agent.jobs.write',
    idempotency: 'invocation',
    receipt: 'mutation',
    visibility: 'private',
    inputSchema: {
      type: 'object',
      properties: {
        ...invocation,
        ...agent,
        ...identifier,
        name: { type: 'string', minLength: 1, maxLength: 200 },
        prompt: { type: 'string', minLength: 1, maxLength: 8000 },
        intervalSeconds: { type: 'integer', minimum: 60, maximum: 31536000 },
        repeat: { type: 'boolean' },
      },
      required: ['invocationId', 'agentId', 'id', 'name', 'prompt', 'intervalSeconds'],
      additionalProperties: false,
    },
  },
  ...['pause', 'resume', 'delete'].map((action) => ({
    name: `agent_job_${action}`,
    kind: 'tool' as const,
    owner: 'agent' as const,
    authority: 'agent.jobs.write',
    idempotency: 'invocation' as const,
    receipt: 'mutation' as const,
    visibility: 'private' as const,
    inputSchema: {
      type: 'object',
      properties: { ...invocation, ...agent, ...identifier },
      required: ['invocationId', 'agentId', 'id'],
      additionalProperties: false,
    },
  })),
  {
    name: 'agent_file_upload',
    kind: 'tool',
    owner: 'agent',
    authority: 'agent.files.write',
    idempotency: 'invocation',
    receipt: 'mutation',
    visibility: 'private',
    inputSchema: {
      type: 'object',
      properties: {
        ...invocation,
        ...agent,
        name: { type: 'string', minLength: 1, maxLength: 200 },
        mediaType: { type: 'string', enum: ['text/plain', 'text/markdown', 'application/json'] },
        text: { type: 'string', maxLength: 64000 },
      },
      required: ['invocationId', 'agentId', 'name', 'mediaType', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'agent_file_delete',
    kind: 'tool',
    owner: 'agent',
    authority: 'agent.files.write',
    idempotency: 'invocation',
    receipt: 'mutation',
    visibility: 'private',
    inputSchema: {
      type: 'object',
      properties: {
        ...invocation,
        ...agent,
        fileId: { type: 'string', minLength: 1, maxLength: 200 },
      },
      required: ['invocationId', 'agentId', 'fileId'],
      additionalProperties: false,
    },
  },
  {
    name: 'orchestration_update',
    kind: 'tool',
    owner: 'room',
    authority: 'orchestration.write',
    idempotency: 'invocation',
    receipt: 'mutation',
    visibility: 'room',
    inputSchema: {
      type: 'object',
      properties: { ...invocation, mode: { type: 'string', enum: ['strict', 'mesh'] } },
      required: ['invocationId', 'mode'],
      additionalProperties: false,
    },
  },
  {
    name: 'ui_open_conversation',
    kind: 'tool',
    owner: 'room',
    authority: 'ui.navigate',
    idempotency: 'invocation',
    receipt: 'mutation',
    visibility: 'room',
    inputSchema: {
      type: 'object',
      properties: { ...invocation, ...agent },
      required: ['invocationId', 'agentId'],
      additionalProperties: false,
    },
  },
  {
    name: 'fleet_changed',
    kind: 'event',
    owner: 'room',
    authority: 'fleet.read',
    idempotency: 'natural',
    receipt: 'none',
    visibility: 'redacted',
    uri: 'chat-ax://events/fleet',
  },
] as const;

export const universalMcpTools = universalMcpOperations
  .filter((operation) => operation.kind === 'tool')
  .map((operation) => ({
    name: operation.name,
    title: operation.name
      .split('_')
      .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
      .join(' '),
    description: `${operation.authority} through the ${operation.owner} authority boundary.`,
    inputSchema: operation.inputSchema,
  }));

export const universalMcpEvents = universalMcpOperations
  .filter((operation) => operation.kind === 'event')
  .map((operation) => ({
    name: operation.name,
    authority: operation.authority,
    visibility: operation.visibility,
    transport: { kind: 'websocket', href: '/api/fleet/events' },
    ...(operation.uri === undefined ? {} : { uri: operation.uri }),
    ...(operation.uriTemplate === undefined ? {} : { uriTemplate: operation.uriTemplate }),
  }));

export const universalMcpResources = universalMcpOperations
  .filter((operation) => operation.kind === 'resource')
  .map((operation) => ({ name: operation.name, uri: operation.uri, mimeType: 'application/json' }));

export const universalMcpResourceTemplates = universalMcpOperations
  .filter((operation) => operation.kind === 'resource-template')
  .map((operation) => ({
    name: operation.name,
    uriTemplate: operation.uriTemplate,
    mimeType: 'application/json',
  }));

export interface UniversalMcpStore {
  read(uri: string, actor: PersonRequestActor): Promise<unknown>;
  execute(
    name: string,
    args: Record<string, unknown>,
    actor: PersonRequestActor,
  ): Promise<{ invocationId: string; replayed: boolean; receiptId: string; result: unknown }>;
}

export function universalMcpTool(name: string): UniversalMcpOperation | undefined {
  return universalMcpOperations.find(
    (operation) => operation.kind === 'tool' && operation.name === name,
  );
}

function matchesSchema(value: unknown, schema: JsonSchema): boolean {
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'string')
    return (
      typeof value === 'string' &&
      value.length >= (schema.minLength ?? 0) &&
      value.length <= (schema.maxLength ?? Number.POSITIVE_INFINITY) &&
      (schema.pattern === undefined || new RegExp(schema.pattern).test(value))
    );
  if (schema.type === 'integer')
    return (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= (schema.minimum ?? Number.NEGATIVE_INFINITY) &&
      value <= (schema.maximum ?? Number.POSITIVE_INFINITY)
    );
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'array')
    return (
      Array.isArray(value) &&
      value.length <= (schema.maxItems ?? Number.POSITIVE_INFINITY) &&
      value.every((item) => !schema.items || matchesSchema(item, schema.items))
    );
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const properties = schema.properties ?? {};
    if (
      schema.additionalProperties === false &&
      Object.keys(value).some((key) => !(key in properties))
    )
      return false;
    if ((schema.required ?? []).some((key) => !(key in value))) return false;
    return Object.entries(value).every(
      ([key, item]) => !properties[key] || matchesSchema(item, properties[key]),
    );
  }
  return true;
}

export function validateUniversalMcpArguments(
  operation: UniversalMcpOperation,
  args: Record<string, unknown>,
): void {
  if (!operation.inputSchema || !matchesSchema(args, operation.inputSchema))
    throw new Error('Arguments do not match the product operation schema');
}
