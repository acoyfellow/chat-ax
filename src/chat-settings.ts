export type ChatModelId =
  | 'gpt-5.6-luna'
  | 'gpt-5.6-sol'
  | 'gpt-5.6-terra'
  | 'anthropic/claude-opus-5-5'
  | '@cf/moonshotai/kimi-k3'
  | '@cf/zai-org/glm-5.3';

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type ChatModel = {
  id: ChatModelId;
  label: string;
  provider: string;
  description: string;
  pi?: { provider: string; modelId: string };
};

export const chatModels: ChatModel[] = [
  {
    id: 'gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    provider: 'AI Gateway',
    description: 'GPT-5.6 Luna through Cloudflare AI Gateway.',
    pi: { provider: 'cloudflare', modelId: 'openai/gpt-5.6-luna' },
  },
  {
    id: 'gpt-5.6-sol',
    label: 'GPT-5.6 Sol',
    provider: 'AI Gateway',
    description: 'GPT-5.6 Sol for deep research discussion.',
    pi: { provider: 'cloudflare', modelId: 'openai/gpt-5.6-sol' },
  },
  {
    id: 'gpt-5.6-terra',
    label: 'GPT-5.6 Terra',
    provider: 'AI Gateway',
    description: 'GPT-5.6 Terra through Cloudflare AI Gateway.',
    pi: { provider: 'cloudflare', modelId: 'openai/gpt-5.6-terra' },
  },
  {
    id: 'anthropic/claude-opus-5-5',
    label: 'Claude Opus 5.5',
    provider: 'AI Gateway',
    description: 'Latest Claude model through Cloudflare AI Gateway.',
    pi: { provider: 'cloudflare', modelId: 'anthropic/claude-opus-5-5' },
  },
  {
    id: '@cf/moonshotai/kimi-k3',
    label: 'Kimi K3',
    provider: 'Workers AI',
    description: 'Latest Kimi model hosted by Cloudflare.',
    pi: { provider: 'cloudflare-workers-ai', modelId: '@cf/moonshotai/kimi-k3' },
  },
  {
    id: '@cf/zai-org/glm-5.3',
    label: 'GLM 5.3',
    provider: 'Workers AI',
    description: 'Latest GLM model hosted by Cloudflare.',
    pi: { provider: 'cloudflare-workers-ai', modelId: '@cf/zai-org/glm-5.3' },
  },
];

export const thinkingLevels: Array<{ id: ThinkingLevel; label: string }> = [
  { id: 'off', label: 'Off' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high' },
  { id: 'max', label: 'Maximum' },
];

export const defaultChatModelId: ChatModelId = '@cf/zai-org/glm-5.3';

export function deploymentDefaultModelId(configured: string | undefined): ChatModelId {
  return currentChatModelId(configured?.trim() ?? '') ?? defaultChatModelId;
}
export const defaultThinkingLevel: ThinkingLevel = 'xhigh';
export const defaultSystemPrompt =
  'You are the single shared agent in a team chat room. Answer the current request using the supplied shared transcript. Be direct, useful, and concise. Do not claim to have tools or context that are not present.';
export const maximumSystemPromptLength = 8000;

export function normalizeSystemPrompt(value: string): string | null {
  const prompt = value.trim();
  return prompt.length > 0 && prompt.length <= maximumSystemPromptLength ? prompt : null;
}

export function isChatModelId(value: string): value is ChatModelId {
  return chatModels.some((model) => model.id === value);
}

export function isThinkingLevel(value: string): value is ThinkingLevel {
  return thinkingLevels.some((level) => level.id === value);
}

const replacedChatModelIds: Record<string, ChatModelId> = {
  'anthropic/claude-opus-5': 'anthropic/claude-opus-5-5',
};

export function currentChatModelId(id: string): ChatModelId | undefined {
  const current = replacedChatModelIds[id] ?? id;
  return isChatModelId(current) ? current : undefined;
}

export function chatModelById(id: string): ChatModel {
  const current = currentChatModelId(id) ?? defaultChatModelId;
  return chatModels.find((model) => model.id === current)!;
}
