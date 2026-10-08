import { aiGatewayId, workersAIGatewayId } from './deployment-config';
import { localModelReply } from './local-model';
import { DurableObject } from 'cloudflare:workers';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { createModels } from '@earendil-works/pi-ai/models';
import { chatGatewayProvider } from './chat-model-provider';
import { Type } from 'typebox';
import { z } from 'zod';
import { agentFileObjectKey, recurringJobActorId } from './agent-private-resources';
import { applyAgentCancellation } from './agent-cancellation';
import {
  type AgentQueueRecord,
  claimAgentWork,
  createAgentRuntimeIdentity,
  enqueueAgentWork,
} from './agent-runtime';
import { callSpeakerMcpTool, listSpeakerMcpTools } from './mcp-connector-client';
import {
  chatModelById,
  deploymentDefaultModelId,
  defaultSystemPrompt,
  defaultThinkingLevel,
  isChatModelId,
  isThinkingLevel,
  normalizeSystemPrompt,
} from './chat-settings';
import { DurableTurnRuntime, type TurnInvocation, type TurnTool } from './pi/durable/turn-runtime';
import { toolArgumentsDetail, toolResultDetail } from './tool-activity-detail';
import { workersAI } from './pi/providers/workers-ai';
import type { Provider } from '@earendil-works/pi-ai';
import type { ChatMessage, RoomSettings, WorkItem } from './room';
import { type RoomSkill, createRoomSkill, deleteRoomSkill, editRoomSkill } from './room-skills';
import type { ConnectorVaultDO } from './connector-vault';
import { recordMcpExecution, type McpReceipt } from './mcp-receipts';
import { nativeAgentCapabilityPrompt, SerialOperationLane } from './native-agent-tools';
import { FrameCoalescer, type LiveFrame, encodeFrame, isWebSocketUpgrade } from './live-socket';
import { cloneRequest, parseBoundedJson, readBoundedJson } from './safe-json';
import { resolveTurnAuthority } from './turn-authority';
import {
  type AgentStateEntry,
  type RecurringJob,
  type SharedFile,
  maximumAgentStateEntries,
  maximumRecurringJobs,
  maximumSharedFiles,
  fileKind,
  maximumTextFileBytes,
  normalizeJobInput,
  normalizeStateKey,
  normalizeStateValue,
  supportedTextTypes,
} from './shared-features';

const resourceNames = [
  'settings',
  'messages',
  'skills',
  'files',
  'state',
  'jobs',
  'work',
  'tools',
  'queue',
] as const;
export type AgentResourceName = (typeof resourceNames)[number];

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string().max(32_000),
    z.array(jsonValueSchema).max(500),
    z
      .record(z.string().max(200), jsonValueSchema)
      .refine((value) => Object.keys(value).length <= 100),
  ]),
);
const storedJson = <T>() => jsonValueSchema.pipe(z.custom<T>(() => true));
const agentResourcesObjectSchema = z.object({
  settings: z.record(z.string(), jsonValueSchema).default({}),
  messages: z.array(storedJson<ChatMessage>()).max(200).default([]),
  skills: z.array(storedJson<RoomSkill>()).max(100).default([]),
  files: z.array(storedJson<SharedFile>()).max(maximumSharedFiles).default([]),
  state: z.array(storedJson<AgentStateEntry>()).max(maximumAgentStateEntries).default([]),
  jobs: z.array(storedJson<RecurringJob>()).max(maximumRecurringJobs).default([]),
  work: z.array(storedJson<WorkItem>()).max(100).default([]),
  tools: z.array(jsonValueSchema).max(100).default([]),
  queue: z.array(jsonValueSchema).max(100).default([]),
});
export const agentResourcesSchema = {
  parse(value: unknown): AgentResources {
    return agentResourcesObjectSchema.parse(value);
  },
};
const initializeSchema = z.object({
  agentId: z.string().min(1).max(200),
  customization: agentResourcesObjectSchema.partial().optional(),
});
const resourceMutationSchema = z.object({ value: jsonValueSchema });
const communicationInboxSchema = z
  .object({
    fromAgentId: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(8_000),
  })
  .strict();
const submittedMessageSchema = z.object({
  text: z.string().trim().min(1).max(8_000),
  authorId: z.string().trim().min(1).max(200),
  authorName: z.string().trim().min(1).max(200),
  authorEmail: z.string().trim().toLowerCase().email().max(320),
  avatarUrl: z.string().url().max(2_000).optional(),
  personRequestId: z.string().trim().min(1).max(200).optional(),
});

export type AgentResources = {
  settings: Record<string, unknown>;
  messages: ChatMessage[];
  skills: RoomSkill[];
  files: SharedFile[];
  state: AgentStateEntry[];
  jobs: RecurringJob[];
  work: WorkItem[];
  tools: unknown[];
  queue: unknown[];
};
export type NativeAgentToolReceipt = {
  id: string;
  operationId: string;
  invocationId: string;
  actorId: string;
  agentId: string;
  toolName: string;
  resource: 'state' | 'jobs' | 'skills' | 'files' | 'settings' | 'work' | 'coordination';
  action: string;
  status: 'admitted' | 'succeeded' | 'outcome-unknown';
  startedAt: string;
  finishedAt?: string;
  result?: unknown;
};

export type AgentSnapshot = AgentResources & {
  agentId: string;
  sessionId: string;
  initializedAt: string;
};
export type AgentEnv = {
  AI: Ai;
  CONNECTOR_VAULT: DurableObjectNamespace<ConnectorVaultDO>;
  ROOM: DurableObjectNamespace;
  FILES: R2Bucket;
  ENVIRONMENT?: string;
  LOCAL_AI_MODE?: 'faux' | 'remote';
  MCP_CONNECTOR_ID?: string;
  MCP_CONNECTOR_NAME?: string;
  MCP_SERVER_URL?: string;
  AI_GATEWAY_ID?: string;
  DEFAULT_MODEL?: string;
};

const queueInputSchema = z.object({
  id: z.string().min(1).max(200),
  payload: jsonValueSchema,
});
const maximumMessageQueueDepth = 100;
const requestPersonParameters = Type.Object(
  {
    recipientEmail: Type.String({ format: 'email', maxLength: 320 }),
    recipientName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    title: Type.String({ minLength: 1, maxLength: 240 }),
    details: Type.String({ minLength: 1, maxLength: 8_000 }),
    kind: Type.Optional(Type.Literal('review', { description: 'Set for a code-review request.' })),
    resourceUrl: Type.Optional(
      Type.String({
        format: 'uri',
        maxLength: 2_000,
        description: 'The single merge-request URL to review.',
      }),
    ),
  },
  { additionalProperties: false },
);
const emptyParameters = Type.Object({}, { additionalProperties: false });
const identifierParameters = Type.Object(
  { id: Type.String({ minLength: 1, maxLength: 200 }) },
  { additionalProperties: false },
);
const stateWriteParameters = Type.Object(
  {
    id: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    key: Type.String({ minLength: 1, maxLength: 80 }),
    value: Type.String({ minLength: 1, maxLength: 8_000 }),
  },
  { additionalProperties: false },
);
const skillNameParameters = Type.Object(
  { name: Type.String({ minLength: 2, maxLength: 64 }) },
  { additionalProperties: false },
);
const skillCreateParameters = Type.Object(
  {
    name: Type.String({ minLength: 2, maxLength: 64 }),
    description: Type.String({ minLength: 1, maxLength: 500 }),
    body: Type.String({ minLength: 1, maxLength: 32_000 }),
  },
  { additionalProperties: false },
);
const skillUpdateParameters = Type.Object(
  {
    name: Type.String({ minLength: 2, maxLength: 64 }),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    body: Type.Optional(Type.String({ minLength: 1, maxLength: 32_000 })),
  },
  { additionalProperties: false },
);
const jobWriteParameters = Type.Object(
  {
    id: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    prompt: Type.String({ minLength: 1, maxLength: 4_000 }),
    intervalSeconds: Type.Integer({ minimum: 60, maximum: 2_592_000 }),
    maxRuns: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 1_000 }), Type.Null()])),
  },
  { additionalProperties: false },
);
const fileCreateParameters = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    mime: Type.Union([
      Type.Literal('text/plain'),
      Type.Literal('text/markdown'),
      Type.Literal('text/csv'),
      Type.Literal('application/json'),
    ]),
    content: Type.String({ maxLength: maximumTextFileBytes }),
  },
  { additionalProperties: false },
);
const settingsUpdateParameters = Type.Object(
  {
    modelId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    thinkingLevel: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
    systemPrompt: Type.Optional(Type.String({ minLength: 1, maxLength: 32_000 })),
    agentAvatarSeed: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false },
);
const listMcpParameters = emptyParameters;
const callMcpParameters = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  argumentsJson: Type.Optional(Type.String({ maxLength: 8_000 })),
});

const defaults = (): AgentResources => agentResourcesSchema.parse({});

const workersAIModels = [
  { id: '@cf/moonshotai/kimi-k2.7-code', name: 'Kimi K2.7 Code' },
  { id: '@cf/moonshotai/kimi-k3', name: 'Kimi K3' },
  { id: '@cf/zai-org/glm-5.3', name: 'GLM 5.3' },
].map((model) => ({ ...model, contextWindow: 262_144, maxTokens: 16_384, reasoning: true }));

type ProofJson = null | boolean | number | string | ProofJson[] | { [key: string]: ProofJson };

function proofJson(value: unknown): ProofJson {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(proofJson);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, proofJson(item)]));
  throw new Error('Proof tool arguments must be JSON');
}

function proofToolArguments(value: unknown): { [key: string]: ProofJson } {
  const parsed = proofJson(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Proof tool arguments must be an object');
  return parsed;
}

function gatewayProviders(env: AgentEnv): Provider[] {
  const gateway = aiGatewayId(env);
  return [workersAI(env.AI, { gateway: workersAIGatewayId(env), models: workersAIModels }), chatGatewayProvider(env.AI, gateway)];
}

export class AgentDO extends DurableObject<AgentEnv> {
  private readonly pi: DurableTurnRuntime;
  private readonly faux: ReturnType<typeof fauxProvider> | null;
  private drainPromise: Promise<void> | null = null;
  private readonly nativeResourceLane = new SerialOperationLane();
  private readonly piProgress = new Map<string, { text: string; reasoning: string; tools: Array<{ id: string; name: string; status: 'running' | 'complete' | 'error'; startedAt: string; completedAt?: string; arguments?: string; result?: string }> }>();
  private readonly progressWrites = new Map<string, Promise<void>>();
  private readonly liveFrames = new FrameCoalescer((frame) => this.broadcast(frame));

  private broadcast(frame: LiveFrame): void {
    const encoded = encodeFrame(frame);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(encoded);
      } catch {}
    }
  }

  private announceChange(): void {
    this.liveFrames.flush();
    this.broadcast({ type: 'changed' });
  }

  private acceptLiveSocket(): Response {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].send(encodeFrame({ type: 'ready' }));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'ping') socket.send('pong');
  }

  async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    try {
      socket.close(code === 1005 ? 1000 : code, 'closed');
    } catch {}
  }

  constructor(state: DurableObjectState, env: AgentEnv) {
    super(state, env);
    const faux = env.ENVIRONMENT === 'dev' && env.LOCAL_AI_MODE !== 'remote' ? fauxProvider({ tokensPerSecond: 60, tokenSize: { min: 2, max: 5 } }) : null;
    this.faux = faux;
    const models = createModels();
    if (faux) models.setProvider(faux.provider);
    else for (const provider of gatewayProviders(env)) models.setProvider(provider);
    this.pi = new DurableTurnRuntime({
      storage: state.storage,
      models,
      model: faux
        ? { provider: faux.getModel().provider, modelId: faux.getModel().id }
        : { provider: 'cloudflare-workers-ai', modelId: '@cf/moonshotai/kimi-k2.7-code' },
      thinkingLevel: 'low',
      tools: () => this.tools(),
      instructions: async () => {
        const configured = (await this.settings()).systemPrompt;
        return `${configured}\n\n${nativeAgentCapabilityPrompt}`;
      },
    });
    this.pi.on((event) => {
      const operationId = event.operationId;
      const current = this.piProgress.get(operationId) ?? { text: '', reasoning: '', tools: [] };
      if (event.type === 'text_delta') current.text += event.delta;
      if (event.type === 'thinking_delta') current.reasoning += event.delta;
      if (event.type === 'tool_start') current.tools = [...current.tools, { id: event.toolCallId, name: event.toolName, status: 'running', startedAt: new Date().toISOString(), arguments: toolArgumentsDetail(event.arguments) }];
      if (event.type === 'tool_end') current.tools = current.tools.map((tool) => tool.id === event.toolCallId ? { ...tool, status: event.error ? 'error' : 'complete', completedAt: new Date().toISOString(), result: typeof event.result === 'string' ? event.result : undefined } : tool);
      this.piProgress.set(operationId, current);
      this.liveFrames.push(operationId, { type: 'progress', messageId: `agent-${operationId}`, text: current.text, tools: current.tools });
      const previousWrite = this.progressWrites.get(operationId) ?? Promise.resolve();
      const write = previousWrite.then(() => this.ctx.storage.put(`turn-progress:${operationId}`, { text: current.text, tools: current.tools }));
      this.progressWrites.set(operationId, write);
      this.ctx.waitUntil(write);
    });
    Object.defineProperty(this, 'fetch', {
      configurable: true,
      value: (request: Request) => this.onRequest(request),
    });
    Object.defineProperty(this, 'alarm', {
      configurable: true,
      value: () => this.onAlarm(),
    });
    void state.blockConcurrencyWhile(async () => {
      if (((await state.storage.get<string[]>('message-queue')) ?? []).length) this.ensureDrain();
    });
  }

  private async messages(): Promise<ChatMessage[]> {
    return (await this.ctx.storage.get<ChatMessage[]>('resource:messages')) ?? [];
  }

  private async settings(): Promise<RoomSettings> {
    const stored = await this.ctx.storage.get<Partial<RoomSettings>>('resource:settings');
    return {
      strategyId: stored?.strategyId ?? 'fifo',
      modelId: chatModelById(stored?.modelId ?? deploymentDefaultModelId(this.env.DEFAULT_MODEL)).id,
      thinkingLevel: stored?.thinkingLevel ?? defaultThinkingLevel,
      systemPrompt: stored?.systemPrompt ?? defaultSystemPrompt,
      agentAvatarSeed: stored?.agentAvatarSeed ?? 'agent',
      version: stored?.version ?? 1,
      updatedAt: stored?.updatedAt ?? new Date(0).toISOString(),
      updatedBy: stored?.updatedBy,
    };
  }

  private async executeNativeResourceTool(
    operationId: string,
    invocationId: string,
    toolName: string,
    resource: 'state' | 'jobs' | 'skills' | 'files' | 'settings' | 'work',
    action: string,
    input: Record<string, unknown>,
  ) {
    const authority = resolveTurnAuthority(await this.messages(), operationId);
    const identity = await this.ctx.storage.get<{ agentId: string }>('identity');
    if (!identity) throw new Error('Agent identity is unavailable');
    const receiptKey = `native-tool-receipt:${invocationId}`;
    if (await this.ctx.storage.get(receiptKey))
      throw new Error('Native tool invocation was already admitted; do not retry');
    const receipt: NativeAgentToolReceipt = {
      id: invocationId,
      operationId,
      invocationId,
      actorId: authority.actorId,
      agentId: identity.agentId,
      toolName,
      resource,
      action,
      status: 'admitted',
      startedAt: new Date().toISOString(),
    };
    await this.ctx.storage.put(receiptKey, receipt);
    await this.ctx.storage.sync();
    try {
      const result = await this.nativeResourceLane.run(() =>
        this.nativeResourceTool(operationId, resource, action, input),
      );
      await this.ctx.storage.put(receiptKey, {
        ...receipt,
        status: 'succeeded',
        finishedAt: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      await this.ctx.storage.put(receiptKey, {
        ...receipt,
        status: 'outcome-unknown',
        finishedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  private async recordCoordinationReceipt<T>(
    operationId: string,
    invocationId: string,
    toolName: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const authority = resolveTurnAuthority(await this.messages(), operationId);
    const identity = await this.ctx.storage.get<{ agentId: string }>('identity');
    if (!identity) throw new Error('Agent identity is unavailable');
    const key = `native-tool-receipt:${invocationId}`;
    if (await this.ctx.storage.get(key))
      throw new Error('Native tool invocation was already admitted; do not retry');
    const receipt: NativeAgentToolReceipt = {
      id: invocationId,
      operationId,
      invocationId,
      actorId: authority.actorId,
      agentId: identity.agentId,
      toolName,
      resource: 'coordination',
      action: toolName,
      status: 'admitted',
      startedAt: new Date().toISOString(),
    };
    await this.ctx.storage.put(key, receipt);
    await this.ctx.storage.sync();
    try {
      const result = await action();
      await this.ctx.storage.put(key, {
        ...receipt,
        status: 'succeeded',
        finishedAt: new Date().toISOString(),
        result,
      });
      return result;
    } catch (error) {
      await this.ctx.storage.put(key, {
        ...receipt,
        status: 'outcome-unknown',
        finishedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  private async reconcileNativeFileCleanup(): Promise<void> {
    const files = (await this.ctx.storage.get<SharedFile[]>('resource:files')) ?? [];
    for (const prefix of ['native-file-cleanup:', 'native-file-create:']) {
      let startAfter: string | undefined;
      while (true) {
        const cleanups = await this.ctx.storage.list<{ objectKey: string }>({
          prefix,
          startAfter,
          limit: 100,
        });
        for (const [key, cleanup] of cleanups) {
          if (!files.some((file) => file.objectKey === cleanup.objectKey))
            await this.env.FILES.delete(cleanup.objectKey);
          await this.ctx.storage.delete(key);
        }
        if (cleanups.size < 100) break;
        startAfter = [...cleanups.keys()].at(-1);
      }
    }
  }

  private async armNativeFileRecovery(): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    const recoveryAt = Date.now() + 60_000;
    if (current === null || current > recoveryAt) await this.ctx.storage.setAlarm(recoveryAt);
  }

  private async nativeResourceTool(
    operationId: string,
    resource: 'state' | 'jobs' | 'skills' | 'files' | 'settings' | 'work',
    action: string,
    input: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; details: unknown }> {
    const authority = resolveTurnAuthority(await this.messages(), operationId);
    const actorId = authority.actorId;
    const read = async <T>(name: AgentResourceName): Promise<T[]> =>
      (await this.ctx.storage.get<T[]>(`resource:${name}`)) ?? [];
    let details: unknown;
    if (resource === 'state') {
      const entries = await read<AgentStateEntry>('state');
      if (action === 'list') details = { entries };
      else if (action === 'delete') {
        const id = String(input.id);
        if (!entries.some((entry) => entry.id === id)) throw new Error('State entry not found');
        await this.ctx.storage.put(
          'resource:state',
          entries.filter((entry) => entry.id !== id),
        );
        details = { deleted: true, id };
      } else {
        const id = action === 'create' ? crypto.randomUUID() : String(input.id);
        const key = normalizeStateKey(String(input.key));
        const value = normalizeStateValue(String(input.value));
        if (!key || !value) throw new Error('Invalid state entry');
        const current = entries.find((entry) => entry.id === id);
        if (action === 'create' && entries.length >= maximumAgentStateEntries)
          throw new Error('Agent state limit reached');
        if (action === 'create' && entries.some((entry) => entry.key === key))
          throw new Error('State key already exists');
        if (action === 'update' && !current) throw new Error('State entry not found');
        if (action === 'update' && entries.some((entry) => entry.id !== id && entry.key === key))
          throw new Error('State key already exists');
        const now = new Date().toISOString();
        const entry: AgentStateEntry = current
          ? { ...current, key, value, updatedAt: now, updatedBy: actorId }
          : {
              id,
              key,
              value,
              createdAt: now,
              createdBy: actorId,
              updatedAt: now,
              updatedBy: actorId,
            };
        await this.ctx.storage.put(
          'resource:state',
          current ? entries.map((item) => (item.id === id ? entry : item)) : [...entries, entry],
        );
        details = { entry };
      }
    } else if (resource === 'skills') {
      const skills = await read<RoomSkill>('skills');
      if (action === 'list') details = { skills };
      else if (action === 'read') {
        const skill = skills.find((candidate) => candidate.name === input.name);
        if (!skill) throw new Error('Skill not found');
        details = { skill };
      } else {
        const result =
          action === 'create'
            ? createRoomSkill(skills, {
                name: String(input.name),
                description: String(input.description),
                body: String(input.body),
                actorId,
              })
            : action === 'update'
              ? editRoomSkill(skills, {
                  name: String(input.name),
                  description:
                    input.description === undefined ? undefined : String(input.description),
                  body: input.body === undefined ? undefined : String(input.body),
                  actorId,
                })
              : deleteRoomSkill(skills, String(input.name));
        if ('error' in result) throw new Error(result.error);
        await this.ctx.storage.put('resource:skills', result.skills);
        details =
          action === 'delete'
            ? { deleted: true, name: result.skill.name }
            : { skill: result.skill };
      }
    } else if (resource === 'jobs') {
      const jobs = await read<RecurringJob>('jobs');
      if (action === 'list') details = { jobs };
      else if (action === 'delete') {
        const id = String(input.id);
        if (!jobs.some((job) => job.id === id)) throw new Error('Job not found');
        await this.ctx.storage.put(
          'resource:jobs',
          jobs.filter((job) => job.id !== id),
        );
        await this.scheduleJobs();
        details = { deleted: true, id };
      } else if (action === 'pause' || action === 'resume') {
        const id = String(input.id);
        const current = jobs.find((job) => job.id === id);
        if (!current) throw new Error('Job not found');
        const job: RecurringJob = {
          ...current,
          status: action === 'pause' ? 'paused' : 'active',
          nextRunAt:
            action === 'pause'
              ? null
              : new Date(Date.now() + current.intervalSeconds * 1000).toISOString(),
          updatedAt: new Date().toISOString(),
          updatedBy: actorId,
        };
        await this.ctx.storage.put(
          'resource:jobs',
          jobs.map((item) => (item.id === id ? job : item)),
        );
        await this.scheduleJobs();
        details = { job };
      } else {
        const normalized = normalizeJobInput(input, this.env.ENVIRONMENT === 'dev' ? 1 : 60);
        if (!normalized) throw new Error('Invalid job');
        const id = action === 'create' ? crypto.randomUUID() : String(input.id);
        const current = jobs.find((job) => job.id === id);
        if (action === 'create' && jobs.length >= maximumRecurringJobs)
          throw new Error('Recurring job limit reached');
        if (action === 'update' && !current) throw new Error('Job not found');
        const now = new Date().toISOString();
        const job: RecurringJob = current
          ? {
              ...current,
              ...normalized,
              updatedAt: now,
              updatedBy: actorId,
              nextRunAt:
                current.status === 'active'
                  ? new Date(Date.now() + normalized.intervalSeconds * 1000).toISOString()
                  : null,
            }
          : {
              id,
              ...normalized,
              runCount: 0,
              status: 'active',
              nextRunAt: new Date(Date.now() + normalized.intervalSeconds * 1000).toISOString(),
              lastRunAt: null,
              createdAt: now,
              createdBy: actorId,
              updatedAt: now,
              updatedBy: actorId,
            };
        await this.ctx.storage.put(
          'resource:jobs',
          current ? jobs.map((item) => (item.id === id ? job : item)) : [...jobs, job],
        );
        await this.scheduleJobs();
        details = { job };
      }
    } else if (resource === 'files') {
      await this.reconcileNativeFileCleanup();
      const files = await read<SharedFile>('files');
      if (action === 'list')
        details = { files: files.map(({ objectKey: _objectKey, ...file }) => file) };
      else if (action === 'read') {
        const file = files.find((candidate) => candidate.id === input.id);
        if (!file) throw new Error('File not found');
        if (file.kind !== 'text') throw new Error('Only text files can be read');
        const object = await this.env.FILES.get(file.objectKey, {
          range: { offset: 0, length: maximumTextFileBytes + 1 },
        });
        if (!object) throw new Error('File content not found');
        const bytes = await object.arrayBuffer();
        if (bytes.byteLength > maximumTextFileBytes) throw new Error('File is too large to read');
        const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        const { objectKey: _objectKey, ...metadata } = file;
        details = { file: metadata, content };
      } else if (action === 'create') {
        if (files.length >= maximumSharedFiles) throw new Error('Shared file limit reached');
        const mime = String(input.mime);
        if (!supportedTextTypes.has(mime) || fileKind(mime) !== 'text')
          throw new Error('Unsupported text file type');
        const name = String(input.name).trim();
        if (!name) throw new Error('Invalid file name');
        const content = String(input.content);
        const bytes = new TextEncoder().encode(content);
        if (bytes.byteLength > maximumTextFileBytes) throw new Error('File is too large');
        const identity = await this.ctx.storage.get<{ agentId: string }>('identity');
        if (!identity) throw new Error('Agent identity is unavailable');
        const id = crypto.randomUUID();
        const objectKey = agentFileObjectKey(identity.agentId, id);
        const cleanupKey = `native-file-create:${id}`;
        await this.ctx.storage.put(cleanupKey, { objectKey });
        await this.ctx.storage.sync();
        await this.armNativeFileRecovery();
        await this.env.FILES.put(objectKey, bytes, { httpMetadata: { contentType: mime } });
        const file: SharedFile = {
          id,
          name,
          mime,
          bytes: bytes.byteLength,
          objectKey,
          kind: 'text',
          createdAt: new Date().toISOString(),
          createdBy: actorId,
        };
        await this.ctx.storage.transaction(async (transaction) => {
          const current = (await transaction.get<SharedFile[]>('resource:files')) ?? [];
          if (current.length >= maximumSharedFiles) throw new Error('Shared file limit reached');
          await transaction.put('resource:files', [...current, file]);
          await transaction.delete(cleanupKey);
        });
        await this.scheduleJobs();
        const { objectKey: _objectKey, ...metadata } = file;
        details = { file: metadata };
      } else {
        const id = String(input.id);
        const file = files.find((candidate) => candidate.id === id);
        if (!file) throw new Error('File not found');
        const cleanupKey = `native-file-cleanup:${id}`;
        await this.ctx.storage.transaction(async (transaction) => {
          const current = (await transaction.get<SharedFile[]>('resource:files')) ?? [];
          const currentFile = current.find((candidate) => candidate.id === id);
          if (!currentFile) throw new Error('File not found');
          await transaction.put(cleanupKey, { objectKey: currentFile.objectKey });
          await transaction.put(
            'resource:files',
            current.filter((candidate) => candidate.id !== id),
          );
        });
        await this.ctx.storage.sync();
        await this.armNativeFileRecovery();
        await this.env.FILES.delete(file.objectKey);
        await this.ctx.storage.delete(cleanupKey);
        await this.scheduleJobs();
        details = { deleted: true, id };
      }
    } else if (resource === 'settings') {
      const current = await this.settings();
      if (action === 'read') details = { settings: current };
      else {
        const modelId = input.modelId === undefined ? current.modelId : String(input.modelId);
        const thinkingLevel =
          input.thinkingLevel === undefined ? current.thinkingLevel : String(input.thinkingLevel);
        if (!isChatModelId(modelId)) throw new Error('Invalid model');
        if (!isThinkingLevel(thinkingLevel)) throw new Error('Invalid thinking level');
        const prompt =
          input.systemPrompt === undefined
            ? current.systemPrompt
            : normalizeSystemPrompt(String(input.systemPrompt));
        if (!prompt) throw new Error('Invalid system prompt');
        const settings: RoomSettings = {
          ...current,
          modelId,
          thinkingLevel,
          systemPrompt: prompt,
          agentAvatarSeed:
            input.agentAvatarSeed === undefined
              ? current.agentAvatarSeed
              : String(input.agentAvatarSeed).trim(),
          version: current.version + 1,
          updatedAt: new Date().toISOString(),
          updatedBy: actorId,
        };
        await this.ctx.storage.put('resource:settings', settings);
        details = { settings };
      }
    } else {
      details = { work: await read<WorkItem>('work') };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(details) }],
      details,
    };
  }

  private nativeResourceTools() {
    const tool = (
      name: string,
      label: string,
      description: string,
      parameters: object,
      resource: 'state' | 'jobs' | 'skills' | 'files' | 'settings' | 'work',
      action: string,
      replay: 'safe' | 'unsafe',
    ) => ({
      name,
      label,
      description,
      parameters,
      replay,
      execute: async (
        input: Record<string, unknown>,
        invocation: TurnInvocation,
      ) =>
        this.executeNativeResourceTool(
          invocation.operationId,
          invocation.invocationId,
          name,
          resource,
          action,
          input,
        ),
    });
    return [
      tool(
        'list_state',
        'List agent state',
        'List persistent state entries scoped to this agent.',
        emptyParameters,
        'state',
        'list',
        'safe',
      ),
      tool(
        'create_state',
        'Create agent state',
        'Create a persistent state entry scoped to this agent.',
        stateWriteParameters,
        'state',
        'create',
        'unsafe',
      ),
      tool(
        'update_state',
        'Update agent state',
        'Update a persistent state entry scoped to this agent by id.',
        Type.Required(stateWriteParameters),
        'state',
        'update',
        'unsafe',
      ),
      tool(
        'delete_state',
        'Delete agent state',
        'Delete a persistent state entry scoped to this agent by id.',
        identifierParameters,
        'state',
        'delete',
        'unsafe',
      ),
      tool(
        'list_jobs',
        'List recurring jobs',
        'List recurring jobs owned by this agent.',
        emptyParameters,
        'jobs',
        'list',
        'safe',
      ),
      tool(
        'create_job',
        'Create recurring job',
        'Create a recurring job owned and executed by this agent.',
        jobWriteParameters,
        'jobs',
        'create',
        'unsafe',
      ),
      tool(
        'update_job',
        'Update recurring job',
        'Update a recurring job owned by this agent.',
        Type.Required(jobWriteParameters),
        'jobs',
        'update',
        'unsafe',
      ),
      tool(
        'pause_job',
        'Pause recurring job',
        'Pause a recurring job owned by this agent.',
        identifierParameters,
        'jobs',
        'pause',
        'unsafe',
      ),
      tool(
        'resume_job',
        'Resume recurring job',
        'Resume a recurring job owned by this agent.',
        identifierParameters,
        'jobs',
        'resume',
        'unsafe',
      ),
      tool(
        'delete_job',
        'Delete recurring job',
        'Delete a recurring job owned by this agent.',
        identifierParameters,
        'jobs',
        'delete',
        'unsafe',
      ),
      tool(
        'list_skills',
        'List agent skills',
        'List reusable skills installed on this agent.',
        emptyParameters,
        'skills',
        'list',
        'safe',
      ),
      tool(
        'read_skill',
        'Read agent skill',
        'Read one skill installed on this agent.',
        skillNameParameters,
        'skills',
        'read',
        'safe',
      ),
      tool(
        'create_skill',
        'Create agent skill',
        'Create a reusable skill scoped to this agent.',
        skillCreateParameters,
        'skills',
        'create',
        'unsafe',
      ),
      tool(
        'update_skill',
        'Update agent skill',
        'Update a reusable skill scoped to this agent.',
        skillUpdateParameters,
        'skills',
        'update',
        'unsafe',
      ),
      tool(
        'delete_skill',
        'Delete agent skill',
        'Delete a reusable skill scoped to this agent.',
        skillNameParameters,
        'skills',
        'delete',
        'unsafe',
      ),
      tool(
        'list_files',
        'List agent files',
        'List files scoped to this agent.',
        emptyParameters,
        'files',
        'list',
        'safe',
      ),
      tool(
        'read_file',
        'Read agent file',
        'Read one text file scoped to this agent.',
        identifierParameters,
        'files',
        'read',
        'safe',
      ),
      tool(
        'create_file',
        'Create agent file',
        'Create a text file scoped to this agent.',
        fileCreateParameters,
        'files',
        'create',
        'unsafe',
      ),
      tool(
        'delete_file',
        'Delete agent file',
        'Delete a file scoped to this agent.',
        identifierParameters,
        'files',
        'delete',
        'unsafe',
      ),
      tool(
        'read_settings',
        'Read agent settings',
        'Read this agent’s model, reasoning, prompt, and avatar settings.',
        emptyParameters,
        'settings',
        'read',
        'safe',
      ),
      tool(
        'update_settings',
        'Update agent settings',
        'Update this agent’s model, reasoning, prompt, or avatar settings.',
        settingsUpdateParameters,
        'settings',
        'update',
        'unsafe',
      ),
      tool(
        'list_work',
        'List agent work',
        'List durable work owned by this agent.',
        emptyParameters,
        'work',
        'list',
        'safe',
      ),
    ];
  }

  private durableProofTools(): TurnTool[] {
    if (this.env.ENVIRONMENT !== 'dev') return [];
    return [
      {
        name: 'durable_wait',
        description: 'Development proof tool: wait without side effects.',
        parameters: Type.Object({ ms: Type.Number({ minimum: 0, maximum: 120_000 }) }),
        replay: 'unsafe' as const,
        execute: async (input: { ms: number }, invocation: TurnInvocation) => {
          await this.ctx.storage.put(`durable-proof:started:${invocation.operationId}`, Date.now());
          await new Promise((resolve) => setTimeout(resolve, input.ms));
          return { content: [{ type: 'text' as const, text: 'waited' }] };
        },
      },
    ];
  }

  private tools(): TurnTool[] {
    return [
      ...this.durableProofTools(),
      ...this.nativeResourceTools(),
      {
        name: 'list_subagents',
        label: 'List direct subagents',
        description: 'List the direct child agents of this agent in the shared fleet.',
        parameters: Type.Object({}),
        replay: 'safe' as const,
        execute: async (
          _input: Record<string, never>,
          invocation: TurnInvocation,
        ) =>
          this.recordCoordinationReceipt(
            invocation.operationId,
            invocation.invocationId,
            'list_subagents',
            async () => {
              const identity = await this.ctx.storage.get<{ agentId: string }>('identity');
              if (!identity) throw new Error('Agent identity is unavailable');
              const room = this.env.ROOM.get(this.env.ROOM.idFromName('agent-coordinator-v1'));
              const response = await room.fetch('https://room/fleet');
              if (!response.ok) throw new Error('Unable to inspect the fleet');
              const result = await response.json<{
                agents: Array<{
                  id: string;
                  parentId: string | null;
                  title: string;
                  status: string;
                }>;
              }>();
              const agents = result.agents.filter((agent) => agent.parentId === identity.agentId);
              return {
                content: [
                  { type: 'text' as const, text: JSON.stringify({ count: agents.length, agents }) },
                ],
                details: { count: agents.length, agents },
              };
            },
          ),
      },
      {
        name: 'send_subagent_test_message',
        label: 'Send subagent test message',
        description: 'Send one short test message to a direct subagent.',
        parameters: Type.Object({
          toAgentId: Type.String({ minLength: 1, maxLength: 200 }),
          message: Type.String({ minLength: 1, maxLength: 280 }),
        }),
        replay: 'unsafe' as const,
        execute: async (
          input: { toAgentId: string; message: string },
          invocation: TurnInvocation,
        ) =>
          this.recordCoordinationReceipt(
            invocation.operationId,
            invocation.invocationId,
            'send_subagent_test_message',
            async () => {
              const identity = await this.ctx.storage.get<{ agentId: string }>('identity');
              if (!identity) throw new Error('Agent identity is unavailable');
              const room = this.env.ROOM.get(this.env.ROOM.idFromName('agent-coordinator-v1'));
              const fleetResponse = await room.fetch('https://room/fleet');
              if (!fleetResponse.ok) throw new Error('Unable to inspect the fleet');
              const fleet = await fleetResponse.json<{
                agents: Array<{ id: string; parentId: string | null }>;
              }>();
              if (
                !fleet.agents.some(
                  (agent) => agent.id === input.toAgentId && agent.parentId === identity.agentId,
                )
              )
                throw new Error('Target must be a direct subagent');
              const response = await room.fetch('https://room/communications', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  fromAgentId: identity.agentId,
                  toAgentId: input.toAgentId,
                  action: 'message',
                  message: input.message,
                }),
              });
              const result = await response.json<{ error?: string }>();
              if (!response.ok) throw new Error(result.error ?? 'Unable to send subagent message');
              return {
                content: [
                  { type: 'text' as const, text: `Sent a test message to ${input.toAgentId}.` },
                ],
                details: { toAgentId: input.toAgentId },
              };
            },
          ),
      },
      {
        name: 'request_person',
        label: 'Request help from a person',
        description:
          'Send a durable approval request and notification to another verified person. The recipient decides whether to accept and use their own permissions or connectors. For code reviews, send one request per merge-request URL with kind review and resourceUrl.',
        parameters: requestPersonParameters,
        replay: 'unsafe' as const,
        execute: async (
          input: {
            recipientEmail: string;
            recipientName?: string;
            title: string;
            details: string;
            kind?: 'review';
            resourceUrl?: string;
          },
          invocation: TurnInvocation,
        ) => {
          const authority = resolveTurnAuthority(await this.messages(), invocation.operationId);
          const identity = await this.ctx.storage.get<{ agentId: string }>('identity');
          if (!identity) throw new Error('Agent identity is unavailable');
          const room = this.env.ROOM.get(this.env.ROOM.idFromName('agent-coordinator-v1'));
          const response = await room.fetch('https://room/person-requests', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              actorId: authority.actorId,
              actorEmail: authority.actorEmail,
              actorName: authority.actorName,
              recipientEmail: input.recipientEmail,
              recipientName: input.recipientName,
              title: input.title,
              details: input.details,
              kind: input.kind,
              resourceUrl: input.resourceUrl,
              initiatingMessageId: invocation.operationId,
              agentId: identity.agentId,
            }),
          });
          const result = await response.json<{ request?: { id: string }; error?: string }>();
          if (!response.ok || !result.request)
            throw new Error(result.error ?? 'Unable to send the person request');
          return {
            content: [
              {
                type: 'text' as const,
                text: `Sent an approval request to ${input.recipientEmail}.`,
              },
            ],
            details: { requestId: result.request.id, status: 'pending' },
          };
        },
      },
      {
        name: 'list_mcp_tools',
        label: 'List MCP tools',
        description: 'List MCP connector tools available to the verified speaker of this turn.',
        parameters: listMcpParameters,
        replay: 'safe' as const,
        execute: async (
          _input: Record<string, never>,
          invocation: TurnInvocation,
        ) => {
          const authority = resolveTurnAuthority(await this.messages(), invocation.operationId);
          const tools = await recordMcpExecution(
            this.ctx.storage,
            {
              operationId: invocation.operationId,
              invocationId: invocation.invocationId,
              actorId: authority.actorId,
              toolName: 'list_mcp_tools',
            },
            () =>
              listSpeakerMcpTools({
                namespace: this.env.CONNECTOR_VAULT,
                actorId: authority.actorId,
                env: this.env,
              }),
          );
          const text = tools.length
            ? tools.map((tool) => `${tool.name}: ${tool.description}`).join('\n')
            : 'No MCP connector tools are connected for this speaker.';
          return { content: [{ type: 'text' as const, text }], details: { tools } };
        },
      },
      {
        name: 'call_mcp',
        label: 'Call MCP tool',
        description: "Call one MCP connector tool using the verified speaker's own connector.",
        parameters: callMcpParameters,
        replay: 'unsafe' as const,
        execute: async (
          input: { name: string; argumentsJson?: string },
          invocation: TurnInvocation,
        ) => {
          const authority = resolveTurnAuthority(await this.messages(), invocation.operationId);
          const arguments_ = input.argumentsJson?.trim()
            ? z.record(z.string(), z.unknown()).parse(JSON.parse(input.argumentsJson))
            : {};
          const text = await recordMcpExecution(
            this.ctx.storage,
            {
              operationId: invocation.operationId,
              invocationId: invocation.invocationId,
              actorId: authority.actorId,
              toolName: input.name,
            },
            () =>
              callSpeakerMcpTool({
                namespace: this.env.CONNECTOR_VAULT,
                actorId: authority.actorId,
                env: this.env,
                name: input.name,
                arguments: arguments_,
              }),
          );
          return { content: [{ type: 'text' as const, text }], details: { text } };
        },
      },
    ];
  }

  private ensureDrain(): void {
    if (this.drainPromise) return;
    this.drainPromise = this.drain().finally(() => {
      this.drainPromise = null;
    });
    this.ctx.waitUntil(this.drainPromise);
  }

  private async drain(): Promise<void> {
    while (true) {
      const queue = (await this.ctx.storage.get<string[]>('message-queue')) ?? [];
      const messageId = queue[0];
      if (!messageId) return;
      const messages = await this.messages();
      const message = messages.find((candidate) => candidate.id === messageId);
      if (!message || (message.status !== 'queued' && message.status !== 'active')) {
        await this.ctx.storage.put('message-queue', queue.slice(1));
        await this.ctx.storage.delete(`turn-cancelled:${messageId}`);
        continue;
      }
      const settings = await this.settings();
      const active = {
        ...message,
        status: 'active' as const,
        modelId: settings.modelId,
        thinkingLevel: settings.thinkingLevel,
        systemPrompt: settings.systemPrompt,
      };
      const responseId = `agent-${messageId}`;
      const responseMessage = {
        id: responseId,
        role: 'assistant' as const,
        authorId: 'agent',
        authorName: 'Agent',
        text: '',
        createdAt: new Date().toISOString(),
        status: 'active' as const,
        replyTo: messageId,
        threadId: message.threadId,
        tools: [],
        reasoning: '',
      };
      const recovering = messages.find((candidate) => candidate.replyTo === messageId);
      await this.ctx.storage.put(
        'resource:messages',
        recovering
          ? messages.map((candidate) => (candidate.id === messageId ? active : candidate))
          : [...messages.map((candidate) => (candidate.id === messageId ? active : candidate)), responseMessage],
      );
      this.announceChange();
      let text = '';
      let executionModel: { provider: string; modelId: string } | undefined;
      let status: 'complete' | 'error' = 'complete';
      try {
        if (await this.ctx.storage.get('production-proof:fail-next-turn')) {
          await this.ctx.storage.delete('production-proof:fail-next-turn');
          throw new Error('production proof turn interruption');
        }
        if (!this.faux) {
          const localModel =
            this.env.ENVIRONMENT === 'dev' && this.env.LOCAL_AI_MODE === 'remote'
              ? chatModelById(settings.modelId).pi?.provider === 'cloudflare-workers-ai'
                ? chatModelById(settings.modelId).pi
                : { provider: 'cloudflare-workers-ai', modelId: '@cf/moonshotai/kimi-k2.7-code' }
              : chatModelById(settings.modelId).pi;
          await this.pi.setModel(localModel!);
        }
        await this.pi.setThinkingLevel(settings.thinkingLevel);
        const nativeProof = /^NATIVE_TOOL_PROOF ([a-z_]+) (\{.*\})$/s.exec(active.text);
        if (this.faux && active.text === 'DURABLE_RECOVERY_PROOF') {
          const recovering = Boolean(await this.ctx.storage.get(`durable-proof:started:${active.id}`));
          this.faux.setResponses(
            recovering
              ? [fauxAssistantMessage('recovered and finished')]
              : [
                  fauxAssistantMessage(fauxToolCall('durable_wait', { ms: 60_000 }), { stopReason: 'toolUse' }),
                  fauxAssistantMessage('recovered and finished'),
                ],
          );
        } else if (this.faux && active.text === 'NATIVE_CAPABILITY_PROOF') {
          this.faux.setResponses([fauxAssistantMessage(nativeAgentCapabilityPrompt)]);
        } else if (this.faux && nativeProof) {
          const arguments_ = proofToolArguments(JSON.parse(nativeProof[2]));
          this.faux.setResponses([
            fauxAssistantMessage(fauxToolCall(nativeProof[1], arguments_), {
              stopReason: 'toolUse',
            }),
            fauxAssistantMessage(`Completed ${nativeProof[1]}.`),
          ]);
        } else if (this.faux) {
          this.faux.setResponses([fauxAssistantMessage(localModelReply(active.text))]);
        }
        const reply = await this.pi.prompt(active.text, { operationId: active.id });
        executionModel = reply.model;
        text = reply.text || (reply.status === 'completed' ? 'No response.' : 'Agent execution failed.');
        status = reply.status === 'completed' ? 'complete' : 'error';
        if (status === 'error') {
          console.error('chat-ax agent turn failed', JSON.stringify({
            status: reply.status,
            model: executionModel?.modelId,
            error: (reply.error ?? '').slice(0, 500),
          }));
        }
      } catch (error) {
        console.error(
          'chat-ax agent execution failed',
          error instanceof Error ? error.message : 'unknown error',
        );
        text = 'Agent execution failed.';
        status = 'error';
      }
      await this.ctx.storage.transaction(async (transaction) => {
        const current = (await transaction.get<ChatMessage[]>('resource:messages')) ?? [];
        const cancelled =
          Boolean(await transaction.get(`turn-cancelled:${messageId}`)) ||
          current.find((candidate) => candidate.id === messageId)?.status === 'error';
        const updated = current.map((candidate) =>
          candidate.id === messageId
            ? { ...candidate, status: cancelled ? ('error' as const) : ('complete' as const) }
            : candidate.id === `agent-${messageId}`
              ? {
                  ...candidate,
                  text: cancelled ? 'Response cancelled.' : text,
                  status: cancelled ? ('error' as const) : status,
                  ...(executionModel ? { executionModel } : {}),
                  ...(this.piProgress.get(messageId)?.tools ? { tools: this.piProgress.get(messageId)?.tools } : {}),
                }
              : candidate,
        );
        if (!current.some((candidate) => candidate.replyTo === messageId))
          updated.push({
            id: `agent-${messageId}`,
            role: 'assistant',
            authorId: 'agent',
            authorName: 'Agent',
            text: cancelled ? 'Response cancelled.' : text,
            createdAt: new Date().toISOString(),
            status: cancelled ? 'error' : status,
            replyTo: messageId,
            ...(executionModel ? { executionModel } : {}),
          });
        await transaction.put('resource:messages', updated.slice(-200));
        const pending = (await transaction.get<string[]>('message-queue')) ?? [];
        await transaction.put(
          'message-queue',
          pending.filter((id) => id !== messageId),
        );
      });
      await (this.progressWrites.get(messageId) ?? Promise.resolve());
      this.piProgress.delete(messageId);
      this.progressWrites.delete(messageId);
      await this.ctx.storage.delete(`turn-progress:${messageId}`);
      await this.ctx.storage.delete(`turn-cancelled:${messageId}`);
      this.announceChange();
    }
  }

  private async snapshot(): Promise<AgentSnapshot | null> {
    const identity = await this.ctx.storage.get<{
      agentId: string;
      sessionId: string;
      initializedAt: string;
    }>('identity');
    if (!identity) return null;
    const resources = defaults();
    for (const name of resourceNames)
      resources[name] =
        (await this.ctx.storage.get(`resource:${name}`)) ?? (resources[name] as never);
    return { ...resources, ...identity };
  }

  private async initialize(request: Request): Promise<Response> {
    const input = await parseBoundedJson(request, initializeSchema);
    const existing = await this.snapshot();
    if (existing)
      return existing.agentId === input.agentId
        ? Response.json(existing)
        : Response.json({ error: 'agent already initialized' }, { status: 409 });
    const resources = agentResourcesSchema.parse(input.customization ?? {});
    if (new Set(resources.state.map((entry) => entry.key)).size !== resources.state.length)
      return Response.json({ error: 'state key already exists' }, { status: 409 });
    const identity = createAgentRuntimeIdentity(input.agentId);
    await this.ctx.storage.transaction(async (transaction) => {
      await transaction.put('identity', identity);
      for (const name of resourceNames)
        await transaction.put(`resource:${name}`, structuredClone(resources[name]));
    });
    return Response.json({ ...resources, ...identity }, { status: 201 });
  }

  private async privateResourceRequest(request: Request, url: URL): Promise<Response | null> {
    const isPrivatePath = ['/skills', '/files', '/agent-state', '/jobs', '/work', '/tools'].some(
      (path) => url.pathname === path || url.pathname.startsWith(`${path}/`),
    );
    if (!isPrivatePath) return null;
    if (!(await this.ctx.storage.get('identity')))
      return Response.json({ error: 'unknown agent' }, { status: 404 });
    const read = async <T>(name: AgentResourceName): Promise<T[]> =>
      (await this.ctx.storage.get<T[]>(`resource:${name}`)) ?? [];
    const write = (name: AgentResourceName, value: unknown) =>
      this.ctx.storage.put(`resource:${name}`, value);
    if (url.pathname === '/skills' || url.pathname.startsWith('/skills/')) {
      const skills = await read<RoomSkill>('skills');
      if (request.method === 'GET') return Response.json({ skills });
      const skillRequestSchema = z.object({
        name: z.string().max(200).optional(),
        description: z.string().max(2_000).optional(),
        body: z.string().max(32_000).optional(),
        actorId: z.string().max(200).optional(),
      });
      const emptySkillRequest: z.infer<typeof skillRequestSchema> = {};
      const body = await parseBoundedJson(request, skillRequestSchema).catch(() => emptySkillRequest);
      const actorId = body.actorId?.trim() || url.searchParams.get('actorId')?.trim() || '';
      const name =
        url.pathname === '/skills' ? (body.name ?? '') : decodeURIComponent(url.pathname.slice(8));
      const result =
        request.method === 'POST'
          ? createRoomSkill(skills, {
              name,
              description: body.description ?? '',
              body: body.body ?? '',
              actorId,
            })
          : request.method === 'PUT'
            ? editRoomSkill(skills, {
                name,
                description: body.description,
                body: body.body,
                actorId,
              })
            : deleteRoomSkill(skills, name);
      if ('error' in result)
        return Response.json(
          { error: result.error },
          { status: result.error.includes('not found') ? 404 : 400 },
        );
      await write('skills', result.skills);
      return Response.json(
        { skill: result.skill, skills: result.skills },
        { status: request.method === 'POST' ? 201 : 200 },
      );
    }
    if (url.pathname === '/files' || url.pathname.startsWith('/files/')) {
      const files = await read<SharedFile>('files');
      if (request.method === 'GET') return Response.json({ files });
      if (request.method === 'POST') {
        const file = z
          .custom<SharedFile>((value) => typeof value === 'object' && value !== null)
          .parse(await readBoundedJson(request));
        if (files.length >= maximumSharedFiles)
          return Response.json({ error: 'shared file limit reached' }, { status: 409 });
        await write('files', [...files.filter((item) => item.id !== file.id), file]);
        return Response.json({ file }, { status: 201 });
      }
      const id = decodeURIComponent(url.pathname.slice(7));
      const file = files.find((item) => item.id === id);
      if (!file) return Response.json({ error: 'file not found' }, { status: 404 });
      await write(
        'files',
        files.filter((item) => item.id !== id),
      );
      return Response.json({ deleted: true, objectKey: file.objectKey });
    }
    if (url.pathname === '/agent-state' || url.pathname.startsWith('/agent-state/')) {
      const entries = await read<AgentStateEntry>('state');
      if (request.method === 'GET') return Response.json({ entries });
      const body =
        request.method === 'DELETE'
          ? {}
          : ((await readBoundedJson(request)) as {
              key?: string;
              value?: string;
              actorId?: string;
            });
      const id =
        url.pathname === '/agent-state'
          ? crypto.randomUUID()
          : decodeURIComponent(url.pathname.slice(13));
      if (request.method === 'DELETE') {
        if (!entries.some((item) => item.id === id))
          return Response.json({ error: 'state entry not found' }, { status: 404 });
        await write(
          'state',
          entries.filter((item) => item.id !== id),
        );
        return Response.json({ deleted: true });
      }
      const key = normalizeStateKey(body.key ?? '');
      const value = normalizeStateValue(body.value ?? '');
      const actorId = body.actorId?.trim() ?? '';
      if (!key || !value || !actorId)
        return Response.json({ error: 'invalid state entry' }, { status: 400 });
      if (request.method === 'POST' && entries.length >= maximumAgentStateEntries)
        return Response.json({ error: 'agent state limit reached' }, { status: 409 });
      const current = entries.find((item) => item.id === id);
      if (entries.some((entry) => entry.id !== id && entry.key === key))
        return Response.json({ error: 'state key already exists' }, { status: 409 });
      if (request.method === 'PUT' && !current)
        return Response.json({ error: 'state entry not found' }, { status: 404 });
      const now = new Date().toISOString();
      const entry: AgentStateEntry = current
        ? { ...current, key, value, updatedAt: now, updatedBy: actorId }
        : {
            id,
            key,
            value,
            createdAt: now,
            createdBy: actorId,
            updatedAt: now,
            updatedBy: actorId,
          };
      await write(
        'state',
        current ? entries.map((item) => (item.id === id ? entry : item)) : [...entries, entry],
      );
      return Response.json({ entry }, { status: current ? 200 : 201 });
    }
    if (url.pathname === '/jobs' || url.pathname.startsWith('/jobs/'))
      return this.jobsRequest(request, url);
    if (url.pathname === '/work' && request.method === 'GET')
      return Response.json({ work: await read('work') });
    if (url.pathname === '/tools' && request.method === 'GET')
      return Response.json({ tools: await read('tools') });
    return null;
  }

  private async jobsRequest(request: Request, url: URL): Promise<Response> {
    const jobs = (await this.ctx.storage.get<RecurringJob[]>('resource:jobs')) ?? [];
    if (request.method === 'GET') return Response.json({ jobs });
    const parts = url.pathname.split('/').filter(Boolean);
    const id = decodeURIComponent(parts[1] ?? '');
    if (request.method === 'DELETE') {
      if (!jobs.some((job) => job.id === id))
        return Response.json({ error: 'job not found' }, { status: 404 });
      await this.ctx.storage.put(
        'resource:jobs',
        jobs.filter((job) => job.id !== id),
      );
      await this.scheduleJobs();
      return Response.json({ deleted: true });
    }
    const body = (await readBoundedJson(request)) as {
      name?: string;
      prompt?: string;
      intervalSeconds?: number;
      maxRuns?: number | null;
      actorId?: string;
    };
    const actorId = body.actorId?.trim() ?? '';
    const current = jobs.find((job) => job.id === id);
    if (parts[2] === 'pause' || parts[2] === 'resume') {
      if (!current) return Response.json({ error: 'job not found' }, { status: 404 });
      const job = {
        ...current,
        status: parts[2] === 'pause' ? ('paused' as const) : ('active' as const),
        nextRunAt:
          parts[2] === 'pause'
            ? null
            : new Date(Date.now() + current.intervalSeconds * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: actorId,
      };
      await this.ctx.storage.put(
        'resource:jobs',
        jobs.map((item) => (item.id === id ? job : item)),
      );
      await this.scheduleJobs();
      return Response.json({ job });
    }
    const input = normalizeJobInput(body, this.env.ENVIRONMENT === 'dev' ? 1 : 60);
    if (!input || !actorId) return Response.json({ error: 'invalid job' }, { status: 400 });
    if (request.method === 'POST' && jobs.length >= maximumRecurringJobs)
      return Response.json({ error: 'recurring job limit reached' }, { status: 409 });
    if (request.method === 'PUT' && !current)
      return Response.json({ error: 'job not found' }, { status: 404 });
    const now = new Date().toISOString();
    const job: RecurringJob = current
      ? {
          ...current,
          ...input,
          updatedAt: now,
          updatedBy: actorId,
          nextRunAt:
            current.status === 'active'
              ? new Date(Date.now() + input.intervalSeconds * 1000).toISOString()
              : null,
        }
      : {
          id: crypto.randomUUID(),
          ...input,
          runCount: 0,
          status: 'active',
          nextRunAt: new Date(Date.now() + input.intervalSeconds * 1000).toISOString(),
          lastRunAt: null,
          createdAt: now,
          createdBy: actorId,
          updatedAt: now,
          updatedBy: actorId,
        };
    await this.ctx.storage.put(
      'resource:jobs',
      current ? jobs.map((item) => (item.id === id ? job : item)) : [...jobs, job],
    );
    await this.scheduleJobs();
    return Response.json({ job }, { status: current ? 200 : 201 });
  }

  private async scheduleJobs(): Promise<void> {
    const jobs = (await this.ctx.storage.get<RecurringJob[]>('resource:jobs')) ?? [];
    const times = jobs.flatMap((job) =>
      job.status === 'active' && job.nextRunAt ? [Date.parse(job.nextRunAt)] : [],
    );
    if (times.length) await this.ctx.storage.setAlarm(Math.min(...times));
    else await this.ctx.storage.deleteAlarm();
  }

  async onAlarm(): Promise<void> {
    return this.nativeResourceLane.run(() => this.runAlarm());
  }

  private async runAlarm(): Promise<void> {
    if (await this.ctx.storage.get('deleting')) return;
    try {
      await this.reconcileNativeFileCleanup();
    } catch {
      await this.armNativeFileRecovery();
      return;
    }
    const now = new Date();
    const jobs = (await this.ctx.storage.get<RecurringJob[]>('resource:jobs')) ?? [];
    const due = jobs.filter(
      (job) =>
        job.status === 'active' && job.nextRunAt && Date.parse(job.nextRunAt) <= now.getTime(),
    );
    for (const job of due) {
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        authorId: recurringJobActorId(job.id),
        authorName: job.name,
        text: job.prompt,
        createdAt: now.toISOString(),
        status: 'queued',
        source: 'job',
      };
      const messages = await this.messages();
      const queue = (await this.ctx.storage.get<string[]>('message-queue')) ?? [];
      await this.ctx.storage.put({
        'resource:messages': [...messages, message].slice(-200),
        'message-queue': [
          ...queue
            .filter((id) => messages.some((item) => item.id === id))
            .slice(-(maximumMessageQueueDepth - 1)),
          message.id,
        ],
      });
    }
    const dueIds = new Set(due.map((job) => job.id));
    await this.ctx.storage.put(
      'resource:jobs',
      jobs.map((job) => {
        if (!dueIds.has(job.id)) return job;
        const runCount = job.runCount + 1;
        const complete = job.maxRuns !== null && runCount >= job.maxRuns;
        return {
          ...job,
          runCount,
          lastRunAt: now.toISOString(),
          status: complete ? 'complete' : job.status,
          nextRunAt: complete
            ? null
            : new Date(now.getTime() + job.intervalSeconds * 1000).toISOString(),
        };
      }),
    );
    this.ensureDrain();
    await this.scheduleJobs();
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/live' && isWebSocketUpgrade(request)) return this.acceptLiveSocket();
    const response = await this.routeRequest(request, url);
    if (request.method !== 'GET' && response.ok) this.announceChange();
    return response;
  }

  private async routeRequest(request: Request, url: URL): Promise<Response> {
    if (request.method === 'POST' && url.pathname === '/seal') {
      await this.ctx.storage.put('deleting', true);
      const snapshot = await this.snapshot();
      return snapshot
        ? Response.json(snapshot)
        : Response.json({ error: 'unknown agent' }, { status: 404 });
    }
    if (request.method === 'DELETE' && url.pathname === '/purge') {
      await this.ctx.storage.deleteAll();
      return Response.json({ deleted: true });
    }
    if (request.method === 'GET' && url.pathname === '/diagnostics')
      return Response.json({
        initialized: Boolean(await this.ctx.storage.get('identity')),
        deleting: Boolean(await this.ctx.storage.get('deleting')),
        toolNames: this.tools().map((tool) => tool.name),
      });
    if (request.method === 'POST' && url.pathname === '/dev/durable-proof/crash' && this.env.ENVIRONMENT === 'dev') {
      this.ctx.abort('durable recovery proof');
      return Response.json({ crashed: true });
    }
    if (request.method === 'GET' && url.pathname === '/dev/durable-proof/transcript' && this.env.ENVIRONMENT === 'dev') {
      return Response.json(await this.pi.snapshot());
    }
    if (request.method === 'POST' && url.pathname === '/production-proof/fail-next-turn') {
      await this.ctx.storage.put('production-proof:fail-next-turn', true);
      return Response.json({ armed: true });
    }
    if (request.method === 'GET' && url.pathname === '/native-tool-receipts') {
      const actorId = url.searchParams.get('actorId');
      if (!actorId) return Response.json({ error: 'actorId is required' }, { status: 400 });
      return Response.json({
        receipts: [
          ...(await this.ctx.storage.list<NativeAgentToolReceipt>({
            prefix: 'native-tool-receipt:',
            limit: 200,
          })),
        ]
          .map(([, receipt]) => receipt)
          .filter((receipt) => receipt.actorId === actorId)
          .sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
      });
    }
    if (request.method === 'GET' && url.pathname === '/mcp-receipts') {
      const actorId = url.searchParams.get('actorId');
      if (!actorId) return Response.json({ error: 'actorId is required' }, { status: 400 });
      return Response.json({
        receipts: [
          ...(await this.ctx.storage.list<McpReceipt>({ prefix: 'mcp-receipt:', limit: 200 })),
        ]
          .map(([, receipt]) => receipt)
          .filter((receipt) => receipt.actorId === actorId && receipt.connectorOwnerId === actorId)
          .sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
      });
    }
    if (await this.ctx.storage.get('deleting'))
      return Response.json({ error: 'agent deleting' }, { status: 410 });
    if (request.method === 'GET' && url.pathname === '/operations') {
      if (!(await this.ctx.storage.get('identity')))
        return Response.json({ error: 'unknown agent' }, { status: 404 });
      const snapshot = await this.pi.snapshot();
      const capacity = 128_000;
      const used = Math.min(capacity, Math.ceil(JSON.stringify(snapshot.messages).length / 4));
      return Response.json({
        context: { used, capacity, ratio: used / capacity },
        active: snapshot.active,
        queued: snapshot.queued,
      });
    }
    const privateResponse = await this.nativeResourceLane.run(() =>
      this.privateResourceRequest(cloneRequest(request), url),
    );
    if (privateResponse) return privateResponse;
    if (request.method === 'POST' && url.pathname === '/communications/inbox') {
      if (!(await this.ctx.storage.get('identity')))
        return Response.json({ error: 'unknown agent' }, { status: 404 });
      const input = communicationInboxSchema.parse(await readBoundedJson(request));
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        authorId: input.fromAgentId,
        authorName: input.fromAgentId,
        text: input.message,
        createdAt: new Date().toISOString(),
        status: 'complete',
      };
      const messages = await this.messages();
      await this.ctx.storage.put('resource:messages', [...messages, message].slice(-200));
      return Response.json({ messageId: message.id }, { status: 201 });
    }
    if (request.method === 'POST' && url.pathname === '/messages') {
      if (!(await this.ctx.storage.get('identity')))
        return Response.json({ error: 'unknown agent' }, { status: 404 });
      const input = submittedMessageSchema.parse(await readBoundedJson(request));
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        ...input,
        text: input.text,
        createdAt: new Date().toISOString(),
        status: 'queued',
        source: 'person',
      };
      const accepted = await this.ctx.storage.transaction(async (transaction) => {
        const messages = (await transaction.get<ChatMessage[]>('resource:messages')) ?? [];
        const existing = input.personRequestId
          ? messages.find((candidate) => candidate.personRequestId === input.personRequestId)
          : undefined;
        if (existing) return { message: existing, created: false };
        const queue = (await transaction.get<string[]>('message-queue')) ?? [];
        const liveQueue = queue.filter((id) =>
          messages.some((candidate) => candidate.id === id && candidate.status === 'queued'),
        );
        if (liveQueue.length >= maximumMessageQueueDepth) return undefined;
        await transaction.put('resource:messages', [...messages, message].slice(-200));
        await transaction.put('message-queue', [...liveQueue, message.id]);
        return { message, created: true };
      });
      if (!accepted)
        return Response.json({ error: 'message queue capacity reached' }, { status: 429 });
      this.ensureDrain();
      return Response.json({ message: accepted.message }, { status: accepted.created ? 202 : 200 });
    }
    const cancelMatch = /^\/messages\/([^/]+)\/cancel$/.exec(url.pathname);
    if (request.method === 'POST' && cancelMatch) {
      const id = decodeURIComponent(cancelMatch[1]);
      const messages = await this.messages();
      const target = messages.find((message) => message.id === id);
      const operationId = target?.role === 'assistant' ? target.replyTo : target?.id;
      if (operationId) {
        await this.ctx.storage.put(`turn-cancelled:${operationId}`, true);
        await this.pi.abort({ operationId });
        if (await this.ctx.storage.get(`turn-cancelled:${operationId}`)) {
          await this.ctx.storage.transaction(async (transaction) => {
            const current = (await transaction.get<ChatMessage[]>('resource:messages')) ?? [];
            const updated = applyAgentCancellation(current, operationId);
            await transaction.put('resource:messages', updated);
          });
        }
      }
      return Response.json({ cancelled: true });
    }
    if (request.method === 'POST' && url.pathname === '/history/clear') {
      for (const message of await this.messages())
        if (message.status === 'queued' || message.status === 'active')
          await this.pi.abort({ operationId: message.id });
      await this.pi.clear();
      await this.ctx.storage.put({ 'resource:messages': [], 'message-queue': [] });
      return Response.json({ ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/history/compact') {
      try {
        await this.pi.compact(
          'Preserve durable agent decisions, active work, file references, and unresolved questions. Omit private tool output and internal reasoning.',
        );
        return Response.json({ accepted: true });
      } catch {
        return Response.json({ error: 'Context cannot be compacted' }, { status: 409 });
      }
    }
    if (request.method === 'PUT' && url.pathname === '/settings')
      return this.nativeResourceLane.run(async () => {
        const body = (await readBoundedJson(request)) as {
          modelId?: string;
          thinkingLevel?: string;
          systemPrompt?: string;
          agentAvatarSeed?: string;
          updatedBy?: string;
        };
        if (body.modelId !== undefined && !isChatModelId(body.modelId))
          return Response.json({ error: 'invalid model' }, { status: 400 });
        if (body.thinkingLevel !== undefined && !isThinkingLevel(body.thinkingLevel))
          return Response.json({ error: 'invalid thinking level' }, { status: 400 });
        const prompt =
          body.systemPrompt === undefined ? undefined : normalizeSystemPrompt(body.systemPrompt);
        if (body.systemPrompt !== undefined && !prompt)
          return Response.json({ error: 'invalid system prompt' }, { status: 400 });
        const current = await this.settings();
        const settings: RoomSettings = {
          ...current,
          modelId: body.modelId ?? current.modelId,
          thinkingLevel: body.thinkingLevel ?? current.thinkingLevel,
          systemPrompt: prompt ?? current.systemPrompt,
          agentAvatarSeed: body.agentAvatarSeed?.trim() || current.agentAvatarSeed,
          version: current.version + 1,
          updatedAt: new Date().toISOString(),
          updatedBy: body.updatedBy?.trim() || undefined,
        };
        await this.ctx.storage.put('resource:settings', settings);
        return Response.json({ settings });
      });
    if (request.method === 'GET' && url.pathname === '/conversation') {
      this.ensureDrain();
      const messages = await this.messages();
      const visibleMessages = await Promise.all(
        messages.map(async (message) => {
          if (message.role !== 'assistant' || message.status !== 'active') return message;
          const progress =
            this.piProgress.get(message.replyTo ?? message.id) ??
            (await this.ctx.storage.get<{ text: string; tools: ChatMessage['tools'] }>(`turn-progress:${message.replyTo ?? message.id}`));
          return progress ? { ...message, text: progress.text, tools: progress.tools } : message;
        }),
      );
      return Response.json({ messages: visibleMessages, settings: await this.settings() });
    }
    if (request.method === 'POST' && url.pathname === '/queue') {
      if (!(await this.ctx.storage.get('identity')))
        return Response.json({ error: 'unknown agent' }, { status: 404 });
      const input = await parseBoundedJson(request, queueInputSchema);
      const record: AgentQueueRecord = {
        ...input,
        enqueuedAt: new Date().toISOString(),
      };
      await enqueueAgentWork(this.ctx.storage, record);
      return Response.json({ queued: true, id: record.id }, { status: 201 });
    }
    if (request.method === 'POST' && url.pathname === '/queue/claim') {
      if (!(await this.ctx.storage.get('identity')))
        return Response.json({ error: 'unknown agent' }, { status: 404 });
      const owner = request.headers.get('x-agent-queue-owner')?.trim();
      if (!owner) return Response.json({ error: 'queue owner required' }, { status: 400 });
      const claim = await claimAgentWork(this.ctx.storage, owner);
      return claim ? Response.json({ claim }) : new Response(null, { status: 204 });
    }
    if (request.method === 'POST' && url.pathname === '/initialize')
      return this.initialize(request);
    if (request.method === 'GET' && (url.pathname === '/snapshot' || url.pathname === '/context')) {
      const snapshot = await this.snapshot();
      return snapshot
        ? Response.json(snapshot)
        : Response.json({ error: 'unknown agent' }, { status: 404 });
    }
    if (request.method === 'PUT' && url.pathname === '/context')
      return this.nativeResourceLane.run(async () => {
        if (!(await this.ctx.storage.get('identity')))
          return Response.json({ error: 'unknown agent' }, { status: 404 });
        const updates = await parseBoundedJson(
          request,
          agentResourcesObjectSchema.pick({ settings: true, skills: true, tools: true }).partial(),
        );
        await this.ctx.storage.transaction(async (transaction) => {
          for (const name of ['settings', 'skills', 'tools'] as const)
            if (updates[name] !== undefined)
              await transaction.put(`resource:${name}`, structuredClone(updates[name]));
        });
        return Response.json({ ok: true });
      });
    const match =
      /^\/resources\/(settings|messages|skills|files|state|jobs|work|tools|queue)$/.exec(
        url.pathname,
      );
    if (match) {
      const name = z.enum(resourceNames).parse(match[1]);
      if (!(await this.ctx.storage.get('identity')))
        return Response.json({ error: 'unknown agent' }, { status: 404 });
      if (request.method === 'GET')
        return Response.json({ value: await this.ctx.storage.get(`resource:${name}`) });
      if (request.method === 'PUT')
        return this.nativeResourceLane.run(async () => {
          const { value } = await parseBoundedJson(request, resourceMutationSchema);
          const validated = agentResourcesObjectSchema.shape[name].parse(value);
          if (name === 'state') {
            const state = agentResourcesObjectSchema.shape.state.parse(validated);
            if (new Set(state.map((entry) => entry.key)).size !== state.length)
              return Response.json({ error: 'state key already exists' }, { status: 409 });
          }
          await this.ctx.storage.put(`resource:${name}`, structuredClone(validated));
          return Response.json({ ok: true });
        });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  }
}
