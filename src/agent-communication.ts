import { z } from 'zod';

export const communicationActionSchema = z.enum(['message', 'file', 'job-summary']);
export type CommunicationAction = z.infer<typeof communicationActionSchema>;

export const communicationRequestSchema = z
  .object({
    fromAgentId: z.string().trim().min(1).max(200),
    toAgentId: z.string().trim().min(1).max(200),
    action: communicationActionSchema,
    message: z.string().trim().min(1).max(8_000).optional(),
    fileId: z.string().trim().min(1).max(200).optional(),
    jobId: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === 'message' && !value.message)
      context.addIssue({ code: 'custom', message: 'message is required' });
    if (value.action === 'file' && !value.fileId)
      context.addIssue({ code: 'custom', message: 'fileId is required' });
    if (value.action === 'job-summary' && !value.jobId)
      context.addIssue({ code: 'custom', message: 'jobId is required' });
  });

export const communicationGrantInputSchema = z
  .object({
    fromAgentId: z.string().trim().min(1).max(200),
    toAgentId: z.string().trim().min(1).max(200),
    actions: z
      .array(communicationActionSchema)
      .min(1)
      .max(3)
      .transform((items) => [...new Set(items)]),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type CommunicationGrant = z.infer<typeof communicationGrantInputSchema> & {
  id: string;
  createdAt: string;
  createdBy: string;
  revokedAt?: string;
  usedAt?: string;
};

export type CommunicationEvent = {
  id: string;
  type: 'communication.sent' | 'communication.delivered' | 'communication.failed';
  fromAgentId: string;
  toAgentId: string;
  action: CommunicationAction;
  occurredAt: string;
  grantId?: string;
  reason?: string;
};

export function authorizeCommunication(
  parentByAgent: ReadonlyMap<string, string | null>,
  fromAgentId: string,
  toAgentId: string,
  action: CommunicationAction,
  mode: 'strict' | 'mesh',
  grants: readonly CommunicationGrant[],
  now = Date.now(),
): CommunicationGrant | undefined {
  if (fromAgentId === toAgentId) throw new Error('source and destination must differ');
  if (!parentByAgent.has(fromAgentId) || !parentByAgent.has(toAgentId))
    throw new Error('unknown agent');
  const direct =
    parentByAgent.get(fromAgentId) === toAgentId || parentByAgent.get(toAgentId) === fromAgentId;
  if (direct) return undefined;
  if (mode === 'strict') throw new Error('strict posture denies lateral communication');
  const grant = grants.find(
    (candidate) =>
      candidate.fromAgentId === fromAgentId &&
      candidate.toAgentId === toAgentId &&
      candidate.actions.includes(action) &&
      !candidate.revokedAt &&
      !candidate.usedAt &&
      Date.parse(candidate.expiresAt) > now,
  );
  if (!grant) throw new Error('communication grant required');
  return grant;
}
