export type ApprovalStatus = 'pending' | 'denied' | 'expired' | 'running' | 'succeeded' | 'outcome-unknown';

export type ApprovalEvent = 'approve' | 'deny' | 'expire' | 'ran' | 'crashed';

const transitions: Record<ApprovalStatus, Partial<Record<ApprovalEvent, ApprovalStatus>>> = {
  pending: { approve: 'running', deny: 'denied', expire: 'expired' },
  running: { ran: 'succeeded', crashed: 'outcome-unknown' },
  denied: {},
  expired: {},
  succeeded: {},
  'outcome-unknown': {},
};

export const terminalApprovalStatuses: readonly ApprovalStatus[] = ['denied', 'expired', 'succeeded', 'outcome-unknown'];

export function nextApprovalStatus(current: ApprovalStatus, event: ApprovalEvent): ApprovalStatus {
  const next = transitions[current][event];
  if (!next) throw new Error(`An approval that is ${current} cannot ${event}`);
  return next;
}

export function canApprovalMove(current: ApprovalStatus, event: ApprovalEvent): boolean {
  return transitions[current][event] !== undefined;
}

const legacyStatuses: Record<string, ApprovalStatus> = {
  'not-executed': 'outcome-unknown',
  failed: 'outcome-unknown',
};

function isApprovalStatus(value: string): value is ApprovalStatus {
  return Object.hasOwn(transitions, value);
}

export function readApprovalStatus(stored: string, expiresAt: number, now: number): ApprovalStatus {
  const known = legacyStatuses[stored] ?? stored;
  const status: ApprovalStatus = isApprovalStatus(known) ? known : 'outcome-unknown';
  return status === 'pending' && expiresAt <= now ? 'expired' : status;
}

export const approvalStatusMeaning: Record<ApprovalStatus, { label: string; detail: string; nextStep: string }> = {
  pending: { label: 'Waiting for approval', detail: 'Nothing has run yet.', nextStep: 'Approve or deny it.' },
  denied: { label: 'Denied', detail: 'Nothing ran.', nextStep: 'Ask again if it is still needed; a new request is required.' },
  expired: { label: 'Expired', detail: 'Nobody decided in time, so nothing ran.', nextStep: 'Ask again if it is still needed; a new request is required.' },
  running: { label: 'Running', detail: 'It was approved and is running now, exactly once.', nextStep: 'Wait for the result.' },
  succeeded: { label: 'Done', detail: 'It ran once and the result is in the chat.', nextStep: 'Nothing to do.' },
  'outcome-unknown': { label: 'Outcome unknown', detail: 'It may or may not have happened. It will never run again by itself.', nextStep: 'Check the other service before asking again.' },
};
