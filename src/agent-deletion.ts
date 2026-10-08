export type AgentDeletionPlan = { agentIds: string[]; objectKeys: string[] };

export async function runAgentDeletionProtocol(input: {
  loadPlan(): Promise<AgentDeletionPlan | undefined>;
  collect(): Promise<AgentDeletionPlan>;
  commit(plan: AgentDeletionPlan): Promise<void>;
  cleanup(plan: AgentDeletionPlan): Promise<void>;
  complete(plan: AgentDeletionPlan): Promise<void>;
}): Promise<void> {
  let plan = await input.loadPlan();
  if (!plan) {
    plan = await input.collect();
    await input.commit(plan);
  }
  await input.cleanup(plan);
  await input.complete(plan);
}
