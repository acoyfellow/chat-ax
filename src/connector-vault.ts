import { DurableObject } from 'cloudflare:workers';
import * as v from 'valibot';
import { decryptGrant, encryptGrant } from './grant-crypto';
import { discoverOAuthEndpoints, type McpConnector, type McpConnectorEnv, type McpOAuthEndpoints, mcpConnector } from './mcp-connector';
import { readBoundedJson } from './safe-json';

export interface ConnectorEnv extends McpConnectorEnv {
  ENVIRONMENT?: string;
  MASTER_KEY?: string;
}

type StoredGrant = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  clientId: string;
};

type PendingAuthorization = {
  codeVerifier: string;
  redirectBackTo: string;
  expiresAt: number;
  clientId: string;
};

const TokenResponse = v.object({
  access_token: v.string(),
  refresh_token: v.optional(v.string()),
  expires_in: v.optional(v.number()),
});

const RegistrationResponse = v.object({ client_id: v.string() });

async function parseRequest<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  request: Request,
  schema: TSchema,
): Promise<v.InferOutput<TSchema>> {
  return v.parse(schema, await readBoundedJson(request));
}

function encode(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_');
}

function safeReturnPath(value: string): string {
  return value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export class ConnectorVaultDO extends DurableObject<ConnectorEnv> {
  private actorId(): string {
    return this.ctx.id.name ?? this.ctx.id.toString();
  }

  private async masterKey(): Promise<string> {
    if (this.env.MASTER_KEY) return this.env.MASTER_KEY;
    const stored = await this.ctx.storage.get<string>('generated-master-key');
    if (stored) return stored;
    const generated = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    await this.ctx.storage.put('generated-master-key', generated);
    return generated;
  }

  private connector(): McpConnector {
    const connector = mcpConnector(this.env);
    if (!connector) throw new Error('No MCP connector is configured');
    return connector;
  }

  private grantKey(): string {
    return `grant:${this.connector().id}`;
  }

  private async endpoints(): Promise<McpOAuthEndpoints> {
    const cached = await this.ctx.storage.get<McpOAuthEndpoints & { serverUrl: string }>('oauth-endpoints');
    const connector = this.connector();
    if (cached?.serverUrl === connector.serverUrl) return cached;
    const discovered = await discoverOAuthEndpoints(this.env, connector);
    await this.ctx.storage.put('oauth-endpoints', { ...discovered, serverUrl: connector.serverUrl });
    return discovered;
  }

  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/status' && request.method === 'GET') {
      const connector = mcpConnector(this.env);
      if (!connector) return Response.json({ configured: false, connected: false });
      const grant = await this.ctx.storage.get<StoredGrant>(this.grantKey());
      return Response.json({ configured: true, id: connector.id, name: connector.name, connected: Boolean(grant) });
    }
    if (pathname === '/start' && request.method === 'POST') return this.start(request);
    if (pathname === '/complete' && request.method === 'POST') return this.complete(request);
    if (pathname === '/token' && request.method === 'GET') {
      return Response.json({ token: await this.validToken() });
    }
    if (pathname === '/disconnect' && request.method === 'POST') {
      await this.ctx.storage.delete(this.grantKey());
      return Response.json({ ok: true });
    }
    if (pathname === '/dev/seed' && request.method === 'POST') {
      const input = await parseRequest(request, v.object({ token: v.string() }));
      await this.ctx.storage.put<StoredGrant>(this.grantKey(), {
        accessToken: await encryptGrant(await this.masterKey(), this.actorId(), input.token),
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        clientId: 'development-test',
      });
      return Response.json({ ok: true });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  private async start(request: Request): Promise<Response> {
    const input = await parseRequest(
      request,
      v.object({ callbackUrl: v.string(), redirectBackTo: v.string() }),
    );
    const endpoint = await this.endpoints();
    const registration = await fetch(endpoint.registration, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: `chat-ax-${crypto.randomUUID()}`,
        redirect_uris: [input.callbackUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    });
    if (!registration.ok) throw new Error(`${this.connector().name} client registration failed: ${registration.status}`);
    const registered = v.parse(RegistrationResponse, await registration.json());
    const verifier = encode(crypto.getRandomValues(new Uint8Array(32))).slice(0, 43);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const state = encode(crypto.getRandomValues(new Uint8Array(24)));
    await this.ctx.storage.put<PendingAuthorization>(`pending:${state}`, {
      codeVerifier: verifier,
      redirectBackTo: safeReturnPath(input.redirectBackTo),
      expiresAt: Date.now() + 5 * 60 * 1000,
      clientId: registered.client_id,
    });
    const parameters = new URLSearchParams({
      response_type: 'code',
      client_id: registered.client_id,
      state,
      code_challenge: encode(new Uint8Array(digest)),
      code_challenge_method: 'S256',
      redirect_uri: input.callbackUrl,
      resource: endpoint.resource,
    });
    return Response.json({ authorizationUrl: `${endpoint.authorize}?${parameters}`, state });
  }

  private async complete(request: Request): Promise<Response> {
    const input = await parseRequest(
      request,
      v.object({ callbackUrl: v.string(), code: v.string(), state: v.string() }),
    );
    const pending = await this.ctx.storage.get<PendingAuthorization>(`pending:${input.state}`);
    if (!pending || pending.expiresAt < Date.now()) {
      await this.ctx.storage.delete(`pending:${input.state}`);
      return Response.json({ ok: false, error: 'Unknown or expired state' }, { status: 400 });
    }
    const endpoint = await this.endpoints();
    const response = await fetch(endpoint.token, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        client_id: pending.clientId,
        code_verifier: pending.codeVerifier,
        redirect_uri: input.callbackUrl,
        resource: endpoint.resource,
      }),
    });
    if (!response.ok)
      return Response.json({ ok: false, error: 'Token exchange failed' }, { status: 502 });
    const token = v.parse(TokenResponse, await response.json());
    const now = Math.floor(Date.now() / 1000);
    await this.ctx.storage.put<StoredGrant>(this.grantKey(), {
      accessToken: await encryptGrant(await this.masterKey(), this.actorId(), token.access_token),
      refreshToken: token.refresh_token
        ? await encryptGrant(await this.masterKey(), this.actorId(), token.refresh_token)
        : undefined,
      expiresAt: now + (token.expires_in ?? 900),
      clientId: pending.clientId,
    });
    await this.ctx.storage.delete(`pending:${input.state}`);
    return Response.json({ ok: true, redirectBackTo: pending.redirectBackTo });
  }

  private async validToken(): Promise<string | null> {
    if (!mcpConnector(this.env)) return null;
    const grant = await this.ctx.storage.get<StoredGrant>(this.grantKey());
    if (!grant) return null;
    const accessToken = await decryptGrant(await this.masterKey(), this.actorId(), grant.accessToken).catch(() => null);
    if (accessToken === null) {
      await this.ctx.storage.delete(this.grantKey());
      return null;
    }
    if (grant.expiresAt - Math.floor(Date.now() / 1000) >= 60) return accessToken;
    if (!grant.refreshToken) return null;
    const endpoint = await this.endpoints();
    const refreshToken = await decryptGrant(await this.masterKey(), this.actorId(), grant.refreshToken);
    const response = await fetch(endpoint.token, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: grant.clientId,
        resource: endpoint.resource,
      }),
    });
    if (!response.ok) return null;
    const token = v.parse(TokenResponse, await response.json());
    const updatedAccessToken = token.access_token;
    await this.ctx.storage.put<StoredGrant>(this.grantKey(), {
      accessToken: await encryptGrant(await this.masterKey(), this.actorId(), updatedAccessToken),
      refreshToken: await encryptGrant(
        await this.masterKey(),
        this.actorId(),
        token.refresh_token ?? refreshToken,
      ),
      expiresAt: Math.floor(Date.now() / 1000) + (token.expires_in ?? 900),
      clientId: grant.clientId,
    });
    return updatedAccessToken;
  }
}

export function connectorVault(
  namespace: DurableObjectNamespace<ConnectorVaultDO>,
  actorId: string,
): DurableObjectStub<ConnectorVaultDO> {
  return namespace.get(namespace.idFromName(actorId));
}
