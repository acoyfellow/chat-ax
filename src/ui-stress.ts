import type { RoomParticipant } from './presence';
import type { ChatMessage } from './room';
import type { StrategyId } from './strategies';

export type UiStressFixture = {
  messages: ChatMessage[];
  online: RoomParticipant[];
};

const participantNames = ['Jordan Coeyman', 'Sam Rivera', 'Alex Chen', 'Priya Shah', 'Morgan Lee'];

function participantId(index: number): string {
  return `stress-person-${index + 1}`;
}

export function createUiStressFixture(
  strategyIds: StrategyId[],
  count = 500,
  now = Date.now(),
  viewer?: Pick<RoomParticipant, 'id' | 'name' | 'avatarUrl'>,
): UiStressFixture {
  if (strategyIds.length === 0) throw new Error('UI stress fixture requires strategies');
  const participants: Array<Pick<RoomParticipant, 'id' | 'name' | 'avatarUrl'>> =
    participantNames.map((name, index) => ({
      id: participantId(index),
      name,
    }));
  if (viewer) participants[0] = viewer;
  const messages: ChatMessage[] = [];
  let latestUserId = '';
  for (let index = 0; index < count; index += 1) {
    const strategyId = strategyIds[index % strategyIds.length];
    const createdAt = new Date(now - (count - index) * 2_000).toISOString();
    if (index % 2 === 0) {
      const participantIndex = (index / 2) % participants.length;
      const participant = participants[participantIndex];
      latestUserId = `stress-message-${index}`;
      messages.push({
        id: latestUserId,
        role: 'user',
        authorId: participant.id,
        authorName: participant.name,
        authorEmail: `${participant.id}@example.com`,
        avatarUrl: participant.avatarUrl,
        text: `Fixture request ${index + 1}: compare queue behavior for **${strategyId}** with ${(index % 7) + 1} waiting turns.`,
        createdAt,
        status: 'complete',
        strategyId,
        source: 'person',
        attachmentIds: [],
      });
      continue;
    }
    const detailed = index % 20 === 1;
    messages.push({
      id: `stress-message-${index}`,
      role: 'assistant',
      authorId: 'agent',
      authorName: 'Agent',
      text: detailed
        ? `## ${strategyId}\n\n- Processed turn ${index + 1}\n- Preserved participant fairness\n- Queue depth: \`${index % 17}\`\n\n| Metric | Value |\n|---|---:|\n| Latency | ${120 + index} ms |\n| Batch | ${(index % 8) + 1} |`
        : `Processed fixture turn ${index + 1} using **${strategyId}**. The response remains readable while the transcript contains hundreds of messages.`,
      createdAt,
      status: 'complete',
      strategyId,
      replyTo: latestUserId,
      reasoning: detailed
        ? `Evaluating ${strategyId}, participant order, queue pressure, and transcript rendering.`
        : undefined,
      tools: detailed
        ? [
            {
              id: `stress-tool-${index}`,
              name: 'fixture_queue_measurement',
              status: 'complete',
              startedAt: new Date(new Date(createdAt).getTime() - 420).toISOString(),
              completedAt: createdAt,
            },
          ]
        : undefined,
    });
  }

  const online = participants.map((participant, index) => ({
    ...participant,
    lastSeenAt: new Date(now - index * 1_000).toISOString(),
  }));
  return { messages, online };
}
