import { z } from 'zod';

const requiredFlags = [
  'absentAfterCleanup',
  'orchestrationUnchanged',
  'privateStateVerified',
  'privateResourcesVerified',
  'independentTurnsVerified',
] as const;

const receiptSchema = z
  .object({
    marker: z.literal('PRODUCTION_AGENT_ISOLATION_PASS'),
    release: z.string().min(1),
    build: z.string().min(1),
    verifiedAt: z.iso.datetime(),
    absentAfterCleanup: z.literal(true),
    orchestrationUnchanged: z.literal(true),
    privateStateVerified: z.literal(true),
    privateResourcesVerified: z.literal(true),
    independentTurnsVerified: z.literal(true),
  })
  .strict();

export function verifyReadinessProof(
  input: unknown,
  expected: { release: string; build: string },
  now = Date.now(),
): { valid: true; flags: number } {
  const receipt = receiptSchema.parse(input);
  if (receipt.release !== expected.release || receipt.build !== expected.build)
    throw new Error('receipt release mismatch');
  const verifiedAt = Date.parse(receipt.verifiedAt);
  if (verifiedAt > now + 5 * 60 * 1000 || now - verifiedAt > 24 * 60 * 60 * 1000)
    throw new Error('receipt timestamp invalid');
  return { valid: true, flags: requiredFlags.length };
}
