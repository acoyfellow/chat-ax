import { describe, expect, test } from 'bun:test';
import {
  chatModels,
  defaultChatModelId,
  defaultSystemPrompt,
  deploymentDefaultModelId,
  maximumSystemPromptLength,
  normalizeSystemPrompt,
} from './chat-settings';

describe('chat settings', () => {
  test('provides a non-empty default system prompt', () => {
    expect(normalizeSystemPrompt(defaultSystemPrompt)).toBe(defaultSystemPrompt);
  });

  test('exposes k3 and the three gateway gpt models', () => {
    expect(chatModels.some((model) => model.id === '@cf/moonshotai/kimi-k3')).toBe(true);
    expect(chatModels.some((model) => model.id === 'gpt-5.6-luna')).toBe(true);
    expect(chatModels.some((model) => model.id === 'gpt-5.6-sol')).toBe(true);
    expect(chatModels.some((model) => model.id === 'gpt-5.6-terra')).toBe(true);
  });

  test('a fresh deployment defaults to a Workers AI model that needs no paid credits', () => {
    expect(chatModels.find((model) => model.id === defaultChatModelId)?.provider).toBe('Workers AI');
    expect(deploymentDefaultModelId(undefined)).toBe(defaultChatModelId);
    expect(deploymentDefaultModelId('not-a-model')).toBe(defaultChatModelId);
  });

  test('DEFAULT_MODEL selects any known model for the whole deployment', () => {
    expect(deploymentDefaultModelId(' gpt-5.6-terra ')).toBe('gpt-5.6-terra');
  });

  test('bounds editable system prompts', () => {
    expect(normalizeSystemPrompt('  Be useful.  ')).toBe('Be useful.');
    expect(normalizeSystemPrompt('')).toBeNull();
    expect(normalizeSystemPrompt('x'.repeat(maximumSystemPromptLength + 1))).toBeNull();
  });
});
