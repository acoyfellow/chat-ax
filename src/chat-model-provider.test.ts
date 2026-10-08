import { expect, test } from 'bun:test';
import { cloudflareBindingProvider } from '@flue/runtime/cloudflare/workers-ai';
import type { Provider } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { chatModelById, chatModels, defaultChatModelId, defaultThinkingLevel, deploymentDefaultModelId, isChatModelId } from './chat-settings';
import { adaptiveThinkingRequest, anthropicEndpointBinding, chatGatewayProvider } from './chat-model-provider';

test('DEFAULT_MODEL=gpt-5.6-terra selects Terra xhigh and removed models are rejected', () => {
  expect(deploymentDefaultModelId('gpt-5.6-terra')).toBe('gpt-5.6-terra');
  expect(defaultThinkingLevel).toBe('xhigh');
  expect(isChatModelId('gpt-6-astra')).toBe(false);
  expect(isChatModelId('anthropic/claude-fable-5')).toBe(false);
  const registry = createModels();
  const gatewayCatalog: object = cloudflareBindingProvider({
    binding: { run() { throw new Error('Unexpected network'); } } as unknown as Ai,
    gateway: { id: 'ax' },
  });
  registry.setProvider(gatewayCatalog as Provider);
  const terra = chatModels.find(model => model.id === deploymentDefaultModelId('gpt-5.6-terra'))!;
  expect(registry.getModel(terra.pi!.provider, terra.pi!.modelId)?.id).toBe('openai/gpt-5.6-terra');
});

test('Opus 5.5 replaces Opus 5 and resolves through the gateway binding', () => {
  expect(isChatModelId('anthropic/claude-opus-5-5')).toBe(true);
  expect(isChatModelId('anthropic/claude-opus-5')).toBe(false);
  expect(chatModelById('anthropic/claude-opus-5').id).toBe('anthropic/claude-opus-5-5');
  expect(chatModelById('removed-model').id).toBe(defaultChatModelId);
  const offline = { run() { throw new Error('Unexpected network'); }, gateway() { return { run() { throw new Error('Unexpected network'); } }; } } as unknown as Ai;
  const registry = createModels();
  registry.setProvider(chatGatewayProvider(offline, 'ax'));
  const opus = chatModels.find(model => model.id === 'anthropic/claude-opus-5-5')!;
  const resolved = registry.getModel(opus.pi!.provider, opus.pi!.modelId)!;
  expect(resolved.id).toBe('anthropic/claude-opus-5-5');
  expect(resolved.api).toBe('anthropic-messages');
  expect(resolved.reasoning).toBe(true);
  expect(registry.getModel('cloudflare', 'openai/gpt-5.6-terra')?.id).toBe('openai/gpt-5.6-terra');
});

test('Opus 5.5 is sent to the Anthropic endpoint through the gateway', async () => {
  const calls: unknown[] = [];
  const ai = {
    run() { throw new Error('Binding catalog must not receive Opus 5.5'); },
    gateway(id: string) { return { run(request: unknown) { calls.push({ id, request }); return Promise.resolve(new Response('{}')); } }; },
  } as unknown as Ai;
  await anthropicEndpointBinding(ai, 'ax', new Set(['anthropic/claude-opus-5-5'])).run('anthropic/claude-opus-5-5', { max_tokens: 8 }, { extraHeaders: { 'x-session-affinity': 's' } });
  expect(calls).toEqual([{ id: 'ax', request: {
    provider: 'anthropic',
    endpoint: 'v1/messages',
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-session-affinity': 's' },
    query: { max_tokens: 8, model: 'claude-opus-5-5' },
  } }]);
});

test('Opus 5.5 requests use adaptive thinking', () => {
  expect(adaptiveThinkingRequest({ thinking: { type: 'enabled', budget_tokens: 1024, display: 'summarized' }, max_tokens: 8 }))
    .toEqual({ thinking: { type: 'adaptive', display: 'summarized' }, max_tokens: 8 });
  expect(adaptiveThinkingRequest({ thinking: { type: 'disabled' } })).toEqual({ thinking: { type: 'disabled' } });
});
