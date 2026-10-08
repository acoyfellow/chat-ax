import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = 18800 + Math.floor(Math.random() * 700);
const suppliedOrigin = process.env.CHAT_AX_URL;
const origin = suppliedOrigin ?? `http://127.0.0.1:${port}`;
const headers = {
  'content-type': 'application/json',
  'x-dev-user-email': 'isolation-e2e@example.com',
  'x-dev-user-name': 'Isolation E2E',
};
const persist = suppliedOrigin ? null : await mkdtemp(join(tmpdir(), 'chat-ax-agent-isolation-'));
let server;
let rpcId = 0;

const waitForServer = async () => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${origin}/api/threads`, { headers })).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('local Chat AX did not start');
};
const mcp = async (name, args = {}) => {
  const response = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++rpcId,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const body = await response.json();
  assert(response.ok && !body.error, JSON.stringify(body));
  return body.result.structuredContent;
};
const mcpDenied = async (name, args = {}) => {
  const response = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++rpcId,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const body = await response.json();
  assert(body.error, JSON.stringify(body));
  return body.error;
};
const create = async (body) => {
  const response = await fetch(`${origin}/api/threads`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const value = await response.json();
  assert.equal(response.status, 201, JSON.stringify(value));
  return value.node;
};
const context = async (agentId) => (await mcp('get_agent_context', { agentId })).context;
const update = async (agentId, value) => mcp('update_agent_context', { agentId, context: value });

try {
  if (!suppliedOrigin) {
    server = spawn(
      'npx',
      [
        'wrangler',
        'dev',
        '--config',
        'wrangler.test.jsonc',
        '--port',
        String(port),
        '--persist-to',
        persist,
      ],
      { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'ignore', 'inherit'] },
    );
  }
  await waitForServer();
  const fleet = await mcp('list_agents');
  const root = fleet.agents.find((agent) => agent.parentId === null);
  assert(root?.id);
  const [agentA, blankAgent] = await Promise.all([
    create({
      parentId: root.id,
      title: 'Isolation A',
      customization: {
        settings: { marker: 'a-settings' },
        skills: ['a-skill'],
        tools: [{ name: 'a-tool', label: 'A tool' }],
      },
    }),
    create({ parentId: root.id, title: 'Isolation Blank' }),
  ]);
  const childAgent = await create({ parentId: agentA.id, title: 'Isolation Child' });
  await mcp('send_agent_message', {
    fromAgentId: agentA.id,
    toAgentId: childAgent.id,
    message: 'vertical-secret',
  });
  assert(
    (await context(childAgent.id)).messages.some((message) => message.text === 'vertical-secret'),
  );
  await mcpDenied('send_agent_message', {
    fromAgentId: agentA.id,
    toAgentId: blankAgent.id,
    message: 'denied-secret',
  });
  const meshResponse = await fetch(`${origin}/api/orchestration`, { method: 'PUT', headers, body: JSON.stringify({ mode: 'mesh' }) });
  assert.equal(meshResponse.ok, true);
  const grant = (
    await mcp('grant_agent_communication', {
      fromAgentId: agentA.id,
      toAgentId: blankAgent.id,
      actions: ['message'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
  ).grant;
  await mcp('send_agent_message', {
    fromAgentId: agentA.id,
    toAgentId: blankAgent.id,
    message: 'granted-secret',
  });
  assert(
    (await context(blankAgent.id)).messages.some((message) => message.text === 'granted-secret'),
  );
  await mcpDenied('transfer_agent_file', {
    fromAgentId: agentA.id,
    toAgentId: blankAgent.id,
    fileId: 'missing',
  });
  await mcpDenied('inspect_agent_job', {
    fromAgentId: agentA.id,
    toAgentId: blankAgent.id,
    jobId: 'missing',
  });
  await mcp('revoke_agent_communication', { grantId: grant.id });
  await mcpDenied('send_agent_message', {
    fromAgentId: agentA.id,
    toAgentId: blankAgent.id,
    message: 'revoked-secret',
  });
  const audit = await (await fetch(`${origin}/api/dev/communication-events`, { headers })).json();
  assert(audit.events.some((event) => event.type === 'communication.sent'));
  assert(audit.events.some((event) => event.type === 'communication.delivered'));
  assert(audit.events.some((event) => event.type === 'communication.failed'));
  assert(!JSON.stringify(audit).includes('vertical-secret'));
  assert(!JSON.stringify(audit).includes('granted-secret'));
  assert(!JSON.stringify(audit).includes('denied-secret'));

  const [aBefore, blank] = await Promise.all([context(agentA.id), context(blankAgent.id)]);
  assert.notEqual(aBefore.sessionId, blank.sessionId);
  for (const name of ['skills', 'files', 'jobs', 'work']) assert.deepEqual(blank[name], []);
  assert.equal(blank.messages.length, 1);
  assert.deepEqual(blank.settings, {});
  assert(!JSON.stringify(blank).includes('a-settings'));

  const copiedAgent = await create({
    parentId: root.id,
    title: 'Isolation Copy',
    copyFromAgentId: agentA.id,
  });
  const copied = await context(copiedAgent.id);
  assert.notEqual(copied.sessionId, aBefore.sessionId);
  assert.deepEqual(copied.skills, aBefore.skills);
  assert.deepEqual(copied.files, aBefore.files);
  await update(agentA.id, { settings: { marker: 'a-changed' }, skills: ['a-changed-skill'] });
  const [aAfter, copyAfter] = await Promise.all([context(agentA.id), context(copiedAgent.id)]);
  assert.equal(aAfter.settings.marker, 'a-changed');
  assert.equal(copyAfter.settings.marker, 'a-settings');
  assert.deepEqual(copyAfter.skills, ['a-skill']);
  assert.deepEqual(copyAfter.files, []);
  assert(!JSON.stringify(blank).includes('a-changed'));

  await mcp('delete_agent', { agentId: agentA.id });
  await assert.rejects(() => context(agentA.id));
  assert.equal((await context(copiedAgent.id)).settings.marker, 'a-settings');
  await Promise.all([
    mcp('delete_agent', { agentId: blankAgent.id }),
    mcp('delete_agent', { agentId: copiedAgent.id }),
  ]);
  const finalFleet = await mcp('list_agents');
  assert(
    !finalFleet.agents.some((agent) =>
      [agentA.id, blankAgent.id, copiedAgent.id].includes(agent.id),
    ),
  );
  console.log('AGENT_ISOLATION_PASS');
} finally {
  if (server) server.kill('SIGTERM');
  if (persist) await rm(persist, { recursive: true, force: true });
}
