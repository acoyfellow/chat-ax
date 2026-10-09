import type { PendingMcpAction } from './mcp-approval';

export type ApprovalDecision = 'approve' | 'deny';

export type ApprovalActor = { id: string; email: string; name: string };

export const approvalLifetimeMilliseconds = 15 * 60_000;

export async function argumentsDigest(argumentsJson: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(argumentsJson));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function canonicalArguments(argumentsJson: string | undefined): string {
  if (!argumentsJson?.trim()) return '{}';
  const parsed: unknown = JSON.parse(argumentsJson);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('Tool arguments must be a JSON object');
  return JSON.stringify(parsed);
}

export async function tamperRefusal(action: Pick<PendingMcpAction, 'argumentsJson' | 'argumentsDigest'>): Promise<string | null> {
  return action.argumentsDigest === (await argumentsDigest(action.argumentsJson)) ? null : 'The request changed after it was asked';
}

export function decisionRefusal(
  action: PendingMcpAction | undefined,
  actor: ApprovalActor,
  now: number,
): string | null {
  if (!action) return 'Approval not found';
  if (action.actorId !== actor.id || action.connectorOwnerEmail !== actor.email)
    return 'Only the connector owner can decide this request';
  if (action.status !== 'pending') return 'This request was already decided';
  if (action.expiresAt <= now) return 'This request expired';
  return null;
}

export function approvalArgumentsLine(argumentsJson: string): string {
  const shown = argumentsJson.length > 600 ? `${argumentsJson.slice(0, 600)}… (${argumentsJson.length} characters)` : argumentsJson;
  return `Exact arguments: ${shown}`;
}

export function approvalFingerprint(digest: string): string {
  return digest.slice(0, 12);
}

export function approvalLogLine(
  action: Pick<PendingMcpAction, 'requesterEmail' | 'connectorOwnerEmail' | 'toolName' | 'argumentsJson' | 'argumentsDigest'>,
  stage: 'requested' | 'approved' | 'denied' | 'ran' | 'failed',
  detail = '',
): string {
  const who = `${action.requesterEmail} → ${action.connectorOwnerEmail}'s connector · ${action.toolName}`;
  const exact = `${approvalArgumentsLine(action.argumentsJson)}\nFingerprint: ${approvalFingerprint(action.argumentsDigest)}`;
  if (stage === 'requested') return `🔐 Approval requested: ${who}. Nothing has run. Waiting for ${action.connectorOwnerEmail}.\n${exact}`;
  if (stage === 'approved') return `✅ Approved by ${action.connectorOwnerEmail}: ${who}. Running once, with exactly these arguments.\n${exact}`;
  if (stage === 'denied') return `⛔ Denied by ${action.connectorOwnerEmail}: ${who}. Nothing ran.\n${exact}`;
  if (stage === 'ran') return `🔐 Ran once as ${action.connectorOwnerEmail}: ${who}.\n${exact}${detail ? `\n\n${detail}` : ''}`;
  return `⚠️ ${who} did not complete.${detail ? ` ${detail}` : ''} This approval is spent; ask again if needed.\n${exact}`;
}
