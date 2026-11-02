import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Models, ModelThinkingLevel } from '@earendil-works/pi-ai';
import {
  createRegistry,
  defineExtension,
  Harness,
  LiveDoc,
  type Conversation,
  type ConversationView,
  type EntryRecord,
  type ToolRegistration,
  type LiveState,
  ToolResultEntry,
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
  onToolCall?: (call: TurnToolCall) => Promise<void>;
};

export type TurnToolCall = {
  toolName: string;
  operationId: string;
  invocationId: string;
  arguments: unknown;
  isError: boolean;
  held: boolean;
  durationMs: number;
};

function heldResult(result: unknown): boolean {
  if (result === null || typeof result !== 'object' || !('details' in result)) return false;
  const details = result.details;
  return details !== null && typeof details === 'object' && 'held' in details && details.held === true;
}

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
        const detail = (await this.liveSnapshot())?.runFailure?.detail;
        return { status: aborted ? 'aborted' : 'failed', text: '', error: detail ? `${settled.reason}: ${detail}` : settled.reason };
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

  private async liveSnapshot(): Promise<LiveState | undefined> {
    const { harness, root } = await this.open();
    return harness.snapshot(LiveDoc, root.id, context);
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
          const startedAt = Date.now();
          const report = (isError: boolean, held = false) =>
            this.options.onToolCall?.({ toolName: tool.name, operationId, invocationId: api.callId, arguments: args, isError, held, durationMs: Date.now() - startedAt }).catch(() => undefined);
          try {
            const work = tool.execute(args as never, { operationId, invocationId: api.callId, signal });
            const result = signal ? await Promise.race([work, aborted(signal)]) : await work;
            await report(result.isError ?? false, heldResult(result));
            return { output: result.content, isError: result.isError ?? false };
          } catch (error) {
            await report(true);
            throw error;
          }
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

  private async watch(_harness: Harness, root: Conversation): Promise<void> {
    const watch = await root.watch(context);
    this.markSeen(watch.value);
    watch.start(async (call) => {
      if (call.kind === 'value') this.forward(call.value);
    });
  }

  private readonly seenEntries = new Set<string>();
  private readonly startedCalls = new Set<string>();
  private readonly endedCalls = new Set<string>();
  private streamedThinking = '';

  private markSeen(view: ConversationView): void {
    for (const entry of view.entries) this.seenEntries.add(String(entry.id));
    for (const slot of liveOf(view).tools ?? []) {
      this.startedCalls.add(slot.callId);
      if (slot.status === 'done') this.endedCalls.add(slot.callId);
    }
  }

  private forward(view: ConversationView): void {
    const operationId = this.activeOperation;
    if (!operationId) {
      this.markSeen(view);
      return;
    }
    const emit = (value: TurnEvent) => {
      for (const listener of this.listeners) listener(value);
    };
    const live = liveOf(view);
    const newEntries = view.entries.filter((entry) => !this.seenEntries.has(String(entry.id)));
    for (const entry of newEntries) {
      this.seenEntries.add(String(entry.id));
      const message = entry.model?.[0];
      if (message?.role !== 'assistant') continue;
      const finalText = blockText(message.content, 'text');
      if (finalText.startsWith(this.streamedText) && finalText.length > this.streamedText.length)
        emit({ type: 'text_delta', operationId, delta: finalText.slice(this.streamedText.length) });
      this.streamedText = '';
      this.streamedThinking = '';
    }
    const partial = live.generation?.message;
    if (partial) {
      const text = blockText(partial.content, 'text');
      const thinking = blockText(partial.content, 'thinking');
      if (!text.startsWith(this.streamedText)) this.streamedText = '';
      if (!thinking.startsWith(this.streamedThinking)) this.streamedThinking = '';
      if (text.length > this.streamedText.length) {
        emit({ type: 'text_delta', operationId, delta: text.slice(this.streamedText.length) });
        this.streamedText = text;
      }
      if (thinking.length > this.streamedThinking.length) {
        emit({ type: 'thinking_delta', operationId, delta: thinking.slice(this.streamedThinking.length) });
        this.streamedThinking = thinking;
      }
    }
    for (const slot of live.tools ?? []) {
      if (!this.startedCalls.has(slot.callId)) {
        this.startedCalls.add(slot.callId);
        emit({ type: 'tool_start', operationId, toolCallId: slot.callId, toolName: slot.name, arguments: toolArguments(view, slot.callId) });
      }
      if (slot.status === 'done' && !this.endedCalls.has(slot.callId)) {
        this.endedCalls.add(slot.callId);
        const entry = view.entries.find((candidate) => candidate.id === slot.entry);
        const message = entry && ToolResultEntry.is(entry) ? entry.model?.[0] : undefined;
        const result = message?.role === 'toolResult' ? message.content.filter(isJsonText).map((part) => part.text).join('\n') : undefined;
        emit({
          type: 'tool_end',
          operationId,
          toolCallId: slot.callId,
          error: message?.role === 'toolResult' ? message.isError : true,
          result,
        });
      }
    }
  }
}

function liveOf(view: ConversationView): LiveState {
  const doc = view.docs['pi.live'];
  return isLiveState(doc) ? doc : {};
}

function isLiveState(value: unknown): value is LiveState {
  if (typeof value !== 'object' || value === null) return false;
  return !('tools' in value) || Array.isArray(value.tools);
}

function blockText(content: readonly unknown[], kind: 'text' | 'thinking'): string {
  return content
    .map((block) => {
      if (typeof block !== 'object' || block === null || !('type' in block) || block.type !== kind) return '';
      if (kind === 'text') return 'text' in block && typeof block.text === 'string' ? block.text : '';
      return 'thinking' in block && typeof block.thinking === 'string' ? block.thinking : '';
    })
    .join('');
}

function toolArguments(view: ConversationView, callId: string): unknown {
  for (const entry of [...view.entries].reverse()) {
    const message = entry.model?.[0];
    if (message?.role !== 'assistant') continue;
    const call = message.content.find((block) => block.type === 'toolCall' && block.id === callId);
    if (call && call.type === 'toolCall') return call.arguments;
  }
  return undefined;
}
