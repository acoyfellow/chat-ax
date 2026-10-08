import { describe, expect, test } from 'bun:test';
import { agentFileObjectKey, privateAgentResourceNames, recurringJobActorId } from './agent-private-resources';

describe('private agent resources', () => {
  test('keeps file content in an agent-specific object namespace', () => {
    expect(agentFileObjectKey('agent-a', 'file-1')).toBe('agents/agent-a/files/file-1');
    expect(agentFileObjectKey('agent-a', 'file-1')).not.toBe(agentFileObjectKey('agent-b', 'file-1'));
  });

  test('defines private ownership without room coordination resources', () => {
    expect(privateAgentResourceNames).toEqual(['skills', 'files', 'state', 'jobs', 'work', 'tools']);
    expect(privateAgentResourceNames).not.toContain('messages' as never);
    expect(privateAgentResourceNames).not.toContain('queue' as never);
  });

  test('binds recurring prompts to their owning job identity', () => {
    expect(recurringJobActorId('daily-review')).toBe('job:daily-review');
    expect(recurringJobActorId('daily-review')).not.toBe(recurringJobActorId('weekly-review'));
  });
});
