export const nativeAgentToolNames = [
  'list_state',
  'create_state',
  'update_state',
  'delete_state',
  'list_jobs',
  'create_job',
  'update_job',
  'pause_job',
  'resume_job',
  'delete_job',
  'list_skills',
  'read_skill',
  'create_skill',
  'update_skill',
  'delete_skill',
  'list_files',
  'read_file',
  'create_file',
  'delete_file',
  'read_settings',
  'update_settings',
  'list_work',
  'list_subagents',
  'send_subagent_test_message',
] as const;

export class SerialOperationLane {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release = () => {};
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export const nativeAgentCapabilityPrompt =
  "You have persistent resources scoped automatically to this agent: state, recurring jobs, skills, files, settings, and work. Use the native resource tools to inspect or manage them when asked. Authorized room participants may also manage room agents, but these resources are separate from connector MCP tools and hidden reasoning. Never claim they are unavailable merely because no connector MCP is connected. You can inspect direct subagents and send them a short test message when asked, but you cannot access a sibling agent's resources or arbitrary agents through these tools.";
