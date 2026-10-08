export type RoomParticipant = {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  avatarSeed?: string;
  lastSeenAt: string;
};

export const presenceLifetimeMs = 45_000;
export const maximumTrackedParticipants = 100;
export const maximumVisibleParticipants = 5;

export function activeParticipants(
  participants: RoomParticipant[],
  now = Date.now(),
): RoomParticipant[] {
  return participants
    .filter((participant) => now - new Date(participant.lastSeenAt).getTime() < presenceLifetimeMs)
    .sort(
      (left, right) => new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime(),
    )
    .slice(0, maximumTrackedParticipants);
}

export function touchParticipant(
  participants: RoomParticipant[],
  participant: Omit<RoomParticipant, 'lastSeenAt'>,
  now = Date.now(),
): RoomParticipant[] {
  return activeParticipants(
    [
      ...participants.filter((candidate) => candidate.id !== participant.id),
      { ...participant, lastSeenAt: new Date(now).toISOString() },
    ],
    now,
  );
}
