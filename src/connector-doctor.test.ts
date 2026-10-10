import { describe, expect, test } from 'bun:test';
import { diagnoseConnector, type DoctorProbes } from './connector-doctor';

const configured = () => ({ name: 'ax-mcp', serverUrl: 'https://mcp.example/mcp' });

function probes(overrides: Partial<DoctorProbes>): DoctorProbes {
  return {
    configured,
    status: async () => ({ connected: true }),
    token: async () => 'token',
    listTools: async () => [{ name: 'a' }, { name: 'b' }],
    ...overrides,
  };
}

describe('connector doctor', () => {
  test('stops at the first broken step and says how to fix it', async () => {
    const steps = await diagnoseConnector('sam@example.com', probes({ status: async () => ({ connected: false }) }));
    expect(steps.map((step) => step.step)).toEqual(['configured', 'linked']);
    expect(steps[1].detail).toContain('Connect ax-mcp');
  });

  test('an expired grant is reported as a token failure', async () => {
    const steps = await diagnoseConnector('sam@example.com', probes({ token: async () => null }));
    expect(steps.at(-1)).toMatchObject({ step: 'token', ok: false });
  });

  test('a server error is reported, not thrown', async () => {
    const steps = await diagnoseConnector('sam@example.com', probes({ listTools: async () => { throw new Error('401 invalid_token'); } }));
    expect(steps.at(-1)).toMatchObject({ step: 'tools', ok: false });
    expect(steps.at(-1)?.detail).toContain('401');
  });

  test('a healthy connector passes every step', async () => {
    const steps = await diagnoseConnector('sam@example.com', probes({}));
    expect(steps.every((step) => step.ok)).toBe(true);
    expect(steps).toHaveLength(4);
  });
});
