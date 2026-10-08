import { describe, expect, test } from 'bun:test';
import {
  appendPersonRequest,
  applyPersonRequestAction,
  canViewPersonRequest,
  createPersonRequest,
  parseCreatePersonRequestInput,
  personRequestTaskStatus,
} from './person-requests';

const sam = { id: 'sam-sub', email: 'sam@example.com', name: 'Sam Example' };
const jordan = { id: 'jordan-sub', email: 'jordan@example.com', name: 'Jordan Example' };
const michelle = { id: 'michelle-sub', email: 'michelle@example.com', name: 'Michelle Example' };
const input = {
  recipientEmail: jordan.email,
  recipientName: jordan.name,
  title: 'Create an MR for ISSUE-123',
  details: 'Please create an MR for the agreed change.',
};

function pendingRequest() {
  return createPersonRequest(sam, input, new Date('2026-09-02T12:00:00.000Z'), 'request-1');
}

describe('person requests', () => {
  test('normalizes and validates creation input', () => {
    expect(
      parseCreatePersonRequestInput({
        ...input,
        recipientEmail: '  JORDAN@example.com ',
        title: '  Create the MR ',
      }),
    ).toEqual({ ...input, recipientEmail: jordan.email, title: 'Create the MR' });
    expect(() => parseCreatePersonRequestInput({ ...input, recipientEmail: 'Jordan' })).toThrow();
    const review = createPersonRequest(
      sam,
      parseCreatePersonRequestInput({
        ...input,
        kind: 'review',
        resourceUrl: 'https://example.com/review/1',
        initiatingMessageId: 'message-1',
        agentId: 'agent-1',
      }),
    );
    expect(review).toMatchObject({
      kind: 'review',
      resourceUrl: 'https://example.com/review/1',
      initiatingMessageId: 'message-1',
      agentId: 'agent-1',
    });
  });

  test('keeps requester and recipient authority separate', () => {
    const request = pendingRequest();
    expect(canViewPersonRequest(request, sam)).toBe(true);
    expect(canViewPersonRequest(request, jordan)).toBe(true);
    expect(canViewPersonRequest(request, michelle)).toBe(false);
    expect(() => applyPersonRequestAction(request, sam, 'accept', undefined)).toThrow();
    expect(() => applyPersonRequestAction(request, michelle, 'accept', undefined)).toThrow();
  });

  test('binds acceptance and completion to the verified recipient', () => {
    const accepted = applyPersonRequestAction(
      pendingRequest(),
      jordan,
      'accept',
      undefined,
      new Date('2026-09-02T12:01:00.000Z'),
    );
    expect(accepted.status).toBe('accepted');
    expect(accepted.recipientId).toBe(jordan.id);
    const completed = applyPersonRequestAction(
      accepted,
      jordan,
      'complete',
      'MR !42 is ready.',
      new Date('2026-09-02T12:02:00.000Z'),
    );
    expect(completed.status).toBe('completed');
    expect(completed.response).toBe('MR !42 is ready.');
  });

  test('lets only the requester cancel active work', () => {
    const request = pendingRequest();
    expect(() => applyPersonRequestAction(request, jordan, 'cancel', undefined)).toThrow();
    const cancelled = applyPersonRequestAction(request, sam, 'cancel', undefined);
    expect(cancelled.status).toBe('cancelled');
    expect(() => applyPersonRequestAction(cancelled, sam, 'cancel', undefined)).toThrow();
  });

  test('never evicts active work when the room reaches its bound', () => {
    const active = pendingRequest();
    expect(() => appendPersonRequest([active], { ...active, id: 'request-2' }, 1)).toThrow();
    const completed = applyPersonRequestAction(
      applyPersonRequestAction(active, jordan, 'accept', undefined),
      jordan,
      'complete',
      'Done',
    );
    expect(appendPersonRequest([completed], { ...active, id: 'request-2' }, 1)).toEqual([
      { ...active, id: 'request-2' },
    ]);
  });

  test('maps one durable record to actor-specific task status', () => {
    const request = pendingRequest();
    expect(personRequestTaskStatus(request, sam)).toBe('working');
    expect(personRequestTaskStatus(request, jordan)).toBe('input_required');
    const accepted = applyPersonRequestAction(request, jordan, 'accept', undefined);
    expect(personRequestTaskStatus(accepted, sam)).toBe('working');
    expect(personRequestTaskStatus(accepted, jordan)).toBe('working');
    const declined = applyPersonRequestAction(request, jordan, 'decline', 'Not mine.');
    expect(personRequestTaskStatus(declined, sam)).toBe('failed');
  });
});
