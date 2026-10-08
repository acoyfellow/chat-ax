import { connectorAccessToken } from './connector-token';
import type { ConnectorVaultDO } from './connector-vault';
import { type McpConnectorEnv, mcpConnector } from './mcp-connector';

export type McpToolDescriptor = {
  name: string;
  description: string;
};

type McpJson = {
  result?: {
    tools?: Array<{ name?: string; description?: string }>;
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  error?: { message?: string };
};

function mcpUrl(env: McpConnectorEnv): string | null {
  return mcpConnector(env)?.serverUrl ?? null;
}

async function mcpRpc(
  url: string,
  token: string,
  method: string,
  params?: Record<string, unknown>,
  sessionId?: string,
): Promise<{ body: McpJson; sessionId?: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text.slice(0, 240) || `MCP ${method} failed: ${response.status}`);
  const payload = text.startsWith('event:') || text.startsWith('data:')
    ? text.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim()
    : text;
  if (!payload) throw new Error(`MCP ${method} returned no response`);
  try {
    return { body: JSON.parse(payload) as McpJson, sessionId: response.headers.get('mcp-session-id') ?? sessionId };
  } catch {
    throw new Error(payload.slice(0, 240) || `MCP ${method} failed`);
  }
}

async function mcpSession(url: string, token: string): Promise<string | undefined> {
  const initialized = await mcpRpc(url, token, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'chat-ax', version: '0.0.1' },
  });
  if (initialized.body.error?.message) throw new Error(initialized.body.error.message);
  if (!initialized.sessionId) return undefined;
  await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'mcp-session-id': initialized.sessionId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    signal: AbortSignal.timeout(8_000),
  });
  return initialized.sessionId;
}

export async function listSpeakerMcpTools(input: {
  namespace: DurableObjectNamespace<ConnectorVaultDO>;
  actorId: string;
  env: McpConnectorEnv;
}): Promise<McpToolDescriptor[]> {
  const url = mcpUrl(input.env);
  if (!url) return [];
  let token: string;
  try {
    token = await connectorAccessToken(input.namespace, input.actorId);
  } catch {
    return [];
  }
  const sessionId = await mcpSession(url, token);
  const { body } = await mcpRpc(url, token, 'tools/list', undefined, sessionId);
  if (body.error?.message) throw new Error(body.error.message);
  return (body.result?.tools ?? [])
    .filter((tool): tool is { name: string; description?: string } => typeof tool.name === 'string')
    .map((tool) => ({
      name: tool.name,
      description: tool.description?.trim() || `MCP tool ${tool.name}`,
    }));
}

export async function callSpeakerMcpTool(input: {
  namespace: DurableObjectNamespace<ConnectorVaultDO>;
  actorId: string;
  env: McpConnectorEnv;
  name: string;
  arguments?: Record<string, unknown>;
}): Promise<string> {
  const url = mcpUrl(input.env);
  if (!url) throw new Error('No MCP connector is configured');
  const token = await connectorAccessToken(input.namespace, input.actorId);
  const sessionId = await mcpSession(url, token);
  const { body } = await mcpRpc(url, token, 'tools/call', {
    name: input.name,
    arguments: input.arguments ?? {},
  }, sessionId);
  if (body.error?.message) throw new Error(body.error.message);
  const text = (body.result?.content ?? [])
    .filter((part) => part.type === 'text' && part.text)
    .map((part) => part.text)
    .join('\n');
  if (body.result?.isError) throw new Error(text || 'MCP tool failed');
  return text || 'MCP tool returned no text';
}
