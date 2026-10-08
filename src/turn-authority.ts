export type AuthorityMessage = {
  id: string;
  role: string;
  authorId: string;
  authorEmail?: string;
  authorName?: string;
  source?: string;
};

export function resolveTurnAuthority(messages: readonly AuthorityMessage[], operationId: string) {
  const matches = messages.filter((message) => message.id === operationId);
  if (matches.length !== 1) throw new Error('Turn authority is unavailable or ambiguous');
  const message = matches[0];
  if (
    message.role !== 'user' ||
    message.source !== 'person' ||
    !message.authorId ||
    !message.authorEmail
  ) {
    throw new Error('Personal connector access requires a verified person request');
  }
  return Object.freeze({
    operationId,
    actorId: message.authorId,
    actorEmail: message.authorEmail,
    actorName: message.authorName ?? message.authorEmail.split('@')[0],
  });
}
