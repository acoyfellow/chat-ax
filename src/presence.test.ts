import { describe, expect, test } from 'bun:test';
import { activeParticipants, maximumTrackedParticipants, touchParticipant } from './presence';

const now = Date.parse('2026-09-02T15:00:00.000Z');

describe('room presence', () => {
  test('replaces an existing heartbeat and removes stale participants', () => {
    const participants = touchParticipant(
      [
        {
          id: 'jordan',
          name: 'Old name',
          lastSeenAt: new Date(now - 1_000).toISOString(),
        },
        {
          id: 'stale',
          name: 'Stale person',
          lastSeenAt: new Date(now - 60_000).toISOString(),
        },
      ],
      { id: 'jordan', name: 'Jordan Coeyman', avatarSeed: 'jordan-avatar' },
      now,
    );

    expect(participants).toEqual([
      {
        id: 'jordan',
        name: 'Jordan Coeyman',
        avatarSeed: 'jordan-avatar',
        lastSeenAt: new Date(now).toISOString(),
      },
    ]);
  });

  test('bounds a busy room while keeping the newest people', () => {
    const participants = Array.from({ length: maximumTrackedParticipants + 12 }, (_, index) => ({
      id: `person-${index}`,
      name: `Person ${index}`,
      lastSeenAt: new Date(now - index).toISOString(),
    }));

    const active = activeParticipants(participants, now);
    expect(active).toHaveLength(maximumTrackedParticipants);
    expect(active[0]?.id).toBe('person-0');
    expect(active.at(-1)?.id).toBe(`person-${maximumTrackedParticipants - 1}`);
  });
});
