export type GatedAgentTool = 'delete_file' | 'request_person';

export type GateInput = {
  toolName: string;
  speakerId: string;
  fileCreatedBy?: string;
};

export function gateReason(input: GateInput): string | null {
  if (input.toolName === 'request_person') return 'it notifies another person on your behalf';
  if (input.toolName === 'delete_file' && input.fileCreatedBy !== undefined && input.fileCreatedBy !== input.speakerId)
    return 'the file was created by someone else';
  return null;
}

export function heldToolMessage(toolName: string, reason: string): string {
  return `Held for your approval: ${toolName}, because ${reason}. Nothing has happened yet. Approve or deny it in the chat; it runs once, exactly as shown.`;
}

export function isGatedAgentTool(name: string): name is GatedAgentTool {
  return name === 'delete_file' || name === 'request_person';
}
