import { describe, expect, test } from 'bun:test';
import { toolArgumentsDetail, toolResultDetail } from './tool-activity-detail';

const fakeToken = 'fixture'.repeat(3);
const bearer = ['Bearer', fakeToken].join(' ');

describe('tool activity detail', () => {
  test('shows arguments while redacting credentials', () => {
    const detail = toolArgumentsDetail({ toolName: 'code_host_todos', headers: { Authorization: bearer }, apiKey: 'x', note: `use ${bearer}` })!;
    expect(detail).toContain('code_host_todos');
    expect(detail).not.toContain(fakeToken);
    expect(detail).toContain('[redacted]');
  });

  test('prefers text output and falls back to details', () => {
    expect(toolResultDetail({ content: [{ type: 'text', text: 'MCP error: 403 forbidden' }], details: {} })).toBe('MCP error: 403 forbidden');
    expect(toolResultDetail({ content: [], details: { status: 404 } })).toContain('404');
    expect(toolResultDetail(undefined)).toBeUndefined();
  });

  test('bounds oversized payloads', () => {
    expect(toolResultDetail({ content: [{ type: 'text', text: 'x'.repeat(10_000) }], details: null })!.length).toBeLessThan(4_100);
  });
});
