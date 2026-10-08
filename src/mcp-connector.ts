import * as v from 'valibot';

export type McpConnectorEnv = {
  MCP_CONNECTOR_ID?: string;
  MCP_CONNECTOR_NAME?: string;
  MCP_SERVER_URL?: string;
  MCP_OAUTH_RESOURCE?: string;
  MCP_OAUTH_AUTHORIZE_URL?: string;
  MCP_OAUTH_TOKEN_URL?: string;
  MCP_OAUTH_REGISTRATION_URL?: string;
};

export type McpConnector = {
  id: string;
  name: string;
  serverUrl: string;
};

export type McpOAuthEndpoints = {
  authorize: string;
  token: string;
  registration: string;
  resource: string;
};

const connectorIdPattern = /^[a-z0-9][a-z0-9-]{0,39}$/;

function httpsUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1' ? url.href : null;
  } catch {
    return null;
  }
}

export function mcpConnector(env: McpConnectorEnv): McpConnector | null {
  const serverUrl = httpsUrl(env.MCP_SERVER_URL);
  if (!serverUrl) return null;
  const id = env.MCP_CONNECTOR_ID?.trim() || 'mcp';
  if (!connectorIdPattern.test(id)) return null;
  return { id, name: env.MCP_CONNECTOR_NAME?.trim() || new URL(serverUrl).hostname, serverUrl };
}

const ProtectedResourceMetadata = v.object({
  resource: v.optional(v.string()),
  authorization_servers: v.pipe(v.array(v.string()), v.minLength(1)),
});

const AuthorizationServerMetadata = v.object({
  authorization_endpoint: v.string(),
  token_endpoint: v.string(),
  registration_endpoint: v.optional(v.string()),
});

async function fetchMetadata<TSchema extends v.GenericSchema>(url: string, schema: TSchema): Promise<v.InferOutput<TSchema> | null> {
  const response = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(8_000) }).catch(() => null);
  if (!response?.ok) return null;
  const parsed = v.safeParse(schema, await response.json().catch(() => null));
  return parsed.success ? parsed.output : null;
}

function wellKnown(base: string, name: string): string[] {
  const url = new URL(base);
  const path = url.pathname.replace(/\/$/, '');
  const candidates = [`${url.origin}/.well-known/${name}${path}`, `${url.origin}/.well-known/${name}`];
  return path ? candidates : [candidates[1]];
}

async function firstMetadata<TSchema extends v.GenericSchema>(urls: string[], schema: TSchema): Promise<v.InferOutput<TSchema> | null> {
  for (const url of urls) {
    const metadata = await fetchMetadata(url, schema);
    if (metadata) return metadata;
  }
  return null;
}

export async function discoverOAuthEndpoints(env: McpConnectorEnv, connector: McpConnector): Promise<McpOAuthEndpoints> {
  const configured = {
    authorize: httpsUrl(env.MCP_OAUTH_AUTHORIZE_URL),
    token: httpsUrl(env.MCP_OAUTH_TOKEN_URL),
    registration: httpsUrl(env.MCP_OAUTH_REGISTRATION_URL),
    resource: httpsUrl(env.MCP_OAUTH_RESOURCE),
  };
  if (configured.authorize && configured.token && configured.registration) {
    return { authorize: configured.authorize, token: configured.token, registration: configured.registration, resource: configured.resource ?? connector.serverUrl };
  }
  const resourceMetadata = await firstMetadata(wellKnown(connector.serverUrl, 'oauth-protected-resource'), ProtectedResourceMetadata);
  if (!resourceMetadata) throw new Error(`${connector.name} does not publish OAuth protected resource metadata`);
  const issuer = resourceMetadata.authorization_servers[0];
  const serverMetadata = await firstMetadata(
    [...wellKnown(issuer, 'oauth-authorization-server'), ...wellKnown(issuer, 'openid-configuration')],
    AuthorizationServerMetadata,
  );
  if (!serverMetadata?.registration_endpoint) throw new Error(`${connector.name} does not support dynamic client registration`);
  return {
    authorize: serverMetadata.authorization_endpoint,
    token: serverMetadata.token_endpoint,
    registration: serverMetadata.registration_endpoint,
    resource: configured.resource ?? resourceMetadata.resource ?? connector.serverUrl,
  };
}
