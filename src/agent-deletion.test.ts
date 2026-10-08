import { describe, expect, test } from 'bun:test';
import { type AgentDeletionPlan, runAgentDeletionProtocol } from './agent-deletion';

const plan: AgentDeletionPlan = {
  agentIds: ['child', 'grandchild'],
  objectKeys: ['agents/child/files/a', 'agents/grandchild/files/b'],
};

function fixture(initialFailure?: string) {
  let failAt = initialFailure;
  let durablePlan: AgentDeletionPlan | undefined;
  let visibleAgentIds = [...plan.agentIds];
  const cleanedAgentIds: string[] = [];
  let collectionCount = 0;
  const hit = (phase: string) => {
    if (failAt === phase) throw new Error(phase);
  };
  const run = () =>
    runAgentDeletionProtocol({
      async loadPlan() {
        return durablePlan;
      },
      async collect() {
        collectionCount += 1;
        hit('collect');
        return plan;
      },
      async commit(value) {
        hit('commit');
        visibleAgentIds = [];
        durablePlan = value;
      },
      async cleanup(value) {
        for (const agentId of value.agentIds) {
          if (agentId === 'grandchild') hit('second-descendant');
          if (!cleanedAgentIds.includes(agentId)) cleanedAgentIds.push(agentId);
        }
        hit('cleanup');
      },
      async complete() {
        hit('complete');
        durablePlan = undefined;
      },
    });
  return {
    run,
    state: () => ({ durablePlan, visibleAgentIds, cleanedAgentIds, collectionCount }),
    retry: () => {
      failAt = undefined;
      return run();
    },
  };
}

describe('agent deletion protocol', () => {
  test.each(['collect', 'commit'] as const)(
    'does not remove topology when %s fails',
    async (phase) => {
      const value = fixture(phase);
      await expect(value.run()).rejects.toThrow(phase);
      expect(value.state().visibleAgentIds).toEqual(plan.agentIds);
      await value.retry();
      expect(value.state().visibleAgentIds).toEqual([]);
    },
  );

  test.each(['second-descendant', 'cleanup', 'complete'] as const)(
    'keeps topology absent and original plan retryable when %s fails',
    async (phase) => {
      const value = fixture(phase);
      await expect(value.run()).rejects.toThrow(phase);
      expect(value.state().visibleAgentIds).toEqual([]);
      expect(value.state().durablePlan).toEqual(plan);
      expect(value.state().collectionCount).toBe(1);
      await value.retry();
      expect(value.state()).toEqual({
        durablePlan: undefined,
        visibleAgentIds: [],
        cleanedAgentIds: plan.agentIds,
        collectionCount: 1,
      });
    },
  );
});
