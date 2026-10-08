import {
  createProvider,
  type TranscriptContext,
  type Model,
  type ProviderStreams,
  type SimpleStreamOptions
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { cloudflareWorkersAIProvider } from "@earendil-works/pi-ai/providers/cloudflare-workers-ai";
import type { Provider } from "@earendil-works/pi-ai";

export const WORKERS_AI_PROVIDER = "cloudflare-workers-ai";

type RunBinding = {
  run(
    model: string,
    input: Record<string, unknown>,
    options: {
      gateway?: { id: string };
      returnRawResponse: true;
      signal?: AbortSignal;
    }
  ): Promise<Response>;
};

export type WorkersAIModelOptions = {
  readonly id: string;
  readonly name?: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  readonly reasoning?: boolean;
};

export type WorkersAIOptions = {
  readonly gateway?: string;
  readonly models?: readonly WorkersAIModelOptions[];
};

function bodyText(body: BodyInit | null | undefined): string {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(body));
  }
  throw new TypeError("Workers AI pi requests require a JSON request body");
}

function customModel(
  options: WorkersAIModelOptions
): Model<"openai-completions"> {
  return {
    id: options.id,
    name: options.name ?? options.id,
    api: "openai-completions",
    provider: WORKERS_AI_PROVIDER,
    baseUrl: "https://workers-ai.binding.invalid/v1",
    reasoning: options.reasoning ?? false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: options.contextWindow ?? 128_000,
    maxTokens: options.maxTokens ?? 16_384,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStrictMode: false,
      supportsLongCacheRetention: false,
      maxTokensField: "max_tokens",
      requiresReasoningContentOnAssistantMessages:
        options.id.includes("gpt-oss"),
      thinkingFormat: "openai"
    }
  };
}

export function workersAI(
  binding: Ai,
  options: WorkersAIOptions = {}
): Provider {
  const runRaw = async (model: string, input: Record<string, unknown>, runOptions: Parameters<RunBinding["run"]>[2]): Promise<Response> => {
    const result: unknown = await Reflect.apply(binding.run, binding, [model, input, runOptions]);
    if (!(result instanceof Response))
      throw new TypeError("Workers AI binding did not return a raw response");
    return result;
  };
  const fetch = async (
    _input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const parsed: unknown = JSON.parse(bodyText(init?.body));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      throw new TypeError("Workers AI pi request body must be a JSON object");
    const input: Record<string, unknown> = { ...parsed };
    const model = typeof input.model === "string" ? input.model : undefined;
    if (!model)
      throw new TypeError("Workers AI pi request is missing its model");
    delete input.model;
    return runRaw(model, input, {
      ...(options.gateway ? { gateway: { id: options.gateway } } : {}),
      returnRawResponse: true,
      ...(init?.signal ? { signal: init.signal } : {})
    });
  };

  const api = openAICompletionsApi();
  const streams: ProviderStreams = {
    stream: (model, context, streamOptions) =>
      api.stream(model, context, { ...streamOptions, fetch }),
    streamSimple: (
      model: Model<string>,
      context: TranscriptContext,
      streamOptions?: SimpleStreamOptions
    ) => api.streamSimple(model, context, { ...streamOptions, fetch })
  };

  const catalog = cloudflareWorkersAIProvider().getModels();
  const extra = (options.models ?? []).map(customModel);
  return createProvider({
    id: WORKERS_AI_PROVIDER,
    name: "Cloudflare Workers AI",
    auth: {
      apiKey: {
        name: "Workers AI binding",
        check: async () => ({
          type: "api_key" as const,
          source: "Workers AI binding"
        }),
        resolve: async () => ({
          auth: { apiKey: "workers-ai-binding" },
          source: "Workers AI binding"
        })
      }
    },
    models: [
      ...catalog.filter(
        (model) => !extra.some((added) => added.id === model.id)
      ),
      ...extra
    ],
    api: streams
  });
}
