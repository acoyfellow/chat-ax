import { describe, expect, test } from 'bun:test';
import { callOrchestratorTool, type FleetAgent, type FleetStore } from './orchestrator-mcp';

function storeFixture(): FleetStore {
  const agents: FleetAgent[] = [{ id: 'root', parentId: null, title: 'Agent A', avatarSeed: 'root' }];
  const contexts = new Map<string, unknown>();
  return {
    async list() { return agents; },
    async create(parentId) { const agent = { id: `agent-${agents.length}`, parentId, title: `Agent ${String.fromCharCode(65 + agents.length)}`, avatarSeed: `seed-${agents.length}` }; agents.push(agent); return agent; },
    async rename(id, title) { const agent = agents.find((item) => item.id === id); if (!agent) throw new Error('missing agent'); agent.title = title; return agent; },
    async delete(id) { const index = agents.findIndex((item) => item.id === id); if (index >= 0) agents.splice(index, 1); },
    async context(id) { return contexts.get(id) ?? {}; },
    async updateContext(id, context) { contexts.set(id, context); },
  };
}

describe('orchestrator MCP', () => {
  test('performs agent CRUD and context operations without cmux', async () => {
    const store = storeFixture();
    const created = await callOrchestratorTool('create_agent', { parentId: 'root' }, store) as { agent: FleetAgent };
    await callOrchestratorTool('rename_agent', { agentId: created.agent.id, title: 'Researcher' }, store);
    await callOrchestratorTool('update_agent_context', { agentId: created.agent.id, context: { marker: 'child' } }, store);
    expect(await callOrchestratorTool('get_agent_context', { agentId: created.agent.id }, store)).toEqual({ agentId: created.agent.id, context: { marker: 'child' } });
    expect((await callOrchestratorTool('list_agents', {}, store) as { agents: FleetAgent[] }).agents).toHaveLength(2);
    await callOrchestratorTool('delete_agent', { agentId: created.agent.id }, store);
    expect((await callOrchestratorTool('list_agents', {}, store) as { agents: FleetAgent[] }).agents).toHaveLength(1);
  });

  test('requires explicit cross-agent delegation', async () => {
    const store = storeFixture();
    await expect(callOrchestratorTool('delegate_to_agent', { message: { messageId: 'm1', fromAgentId: 'root', toAgentId: 'child', roomId: 'room', taskId: 'task', payload: {}, requestedCapabilities: [], expiresAt: new Date(Date.now() + 10_000).toISOString() } }, store)).resolves.toEqual({ accepted: true, messageId: 'm1' });
  });
});
