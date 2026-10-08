import { describe, expect, test } from 'bun:test';
import { isProductionProofActor, verifiedActorId } from './production-proof';

describe('production proof actor boundary', () => {
  test('fails closed and permits only the configured verified identity', () => {
    expect(verifiedActorId({ sub: 'verified-subject' })).toBe('verified-subject');
    expect(isProductionProofActor(undefined, 'operator@example.invalid')).toBe(false);
    expect(isProductionProofActor('operator@example.invalid', 'other@example.invalid')).toBe(false);
    expect(isProductionProofActor('operator@example.invalid', 'operator@example.invalid')).toBe(
      true,
    );
  });
});
