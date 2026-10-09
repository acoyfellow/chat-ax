import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Models, ModelThinkingLevel } from '@earendil-works/pi-ai';
import {
  createRegistry,
  defineExtension,
  Harness,
  LiveDoc,
  type AgentEvent,
  type Conversation,
  type EntryRecord,
  type ToolRegistration,
  ToolResultEntry,
  watchEvents,
} from '@earendil-works/pi-durable';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import { durableObjectSqliteDatabase, type SqlStorage } from './do-sqlite-database';
import { toolAttributes, traced, type TraceTracer } from '../../agent-tracing';

const context = BACKGROUND_CONTEXT;

export type ModelRef = { provider: string; modelId: string };

export type TurnInvocation = { operationId: string; invocationId: string; signal?: AbortSignal };

export type TurnTool = Omit<ToolRegistration, 'execute'> & {
  label?: string;
  execute(args: never, invocation: TurnInvocation): Promise<{
    content: Array<{ type: 'text'; text: string }>;
    details?: unknown;
    isError?: boolean;
  }>;
};

export type TurnEvent =
  | { type: 'text_delta'; operationId: string; delta: string }
  | { type: 'thinking_delta'; operationId: string; delta: string }
  | { type: 'tool_start'; operationId: string; toolCallId: string; toolName: string; arguments: unknown }
  | { type: 'tool_end'; operationId: string; toolCallId: string; error: boolean; result: unknown };

export type TurnReply = {
  status: 'completed' | 'failed' | 'aborted';
  text: string;
  model?: ModelRef;
  error?: string;
};

export type TurnRuntimeOptions = {
  storage: SqlStorage;
  models: Models;
  model: ModelRef;
  thinkingLevel?: ModelThinkingLevel;
  instructions: () => Promise<string>;
  tools: () => TurnTool[];
  tracer?: TraceTracer;
};

function textOf(entry: EntryRecord | undefined): string {
  const message = entry?.model?.[0];
  if (!message || message.role !== 'assistant') return '';
  return message.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim();
}

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(signal.reason ?? new Error('aborted'));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

function isJsonText(value: unknown): value is { type: 'text'; text: string } {
  return typeof value === 'object' && value !== null && 'text' in value && typeof value.text === 'string';
}

export class DurableTurnRuntime {
  private harness?: Promise<{ harness: Harness; root: Conversation }>;
  private readonly listeners = new Set<(event: TurnEvent) => void>();
  private readonly operationBySubmission = new Map<number, string>();
  private readonly invocationByCall = new Map<string, string>();
  private activeOperation?: string;
  private streamedText = '';
  private model: ModelRef;
  private thinkingLevel: ModelThinkingLevel;

  constructor(private readonly options: TurnRuntimeOptions) {
    this.model = options.model;
    this.thinkingLevel = options.thinkingLevel ?? 'low';
  }

  on(listener: (event: TurnEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async setModel(model: ModelRef): Promise<void> {
    this.model = model;
    if (this.harness) await (await this.open()).root.configure({ model }, context);
  }

  async setThinkingLevel(thinkingLevel: ModelThinkingLevel): Promise<void> {
    this.thinkingLevel = thinkingLevel;
    if (this.harness) await (await this.open()).root.configure({ thinkingLevel }, context);
  }

  async prompt(text: string, options: { operationId: string }): Promise<TurnReply> {
    const { root } = await this.open();
    this.installTools();
    await root.configure(
      { model: this.model, thinkingLevel: this.thinkingLevel, instructions: await this.options.instructions() },
      context,
    );
    this.activeOperation = options.operationId;
    try {
      const submission = await root.submit({ type: 'input', content: text, requestId: options.operationId }, context);
      this.operationBySubmission.set(submission.id, options.operationId);
      const settled = await submission.wait(context);
      if (settled.status !== 'done') {
        const aborted = /abort/i.test(settled.reason);
        return { status: aborted ? 'aborted' : 'failed', text: '', error: settled.reason };
      }
      const page = await root.entries({}, 50, undefined, context);
      const answer = page.items.find((entry) => entry.id === settled.answer);
      const message = answer?.model?.[0];
      const failed = message?.role === 'assistant' && (message.stopReason === 'error' || message.stopReason === 'aborted');
      return {
        status: failed ? (message.stopReason === 'aborted' ? 'aborted' : 'failed') : 'completed',
        text: textOf(answer),
        model: message?.role === 'assistant' ? { provider: message.provider, modelId: message.model } : undefined,
        error: message?.role === 'assistant' ? message.errorMessage : undefined,
      };
    } finally {
      if (this.activeOperation === options.operationId) this.activeOperation = undefined;
    }
  }

  async abort(options: { operationId: string }): Promise<void> {
    if (!this.harness) return;
    const { root } = await this.open();
    if (this.activeOperation === undefined || this.activeOperation === options.operationId) await root.abort(context);
  }

  async snapshot(): Promise<{ messages: unknown[]; active: boolean; queued: number }> {
    const { harness, root } = await this.open();
    const view = await root.context(context);
    const live = await harness.snapshot(LiveDoc, root.id, context);
    return { messages: [...view.messages], active: live?.run !== undefined, queued: Math.max(0, (live?.run?.inputs.length ?? 1) - 1) };
  }

  async clear(): Promise<void> {
    const { root } = await this.open();
    await root.abort(context);
    await root.reset(undefined, context);
  }

  async compact(instructions: string): Promise<void> {
    const { harness, root } = await this.open();
    const task = await root.compact(instructions, context);
    await harness.waitForTask(task, context);
  }

  async close(): Promise<void> {
    if (!this.harness) return;
    const { harness } = await this.harness;
    this.harness = undefined;
    await harness.close(context);
  }

  private readonly registry = createRegistry();

  private installTools(): void {
    this.registry.install(defineExtension({ name: 'chat-ax', tools: this.registrations() }));
  }

  private registrations(): ToolRegistration[] {
    return this.options.tools().map(({ label: _label, ...tool }) => ({
      ...tool,
      execute: async (args, api, callContext) => {
        const operationId = this.activeOperation ?? `recovered:${api.conversationId}`;
        const signal = callContext.abortSignal;
        return traced(this.options.tracer, `execute_tool ${tool.name}`, toolAttributes(tool.name, api.callId, args), async () => {
          const work = tool.execute(args as never, { operationId, invocationId: api.callId, signal });
          const result = signal ? await Promise.race([work, aborted(signal)]) : await work;
          return { content: result.content, isError: result.isError ?? false };
        });
      },
    }));
  }

  private open(): Promise<{ harness: Harness; root: Conversation }> {
    this.harness ??= (async () => {
      const storage = await SqliteStorage.open(durableObjectSqliteDatabase(this.options.storage));
      this.installTools();
      const harness = await Harness.open(storage, { models: this.options.models, registry: this.registry }, context);
      const root = await harness.root(context, {
        agent: { model: this.model, thinkingLevel: this.thinkingLevel },
      });
      await this.watch(harness, root);
      harness.resume();
      return { harness, root };
    })();
    return this.harness;
  }

  private async watch(harness: Harness, root: Conversation): Promise<void> {
    const stream = await watchEvents(harness, root.id, context);
    stream.start(async (events) => {
      for (const event of events) this.forward(event);
    });
  }

  private forward(event: AgentEvent): void {
    const operationId = this.activeOperation;
    if (!operationId) return;
    const emit = (value: TurnEvent) => {
      for (const listener of this.listeners) listener(value);
    };
    if (event.type === 'message_start' && event.message.role === 'assistant') {
      this.streamedText = '';
      for (const block of event.message.content) {
        if (block.type === 'text' && block.text) {
          this.streamedText += block.text;
          emit({ type: 'text_delta', operationId, delta: block.text });
        }
        if (block.type === 'thinking' && block.thinking) emit({ type: 'thinking_delta', operationId, delta: block.thinking });
      }
    }
    if (event.type === 'message_end') {
      const message = event.entry.model?.[0];
      if (message?.role === 'assistant') {
        const finalText = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
        if (finalText.startsWith(this.streamedText) && finalText.length > this.streamedText.length)
          emit({ type: 'text_delta', operationId, delta: finalText.slice(this.streamedText.length) });
        this.streamedText = '';
      }
    }
    if (event.type === 'message_update') {
      for (const change of event.changes) {
        if (change.type === 'text_delta') {
          this.streamedText += change.delta;
          emit({ type: 'text_delta', operationId, delta: change.delta });
        }
        if (change.type === 'thinking_delta') emit({ type: 'thinking_delta', operationId, delta: change.delta });
      }
    }
    if (event.type === 'tool_execution_start')
      emit({ type: 'tool_start', operationId, toolCallId: event.toolCallId, toolName: event.toolName, arguments: event.args });
    if (event.type === 'tool_execution_end') {
      const message = event.entry && ToolResultEntry.is(event.entry) ? event.entry.model?.[0] : undefined;
      const result = message?.role === 'toolResult' ? message.content.filter(isJsonText).map((part) => part.text).join('\n') : undefined;
      emit({
        type: 'tool_end',
        operationId,
        toolCallId: event.toolCallId,
        error: message?.role === 'toolResult' ? message.isError : true,
        result,
      });
    }
  }
}
