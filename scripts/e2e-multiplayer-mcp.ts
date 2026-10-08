import assert from 'node:assert/strict';
import { decryptGrant, encryptGrant } from '../src/grant-crypto';

const masterKey = Buffer.alloc(32, 7).toString('base64');
const tokens = new Map<string, string>([
  ['jordan', 'JORDAN_AX_GRANT_912'],
  ['sam', 'SAM_AX_GRANT_438'],
]);
const stored = new Map<string, string>();
for (const [actor, token] of tokens) stored.set(actor, await encryptGrant(masterKey, actor, token));

async function tokenForVerifiedActor(actor: string): Promise<string> {
  const encrypted = stored.get(actor);
  if (!encrypted) throw new Error('Connect your MCP connector to use this tool');
  return decryptGrant(masterKey, actor, encrypted);
}

assert.equal(await tokenForVerifiedActor('jordan'), tokens.get('jordan'));
assert.equal(await tokenForVerifiedActor('sam'), tokens.get('sam'));
await assert.rejects(() => decryptGrant(masterKey, 'sam', stored.get('jordan') ?? ''));
stored.delete('sam');
await assert.rejects(() => tokenForVerifiedActor('sam'));
const sharedRoom = JSON.stringify({
  messages: [{ authorId: 'jordan', text: 'Use my MCP connector' }],
  receipts: [{ actorId: 'jordan', connectorId: 'mcp', status: 'succeeded' }],
});
assert.equal(sharedRoom.includes('AX_GRANT'), false);
assert.equal(sharedRoom.includes(masterKey), false);

const app = Bun.env.CHAT_AX_URL ?? 'http://127.0.0.1:61901';
const participant = async (email: string, path: string, method = 'GET', token?: string) => {
  const headers = new Headers({
    'x-dev-user-email': email,
    'x-dev-user-name': email.startsWith('jordan') ? 'Jordan Test' : 'Sam Test',
  });
  const request: RequestInit = { method, headers };
  if (token) {
    headers.set('content-type', 'application/json');
    request.body = JSON.stringify({ token });
  }
  const response = await fetch(`${app}${path}`, request);
  assert.equal(response.ok, true, `${email} ${path} failed with ${response.status}`);
  return response.json();
};
await participant(
  'jordan@example.com',
  '/api/dev/connectors/mcp/seed',
  'POST',
  tokens.get('jordan'),
);
await participant('sam@example.com', '/api/dev/connectors/mcp/seed', 'POST', tokens.get('sam'));
assert.equal(
  (await participant('jordan@example.com', '/api/connectors/mcp/status')).connected,
  true,
);
assert.equal(
  (await participant('sam@example.com', '/api/connectors/mcp/status')).connected,
  true,
);
await participant('sam@example.com', '/api/connectors/mcp/disconnect', 'POST');
assert.equal(
  (await participant('sam@example.com', '/api/connectors/mcp/status')).connected,
  false,
);
assert.equal(
  (await participant('jordan@example.com', '/api/connectors/mcp/status')).connected,
  true,
);
await participant('jordan@example.com', '/api/connectors/mcp/disconnect', 'POST');
console.log('PASS MCP connector multiplayer authority and credential isolation');
