import { describe, expect, test } from 'bun:test';
import { agentObjectName } from './agent-identity';
import { applyAgentCancellation } from './agent-cancellation';
import {
  nativeAgentCapabilityPrompt,
  nativeAgentToolNames,
  SerialOperationLane,
} from './native-agent-tools';
import { validateDelegation, type AgentDelegation } from './agent-oracle';

describe('agent durable object boundaries', () => {
  test('maps each agent to a distinct durable object name', () => {
    expect(agentObjectName('root')).toBe('agent:root');
    expect(agentObjectName('child')).toBe('agent:child');
    expect(agentObjectName('root')).not.toBe(agentObjectName('child'));
  });

  test('advertises complete self-scoped native resources without sibling authority', () => {
    expect(nativeAgentToolNames).toEqual([
      'list_state',
      'create_state',
      'update_state',
      'delete_state',
      'list_jobs',
      'create_job',
      'update_job',
      'pause_job',
      'resume_job',
      'delete_job',
      'list_skills',
      'read_skill',
      'create_skill',
      'update_skill',
      'delete_skill',
      'list_files',
      'read_file',
      'create_file',
      'delete_file',
      'read_settings',
      'update_settings',
      'list_work',
      'list_subagents',
      'send_subagent_test_message',
    ]);
    expect(nativeAgentCapabilityPrompt).toContain(
      'state, recurring jobs, skills, files, settings, and work',
    );
    expect(nativeAgentCapabilityPrompt).toContain('scoped automatically to this agent');
    expect(nativeAgentCapabilityPrompt).toContain("cannot access a sibling agent's resources");
    expect(nativeAgentCapabilityPrompt).toContain('Authorized room participants');
  });

  test('serializes external file operations across await boundaries', async () => {
    const lane = new SerialOperationLane();
    const events: string[] = [];
    let releaseFirst = () => {};
    const firstBoundary = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = lane.run(async () => {
      events.push('first-start');
      await firstBoundary;
      events.push('first-end');
    });
    const second = lane.run(async () => {
      events.push('second-start');
      events.push('second-end');
    });
    await Promise.resolve();
    expect(events).toEqual(['first-start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
  });

  test('cancels the request and canonical assistant response together', () => {
    const messages = [
      { id: 'turn-1', role: 'user', authorId: 'person', authorName: 'Jordan', text: 'hello', createdAt: '', status: 'active' as const },
      { id: 'agent-turn-1', role: 'assistant', authorId: 'agent', authorName: 'Agent', text: 'partial', createdAt: '', status: 'active' as const, replyTo: 'turn-1' },
    ];
    const cancelled = applyAgentCancellation(messages, 'turn-1');
    expect(cancelled[0].status).toBe('error');
    expect(cancelled[1].status).toBe('error');
    expect(cancelled[1].text).toBe('Response cancelled.');
  });

  test('does not regress a terminal response during cancellation', () => {
    const messages = [
      { id: 'turn-1', role: 'user', authorId: 'person', authorName: 'Jordan', text: 'hello', createdAt: '', status: 'error' as const },
      { id: 'agent-turn-1', role: 'assistant', authorId: 'agent', authorName: 'Agent', text: 'Response cancelled.', createdAt: '', status: 'error' as const, replyTo: 'turn-1' },
    ];
    expect(applyAgentCancellation(messages, 'turn-1')).toEqual(messages);
  });

  test('requires explicit cross-agent delegation identity and expiry', () => {
    const message: AgentDelegation = {
      messageId: 'message-1',
      fromAgentId: 'root',
      toAgentId: 'child',
      roomId: 'room-1',
      taskId: 'task-1',
      payload: { request: 'inspect' },
      requestedCapabilities: ['read'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    expect(() => validateDelegation(message)).not.toThrow();
    expect(() => validateDelegation({ ...message, toAgentId: 'root' })).toThrow();
  });
});
