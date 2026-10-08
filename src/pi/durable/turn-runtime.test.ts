import { describe, expect, test } from 'bun:test';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { Type } from 'typebox';
import { durableObjectStorageStandIn } from './test-storage';
import { DurableTurnRuntime, type TurnEvent, type TurnTool } from './turn-runtime';

function setup(storage = durableObjectStorageStandIn(), streaming: Parameters<typeof fauxProvider>[0] = {}) {
  const faux = fauxProvider(streaming);
  const models = createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel();
  const calls: Array<{ operationId: string; invocationId: string }> = [];
  let release: (() => void) | undefined;
  let block = false;
  const started = { promise: Promise.resolve() as Promise<void>, resolve: () => {} };
  const tools: TurnTool[] = [
    {
      name: 'lookup',
      label: 'Lookup',
      description: 'look something up',
      parameters: Type.Object({ q: Type.String() }),
      async execute(_args, invocation) {
        calls.push(invocation);
        started.resolve();
        if (block) await new Promise<void>((resolve) => (release = resolve));
        return { content: [{ type: 'text', text: 'found it' }] };
      },
    },
  ];
  const runtime = new DurableTurnRuntime({
    storage,
    models,
    model: { provider: model.provider, modelId: model.id },
    instructions: async () => 'You are a test agent.',
    tools: () => tools,
  });
  const events: TurnEvent[] = [];
  runtime.on((event) => events.push(event));
  return {
    storage,
    faux,
    runtime,
    events,
    calls,
    blockTools() {
      block = true;
      started.promise = new Promise<void>((resolve) => (started.resolve = resolve));
    },
    started: () => started.promise,
    release: () => release?.(),
  };
}

describe('durable turn runtime', () => {
  test('completes a turn with a tool call and streams progress', async () => {
    const run = setup();
    run.faux.setResponses([
      fauxAssistantMessage([fauxToolCall('lookup', { q: 'x' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('the answer is 42'),
    ]);
    const reply = await run.runtime.prompt('what is it?', { operationId: 'op-1' });
    expect(reply).toMatchObject({ status: 'completed', text: 'the answer is 42' });
    expect(run.calls).toEqual([expect.objectContaining({ operationId: 'op-1' })]);
    expect(run.events.find((event) => event.type === 'tool_start')).toMatchObject({ operationId: 'op-1', toolName: 'lookup', arguments: { q: 'x' } });
    expect(run.events.find((event) => event.type === 'tool_end')).toMatchObject({ operationId: 'op-1', error: false, result: 'found it' });
        await run.runtime.close();
  });

  test('streamed text deltas reassemble the whole reply, including the first chunk', async () => {
    const run = setup(durableObjectStorageStandIn(), { tokensPerSecond: 80, tokenSize: { min: 2, max: 4 } });
    const answer = 'You said: hello streaming world, and every character arrives.';
    run.faux.setResponses([fauxAssistantMessage(answer)]);
    const reply = await run.runtime.prompt('hi', { operationId: 'op-stream' });
    const streamed = run.events
      .filter((event) => event.type === 'text_delta' && event.operationId === 'op-stream')
      .map((event) => (event.type === 'text_delta' ? event.delta : ''))
      .join('');
    expect(reply.text).toBe(answer);
    expect(streamed).toBe(answer);
    expect(run.events.filter((event) => event.type === 'text_delta').length).toBeGreaterThan(1);
    await run.runtime.close();
  });

  test('cancels a running turn', async () => {
    const run = setup();
    run.blockTools();
    run.faux.setResponses([fauxAssistantMessage([fauxToolCall('lookup', { q: 'x' })], { stopReason: 'toolUse' }), fauxAssistantMessage('never')]);
    const reply = run.runtime.prompt('slow', { operationId: 'op-cancel' });
    await run.started();
    await run.runtime.abort({ operationId: 'op-cancel' });
    run.release();
    expect((await reply).status).not.toBe('completed');
    await run.runtime.close();
  });

  test('recovers a turn interrupted mid tool call after the object restarts', async () => {
    const first = setup();
    first.blockTools();
    first.faux.setResponses([fauxAssistantMessage([fauxToolCall('lookup', { q: 'x' })], { stopReason: 'toolUse' })]);
    void first.runtime.prompt('slow', { operationId: 'op-crash' }).catch(() => undefined);
    await first.started();
    await first.runtime.close();

    const second = setup(first.storage);
    second.faux.setResponses([fauxAssistantMessage('recovered and finished')]);
    const reply = await second.runtime.prompt('slow', { operationId: 'op-crash' });
    expect(reply).toMatchObject({ status: 'completed', text: 'recovered and finished' });
    const transcript = JSON.stringify((await second.runtime.snapshot()).messages);
    expect(transcript).toContain('interrupted and may have partially run');
    expect(second.calls).toEqual([]);
    await second.runtime.close();
  });
});
