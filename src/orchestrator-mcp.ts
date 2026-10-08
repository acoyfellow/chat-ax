import { z } from 'zod';
import { type AgentDelegation, validateDelegation } from './agent-oracle';

export type FleetAgent = { id: string; parentId: string | null; title: string; avatarSeed: string };
export interface FleetStore {
  list(): Promise<FleetAgent[]>;
  create(parentId: string | null, requestedId?: string, title?: string): Promise<FleetAgent>;
  rename(id: string, title: string): Promise<FleetAgent>;
  delete(id: string): Promise<unknown>;
  context(id: string): Promise<unknown>;
  updateContext(id: string, context: unknown): Promise<void>;
  sendMessage?(fromAgentId: string, toAgentId: string, message: string): Promise<unknown>;
  transferFile?(fromAgentId: string, toAgentId: string, fileId: string): Promise<unknown>;
  inspectJob?(fromAgentId: string, toAgentId: string, jobId: string): Promise<unknown>;
  grantCommunication?(
    fromAgentId: string,
    toAgentId: string,
    actions: string[],
    expiresAt: string,
  ): Promise<unknown>;
  revokeCommunication?(grantId: string): Promise<unknown>;
}

const delegationSchema = z
  .object({
    messageId: z.string(),
    fromAgentId: z.string(),
    toAgentId: z.string(),
    roomId: z.string(),
    taskId: z.string(),
    payload: z.unknown(),
    requestedCapabilities: z.array(z.string()),
    replyTo: z.string().optional(),
    expiresAt: z.string(),
  })
  .strict();

export const orchestratorTools = [
  'list_agents',
  'create_agent',
  'rename_agent',
  'delete_agent',
  'get_agent_context',
  'update_agent_context',
  'delegate_to_agent',
  'send_agent_message',
  'transfer_agent_file',
  'inspect_agent_job',
  'grant_agent_communication',
  'revoke_agent_communication',
] as const;

const orchestratorInputSchemas: Record<(typeof orchestratorTools)[number], object> = {
  list_agents: { type: 'object', properties: {}, additionalProperties: false },
  create_agent: {
    type: 'object',
    properties: {
      parentId: { type: ['string', 'null'], minLength: 1, maxLength: 200 },
      agentId: { type: 'string', minLength: 1, maxLength: 200 },
      title: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
    },
    additionalProperties: false,
  },
  rename_agent: {
    type: 'object',
    properties: {
      agentId: { type: 'string', minLength: 1, maxLength: 200 },
      title: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
    },
    required: ['agentId', 'title'],
    additionalProperties: false,
  },
  delete_agent: {
    type: 'object',
    properties: { agentId: { type: 'string', minLength: 1, maxLength: 200 } },
    required: ['agentId'],
    additionalProperties: false,
  },
  get_agent_context: {
    type: 'object',
    properties: { agentId: { type: 'string', minLength: 1, maxLength: 200 } },
    required: ['agentId'],
    additionalProperties: false,
  },
  update_agent_context: {
    type: 'object',
    properties: {
      agentId: { type: 'string', minLength: 1, maxLength: 200 },
      context: { type: 'object' },
    },
    required: ['agentId', 'context'],
    additionalProperties: false,
  },
  delegate_to_agent: {
    type: 'object',
    properties: {
      message: {
        type: 'object',
        properties: {
          messageId: { type: 'string' },
          fromAgentId: { type: 'string' },
          toAgentId: { type: 'string' },
          roomId: { type: 'string' },
          taskId: { type: 'string' },
          payload: {},
          requestedCapabilities: { type: 'array', items: { type: 'string' } },
          replyTo: { type: 'string' },
          expiresAt: { type: 'string', format: 'date-time' },
        },
        required: [
          'messageId',
          'fromAgentId',
          'toAgentId',
          'roomId',
          'taskId',
          'payload',
          'requestedCapabilities',
          'expiresAt',
        ],
        additionalProperties: false,
      },
    },
    required: ['message'],
    additionalProperties: false,
  },
  send_agent_message: {
    type: 'object',
    properties: {
      fromAgentId: { type: 'string', minLength: 1, maxLength: 200 },
      toAgentId: { type: 'string', minLength: 1, maxLength: 200 },
      message: { type: 'string', minLength: 1, maxLength: 8000 },
    },
    required: ['fromAgentId', 'toAgentId', 'message'],
    additionalProperties: false,
  },
  transfer_agent_file: {
    type: 'object',
    properties: {
      fromAgentId: { type: 'string', minLength: 1, maxLength: 200 },
      toAgentId: { type: 'string', minLength: 1, maxLength: 200 },
      fileId: { type: 'string', minLength: 1, maxLength: 200 },
    },
    required: ['fromAgentId', 'toAgentId', 'fileId'],
    additionalProperties: false,
  },
  inspect_agent_job: {
    type: 'object',
    properties: {
      fromAgentId: { type: 'string', minLength: 1, maxLength: 200 },
      toAgentId: { type: 'string', minLength: 1, maxLength: 200 },
      jobId: { type: 'string', minLength: 1, maxLength: 200 },
    },
    required: ['fromAgentId', 'toAgentId', 'jobId'],
    additionalProperties: false,
  },
  grant_agent_communication: {
    type: 'object',
    properties: {
      fromAgentId: { type: 'string', minLength: 1, maxLength: 200 },
      toAgentId: { type: 'string', minLength: 1, maxLength: 200 },
      actions: {
        type: 'array',
        items: { type: 'string', enum: ['message', 'file', 'job-summary'] },
        minItems: 1,
        maxItems: 3,
      },
      expiresAt: { type: 'string', format: 'date-time' },
    },
    required: ['fromAgentId', 'toAgentId', 'actions', 'expiresAt'],
    additionalProperties: false,
  },
  revoke_agent_communication: {
    type: 'object',
    properties: { grantId: { type: 'string', format: 'uuid' } },
    required: ['grantId'],
    additionalProperties: false,
  },
};

export const orchestratorToolDescriptors = orchestratorTools.map((name) => ({
  name,
  title: name
    .split('_')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' '),
  description: `Run the ${name} fleet operation through the room orchestrator.`,
  inputSchema: orchestratorInputSchemas[name],
}));

export async function callOrchestratorTool(
  name: string,
  args: Record<string, unknown>,
  store: FleetStore,
): Promise<unknown> {
  if (name === 'list_agents') {
    z.object({}).strict().parse(args);
    return { agents: await store.list() };
  }
  if (name === 'create_agent') {
    const value = z
      .object({
        parentId: z.string().min(1).max(200).nullable().optional(),
        agentId: z.string().min(1).max(200).optional(),
        title: z.string().trim().min(1).max(200).optional(),
      })
      .strict()
      .parse(args);
    return { agent: await store.create(value.parentId ?? null, value.agentId, value.title) };
  }
  if (name === 'rename_agent') {
    const value = z
      .object({ agentId: z.string().min(1).max(200), title: z.string().trim().min(1).max(200) })
      .strict()
      .parse(args);
    return { agent: await store.rename(value.agentId, value.title) };
  }
  if (name === 'delete_agent') {
    const value = z
      .object({ agentId: z.string().min(1).max(200) })
      .strict()
      .parse(args);
    const result = await store.delete(value.agentId);
    return { deleted: true, agentId: value.agentId, cleanup: result };
  }
  if (name === 'get_agent_context') {
    const value = z
      .object({ agentId: z.string().min(1).max(200) })
      .strict()
      .parse(args);
    return { agentId: value.agentId, context: await store.context(value.agentId) };
  }
  if (name === 'update_agent_context') {
    const value = z
      .object({ agentId: z.string().min(1).max(200), context: z.record(z.string(), z.unknown()) })
      .strict()
      .parse(args);
    await store.updateContext(value.agentId, value.context);
    return { updated: true, agentId: value.agentId };
  }
  if (name === 'delegate_to_agent') {
    const value = z.object({ message: delegationSchema }).strict().parse(args);
    const message = value.message satisfies AgentDelegation;
    validateDelegation(message);
    return { accepted: true, messageId: message.messageId };
  }
  if (name === 'send_agent_message') {
    const value = z
      .object({
        fromAgentId: z.string().min(1).max(200),
        toAgentId: z.string().min(1).max(200),
        message: z.string().trim().min(1).max(8_000),
      })
      .strict()
      .parse(args);
    if (!store.sendMessage) throw new Error('Agent communication is unavailable');
    return store.sendMessage(value.fromAgentId, value.toAgentId, value.message);
  }
  if (name === 'transfer_agent_file') {
    const value = z
      .object({
        fromAgentId: z.string().min(1).max(200),
        toAgentId: z.string().min(1).max(200),
        fileId: z.string().min(1).max(200),
      })
      .strict()
      .parse(args);
    if (!store.transferFile) throw new Error('Agent communication is unavailable');
    return store.transferFile(value.fromAgentId, value.toAgentId, value.fileId);
  }
  if (name === 'inspect_agent_job') {
    const value = z
      .object({
        fromAgentId: z.string().min(1).max(200),
        toAgentId: z.string().min(1).max(200),
        jobId: z.string().min(1).max(200),
      })
      .strict()
      .parse(args);
    if (!store.inspectJob) throw new Error('Agent communication is unavailable');
    return store.inspectJob(value.fromAgentId, value.toAgentId, value.jobId);
  }
  if (name === 'grant_agent_communication') {
    const value = z
      .object({
        fromAgentId: z.string().min(1).max(200),
        toAgentId: z.string().min(1).max(200),
        actions: z
          .array(z.enum(['message', 'file', 'job-summary']))
          .min(1)
          .max(3),
        expiresAt: z.string().datetime(),
      })
      .strict()
      .parse(args);
    if (!store.grantCommunication) throw new Error('Agent communication is unavailable');
    return store.grantCommunication(
      value.fromAgentId,
      value.toAgentId,
      value.actions,
      value.expiresAt,
    );
  }
  if (name === 'revoke_agent_communication') {
    const value = z.object({ grantId: z.string().uuid() }).strict().parse(args);
    if (!store.revokeCommunication) throw new Error('Agent communication is unavailable');
    return store.revokeCommunication(value.grantId);
  }
  throw new Error('Unknown orchestrator tool');
}
