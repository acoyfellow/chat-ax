import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { agentDigest, agentPublicKeyDigest, createAgentProof, decryptAgentHandoff, encryptAgentHandoff, mintAgentCapability } from '../src/agent-capability.ts';

const origin = process.env.CHAT_AX_URL ?? 'http://127.0.0.1:8791';
const secret = process.env.MCP_CAPABILITY_SECRET;
if (!secret) throw new Error('Set MCP_CAPABILITY_SECRET to the value the server was started with, for example: MCP_CAPABILITY_SECRET=$(openssl rand -hex 32) and wrangler dev --var MCP_CAPABILITY_SECRET:$MCP_CAPABILITY_SECRET');
const encoder = new TextEncoder();
const devHeaders = { 'content-type': 'application/json', 'x-dev-user-email': 'authority-e2e@example.com', 'x-dev-user-name': 'Authority E2E' };
let rpcId = 0;
const rpc = (method, params = {}) => JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params });
const devRpc = async (method, params = {}) => {
  const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: devHeaders, body: rpc(method, params) });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  if (body.error) throw new Error(body.error.message);
  return body.result;
};
const keys = await crypto.webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
const publicKey = await crypto.webcrypto.subtle.exportKey('jwk', keys.publicKey);
const thiefKeys = await crypto.webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
const makeCapability = async ({ raw, operation, agent, room = 'main', ttlMs = 60_000 }) => {
  const now = Date.now();
  return mintAgentCapability({ iss: 'https://chat.ax.local', sub: 'external-agent', aud: 'chat-ax-agent', room, agent, operation, requestDigest: await agentDigest(raw), jti: crypto.randomUUID(), nonce: crypto.randomUUID(), publicKey, cnf: await agentPublicKeyDigest(publicKey), iat: now, exp: now + ttlMs }, secret);
};
const authorizedFetch = async ({ path = '/mcp', raw = '', method = 'POST', envelope, key = keys.privateKey }) => fetch(`${origin}${path}`, { method, headers: { ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), 'x-agent-capability': envelope.capability, dpop: await createAgentProof(envelope.capability, envelope.claims, key, method, path, raw) }, ...(method === 'POST' ? { body: raw } : {}) });

const listed = await devRpc('tools/call', { name: 'list_agents', arguments: {} });
const root = listed.structuredContent.agents.find((agent) => agent.parentId === null);
assert(root?.id, 'root agent missing');
const createRaw = rpc('tools/call', { name: 'create_agent', arguments: { parentId: root.id } });
const createCapability = await makeCapability({ raw: createRaw, operation: 'fleet.write', agent: root.id });
const handoffKeys = await crypto.webcrypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, false, ['encrypt', 'decrypt']);
const handoffPublicKey = await crypto.webcrypto.subtle.exportKey('jwk', handoffKeys.publicKey);
const encrypted = await encryptAgentHandoff({ createCapability }, handoffPublicKey);
assert(!JSON.stringify(encrypted).includes(createCapability.capability));
const handoff = await decryptAgentHandoff(encrypted, handoffKeys.privateKey);

const subscribe = async (agent, after = 0, ttlMs = 30_000) => {
  const path = `/api/fleet/events?after=${after}&agent=${encodeURIComponent(agent)}`;
  const envelope = await makeCapability({ raw: '', operation: 'fleet.subscribe', agent, ttlMs });
  const headers = { 'x-agent-capability': envelope.capability, dpop: await createAgentProof(envelope.capability, envelope.claims, keys.privateKey, 'GET', path, '') };
  const socket = new WebSocket(`${origin.replace(/^http/, 'ws')}${path}`, { headers });
  const frames = [];
  const waiters = new Set();
  let closed = false;
  socket.on('message', (data) => {
    const frame = JSON.parse(String(data));
    frames.push(frame);
    if (frame.type === 'closing') closed = true;
    for (const wake of waiters) wake();
  });
  socket.on('close', () => {
    closed = true;
    for (const wake of waiters) wake();
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('unexpected-response', (_request, response) => reject(new Error(`subscribe rejected ${response.statusCode}`)));
  });
  const wait = () => new Promise((resolve) => { waiters.add(resolve); setTimeout(resolve, 100); }).finally(() => waiters.clear());
  return { socket, frames, wait, isClosed: () => closed, envelope };
};
const baselineResponse = await fetch(`${origin}/api/dev/fleet-receipts`, { headers: devHeaders });
assert.equal(baselineResponse.status, 200);
const baselineReceipts = (await baselineResponse.json()).receipts;
const baselineCursor = baselineReceipts.reduce((maximum, receipt) => Math.max(maximum, receipt.cursor ?? 0), 0);
const firstSubscriber = await subscribe(root.id, baselineCursor);
const secondSubscriber = await subscribe(root.id, baselineCursor);
const createdResponse = await authorizedFetch({ raw: createRaw, envelope: handoff.createCapability });
assert.equal(createdResponse.status, 200);
const createdBody = await createdResponse.json();
const child = createdBody.result.structuredContent.agent;
assert.equal(child.parentId, root.id);
const replay = await authorizedFetch({ raw: createRaw, envelope: handoff.createCapability });
assert.equal(replay.status, 200);
assert.equal((await replay.json()).result.structuredContent.agent.id, child.id);

const nextEvent = async (subscriber, type, timeoutMs = 4000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const index = subscriber.frames.findIndex((frame) => frame.type === 'fleet' && frame.event.type === type);
    if (index >= 0) return subscriber.frames.splice(index, 1)[0].event;
    if (subscriber.isClosed()) return null;
    await subscriber.wait();
  }
  throw new Error(`event timeout: ${type}`);
};
const [firstCreated, secondCreated] = await Promise.all([nextEvent(firstSubscriber, 'agent.created'), nextEvent(secondSubscriber, 'agent.created')]);
assert.equal(firstCreated.cursor, secondCreated.cursor);

const renameRaw = rpc('tools/call', { name: 'rename_agent', arguments: { agentId: child.id, title: `Realtime Child ${crypto.randomUUID().slice(0, 8)}` } });
const renameCapability = await makeCapability({ raw: renameRaw, operation: 'fleet.write', agent: child.id });
const renameResponse = await authorizedFetch({ raw: renameRaw, envelope: renameCapability });
assert.equal(renameResponse.status, 200);
const renameBody = await renameResponse.json();
assert.equal(renameBody.error, undefined, JSON.stringify(renameBody));
const renamed = await nextEvent(secondSubscriber, 'agent.renamed');
assert(renamed.cursor > firstCreated.cursor);
const restartedSubscriber = await subscribe(root.id, firstCreated.cursor);
const replayedRename = await nextEvent(restartedSubscriber, 'agent.renamed');
assert.equal(replayedRename.cursor, renamed.cursor);
restartedSubscriber.socket.close();

const wrongRoomCapability = await makeCapability({ raw: renameRaw, operation: 'fleet.write', agent: child.id, room: 'wrong-room' });
assert.equal((await authorizedFetch({ raw: renameRaw, envelope: wrongRoomCapability })).status, 401);
const wrongAgentCapability = await makeCapability({ raw: renameRaw, operation: 'fleet.write', agent: 'wrong-agent' });
assert.equal((await authorizedFetch({ raw: renameRaw, envelope: wrongAgentCapability })).status, 403);
const stolenCapability = await makeCapability({ raw: renameRaw, operation: 'fleet.write', agent: child.id });
assert.equal((await authorizedFetch({ raw: renameRaw, envelope: stolenCapability, key: thiefKeys.privateKey })).status, 401);
const expiredCapability = await makeCapability({ raw: renameRaw, operation: 'fleet.write', agent: child.id, ttlMs: 100 });
await new Promise((resolve) => setTimeout(resolve, 150));
assert.equal((await authorizedFetch({ raw: renameRaw, envelope: expiredCapability })).status, 401);
const revokedCapability = await makeCapability({ raw: renameRaw, operation: 'fleet.write', agent: child.id });
const revokePath = '/api/agent-capability/revoke';
assert.equal((await authorizedFetch({ path: revokePath, raw: '', envelope: revokedCapability })).status, 200);
assert.equal((await authorizedFetch({ raw: renameRaw, envelope: revokedCapability })).status, 401);
const expiringSubscriber = await subscribe(root.id, 0, 250);
const expiryDeadline = Date.now() + 3000;
while (!expiringSubscriber.isClosed() && Date.now() < expiryDeadline) await expiringSubscriber.wait();
assert.equal(expiringSubscriber.isClosed(), true);
const revokedSubscriber = await subscribe(root.id, 0);
assert.equal((await authorizedFetch({ path: revokePath, raw: '', envelope: revokedSubscriber.envelope })).status, 200);
const revokeDeadline = Date.now() + 3000;
while (!revokedSubscriber.isClosed() && Date.now() < revokeDeadline) await revokedSubscriber.wait();
assert.equal(revokedSubscriber.isClosed(), true);
firstSubscriber.socket.close();
secondSubscriber.socket.close();
const receiptsResponse = await fetch(`${origin}/api/dev/fleet-receipts`, { headers: devHeaders });
assert.equal(receiptsResponse.status, 200);
const receipts = (await receiptsResponse.json()).receipts;
assert(receipts.some((receipt) => receipt.type === 'agent.created' && receipt.agentId === child.id));
assert(receipts.some((receipt) => receipt.type === 'agent.renamed' && receipt.agentId === child.id));
console.log('PASS encrypted agent handoff, Fleet MCP authority, two live WebSocket subscribers, cursor replay, receipts, socket expiry, live revocation, and PoP denials');
process.exit(0);
