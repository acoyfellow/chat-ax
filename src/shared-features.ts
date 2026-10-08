import {
  type ChatModelId,
  type ThinkingLevel,
  defaultChatModelId,
  defaultSystemPrompt,
  defaultThinkingLevel,
} from './chat-settings';
import type { StrategyId } from './strategies';

export const maximumFileBytes = 10 * 1024 * 1024;
export const maximumTextFileBytes = 128 * 1024;
export const maximumSharedFiles = 100;
export const maximumAgentStateEntries = 50;
export const maximumRecurringJobs = 20;
export const supportedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const supportedTextTypes = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
]);

export type SharedFile = {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  objectKey: string;
  kind: 'image' | 'text';
  createdAt: string;
  createdBy: string;
};

export type AgentStateEntry = {
  id: string;
  key: string;
  value: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

export type RecurringJob = {
  id: string;
  name: string;
  prompt: string;
  intervalSeconds: number;
  maxRuns: number | null;
  runCount: number;
  status: 'active' | 'paused' | 'complete';
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

export type RoomNotification = {
  id: string;
  title: string;
  body: string;
  href: string;
  createdAt: string;
  source: 'agent' | 'job';
  messageId?: string;
  recipientEmail?: string;
};

export type StoredPushSubscription = {
  ownerId: string;
  ownerEmail: string;
  endpoint: string;
  subscription: {
    endpoint: string;
    keys: { auth: string; p256dh: string };
  };
  updatedAt: string;
};

export type TurnSettings = {
  strategyId: StrategyId;
  modelId: ChatModelId;
  thinkingLevel: ThinkingLevel;
  systemPrompt: string;
};

export const defaultTurnSettings: TurnSettings = {
  strategyId: 'fifo',
  modelId: defaultChatModelId,
  thinkingLevel: defaultThinkingLevel,
  systemPrompt: defaultSystemPrompt,
};

export function normalizeStateKey(value: string): string | null {
  const key = value.trim();
  return /^[A-Za-z0-9._-]{1,80}$/.test(key) ? key : null;
}

export function normalizeStateValue(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 8000 ? normalized : null;
}

export function normalizeJobInput(
  input: {
    name?: string;
    prompt?: string;
    intervalSeconds?: number;
    maxRuns?: number | null;
  },
  minimumIntervalSeconds = 60,
): { name: string; prompt: string; intervalSeconds: number; maxRuns: number | null } | null {
  const name = input.name?.trim() ?? '';
  const prompt = input.prompt?.trim() ?? '';
  const intervalSeconds = Number(input.intervalSeconds);
  const maxRuns = input.maxRuns === undefined ? null : input.maxRuns;
  if (!name || name.length > 120 || !prompt || prompt.length > 4000) return null;
  if (
    !Number.isInteger(intervalSeconds) ||
    intervalSeconds < minimumIntervalSeconds ||
    intervalSeconds > 2_592_000
  )
    return null;
  if (maxRuns !== null && (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > 1000))
    return null;
  return { name, prompt, intervalSeconds, maxRuns };
}

export function fileKind(mime: string): SharedFile['kind'] | null {
  if (supportedImageTypes.has(mime)) return 'image';
  if (supportedTextTypes.has(mime)) return 'text';
  return null;
}
