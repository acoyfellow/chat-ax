export const privateAgentResourceNames = ['skills', 'files', 'state', 'jobs', 'work', 'tools'] as const;

export function agentFileObjectKey(agentId: string, fileId: string): string {
  if (!agentId || !fileId) throw new Error('agent and file identity are required');
  return `agents/${encodeURIComponent(agentId)}/files/${encodeURIComponent(fileId)}`;
}

export function recurringJobActorId(jobId: string): string {
  if (!jobId) throw new Error('job identity is required');
  return `job:${jobId}`;
}
