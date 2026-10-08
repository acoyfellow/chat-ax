import { describe, expect, test } from 'bun:test';
import { agentContextKey, createAgentContext } from './agent-context';

describe('agent context storage boundaries', () => {
  test('uses a distinct namespace for every thread', () => {
    const parent = createAgentContext('root', null);
    const child = createAgentContext('child', 'root', 'subagent');
    expect(parent.id).toBe(agentContextKey('root'));
    expect(parent.messagesKey).not.toBe(child.messagesKey);
    expect(parent.settingsKey).not.toBe(child.settingsKey);
  });

  test('records parent relationship without sharing storage keys', () => {
    const child = createAgentContext('child', 'root', 'subagent');
    expect(child.parentId).toBe('root');
    expect(child.kind).toBe('subagent');
    expect(child.filesKey).toContain('agent-context:child');
  });
});
