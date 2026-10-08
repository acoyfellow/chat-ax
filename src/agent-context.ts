export type AgentContextId = string;

export type AgentContextRecord = {
  id: AgentContextId;
  threadId: string;
  parentId: string | null;
  kind: 'conversation' | 'subagent';
  settingsKey: string;
  messagesKey: string;
  skillsKey: string;
  filesKey: string;
  stateKey: string;
  workKey: string;
};

export function agentContextKey(threadId: string): string {
  return `agent-context:${threadId}`;
}

export function createAgentContext(threadId: string, parentId: string | null, kind: AgentContextRecord['kind'] = 'conversation'): AgentContextRecord {
  const id = agentContextKey(threadId);
  return {
    id,
    threadId,
    parentId,
    kind,
    settingsKey: `${id}:settings`,
    messagesKey: `${id}:messages`,
    skillsKey: `${id}:skills`,
    filesKey: `${id}:files`,
    stateKey: `${id}:state`,
    workKey: `${id}:work`,
  };
}
