import { chatModels, thinkingLevels } from '../chat-settings';
import type { PendingMcpAction } from '../mcp-approval';
import type { PersonRequest } from '../person-requests';
import type { RoomParticipant } from '../presence';
import type { ChatMessage, ChatToolActivity, RoomSnapshot } from '../room';
import { strategies, strategyCategories } from '../strategies';

const epoch = Date.parse('2026-10-09T15:00:00.000Z');
const at = (seconds: number) => new Date(epoch + seconds * 1_000).toISOString();
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const progress = (time: number, start: number, length: number) => clamp((time - start) / length);
const typed = (text: string, time: number, start: number, length: number) => text.slice(0, Math.ceil(progress(time, start, length) * text.length));

const people = {
  jordan: { id: 'dev-jordan@example.com', name: 'Jordan', email: 'jordan@example.com' },
  sam: { id: 'dev-sam@example.com', name: 'Sam', email: 'sam@example.com' },
  priya: { id: 'dev-priya@example.com', name: 'Priya', email: 'priya@example.com' },
};
const lead = { id: 'agent-lead', title: 'Lead', seed: 'chat-ax-lead' };

export const viewers = { sam: people.sam, jordan: people.jordan };

function person(who: keyof typeof people, id: string, text: string, seconds: number, status: ChatMessage['status'] = 'complete'): ChatMessage {
  const author = people[who];
  return { id, role: 'user', authorId: author.id, authorName: author.name, authorEmail: author.email, text, createdAt: at(seconds), status, source: 'person' };
}

function agent(id: string, replyTo: string, text: string, seconds: number, status: ChatMessage['status'] = 'complete', tools: ChatToolActivity[] = []): ChatMessage {
  return { id, role: 'assistant', authorId: 'agent', authorName: 'Lead', text, createdAt: at(seconds), status, replyTo, tools };
}

function approvals(id: string, text: string, seconds: number): ChatMessage {
  return { id, role: 'assistant', authorId: 'connector-approvals', authorName: 'Approvals', text, createdAt: at(seconds), status: 'complete', replyTo: `approval:${id}` };
}

function tool(id: string, name: string, seconds: number, done: boolean, argumentsText: string, result: string): ChatToolActivity {
  return { id, name, status: done ? 'complete' : 'running', startedAt: at(seconds), completedAt: done ? at(seconds + 0.4) : undefined, arguments: argumentsText, result: done ? result : undefined };
}

function online(time: number): RoomParticipant[] {
  return [people.jordan, people.sam, people.priya]
    .filter((participant, index) => time >= index * 0.5)
    .map((participant) => ({ ...participant, avatarSeed: participant.id, lastSeenAt: at(time) }));
}

const approvalId = 'approval-demo';
function approvalAction(time: number): PendingMcpAction {
  const status: PendingMcpAction['status'] = time >= 29.2 ? 'succeeded' : 'pending';
  return { id: approvalId, operationId: 'a-ask', actorId: people.jordan.id, requesterId: people.sam.id, requesterEmail: people.sam.email, connectorOwnerEmail: people.jordan.email, toolName: 'gitlab_approve_merge_request', argumentsJson: '{"project":"team/app","mr":42}', argumentsDigest: 'digest', resultVisibility: 'room', expiresAt: epoch + 900_000, status };
}

function approvalMessages(time: number): ChatMessage[] {
  if (time < 24.4) return [];
  const ask = person('sam', 'a-ask', 'Approve MR 42 with Jordan’s GitLab.', 24.4);
  const messages: ChatMessage[] = [ask];
  if (time >= 25.2) messages.push(agent('a-reply', ask.id, 'That’s Jordan’s connector, so I asked Jordan. Nothing runs until Jordan approves.', 25.2, 'complete', [tool('t-call', 'call_mcp', 25.2, true, '{\n  "name": "gitlab_approve_merge_request",\n  "connectorOwnerEmail": "jordan@example.com"\n}', 'Asked jordan@example.com to approve. Nothing has run.')]));
  if (time >= 25.6) messages.push(approvals(`mcp-requested:${approvalId}`, '🔐 Approval requested: sam@example.com → jordan@example.com’s connector · gitlab_approve_merge_request. Nothing has run.', 25.6));
  if (time >= 28.6) messages.push(approvals(`mcp-approved:${approvalId}`, '✅ Approved by jordan@example.com. Running once.', 28.6));
  if (time >= 29.2) messages.push(approvals(`mcp-ran:${approvalId}`, '🔐 Ran once as jordan@example.com · gitlab_approve_merge_request.\n\nteam/app!42 approved by Jordan.', 29.2));
  return messages;
}

function snapshot(time: number, messages: ChatMessage[], extras: Partial<RoomSnapshot> = {}): RoomSnapshot {
  const waiting = messages.filter((message) => message.role === 'user' && message.status === 'queued').length;
  const active = messages.some((message) => message.status === 'active') ? 1 : 0;
  return {
    messages,
    threadTree: { rootId: lead.id, nodes: [{ id: lead.id, parentId: null, kind: 'conversation', title: lead.title, avatarSeed: lead.seed, status: active ? 'active' : 'idle', createdAt: at(0), updatedAt: at(time) }] },
    work: [],
    mcpApprovals: [],
    active,
    waiting,
    settings: { strategyId: 'fifo', modelId: '@cf/zai-org/glm-5.3', thinkingLevel: 'medium', systemPrompt: 'You are the team’s shared agent.', agentAvatarSeed: lead.seed, version: 1, updatedAt: at(0) },
    strategies,
    strategyCategories,
    models: chatModels,
    thinkingLevels,
    files: [{ id: 'file-changelog', name: 'CHANGELOG.md', mime: 'text/markdown', bytes: 18_432, objectKey: 'demo', kind: 'text', createdAt: at(0), createdBy: 'agent' }],
    skills: [],
    tools: [
      { name: 'call_mcp', label: 'Call MCP tool', owner: 'room', description: 'Runs a connector tool as the person who sent the turn.' },
      { name: 'request_person', label: 'Ask a person', owner: 'room', description: 'Sends an approval request to another person.' },
      { name: 'send_agent_message', label: 'Message an agent', owner: 'room', description: 'Talks to a parent or child agent.' },
    ],
    agentState: [{ id: 'state-style', key: 'release-style', value: 'Short, plain, linked', createdAt: at(0), createdBy: 'agent', updatedAt: at(0), updatedBy: 'agent' }],
    jobs: [],
    personRequests: [] satisfies PersonRequest[],
    notifications: [],
    online: online(time),
    engine: 'pi',
    ...extras,
  };
}

export type ApprovalScene = { sam: RoomSnapshot; jordan: RoomSnapshot; notification: number; approvePressed: boolean };

export function approvalScene(time: number): ApprovalScene {
  const messages = approvalMessages(time);
  const approval = time >= 25.6 ? [approvalAction(time)] : [];
  const notification = time >= 25.8 ? [{ id: 'n-approval', title: 'Sam wants to use your connector', body: 'gitlab_approve_merge_request · approve or deny', href: `/?approval=${approvalId}`, createdAt: at(25.8), source: 'agent' as const, recipientEmail: people.jordan.email, approvalId, agentId: lead.id }] : [];
  return {
    sam: snapshot(time, messages, { mcpApprovals: approval }),
    jordan: snapshot(time, messages, { mcpApprovals: approval, notifications: notification }),
    notification: progress(time, 25.8, 0.4) * (1 - progress(time, 28.4, 0.3)),
    approvePressed: time >= 28.2 && time < 28.6,
  };
}
