import type { ChatMessage } from './room';

export function applyAgentCancellation(messages: ChatMessage[], operationId: string): ChatMessage[] {
  return messages.map((message) =>
    (message.id === operationId || message.id === `agent-${operationId}`) &&
    (message.status === 'queued' || message.status === 'active')
      ? {
          ...message,
          status: 'error' as const,
          ...(message.id === `agent-${operationId}` ? { text: 'Response cancelled.' } : {}),
        }
      : message,
  );
}
