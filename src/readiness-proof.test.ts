import { describe, expect, test } from 'bun:test';
import { verifyReadinessProof } from './readiness-proof';

const now = Date.parse('2026-09-16T00:00:00.000Z');
const receipt = {
  marker: 'PRODUCTION_AGENT_ISOLATION_PASS',
  release: 'release-1',
  build: 'build-1',
  verifiedAt: new Date(now).toISOString(),
  absentAfterCleanup: true,
  orchestrationUnchanged: true,
  privateStateVerified: true,
  privateResourcesVerified: true,
  independentTurnsVerified: true,
} as const;

describe('deployed readiness proof verification', () => {
  test('accepts only a complete current receipt', () => {
    expect(verifyReadinessProof(receipt, { release: 'release-1', build: 'build-1' }, now)).toEqual({
      valid: true,
      flags: 5,
    });
    for (const flag of [
      'absentAfterCleanup',
      'orchestrationUnchanged',
      'privateStateVerified',
      'privateResourcesVerified',
      'independentTurnsVerified',
    ] as const) {
      const incomplete: Record<string, unknown> = { ...receipt };
      delete incomplete[flag];
      expect(() =>
        verifyReadinessProof(incomplete, { release: 'release-1', build: 'build-1' }, now),
      ).toThrow();
    }
  });

  test('rejects stale, future, and mismatched receipts', () => {
    expect(() =>
      verifyReadinessProof(
        { ...receipt, build: 'old' },
        { release: 'release-1', build: 'build-1' },
        now,
      ),
    ).toThrow();
    expect(() =>
      verifyReadinessProof(
        { ...receipt, verifiedAt: new Date(now - 24 * 60 * 60 * 1000 - 1).toISOString() },
        { release: 'release-1', build: 'build-1' },
        now,
      ),
    ).toThrow();
    expect(() =>
      verifyReadinessProof(
        { ...receipt, verifiedAt: new Date(now + 5 * 60 * 1000 + 1).toISOString() },
        { release: 'release-1', build: 'build-1' },
        now,
      ),
    ).toThrow();
  });
});
