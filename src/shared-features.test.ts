import { describe, expect, test } from 'bun:test';
import { normalizeJobInput, normalizeStateKey, normalizeStateValue } from './shared-features';

const validJob = {
  name: 'Status check',
  prompt: 'Check the shared room once.',
  intervalSeconds: 60,
  maxRuns: 1,
};

describe('shared feature boundaries', () => {
  test('requires a production-safe recurring cadence by default', () => {
    expect(normalizeJobInput({ ...validJob, intervalSeconds: 59 })).toBeNull();
    expect(normalizeJobInput(validJob)).toEqual(validJob);
  });

  test('allows short cadence only when the development boundary requests it', () => {
    expect(normalizeJobInput({ ...validJob, intervalSeconds: 2 }, 1)?.intervalSeconds).toBe(2);
  });

  test('bounds state keys and values', () => {
    expect(normalizeStateKey('project.codename')).toBe('project.codename');
    expect(normalizeStateKey('../secret')).toBeNull();
    expect(normalizeStateValue(' remembered value ')).toBe('remembered value');
    expect(normalizeStateValue('')).toBeNull();
  });
});
