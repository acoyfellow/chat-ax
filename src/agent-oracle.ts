export type AgentDelegation = {
  messageId: string;
  fromAgentId: string;
  toAgentId: string;
  roomId: string;
  taskId: string;
  payload: unknown;
  requestedCapabilities: string[];
  replyTo?: string;
  expiresAt: string;
};

export function validateDelegation(message: AgentDelegation, now = Date.now()): void {
  if (!message.messageId || !message.fromAgentId || !message.toAgentId || !message.roomId || !message.taskId) throw new Error('delegation identity is incomplete');
  if (message.fromAgentId === message.toAgentId) throw new Error('delegation target must differ from sender');
  if (!message.expiresAt || Date.parse(message.expiresAt) <= now) throw new Error('delegation expired');
  if (new Set(message.requestedCapabilities).size !== message.requestedCapabilities.length) throw new Error('delegation capabilities must be unique');
}
