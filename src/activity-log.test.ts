import { describe, expect, test } from 'bun:test';
import { type ActivityEntry, activityFor, redactedArguments } from './activity-log';

const entry = (overrides: Partial<ActivityEntry>): ActivityEntry => ({
  id: 'a',
  at: '2026-10-10T00:00:00.000Z',
  kind: 'tool',
  toolName: 'call_mcp',
  speakerId: 'jordan-id',
  speakerEmail: 'jordan@example.com',
  source: 'person',
  connectorOwnerEmail: 'jordan@example.com',
  argumentsJson: '{"repo":"team/app"}',
  outcome: 'ok',
  ...overrides,
});

const segment = 'x'.repeat(12);
const jwtShaped = ['ey', 'J', segment, '.', segment, '.', segment].join('');
const githubShaped = ['gh', 'p_', 'a'.repeat(30)].join('');
const bearerShaped = ['Bear', 'er ', segment].join('');

describe('activity log', () => {
  test('secret-shaped keys and values are redacted', () => {
    const text = redactedArguments({ repo: 'a', apiKey: 'x', nested: { auth: bearerShaped, note: jwtShaped }, list: [githubShaped] });
    expect(text).toBe('{"repo":"a","apiKey":"[redacted]","nested":{"auth":"[redacted]","note":"[redacted]"},"list":["[redacted]"]}');
  });

  test('secrets inside nested JSON strings are redacted', () => {
    const text = redactedArguments({ name: 'whoami', argumentsJson: JSON.stringify({ repo: 'a', note: bearerShaped }) });
    expect(text).toBe(JSON.stringify({ name: 'whoami', argumentsJson: JSON.stringify({ repo: 'a', note: '[redacted]' }) }));
  });

  test('accepts JSON text and keeps ordinary values', () => {
    expect(redactedArguments('{"id":"f1","name":"notes.md"}')).toBe('{"id":"f1","name":"notes.md"}');
  });

  test('the speaker sees their own call details', () => {
    expect(activityFor([entry({})], { id: 'jordan-id', email: 'jordan@example.com' })[0]?.argumentsJson).toBe('{"repo":"team/app"}');
  });

  test('the connector owner sees details of a call that ran on their connector', () => {
    const view = activityFor([entry({ speakerId: 'sam-id', speakerEmail: 'sam@example.com' })], { id: 'jordan-id', email: 'jordan@example.com' });
    expect(view[0]?.private).toBe(false);
  });

  test('anyone else sees that it happened but not the details', () => {
    const view = activityFor([entry({})], { id: 'sam-id', email: 'sam@example.com' });
    expect(view[0]).toMatchObject({ toolName: 'call_mcp', speakerEmail: 'jordan@example.com', argumentsJson: null, private: true });
  });

  test('newest first', () => {
    const view = activityFor([entry({ id: 'old' }), entry({ id: 'new', at: '2026-10-11T00:00:00.000Z' })], { id: 'jordan-id', email: 'jordan@example.com' });
    expect(view.map((item) => item.id)).toEqual(['new', 'old']);
  });
});
