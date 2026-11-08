import { describe, expect, test } from 'bun:test';
import { type ApprovalEvent, type ApprovalStatus, approvalStatusMeaning, canApprovalMove, nextApprovalStatus, readApprovalStatus, terminalApprovalStatuses } from './approval-machine';

const statuses: ApprovalStatus[] = ['pending', 'denied', 'expired', 'running', 'succeeded', 'outcome-unknown'];
const events: ApprovalEvent[] = ['approve', 'deny', 'expire', 'ran', 'crashed'];

describe('approval state machine', () => {
  test('the happy path is pending, running, succeeded', () => {
    expect(nextApprovalStatus(nextApprovalStatus('pending', 'approve'), 'ran')).toBe('succeeded');
  });

  test('a crash while running is never retried', () => {
    expect(nextApprovalStatus('running', 'crashed')).toBe('outcome-unknown');
  });

  test('only a pending approval can be decided, and only once', () => {
    for (const status of statuses) {
      expect(canApprovalMove(status, 'approve')).toBe(status === 'pending');
      expect(canApprovalMove(status, 'deny')).toBe(status === 'pending');
    }
  });

  test('terminal statuses accept no event at all', () => {
    for (const status of terminalApprovalStatuses) for (const event of events) expect(canApprovalMove(status, event)).toBe(false);
  });

  test('an illegal move throws with a readable reason', () => {
    expect(() => nextApprovalStatus('succeeded', 'approve')).toThrow('An approval that is succeeded cannot approve');
  });

  test('a pending approval past its expiry reads as expired', () => {
    expect(readApprovalStatus('pending', 1_000, 2_000)).toBe('expired');
    expect(readApprovalStatus('pending', 3_000, 2_000)).toBe('pending');
  });

  test('old stored statuses map to the safe reading', () => {
    expect(readApprovalStatus('not-executed', 0, 1)).toBe('outcome-unknown');
    expect(readApprovalStatus('failed', 0, 1)).toBe('outcome-unknown');
    expect(readApprovalStatus('something-new', 0, 1)).toBe('outcome-unknown');
  });

  test('every status explains itself and says what to do next', () => {
    for (const status of statuses) {
      expect(approvalStatusMeaning[status].label.length).toBeGreaterThan(0);
      expect(approvalStatusMeaning[status].nextStep.length).toBeGreaterThan(0);
    }
  });
});
