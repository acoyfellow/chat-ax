import { afterEach, describe, expect, test } from 'bun:test';
import { discoverOAuthEndpoints, mcpConnector } from './mcp-connector';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function serve(routes: Record<string, unknown>) {
  const requested: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      return url in routes ? Response.json(routes[url]) : new Response('not found', { status: 404 });
    },
    { preconnect: realFetch.preconnect },
  );
  return requested;
}

describe('MCP connector configuration', () => {
  test('no server URL means no connector, so the app runs without one', () => {
    expect(mcpConnector({})).toBeNull();
    expect(mcpConnector({ MCP_SERVER_URL: 'http://tools.example.com/mcp' })).toBeNull();
    expect(mcpConnector({ MCP_SERVER_URL: 'https://tools.example.com/mcp', MCP_CONNECTOR_ID: 'Bad Id' })).toBeNull();
  });

  test('a server URL alone produces a named connector', () => {
    expect(mcpConnector({ MCP_SERVER_URL: 'https://tools.example.com/mcp' })).toEqual({ id: 'mcp', name: 'tools.example.com', serverUrl: 'https://tools.example.com/mcp' });
    expect(mcpConnector({ MCP_SERVER_URL: 'https://tools.example.com/mcp', MCP_CONNECTOR_ID: 'team-tools', MCP_CONNECTOR_NAME: 'Team tools' })?.name).toBe('Team tools');
  });

  test('OAuth endpoints are discovered from standard metadata', async () => {
    serve({
      'https://tools.example.com/.well-known/oauth-protected-resource/mcp': { resource: 'https://tools.example.com', authorization_servers: ['https://auth.example.com'] },
      'https://auth.example.com/.well-known/oauth-authorization-server': {
        authorization_endpoint: 'https://auth.example.com/authorize',
        token_endpoint: 'https://auth.example.com/token',
        registration_endpoint: 'https://auth.example.com/register',
      },
    });
    const connector = mcpConnector({ MCP_SERVER_URL: 'https://tools.example.com/mcp' });
    if (!connector) throw new Error('connector expected');
    expect(await discoverOAuthEndpoints({}, connector)).toEqual({
      authorize: 'https://auth.example.com/authorize',
      token: 'https://auth.example.com/token',
      registration: 'https://auth.example.com/register',
      resource: 'https://tools.example.com',
    });
  });

  test('explicit endpoints skip discovery entirely', async () => {
    const requested = serve({});
    const env = {
      MCP_SERVER_URL: 'https://tools.example.com/mcp',
      MCP_OAUTH_AUTHORIZE_URL: 'https://auth.example.com/a',
      MCP_OAUTH_TOKEN_URL: 'https://auth.example.com/t',
      MCP_OAUTH_REGISTRATION_URL: 'https://auth.example.com/r',
      MCP_OAUTH_RESOURCE: 'https://tools.example.com',
    };
    const connector = mcpConnector(env);
    if (!connector) throw new Error('connector expected');
    expect((await discoverOAuthEndpoints(env, connector)).token).toBe('https://auth.example.com/t');
    expect(requested).toEqual([]);
  });

  test('servers without dynamic client registration fail with a clear reason', async () => {
    serve({
      'https://tools.example.com/.well-known/oauth-protected-resource/mcp': { authorization_servers: ['https://auth.example.com'] },
      'https://auth.example.com/.well-known/oauth-authorization-server': { authorization_endpoint: 'https://auth.example.com/a', token_endpoint: 'https://auth.example.com/t' },
    });
    const connector = mcpConnector({ MCP_SERVER_URL: 'https://tools.example.com/mcp' });
    if (!connector) throw new Error('connector expected');
    await expect(discoverOAuthEndpoints({}, connector)).rejects.toThrow('dynamic client registration');
  });
});
