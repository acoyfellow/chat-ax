import type { Provider, Tool, TranscriptContext } from '@earendil-works/pi-ai';
import { getCurrentTools } from '@earendil-works/pi-ai/utils/transcript';
import { cloudflareBindingProvider } from '@flue/runtime/cloudflare/workers-ai';

export const opusBaseModelId = 'anthropic/claude-opus-5';
export const opusModelId = 'anthropic/claude-opus-5-5';

type GatewayProviderOptions = Parameters<typeof cloudflareBindingProvider>[0];
type BindingRunOptions = { signal?: AbortSignal; extraHeaders?: Record<string, string> };
type AnthropicGateway = { run(request: { provider: string; endpoint: string; headers: Record<string, string>; query: unknown }, options?: { signal?: AbortSignal }): Promise<Response> };

export function adaptiveThinkingRequest(inputs: Record<string, unknown>): Record<string, unknown> {
  const thinking = inputs.thinking;
  if (!thinking || typeof thinking !== 'object' || !('type' in thinking) || thinking.type !== 'enabled') return inputs;
  const display = 'display' in thinking && typeof thinking.display === 'string' ? thinking.display : 'summarized';
  return { ...inputs, thinking: { type: 'adaptive', display } };
}

export function anthropicEndpointBinding(ai: Ai, gatewayId: string, modelIds: ReadonlySet<string>): GatewayProviderOptions['binding'] {
  const gateway: AnthropicGateway = ai.gateway(gatewayId);
  return {
    run(modelId: string, inputs: Record<string, unknown>, options?: BindingRunOptions) {
      if (!modelIds.has(modelId)) return ai.run(modelId as never, inputs as never, options as never);
      return gateway.run({
        provider: 'anthropic',
        endpoint: 'v1/messages',
        headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...options?.extraHeaders },
        query: { ...adaptiveThinkingRequest(inputs), model: modelId.slice('anthropic/'.length) },
      }, options?.signal ? { signal: options.signal } : undefined);
    },
  };
}

export type LegacyToolContext = TranscriptContext & { tools?: Tool[] };

export function withDeclaredTools(context: TranscriptContext): LegacyToolContext {
  const declared = getCurrentTools(context.messages);
  if (declared.length === 0) return context;
  const legacy: LegacyToolContext = Object.assign(Object.create(Object.getPrototypeOf(context)), context, { tools: declared });
  return legacy;
}

function withTranscriptTools(provider: Provider): Provider {
  return {
    ...provider,
    getModels: () => provider.getModels(),
    stream: (model, context, options) => provider.stream(model, withDeclaredTools(context), options),
    streamSimple: (model, context, options) => provider.streamSimple(model, withDeclaredTools(context), options),
  };
}

function isPiProvider(value: object): value is Provider {
  return 'id' in value && 'getModels' in value && typeof value.getModels === 'function';
}

export function chatGatewayProvider(ai: Ai, gatewayId: string): Provider {
  const provider = cloudflareBindingProvider({
    binding: anthropicEndpointBinding(ai, gatewayId, new Set([opusModelId])),
    gateway: { id: gatewayId },
  });
  const catalog = provider.getModels();
  const base = catalog.find((model) => model.id === opusBaseModelId);
  const models = !base || catalog.some((model) => model.id === opusModelId)
    ? catalog
    : [...catalog, { ...base, id: opusModelId, name: 'Claude Opus 5.5' }];
  const gateway: object = Object.assign(provider, { getModels: () => models });
  if (!isPiProvider(gateway)) throw new Error('Cloudflare gateway provider is not a pi-ai provider');
  return withTranscriptTools(gateway);
}
