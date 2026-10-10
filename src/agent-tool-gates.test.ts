import { describe, expect, test } from 'bun:test';
import { gateReason, heldToolMessage, isGatedAgentTool } from './agent-tool-gates';

describe('agent tool gates', () => {
  test('deleting your own file runs straight away', () => {
    expect(gateReason({ toolName: 'delete_file', speakerId: 'sam', fileCreatedBy: 'sam' })).toBeNull();
  });

  test('deleting someone else’s file is held', () => {
    expect(gateReason({ toolName: 'delete_file', speakerId: 'sam', fileCreatedBy: 'jordan' })).toContain('someone else');
  });

  test('messaging a person is always held', () => {
    expect(gateReason({ toolName: 'request_person', speakerId: 'sam' })).toContain('notifies');
  });

  test('read-only tools are never gated', () => {
    expect(gateReason({ toolName: 'list_files', speakerId: 'sam' })).toBeNull();
    expect(isGatedAgentTool('list_files')).toBe(false);
  });

  test('the held message says nothing has happened', () => {
    expect(heldToolMessage('delete_file', 'x')).toContain('Nothing has happened yet');
  });
});
