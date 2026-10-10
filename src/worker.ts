import { mcpConnector } from './mcp-connector';
import { Hono, type MiddlewareHandler } from 'hono';
import { attachSvelteRoutes, svelteRenderer } from 'svelte-hono';
import * as v from 'valibot';
import {
  type AgentCapabilityClaims,
  agentDigest,
  agentPublicKeyDigest,
  encryptAgentHandoff,
  mintAgentCapability,
  verifyAgentCapability,
  verifyAgentProof,
} from './agent-capability';
import type { AgentDO } from './agent-do';
import { agentObjectName } from './agent-identity';
import { agentFileObjectKey } from './agent-private-resources';
import { type AccessIdentity, accessMiddleware, configuredAccessApplication, isLocalDevBypassAllowed } from './auth';
import { setupPage } from './setup-page';
import { isWebSocketUpgrade } from './live-socket';
import { bundles } from './bundles.generated';
import { crossUserProbe } from './capability-executor';
import { type ConnectorVaultDO, connectorVault } from './connector-vault';
import { accessIssuer, accessOAuthMetadata, canReadDiagnostics, isAdmin } from './deployment-config';
import { type PersonRequestStore, handleMcpRequest, mcpRequestSchema } from './mcp';
import type { FleetAgent, FleetStore } from './orchestrator-mcp';
import type { PersonRequestActor } from './person-requests';
import { type UniversalMcpStore, universalMcpTool } from './universal-mcp';
import { pwaAssets, pwaHead, pwaManifest } from './pwa';
import { readBoundedJson, readBoundedText } from './safe-json';
import type { ChatRoomDO, RoomEnv, RoomSnapshot } from './room';
import {
  type SharedFile,
  fileKind,
  maximumFileBytes,
  maximumTextFileBytes,
} from './shared-features';
import { pathTo } from './thread-tree';
import { isProductionProofActor, verifiedActorId } from './production-proof';
import { verifyReadinessProof } from './readiness-proof';
import { readinessStatus } from './readiness';
import { createUiStressFixture } from './ui-stress';
import AvatarLab from './ui/AvatarLab.svelte';
import Chat from './ui/Chat.svelte';
import StyleLab from './ui/StyleLab.svelte';
import MotionHeaderPage from './ui/MotionHeaderPage.svelte';

interface Env extends RoomEnv {
  AI: Ai;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_ISS?: string;
  ENVIRONMENT?: string;
  DEV_USER_EMAIL?: string;
  DEV_USER_NAME?: string;
  DEV_USER_GROUPS?: string;
  MINIFLARE?: string;
  ROOM: DurableObjectNamespace<ChatRoomDO>;
  CONNECTOR_VAULT: DurableObjectNamespace<ConnectorVaultDO>;
  AGENT: DurableObjectNamespace<AgentDO>;
  MASTER_KEY?: string;
  MCP_CONNECTOR_ID?: string;
  MCP_CONNECTOR_NAME?: string;
  MCP_SERVER_URL?: string;
  MCP_OAUTH_RESOURCE?: string;
  MCP_OAUTH_AUTHORIZE_URL?: string;
  MCP_OAUTH_TOKEN_URL?: string;
  MCP_OAUTH_REGISTRATION_URL?: string;
  ADMIN_EMAILS?: string;
  AI_GATEWAY_ID?: string;
  WORKER_NAME?: string;
  MCP_CAPABILITY_SECRET?: string;
  AGENT_CAPABILITY_HOST?: string;
  AUTHORITY_RELEASE?: string;
  BUILD_ID?: string;
  PRODUCTION_PROOF_ACTOR?: string;
}

type Context = {
  Bindings: Env;
  Variables: { identity: AccessIdentity; agentCapability?: AgentCapabilityClaims };
};


const renderWithoutFallthrough = async () => {};

const app = new Hono<Context>();
const svelteBundleRoutes = new Hono();
attachSvelteRoutes(svelteBundleRoutes, { bundles });
app.route('/', svelteBundleRoutes);

app.get('/.well-known/oauth-protected-resource/mcp', (context) => {
  const issuer = accessIssuer(context.env);
  if (!issuer) return context.json({ error: 'not found' }, 404);
  return context.json({
    resource: `${new URL(context.req.url).origin}/mcp`,
    authorization_servers: [issuer],
    scopes_supported: ['openid', 'email', 'profile'],
    resource_name: 'Chat AX',
  });
});

app.get('/.well-known/oauth-authorization-server', (context) => {
  const issuer = accessIssuer(context.env);
  if (!issuer) return context.json({ error: 'not found' }, 404);
  return context.json(accessOAuthMetadata(issuer));
});

const publicAgentEndpointMiddleware: MiddlewareHandler<Context> = async (context, next) => {
  if (
    !context.env.AGENT_CAPABILITY_HOST ||
    new URL(context.req.url).hostname !== context.env.AGENT_CAPABILITY_HOST
  )
    return context.json({ error: 'not found' }, 404);
  context.set('identity', {
    sub: 'agent-capability-bootstrap',
    email: 'agent-bootstrap@chat.ax.invalid',
  });
  await next();
};

app.get('/api/production-readiness', async (context) => {
  const readiness = readinessStatus(context.env);
  return context.json(readiness, readiness.status === 'ready' ? 200 : 503);
});

app.use('/api/agent-capability/status', publicAgentEndpointMiddleware);
app.use('/api/agent-capability/session', publicAgentEndpointMiddleware);
app.use('/api/agent-capability/handoff/*', publicAgentEndpointMiddleware);

const agentAuthorityMiddleware: MiddlewareHandler<Context> = async (context, next) => {
  const token = context.req.header('x-agent-capability');
  if (!token) {
    await next();
    return;
  }
  const secret = await agentCapabilitySecret(context.env);
  if (!secret || (context.env.ENVIRONMENT !== 'dev' && !context.env.CF_ACCESS_ISS))
    return context.json({ error: 'Agent capabilities are unavailable' }, 503);
  try {
    const raw = context.req.method === 'GET' ? '' : await readBoundedText(context.req.raw.clone());
    const claims = await verifyAgentCapability(
      token,
      secret,
      async (jti) => {
        const response = await room(context.env).fetch(
          `https://room/agent-capability/revoked/${encodeURIComponent(jti)}`,
        );
        return response.status === 200;
      },
      Date.now(),
      context.env.CF_ACCESS_ISS,
    );
    await verifyAgentProof(context.req.raw, raw, token, claims);
    if (
      claims.room !== 'main' ||
      (context.req.path !== '/api/agent-capability/revoke' &&
        claims.requestDigest !== (await agentDigest(raw)))
    )
      throw new Error('Agent capability scope mismatch');
    context.set('agentCapability', claims);
    context.set('identity', {
      sub: claims.sub,
      email: 'agent@chat.ax.invalid',
      name: claims.agent,
    });
    await next();
  } catch {
    return context.json({ error: 'Invalid agent authority' }, 401);
  }
};

app.use('/mcp', agentAuthorityMiddleware);
app.use('/api/fleet/events', agentAuthorityMiddleware);
app.use('/api/agent-capability/revoke', agentAuthorityMiddleware);
app.use('*', async (context, next) => {
  if (isLocalDevBypassAllowed(context.req.raw, context.env) || configuredAccessApplication(context.env)) {
    await next();
    return;
  }
  return context.html(setupPage(context.env.WORKER_NAME ?? 'chat-ax'), 503, { 'cache-control': 'no-store' });
});
app.use('*', accessMiddleware());

const coordinatorObjectName = 'agent-coordinator-v1';

async function agentCapabilitySecret(env: Env): Promise<string> {
  if (env.MCP_CAPABILITY_SECRET) return env.MCP_CAPABILITY_SECRET;
  const response = await room(env).fetch('https://room/deployment-secret/agent-capability');
  const body = await response.json<{ secret?: string }>();
  return body.secret ?? '';
}

function room(env: Env): DurableObjectStub<ChatRoomDO> {
  return env.ROOM.get(env.ROOM.idFromName(coordinatorObjectName));
}

app.post('/api/production-readiness/verify', async (context) => {
  try {
    const readiness = readinessStatus(context.env);
    const result = verifyReadinessProof(await readBoundedJson(context.req.raw), {
      release: readiness.release,
      build: readiness.build,
    });
    return context.json(result);
  } catch {
    return context.json({ valid: false }, 400);
  }
});

function viewerVault(env: Env, identity: AccessIdentity): DurableObjectStub<ConnectorVaultDO> {
  return connectorVault(env.CONNECTOR_VAULT, identity.sub);
}

function displayName(identity: AccessIdentity): string {
  if (identity.name) return identity.name;
  return identity.email
    .split('@')[0]
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

async function roomSnapshot(
  env: Env,
  identity: AccessIdentity,
  threadId?: string,
): Promise<RoomSnapshot> {
  const query = new URLSearchParams({
    actorId: identity.sub,
    actorEmail: identity.email,
    actorName: displayName(identity),
    ...(threadId ? { threadId } : {}),
  });
  let response = await room(env).fetch(`https://room/state?${query}`);
  if (response.status === 404 && threadId) {
    query.delete('threadId');
    response = await room(env).fetch(`https://room/state?${query}`);
  }
  if (!response.ok) throw new Error('Unable to load the shared room');
  return response.json<RoomSnapshot>();
}

function imageSignatureMatches(mime: string, bytes: Uint8Array): boolean {
  const startsWith = (signature: number[], offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte);
  if (mime === 'image/png') return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mime === 'image/jpeg') return startsWith([0xff, 0xd8, 0xff]);
  if (mime === 'image/gif') return startsWith([0x47, 0x49, 0x46, 0x38]);
  if (mime === 'image/webp')
    return startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8);
  return false;
}

async function forwardRoom(
  env: Env,
  path: string,
  method: string,
  body?: string,
): Promise<Response> {
  return room(env).fetch(`https://room${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body,
  });
}

function actorPayload(actor: PersonRequestActor) {
  return {
    actorId: actor.id,
    actorEmail: actor.email,
    actorName: actor.name,
  };
}

function personRequestStore(env: Env): PersonRequestStore {
  return {
    async create(actor, input) {
      const response = await forwardRoom(
        env,
        '/person-requests',
        'POST',
        JSON.stringify({ ...input, ...actorPayload(actor) }),
      );
      const body = await response.json<{
        request?: RoomSnapshot['personRequests'][number];
        error?: string;
      }>();
      if (!response.ok || !body.request) throw new Error(body.error ?? 'Unable to create request');
      return body.request;
    },
    async list(actor) {
      const query = new URLSearchParams(actorPayload(actor));
      const response = await forwardRoom(env, `/person-requests?${query}`, 'GET');
      const body = await response.json<{
        requests?: RoomSnapshot['personRequests'];
        error?: string;
      }>();
      if (!response.ok || !body.requests) throw new Error(body.error ?? 'Unable to list requests');
      return body.requests;
    },
    async get(actor, id) {
      const query = new URLSearchParams(actorPayload(actor));
      const response = await forwardRoom(
        env,
        `/person-requests/${encodeURIComponent(id)}?${query}`,
        'GET',
      );
      if (response.status === 404) return null;
      const body = await response.json<{
        request?: RoomSnapshot['personRequests'][number];
        error?: string;
      }>();
      if (!response.ok || !body.request) throw new Error(body.error ?? 'Unable to get request');
      return body.request;
    },
    async update(actor, id, action, responseText) {
      const response = await forwardRoom(
        env,
        `/person-requests/${encodeURIComponent(id)}/${action}`,
        'POST',
        JSON.stringify({ ...actorPayload(actor), response: responseText }),
      );
      const body = await response.json<{
        request?: RoomSnapshot['personRequests'][number];
        error?: string;
      }>();
      if (!response.ok || !body.request) throw new Error(body.error ?? 'Unable to update request');
      return body.request;
    },
  };
}

function fleetStore(
  env: Env,
  identity: AccessIdentity,
  capability?: AgentCapabilityClaims,
): FleetStore {
  const request = async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    const response = await forwardRoom(
      env,
      path,
      method,
      body === undefined ? undefined : JSON.stringify(body),
    );
    const value = await response.json<T & { error?: string }>();
    if (!response.ok) throw new Error(value.error ?? 'Fleet operation failed');
    return value;
  };
  return {
    async list() {
      return (await request<{ agents: FleetAgent[] }>('/fleet')).agents;
    },
    async create(parentId, requestedId, title) {
      return (
        await request<{ node: FleetAgent }>('/threads', 'POST', {
          parentId,
          id: requestedId,
          title,
        })
      ).node;
    },
    async rename(id, title) {
      return (await request<{ node: FleetAgent }>('/threads', 'PATCH', { id, title })).node;
    },
    async delete(id) {
      return request('/threads', 'DELETE', { id });
    },
    async context(id) {
      return (await request<{ context: unknown }>(`/agent-context/${encodeURIComponent(id)}`))
        .context;
    },
    async updateContext(id, context) {
      await request(`/agent-context/${encodeURIComponent(id)}`, 'PUT', context);
    },
    async sendMessage(fromAgentId, toAgentId, message) {
      if (capability && capability.agent !== fromAgentId)
        throw new Error('source agent scope mismatch');
      return request('/communications', 'POST', {
        fromAgentId,
        toAgentId,
        action: 'message',
        message,
      });
    },
    async transferFile(fromAgentId, toAgentId, fileId) {
      if (capability && capability.agent !== fromAgentId)
        throw new Error('source agent scope mismatch');
      return request('/communications', 'POST', { fromAgentId, toAgentId, action: 'file', fileId });
    },
    async inspectJob(fromAgentId, toAgentId, jobId) {
      if (capability && capability.agent !== fromAgentId)
        throw new Error('source agent scope mismatch');
      return request('/communications', 'POST', {
        fromAgentId,
        toAgentId,
        action: 'job-summary',
        jobId,
      });
    },
    async grantCommunication(fromAgentId, toAgentId, actions, expiresAt) {
      if (capability) throw new Error('people own communication grants');
      const response = await room(env).fetch('https://room/communication-grants', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-actor-id': identity.sub },
        body: JSON.stringify({ fromAgentId, toAgentId, actions, expiresAt }),
      });
      const value = await response.json<{ grant?: unknown; error?: string }>();
      if (!response.ok) throw new Error(value.error ?? 'Grant failed');
      return value;
    },
    async revokeCommunication(grantId) {
      if (capability) throw new Error('people own communication grants');
      const response = await room(env).fetch(
        `https://room/communication-grants/${encodeURIComponent(grantId)}/revoke`,
        { method: 'POST', headers: { 'x-actor-id': identity.sub } },
      );
      const value = await response.json<{ error?: string }>();
      if (!response.ok) throw new Error(value.error ?? 'Revoke failed');
      return value;
    },
  };
}

function universalMcpStore(env: Env): UniversalMcpStore {
  const request = async (path: string, method: string, body: unknown): Promise<unknown> => {
    const response = await forwardRoom(env, path, method, JSON.stringify(body));
    const raw = await readBoundedText(response.clone());
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error('Product operation returned an invalid response');
    }
    if (!response.ok) {
      const parsed = v.safeParse(v.object({ error: v.optional(v.string()) }), value);
      throw new Error(
        parsed.success
          ? (parsed.output.error ?? 'Product operation failed')
          : 'Product operation failed',
      );
    }
    return value;
  };
  const executionResultSchema = v.object({
    invocationId: v.string(),
    replayed: v.boolean(),
    receiptId: v.string(),
    result: v.unknown(),
  });
  return {
    read(uri, actor) {
      if (uri === 'chat-ax://proof/readiness') return Promise.resolve(readinessStatus(env));
      return request('/universal-mcp/read', 'POST', { uri, actor });
    },
    async execute(name, args, actor) {
      return v.parse(
        executionResultSchema,
        await request('/universal-mcp/execute', 'POST', { name, args, actor }),
      );
    },
  };
}


app.get('/api/fleet', async (context) => forwardRoom(context.env, '/fleet', 'GET'));

app.get('/api/deleted-agents', async (context) => {
  const query = new URL(context.req.url).search;
  return forwardRoom(context.env, `/deleted-agents${query}`, 'GET');
});

app.get('/api/fleet/operations', async (context) =>
  forwardRoom(context.env, '/fleet/operations', 'GET'),
);
app.get('/api/fleet/layout', async (context) => forwardRoom(context.env, '/fleet/layout', 'GET'));
app.put('/api/fleet/layout', async (context) =>
  forwardRoom(
    context.env,
    '/fleet/layout',
    'PUT',
    JSON.stringify(await readBoundedJson(context.req.raw)),
  ),
);

app.get('/api/fleet/events', async (context) => {
  if (!isWebSocketUpgrade(context.req.raw)) return context.json({ error: 'WebSocket upgrade required' }, 426);
  const capability = context.get('agentCapability');
  if (
    capability &&
    (capability.operation !== 'fleet.subscribe' || capability.agent !== context.req.query('agent'))
  )
    return context.json({ error: 'Agent subscription scope mismatch' }, 403);
  if (capability) {
    const claim = await room(context.env).fetch(
      `https://room/agent-capability/claim/${encodeURIComponent(capability.jti)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expiresAt: capability.exp }),
      },
    );
    if (!claim.ok) return context.json({ error: 'Agent capability already used' }, 409);
  }
  const query = new URLSearchParams({
    after: context.req.query('after') ?? '0',
    agent: capability?.agent ?? '*',
    ...(capability ? { expiresAt: String(capability.exp), capability: capability.jti } : {}),
  });
  return room(context.env).fetch(`https://room/fleet-events?${query}`, context.req.raw);
});

app.get('/api/agents/:agentId/live', async (context) => {
  if (!isWebSocketUpgrade(context.req.raw)) return context.json({ error: 'WebSocket upgrade required' }, 426);
  const agentId = context.req.param('agentId');
  const fleet = await room(context.env).fetch('https://room/fleet');
  const { agents } = await fleet.json<{ agents: Array<{ id: string }> }>();
  if (!agents.some((agent) => agent.id === agentId)) return context.json({ error: 'unknown agent' }, 404);
  const stub = context.env.AGENT.get(context.env.AGENT.idFromName(agentObjectName(agentId)));
  return stub.fetch('https://agent/live', context.req.raw);
});

app.get('/api/agent-mcp-receipts', async (context) => {
  const threadId = context.req.query('threadId');
  if (!threadId) return context.json({ error: 'threadId is required' }, 400);
  const response = await room(context.env).fetch(
    `https://room/agent-mcp-receipts/${encodeURIComponent(threadId)}`,
    { headers: { 'x-actor-id': verifiedActorId(context.get('identity')) } },
  );
  return new Response(response.body, response);
});

app.get('/api/dev/fleet-receipts', async (context) => {
  if (context.env.ENVIRONMENT !== 'dev') return context.json({ error: 'not found' }, 404);
  return forwardRoom(context.env, '/fleet-receipts', 'GET');
});

app.get('/api/dev/communication-events', async (context) => {
  if (context.env.ENVIRONMENT !== 'dev') return context.json({ error: 'not found' }, 404);
  return forwardRoom(context.env, '/communication-events', 'GET');
});

for (const path of ['lease', 'fault']) {
  app.post(`/api/production-proof/${path}`, async (context) => {
    const identity = context.get('identity');
    if (!isProductionProofActor(context.env.PRODUCTION_PROOF_ACTOR, identity.email))
      return context.json({ error: 'not found' }, 404);
    const input = v.parse(
      v.record(v.string(), v.unknown()),
      await readBoundedJson(context.req.raw),
    );
    return forwardRoom(
      context.env,
      `/production-proof/${path}`,
      'POST',
      JSON.stringify({ ...input, actorId: verifiedActorId(identity) }),
    );
  });
}

app.post('/api/dev/durable-proof/:agentId/:action', async (context) => {
  const hostname = new URL(context.req.url).hostname;
  if (context.env.ENVIRONMENT !== 'dev' || (hostname !== '127.0.0.1' && hostname !== 'localhost'))
    return context.json({ error: 'not found' }, 404);
  const action = context.req.param('action');
  if (action !== 'crash' && action !== 'transcript') return context.json({ error: 'not found' }, 404);
  const stub = context.env.AGENT.get(context.env.AGENT.idFromName(agentObjectName(context.req.param('agentId'))));
  return stub
    .fetch(`https://agent/dev/durable-proof/${action}`, { method: action === 'crash' ? 'POST' : 'GET' })
    .catch((error: unknown) => context.json({ crashed: true, detail: error instanceof Error ? error.message : 'aborted' }));
});

app.post('/api/dev/a2a-diagnostics', async (context) => {
  if (context.env.ENVIRONMENT !== 'dev') return context.json({ error: 'not found' }, 404);
  return forwardRoom(
    context.env,
    '/agent-cleanup-verification',
    'POST',
    JSON.stringify(await readBoundedJson(context.req.raw)),
  );
});

app.post('/api/dev/universal-mcp/fail-after-admission', async (context) => {
  const hostname = new URL(context.req.url).hostname;
  if (context.env.ENVIRONMENT !== 'dev' || (hostname !== '127.0.0.1' && hostname !== 'localhost'))
    return context.json({ error: 'not found' }, 404);
  const input = v.parse(
    v.object({ invocationId: v.pipe(v.string(), v.minLength(8), v.maxLength(200)) }),
    await readBoundedJson(context.req.raw),
  );
  return forwardRoom(
    context.env,
    '/dev/universal-mcp/fail-after-admission',
    'POST',
    JSON.stringify(input),
  );
});

app.post('/mcp', async (context) => {
  const rpc = v.parse(mcpRequestSchema, await readBoundedJson(context.req.raw));
  const capability = context.get('agentCapability');
  if (capability) {
    if (rpc.method === 'resources/list' || rpc.method === 'resources/read')
      return context.json({ error: 'Agent resource scope mismatch' }, 403);
    const tool = rpc.params?.name;
    const args = rpc.params?.arguments ?? {};
    if (rpc.method === 'tools/list')
      return context.json({ error: 'Agent tool enumeration is forbidden' }, 403);
    if (rpc.method === 'tools/call' && tool === 'list_agents')
      return context.json({ error: 'Agent fleet enumeration is forbidden' }, 403);
    const communicationTools = ['send_agent_message', 'transfer_agent_file', 'inspect_agent_job'];
    const isCommunication = typeof tool === 'string' && communicationTools.includes(tool);
    const isUniversal = typeof tool === 'string' && Boolean(universalMcpTool(tool));
    if (
      isUniversal
        ? capability.operation !== `product.${tool}`
        : isCommunication
          ? !['communication', 'fleet.write'].includes(capability.operation)
          : capability.operation !== 'fleet.write'
    )
      return context.json({ error: 'Agent operation scope mismatch' }, 403);
    const target = isCommunication
      ? args.fromAgentId
      : tool === 'create_agent'
        ? args.parentId
        : args.agentId;
    if (rpc.method === 'tools/call' && tool !== 'list_agents' && target !== capability.agent)
      return context.json({ error: 'Agent target scope mismatch' }, 403);
    if (rpc.method === 'tools/call') {
      const operationDigest = await agentDigest(JSON.stringify(rpc));
      const claim = await room(context.env).fetch(
        `https://room/agent-capability/claim/${encodeURIComponent(capability.jti)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expiresAt: capability.exp, operationDigest }),
        },
      );
      const claimState: { claimed: boolean; result?: { status: number; body: string; contentType: string } } =
        await claim
          .json<{
            claimed: boolean;
            result?: { status: number; body: string; contentType: string };
          }>()
          .catch(() => ({ claimed: false }));
      if (claimState.result)
        return new Response(claimState.result.body, {
          status: claimState.result.status,
          headers: { 'content-type': claimState.result.contentType },
        });
      if (!claim.ok || !claimState.claimed)
        return context.json({ error: 'Agent capability already used' }, 409);
    }
  }
  const response = await handleMcpRequest(
    rpc,
    context.get('identity'),
    personRequestStore(context.env),
    fleetStore(context.env, context.get('identity'), capability),
    universalMcpStore(context.env),
  );
  if (capability && rpc.method === 'tools/call') {
    const body = await readBoundedText(response.clone());
    await room(context.env).fetch(
      `https://room/agent-capability/complete/${encodeURIComponent(capability.jti)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: response.status,
          body,
          contentType: response.headers.get('content-type') ?? 'application/json',
        }),
      },
    );
  }
  return response;
});

app.post('/api/agent-capability/revoke', async (context) => {
  const capability = context.get('agentCapability');
  if (!capability) return context.json({ error: 'Agent capability required' }, 401);
  const response = await room(context.env).fetch(
    `https://room/agent-capability/revoke/${encodeURIComponent(capability.jti)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expiresAt: capability.exp }),
    },
  );
  return new Response(response.body, { status: response.status, headers: response.headers });
});

app.get('/api/agent-capability/status', (context) =>
  context.json({ release: context.env.AUTHORITY_RELEASE ?? null }),
);

app.post('/api/agent-capability/session', async (context) => {
  const body = await readBoundedText(context.req.raw);
  const response = await forwardRoom(context.env, '/agent-capability/sessions', 'POST', body);
  if (!response.ok)
    return new Response(response.body, { status: response.status, headers: response.headers });
  const input = JSON.parse(body) as { sessionId: string };
  const authorizeUrl = new URL(context.req.url);
  authorizeUrl.hostname = (context.env.AGENT_CAPABILITY_HOST ?? authorizeUrl.hostname).replace(/^agent\./, '');
  authorizeUrl.pathname = '/api/agent-capability/authorize';
  authorizeUrl.search = `?session=${encodeURIComponent(input.sessionId)}`;
  return context.json({ accepted: true, authorizeUrl: authorizeUrl.href });
});

app.get('/api/agent-capability/handoff/:sessionId', async (context) => {
  return forwardRoom(
    context.env,
    `/agent-capability/handoff/${encodeURIComponent(context.req.param('sessionId'))}`,
    'GET',
  );
});

app.get('/api/agent-capability/authorize', async (context) => {
  const sessionId = context.req.query('session') ?? '';
  if (!/^[A-Za-z0-9_-]{32,80}$/.test(sessionId)) return context.text('Invalid session', 400);
  return context.html(
    `<!doctype html><meta charset="utf-8"><title>Authorize Chat AX agent</title><button id="authorize">Authorize temporary agent</button><pre id="status">Ready</pre><script>document.querySelector('#authorize').onclick=()=>{const status=document.querySelector('#status');status.textContent='Authorizing';const request=new XMLHttpRequest();request.open('POST','/api/agent-capability/authorize');request.setRequestHeader('content-type','application/json');request.onload=()=>{status.textContent=request.status===200?'Authorized':'Failed '+request.status};request.onerror=()=>{status.textContent='Failed to load'};request.send(JSON.stringify({sessionId:${JSON.stringify(sessionId)}}))}</script>`,
  );
});

app.post('/api/agent-capability/authorize', async (context) => {
  const secret = await agentCapabilitySecret(context.env);
  if (!secret) return context.json({ error: 'Agent capabilities are unavailable' }, 503);
  const input = (await readBoundedJson(context.req.raw)) as { sessionId?: string };
  if (!/^[A-Za-z0-9_-]{32,80}$/.test(input.sessionId ?? ''))
    return context.json({ error: 'Invalid session' }, 400);
  const sessionResponse = await forwardRoom(
    context.env,
    `/agent-capability/session/${encodeURIComponent(input.sessionId!)}`,
    'GET',
  );
  if (!sessionResponse.ok) return context.json({ error: 'Session unavailable' }, 404);
  const { session } = await sessionResponse.json<{
    session: { publicKey: JsonWebKey; handoffKey: JsonWebKey; smokeAgentId: string };
  }>();
  const fleet = await fleetStore(context.env, context.get('identity')).list();
  const root = fleet.find((agent) => agent.parentId === null);
  if (!root) return context.json({ error: 'Root agent unavailable' }, 409);
  const listRaw = JSON.stringify({
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method: 'tools/call',
    params: { name: 'list_agents', arguments: {} },
  });
  const createRaw = JSON.stringify({
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method: 'tools/call',
    params: {
      name: 'create_agent',
      arguments: { parentId: root.id, agentId: session.smokeAgentId, title: session.smokeAgentId },
    },
  });
  const deleteRaw = JSON.stringify({
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method: 'tools/call',
    params: { name: 'delete_agent', arguments: { agentId: session.smokeAgentId } },
  });
  const now = Date.now();
  const mint = async (operation: string, agent: string, raw: string, ttlMs = 60_000) => {
    const claims: AgentCapabilityClaims = {
      iss: context.env.CF_ACCESS_ISS ?? new URL(context.req.url).origin,
      sub: context.get('identity').sub,
      aud: 'chat-ax-agent',
      room: 'main',
      agent,
      operation,
      requestDigest: await agentDigest(raw),
      jti: crypto.randomUUID(),
      nonce: crypto.randomUUID(),
      publicKey: session.publicKey,
      cnf: await agentPublicKeyDigest(session.publicKey),
      iat: now,
      exp: now + ttlMs,
    };
    return mintAgentCapability(claims, secret);
  };
  const subscribePath = `/api/fleet/events?after=0&agent=${encodeURIComponent(session.smokeAgentId)}`;
  const handoff = await encryptAgentHandoff(
    {
      rootId: root.id,
      smokeAgentId: session.smokeAgentId,
      requests: { listRaw, createRaw, deleteRaw, subscribePath },
      capabilities: {
        listBefore: await mint('fleet.read', root.id, listRaw),
        listAfter: await mint('fleet.read', root.id, listRaw),
        listCleanupBefore: await mint('fleet.read', root.id, listRaw),
        listCleanupAfter: await mint('fleet.read', root.id, listRaw),
        create: await mint('fleet.write', root.id, createRaw),
        delete: await mint('fleet.write', session.smokeAgentId, deleteRaw),
        cleanup: await mint('fleet.write', session.smokeAgentId, deleteRaw),
        subscribeA: await mint('fleet.subscribe', session.smokeAgentId, '', 30_000),
        subscribeB: await mint('fleet.subscribe', session.smokeAgentId, '', 30_000),
      },
    },
    session.handoffKey,
  );
  const stored = await forwardRoom(
    context.env,
    `/agent-capability/handoff/${encodeURIComponent(input.sessionId!)}`,
    'PUT',
    JSON.stringify(handoff),
  );
  if (!stored.ok) return context.json({ error: 'Handoff failed' }, 500);
  return context.json({ authorized: true });
});

app.post('/api/files', async (context) => {
  const identity = context.get('identity');
  const form = await context.req.formData();
  const value = form.get('file');
  if (!(value instanceof File)) return context.json({ error: 'file is required' }, 400);
  const mime = value.type.split(';')[0].trim().toLowerCase();
  const kind = fileKind(mime);
  const maximum = kind === 'text' ? maximumTextFileBytes : maximumFileBytes;
  if (!kind || value.size < 1 || value.size > maximum)
    return context.json({ error: 'unsupported file type or size' }, 400);
  const leading = new Uint8Array(await value.slice(0, 16).arrayBuffer());
  if (kind === 'image' && !imageSignatureMatches(mime, leading))
    return context.json({ error: 'image contents do not match the declared type' }, 400);
  const id = crypto.randomUUID();
  const ownerAgentId = context.req.query('threadId');
  if (!ownerAgentId) return context.json({ error: 'agent scope required' }, 400);
  const objectKey = agentFileObjectKey(ownerAgentId, id);
  await context.env.FILES.put(objectKey, value.stream(), {
    httpMetadata: { contentType: mime },
    customMetadata: { name: value.name, createdBy: identity.sub },
  });
  const file: SharedFile = {
    id,
    name: value.name.slice(0, 240) || 'attachment',
    mime,
    bytes: value.size,
    objectKey,
    kind,
    createdAt: new Date().toISOString(),
    createdBy: identity.sub,
  };
  const response = await forwardRoom(
    context.env,
    `/files?threadId=${encodeURIComponent(context.req.query('threadId') ?? '')}`,
    'POST',
    JSON.stringify(file),
  );
  if (!response.ok) await context.env.FILES.delete(objectKey);
  return new Response(response.body, response);
});

app.get('/api/files/:id/content', async (context) => {
  const snapshot = await roomSnapshot(
    context.env,
    context.get('identity'),
    context.req.query('threadId'),
  );
  const file = snapshot.files.find((candidate) => candidate.id === context.req.param('id'));
  if (!file) return context.json({ error: 'file not found' }, 404);
  const object = await context.env.FILES.get(file.objectKey);
  if (!object) return context.json({ error: 'file contents not found' }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('cache-control', 'private, no-store');
  headers.set('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  return new Response(object.body, { headers });
});

app.delete('/api/files/:id', async (context) => {
  const response = await forwardRoom(
    context.env,
    `/files/${encodeURIComponent(context.req.param('id'))}?threadId=${encodeURIComponent(context.req.query('threadId') ?? '')}`,
    'DELETE',
  );
  if (response.ok) {
    const result = await response.clone().json<{ objectKey?: string }>();
    if (result.objectKey) await context.env.FILES.delete(result.objectKey);
  }
  return new Response(response.body, response);
});

app.post('/api/agent-state', async (context) => {
  const identity = context.get('identity');
  const body = (await readBoundedJson(context.req.raw)) as { key?: string; value?: string };
  const response = await forwardRoom(
    context.env,
    `/agent-state?threadId=${encodeURIComponent(context.req.query('threadId') ?? '')}`,
    'POST',
    JSON.stringify({ ...body, actorId: identity.sub }),
  );
  return new Response(response.body, response);
});

app.put('/api/agent-state/:id', async (context) => {
  const identity = context.get('identity');
  const body = (await readBoundedJson(context.req.raw)) as { key?: string; value?: string };
  const response = await forwardRoom(
    context.env,
    `/agent-state/${encodeURIComponent(context.req.param('id'))}?threadId=${encodeURIComponent(context.req.query('threadId') ?? '')}`,
    'PUT',
    JSON.stringify({ ...body, actorId: identity.sub }),
  );
  return new Response(response.body, response);
});

app.delete('/api/agent-state/:id', async (context) => {
  const response = await forwardRoom(
    context.env,
    `/agent-state/${encodeURIComponent(context.req.param('id'))}?threadId=${encodeURIComponent(context.req.query('threadId') ?? '')}`,
    'DELETE',
  );
  return new Response(response.body, response);
});

app.post('/api/jobs', async (context) => {
  const identity = context.get('identity');
  const body = (await readBoundedJson(context.req.raw)) as {
    name?: string;
    prompt?: string;
    intervalSeconds?: number;
    maxRuns?: number | null;
  };
  const response = await forwardRoom(
    context.env,
    `/jobs?threadId=${encodeURIComponent(context.req.query('threadId') ?? '')}`,
    'POST',
    JSON.stringify({ ...body, actorId: identity.sub }),
  );
  return new Response(response.body, response);
});

app.put('/api/jobs/:id', async (context) => {
  const identity = context.get('identity');
  const body = (await readBoundedJson(context.req.raw)) as {
    name?: string;
    prompt?: string;
    intervalSeconds?: number;
    maxRuns?: number | null;
  };
  const response = await forwardRoom(
    context.env,
    `/jobs/${encodeURIComponent(context.req.param('id'))}?threadId=${encodeURIComponent(context.req.query('threadId') ?? '')}`,
    'PUT',
    JSON.stringify({ ...body, actorId: identity.sub }),
  );
  return new Response(response.body, response);
});

app.post('/api/jobs/:id/:action', async (context) => {
  const action = context.req.param('action');
  if (action !== 'pause' && action !== 'resume') return context.json({ error: 'not found' }, 404);
  const identity = context.get('identity');
  const response = await forwardRoom(
    context.env,
    `/jobs/${encodeURIComponent(context.req.param('id'))}/${action}?threadId=${encodeURIComponent(context.req.query('threadId') ?? '')}`,
    'POST',
    JSON.stringify({ actorId: identity.sub }),
  );
  return new Response(response.body, response);
});

app.delete('/api/jobs/:id', async (context) => {
  const response = await forwardRoom(
    context.env,
    `/jobs/${encodeURIComponent(context.req.param('id'))}?threadId=${encodeURIComponent(context.req.query('threadId') ?? '')}`,
    'DELETE',
  );
  return new Response(response.body, response);
});

app.post('/api/push-subscriptions', async (context) => {
  const identity = context.get('identity');
  const body = (await readBoundedJson(context.req.raw)) as {
    endpoint?: string;
    keys?: { auth?: string; p256dh?: string };
  };
  if (!body.endpoint || !body.keys?.auth || !body.keys.p256dh)
    return context.json({ error: 'invalid subscription' }, 400);
  const response = await forwardRoom(
    context.env,
    '/push-subscriptions',
    'POST',
    JSON.stringify({
      ownerId: identity.sub,
      ownerEmail: identity.email,
      subscription: {
        endpoint: body.endpoint,
        keys: { auth: body.keys.auth, p256dh: body.keys.p256dh },
      },
    }),
  );
  return new Response(response.body, response);
});

app.delete('/api/push-subscriptions', async (context) => {
  const identity = context.get('identity');
  const body = (await readBoundedJson(context.req.raw)) as { endpoint?: string };
  if (!body.endpoint) return context.json({ error: 'invalid subscription' }, 400);
  const response = await forwardRoom(
    context.env,
    '/push-subscriptions',
    'DELETE',
    JSON.stringify({ ownerId: identity.sub, endpoint: body.endpoint }),
  );
  return new Response(response.body, response);
});

app.get('/manifest.webmanifest', (context) =>
  context.body(JSON.stringify(pwaManifest()), 200, {
    'content-type': 'application/manifest+json; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  }),
);

function serviceWorkerSource(icon: string): string {
  return [
    `const icon=${JSON.stringify(icon)};`,
    "function text(value){return typeof value==='string'&&value.length<=2000?value:undefined}function readPush(raw){let value={};try{value=raw?JSON.parse(raw):{}}catch{}if(!value||typeof value!=='object')return{};return{title:text(value.title),body:text(value.body),href:text(value.href),notificationId:text(value.notificationId),requestId:text(value.requestId),approvalId:text(value.approvalId),agentId:text(value.agentId)}}",
    "self.addEventListener('install',event=>{event.waitUntil(caches.open('chat-ax-pwa').then(cache=>cache.addAll(['/','/manifest.webmanifest'])))});",
    "self.addEventListener('push',event=>{const data=readPush(event.data?.text());const actions=data.approvalId?[{action:'approve',title:'Approve'},{action:'deny',title:'Deny'}]:data.requestId?[{action:'accept',title:'Accept'},{action:'decline',title:'Decline'}]:[];event.waitUntil(self.registration.showNotification(data.title??'Chat AX',{body:data.body??'',icon,tag:data.approvalId??data.requestId??data.notificationId,requireInteraction:Boolean(data.approvalId||data.requestId),actions,data:{href:data.href??'/',notificationId:data.notificationId,requestId:data.requestId,approvalId:data.approvalId,agentId:data.agentId}}))});",
    "async function decideApproval(approvalId,agentId,action){const response=await fetch(`/api/mcp-approvals/${encodeURIComponent(approvalId)}/${action}?threadId=${encodeURIComponent(agentId??'')}`,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:'{}'});const title=response.ok?(action==='approve'?'Approved. It ran once, as you.':'Denied. Nothing ran.'):'Open Chat AX to decide.';await self.registration.showNotification(title,{icon,tag:approvalId,body:''});return response.ok}",
    "async function decide(requestId,action){const response=await fetch(`/api/person-requests/${encodeURIComponent(requestId)}/${action}`,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:'{}'});const title=response.ok?(action==='accept'?'Accepted. Your agent is on it.':'Declined.'):'Open Chat AX to respond.';await self.registration.showNotification(title,{icon,tag:requestId,body:''});return response.ok}",
    "self.addEventListener('notificationclick',event=>{event.notification.close();const data=event.notification.data??{};const href=new URL(data.href??'/',self.location.origin).href;if(data.approvalId&&(event.action==='approve'||event.action==='deny')){event.waitUntil(decideApproval(data.approvalId,data.agentId,event.action).then(ok=>ok?undefined:clients.openWindow(href)));return}if(data.requestId&&(event.action==='accept'||event.action==='decline')){event.waitUntil(decide(data.requestId,event.action).then(ok=>ok?undefined:clients.openWindow(href)));return}event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{const open=list.find(client=>new URL(client.url).origin===self.location.origin);if(open){open.postMessage({type:'open-request',requestId:data.requestId,approvalId:data.approvalId});return open.focus()}return clients.openWindow(href)}))});",
  ].join('');
}

app.get('/sw.js', (context) => {
  const source = serviceWorkerSource(pwaAssets.icon192);
  return context.body(source, 200, {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'private, no-cache',
    'service-worker-allowed': '/',
  });
});

function connectorCallbackUrl(requestUrl: string, env: Env): string {
  const connectorId = mcpConnector(env)?.id ?? 'mcp';
  return `${new URL(requestUrl).origin}/api/connectors/${connectorId}/callback`;
}

app.get('/api/connectors/mcp/status', async (context) => {
  const response = await viewerVault(context.env, context.get('identity')).fetch(
    'https://vault/status',
  );
  return new Response(response.body, response);
});

app.get('/api/connectors/mcp/authorize', async (context) => {
  try {
    const callbackUrl = connectorCallbackUrl(context.req.url, context.env);
    const response = await viewerVault(context.env, context.get('identity')).fetch(
      'https://vault/start',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          callbackUrl,
          redirectBackTo: context.req.query('return') ?? '/',
        }),
      },
    );
    if (!response.ok) return context.json({ error: 'MCP authorization could not start' }, 503);
    const result = await response.json<{ authorizationUrl: string }>();
    return context.redirect(result.authorizationUrl, 302);
  } catch {
    return context.json({ error: 'MCP authorization could not start' }, 503);
  }
});

app.get('/api/connectors/:connectorId/callback', async (context) => {
  const code = context.req.query('code');
  const state = context.req.query('state');
  if (!code || !state) return context.redirect('/?connector=mcp&result=error', 302);
  const callbackUrl = connectorCallbackUrl(context.req.url, context.env);
  const response = await viewerVault(context.env, context.get('identity')).fetch(
    'https://vault/complete',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callbackUrl, code, state }),
    },
  );
  if (!response.ok) return context.redirect('/?connector=mcp&result=error', 302);
  const result = await response.json<{ ok: boolean; redirectBackTo?: string }>();
  const destination = result.redirectBackTo ?? '/';
  return context.redirect(
    `${destination}${destination.includes('?') ? '&' : '?'}connector=mcp&result=${result.ok ? 'ok' : 'error'}`,
    302,
  );
});

app.post('/api/connectors/mcp/disconnect', async (context) => {
  const response = await viewerVault(context.env, context.get('identity')).fetch(
    'https://vault/disconnect',
    { method: 'POST' },
  );
  return new Response(response.body, response);
});

app.post('/api/dev/connectors/mcp/seed', async (context) => {
  if (context.env.ENVIRONMENT !== 'dev') return context.json({ error: 'not found' }, 404);
  const body = (await readBoundedJson(context.req.raw)) as { token?: string };
  if (!body.token || body.token.length > 4000) return context.json({ error: 'invalid token' }, 400);
  const response = await viewerVault(context.env, context.get('identity')).fetch(
    'https://vault/dev/seed',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: body.token }),
    },
  );
  return new Response(response.body, response);
});

app.get('/api/person-requests', async (context) => {
  const identity = context.get('identity');
  const query = new URLSearchParams({
    actorId: identity.sub,
    actorEmail: identity.email,
    actorName: displayName(identity),
  });
  const response = await forwardRoom(context.env, `/person-requests?${query}`, 'GET');
  return new Response(response.body, response);
});

app.post('/api/person-requests', async (context) => {
  const identity = context.get('identity');
  const body = v.parse(
    v.object({
      recipientEmail: v.string(),
      recipientName: v.optional(v.string()),
      title: v.string(),
      details: v.string(),
    }),
    await readBoundedJson(context.req.raw),
  );
  const response = await forwardRoom(
    context.env,
    '/person-requests',
    'POST',
    JSON.stringify({
      ...body,
      actorId: identity.sub,
      actorEmail: identity.email,
      actorName: displayName(identity),
    }),
  );
  return new Response(response.body, response);
});

app.get('/api/person-requests/:id', async (context) => {
  const identity = context.get('identity');
  const query = new URLSearchParams({
    actorId: identity.sub,
    actorEmail: identity.email,
    actorName: displayName(identity),
  });
  const id = encodeURIComponent(context.req.param('id'));
  const response = await forwardRoom(context.env, `/person-requests/${id}?${query}`, 'GET');
  return new Response(response.body, response);
});

app.post('/api/person-requests/:id/:action', async (context) => {
  const identity = context.get('identity');
  const body = (await readBoundedJson(context.req.raw).catch(() => ({}))) as {
    response?: string;
  };
  const id = encodeURIComponent(context.req.param('id'));
  const action = encodeURIComponent(context.req.param('action'));
  const response = await forwardRoom(
    context.env,
    `/person-requests/${id}/${action}`,
    'POST',
    JSON.stringify({
      response: body.response,
      actorId: identity.sub,
      actorEmail: identity.email,
      actorName: displayName(identity),
    }),
  );
  return new Response(response.body, response);
});

app.get('/api/viewer', (context) => {
  const identity = context.get('identity');
  return context.json({ id: verifiedActorId(identity), email: identity.email });
});

app.get('/api/messages', async (context) => {
  const snapshot = await roomSnapshot(context.env, context.get('identity'), context.req.query('threadId'));
  const { online: _presence, ...versioned } = snapshot;
  const body = JSON.stringify(snapshot);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(versioned)));
  const etag = `"${[...new Uint8Array(digest).slice(0, 12)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}"`;
  const headers = { etag, 'cache-control': 'private, no-cache', vary: 'cookie, cf-access-jwt-assertion' };
  const presented = (context.req.header('if-none-match') ?? '')
    .split(',')
    .map((value) => {
      const trimmed = value.trim();
      return trimmed.startsWith('W/') ? trimmed.slice(2) : trimmed;
    });
  if (presented.includes(etag)) return new Response(null, { status: 304, headers });
  return new Response(body, { headers: { ...headers, 'content-type': 'application/json' } });
});

app.get('/api/orchestration', async (context) => {
  const response = await room(context.env).fetch('https://room/orchestration');
  return new Response(response.body, response);
});

app.put('/api/orchestration', async (context) => {
  const body = v.parse(
    v.object({
      mode: v.picklist(['strict', 'mesh']),
      proofRunId: v.optional(v.string()),
    }),
    await readBoundedJson(context.req.raw),
  );
  const response = await room(context.env).fetch('https://room/orchestration', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, actorId: verifiedActorId(context.get('identity')) }),
  });
  return new Response(response.body, response);
});

app.get('/api/threads', async (context) => {
  const nodeId = context.req.query('nodeId');
  const response = await room(context.env).fetch(
    `https://room/threads${nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ''}`,
  );
  return new Response(response.body, response);
});

app.patch('/api/threads', async (context) => {
  const body = (await readBoundedJson(context.req.raw)) as {
    id?: string;
    title?: string;
    avatarSeed?: string;
  };
  const response = await room(context.env).fetch('https://room/threads', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return new Response(response.body, response);
});

const threadCreationSchema = v.object({
  parentId: v.optional(v.string()),
  siblingOf: v.optional(v.string()),
  title: v.optional(v.string()),
  copyFromAgentId: v.optional(v.string()),
  customization: v.optional(v.record(v.string(), v.unknown())),
});

app.post('/api/threads', async (context) => {
  const body = v.parse(threadCreationSchema, await readBoundedJson(context.req.raw));
  const response = await room(context.env).fetch('https://room/threads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return new Response(response.body, response);
});

app.delete('/api/threads', async (context) => {
  const body = (await readBoundedJson(context.req.raw)) as { id?: unknown };
  if (typeof body.id !== 'string') return context.json({ error: 'id is required' }, 400);
  const response = await room(context.env).fetch('https://room/threads', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: body.id }),
  });
  return new Response(response.body, response);
});

app.get('/api/preview', async (context) => {
  const response = await room(context.env).fetch('https://room/preview');
  return new Response(response.body, response);
});

app.get('/api/dev/pi-tasks', async (context) => {
  if (!isAdmin(context.env, context.get('identity').email)) {
    return context.json({ error: 'not found' }, 404);
  }
  const response = await room(context.env).fetch('https://room/dev/pi-tasks');
  return new Response(response.body, response);
});

app.post('/api/presence', async (context) => {
  const identity = context.get('identity');
  const requestedAvatarSeed = context.req.query('avatarSeed')?.trim();
  const avatarSeed =
    requestedAvatarSeed && requestedAvatarSeed.length <= 200 ? requestedAvatarSeed : undefined;
  const response = await room(context.env).fetch('https://room/presence', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: identity.sub,
      name: displayName(identity),
      email: identity.email,
      avatarUrl: identity.avatarUrl,
      avatarSeed,
    }),
  });
  return new Response(response.body, response);
});

app.post('/api/presence/leave', async (context) => {
  const identity = context.get('identity');
  const response = await room(context.env).fetch('https://room/presence', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: identity.sub }),
  });
  return new Response(response.body, response);
});

app.post('/api/dev/capabilities/cross-user-probe', async (context) => {
  if (context.env.ENVIRONMENT !== 'dev') {
    return context.json({ error: 'not found' }, 404);
  }
  const identity = context.get('identity');
  const decision = crossUserProbe({
    actorId: identity.sub,
    grantOwnerId: 'different-user',
    roomId: 'main',
  });
  return context.json({ decision });
});

app.get('/api/dev/capabilities/receipts', async (context) => {
  if (!canReadDiagnostics(context.env, context.get('identity').email)) {
    return context.json({ error: 'not found' }, 404);
  }
  const response = await room(context.env).fetch('https://room/receipts');
  return new Response(response.body, response);
});

app.get('/api/dev/mcp-receipts', async (context) => {
  if (!canReadDiagnostics(context.env, context.get('identity').email)) {
    return context.json({ error: 'not found' }, 404);
  }
  const response = await room(context.env).fetch('https://room/mcp-receipts');
  return new Response(response.body, response);
});

app.post('/api/mcp-approvals/:id/deny', async (context) => {
  const identity = context.get('identity');
  const query = new URLSearchParams({
    actorId: identity.sub,
    actorEmail: identity.email,
    actorName: displayName(identity),
  });
  const response = await room(context.env).fetch(
    `https://room/mcp-approvals/${encodeURIComponent(context.req.param('id'))}/deny?${query}&threadId=${encodeURIComponent(context.req.query('threadId') ?? '')}`,
    { method: 'POST' },
  );
  return new Response(response.body, response);
});

app.post('/api/mcp-approvals/:id/approve', async (context) => {
  const identity = context.get('identity');
  const query = new URLSearchParams({
    actorId: identity.sub,
    actorEmail: identity.email,
    actorName: displayName(identity),
  });
  const response = await room(context.env).fetch(
    `https://room/mcp-approvals/${encodeURIComponent(context.req.param('id'))}/approve?${query}&threadId=${encodeURIComponent(context.req.query('threadId') ?? '')}`,
    { method: 'POST' },
  );
  return new Response(response.body, response);
});

app.put('/api/settings', async (context) => {
  const identity = context.get('identity');
  const body = (await readBoundedJson(context.req.raw)) as {
    strategyId?: string;
    modelId?: string;
    thinkingLevel?: string;
    systemPrompt?: string;
    agentAvatarSeed?: string;
  };
  const threadId = context.req.query('threadId');
  const response = await room(context.env).fetch(
    `https://room/settings${threadId ? `?threadId=${encodeURIComponent(threadId)}` : ''}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        strategyId: body.strategyId,
        modelId: body.modelId,
        thinkingLevel: body.thinkingLevel,
        systemPrompt: body.systemPrompt,
        agentAvatarSeed: body.agentAvatarSeed,
        updatedBy: identity.sub,
      }),
    },
  );
  return new Response(response.body, response);
});

const skillMutationSchema = v.object({
  name: v.optional(v.string()),
  description: v.optional(v.string()),
  body: v.optional(v.string()),
});

app.post('/api/skills', async (context) => {
  const body = v.parse(skillMutationSchema, await readBoundedJson(context.req.raw));
  const identity = context.get('identity');
  const query = new URLSearchParams({
    actorId: identity.sub,
    actorEmail: identity.email,
    actorName: displayName(identity),
    ...(context.req.query('threadId') ? { threadId: context.req.query('threadId')! } : {}),
  });
  const response = await room(context.env).fetch(`https://room/skills?${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return new Response(response.body, response);
});

app.put('/api/skills/:name', async (context) => {
  const body = v.parse(skillMutationSchema, await readBoundedJson(context.req.raw));
  const identity = context.get('identity');
  const query = new URLSearchParams({
    actorId: identity.sub,
    actorEmail: identity.email,
    actorName: displayName(identity),
    ...(context.req.query('threadId') ? { threadId: context.req.query('threadId')! } : {}),
  });
  const response = await room(context.env).fetch(
    `https://room/skills/${encodeURIComponent(context.req.param('name'))}?${query}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return new Response(response.body, response);
});

app.delete('/api/skills/:name', async (context) => {
  const identity = context.get('identity');
  const query = new URLSearchParams({
    actorId: identity.sub,
    actorEmail: identity.email,
    actorName: displayName(identity),
    ...(context.req.query('threadId') ? { threadId: context.req.query('threadId')! } : {}),
  });
  const response = await room(context.env).fetch(
    `https://room/skills/${encodeURIComponent(context.req.param('name'))}?${query}`,
    {
      method: 'DELETE',
    },
  );
  return new Response(response.body, response);
});

app.post('/api/history/:action', async (context) => {
  const action = context.req.param('action');
  if (action !== 'clear' && action !== 'compact') return context.json({ error: 'not found' }, 404);
  const identity = context.get('identity');
  const query = new URLSearchParams({
    actorId: identity.sub,
    actorEmail: identity.email,
    actorName: displayName(identity),
  });
  const response = await room(context.env).fetch(`https://room/history/${action}?${query}`, {
    method: 'POST',
  });
  return new Response(response.body, response);
});

app.post('/api/pi/compact', async (context) => {
  const identity = context.get('identity');
  const query = new URLSearchParams({
    actorId: identity.sub,
    actorEmail: identity.email,
    actorName: displayName(identity),
  });
  const response = await room(context.env).fetch(`https://room/history/compact?${query}`, {
    method: 'POST',
  });
  return new Response(response.body, response);
});

app.post('/api/messages', async (context) => {
  const identity = context.get('identity');
  const body = (await readBoundedJson(context.req.raw)) as {
    text?: string;
    attachmentIds?: string[];
    threadId?: string;
  };
  const response = await room(context.env).fetch('https://room/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: body.text,
      authorId: identity.sub,
      authorName: displayName(identity),
      authorEmail: identity.email,
      avatarUrl: identity.avatarUrl,
      attachmentIds: body.attachmentIds,
      threadId: body.threadId,
      callbackUrl: connectorCallbackUrl(context.req.url, context.env),
    }),
  });
  return new Response(response.body, response);
});

app.post('/api/messages/:id/cancel', async (context) => {
  const identity = context.get('identity');
  const id = encodeURIComponent(context.req.param('id'));
  const query = new URLSearchParams({
    actorId: identity.sub,
    actorEmail: identity.email,
    actorName: displayName(identity),
  });
  const threadId = context.req.query('threadId');
  if (threadId) query.set('threadId', threadId);
  const response = await room(context.env).fetch(`https://room/messages/${id}/cancel?${query}`, {
    method: 'POST',
  });
  return new Response(response.body, response);
});

app.get('/agent', (context) =>
  svelteRenderer(AvatarLab, {
    hydrateAs: 'avatarLab',
    title: 'Chat AX · Agent avatar explorer',
    props: {},
  })(context, renderWithoutFallthrough),
);

app.get('/video', (context) =>
  svelteRenderer(MotionHeaderPage, {
    hydrateAs: 'motionHeader',
    title: 'Chat AX · Motion header',
    props: {},
  })(context, renderWithoutFallthrough),
);

app.get('/interface-lab', (context) =>
  svelteRenderer(StyleLab, {
    hydrateAs: 'styleLab',
    title: 'Chat AX · Interface lab',
    props: { initialMessageState: 'thinking' },
  })(context, renderWithoutFallthrough),
);

app.get('/', async (context) => {
  const identity = context.get('identity');
  if (context.env.ENVIRONMENT === 'dev' && context.req.query('fresh') === '1')
    await room(context.env).fetch('https://room/dev/reset', { method: 'POST' });
  const [snapshot, connectorResponse] = await Promise.all([
    roomSnapshot(context.env, identity, context.req.query('thread')),
    viewerVault(context.env, identity).fetch('https://vault/status'),
  ]);
  const connector = await connectorResponse.json<{ configured: boolean; id?: string; name?: string; connected: boolean }>();
  const selectedThreadId = context.req.query('thread') || snapshot.threadTree.rootId;
  const selectedThread =
    snapshot.threadTree.nodes.find((node) => node.id === selectedThreadId) ??
    snapshot.threadTree.nodes.find((node) => node.id === snapshot.threadTree.rootId);
  const threadPath = selectedThread
    ? pathTo(snapshot.threadTree, selectedThread.id)
        .map((node) => node.title)
        .join(' / ')
    : 'Thread lens';
  const viewer = {
    id: identity.sub,
    name: displayName(identity),
    email: identity.email,
    avatarUrl: identity.avatarUrl,
  };
  const requestedStressCount = Number(context.req.query('stress-ui'));
  const stressFixture =
    context.env.ENVIRONMENT === 'dev' && requestedStressCount > 0
      ? createUiStressFixture(
          snapshot.strategies.map((strategy) => strategy.id),
          Math.min(2_000, Math.floor(requestedStressCount)),
          Date.now(),
          viewer,
        )
      : undefined;
  return svelteRenderer(Chat, {
    hydrateAs: 'chat',
    title: 'Chat AX',
    head: pwaHead(),
    props: {
      initialState: stressFixture
        ? { ...snapshot, ...stressFixture, active: 0, waiting: 0 }
        : { ...snapshot, messages: [] },
      connector,
      viewer,
      threadId: selectedThread?.id || '',
      threadTitle: selectedThread?.title || 'Thread lens',
      threadPath,
      threadParentId: selectedThread?.parentId || '',
      fleetOpen: context.req.query('fleet') === '1',
      stressFixture: Boolean(stressFixture),
    },
  })(context, renderWithoutFallthrough);
});

export { ConnectorVaultDO } from './connector-vault';
export { ChatRoomDO } from './room';
export { AgentDO } from './agent-do';
export default app;
