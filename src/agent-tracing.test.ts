import { expect, test } from 'bun:test';
import { approvalAttributes, boundedPayload, identityAttributes, toolAttributes, traced, type TraceAttributes, type TraceTracer } from './agent-tracing';

function recordingTracer() {
  const spans: Array<{ name: string; attributes: TraceAttributes; exception?: string }> = [];
  const tracer: TraceTracer = {
    enterSpan(name, callback) {
      const record: { name: string; attributes: TraceAttributes; exception?: string } = { name, attributes: {} };
      spans.push(record);
      return callback({
        setAttributes: (attributes) => Object.assign(record.attributes, attributes),
        recordException: (exception) => {
          record.exception = exception.message;
        },
      });
    },
  };
  return { spans, tracer };
}

test('agent and chat spans carry the identity the Agents dashboard needs', () => {
  const attributes = identityAttributes('invoke_agent', { agentId: 'agent-1', conversationId: 'agent-1' });
  expect(attributes['gen_ai.operation.name']).toBe('invoke_agent');
  expect(attributes['gen_ai.agent.name']).toBe('chat-ax-agent');
  expect(attributes['gen_ai.agent.id']).toBe('agent-1');
  expect(attributes['gen_ai.conversation.id']).toBe('agent-1');
});

test('tool spans record arguments with secrets redacted', () => {
  const attributes = toolAttributes('call_mcp', 'call-1', { name: 'gitlab_list', apiKey: 'sk-live-123', note: 'Bearer abcdefghijklmnop' });
  const recorded = String(attributes['gen_ai.tool.call.arguments']);
  expect(attributes['gen_ai.tool.name']).toBe('call_mcp');
  expect(recorded).toContain('gitlab_list');
  expect(recorded).not.toContain('sk-live-123');
  expect(recorded).not.toContain('abcdefghijklmnop');
});

test('approval spans record the exact arguments, both people, the stage and a fingerprint', () => {
  const attributes = approvalAttributes({
    approvalId: 'a-1',
    toolName: 'gitlab_approve_merge_request',
    stage: 'approved',
    requesterEmail: 'sam@example.com',
    connectorOwnerEmail: 'jordan@example.com',
    argumentsJson: '{"project":"team/app","mr":42}',
    argumentsDigest: '9f2c41ab77e0d1c2aa',
  });
  expect(attributes['gen_ai.operation.name']).toBe('tool_approval');
  expect(attributes['chat_ax.approval.stage']).toBe('approved');
  expect(attributes['chat_ax.approval.requester']).toBe('sam@example.com');
  expect(attributes['chat_ax.approval.connector_owner']).toBe('jordan@example.com');
  expect(attributes['chat_ax.approval.arguments_fingerprint']).toBe('9f2c41ab77e0');
  expect(String(attributes['gen_ai.tool.call.arguments'])).toContain('"mr": 42');
});

test('payloads are bounded so spans stay under size limits', () => {
  expect(boundedPayload('x'.repeat(5_000)).length).toBeLessThan(2_100);
});

test('traced work nests under a named span and records failures', async () => {
  const { spans, tracer } = recordingTracer();
  expect(await traced(tracer, 'execute_tool ok', { a: 1 }, async () => 'done')).toBe('done');
  await expect(traced(tracer, 'execute_tool broken', {}, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  expect(spans.map((span) => span.name)).toEqual(['execute_tool ok', 'execute_tool broken']);
  expect(spans[1].exception).toBe('boom');
});

test('without a tracer the work still runs', async () => {
  expect(await traced(undefined, 'x', {}, async () => 7)).toBe(7);
});
