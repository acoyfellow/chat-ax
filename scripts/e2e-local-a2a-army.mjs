import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = 19500 + Math.floor(Math.random() * 400);
const origin = `http://127.0.0.1:${port}`;
const persist = await mkdtemp(join(tmpdir(), 'chat-ax-a2a-army-'));
const headers = {
  'content-type': 'application/json',
  'x-dev-user-email': 'a2a-army@example.com',
  'x-dev-user-name': 'A2A Army',
};
let rpcId = 0;
let commanderId;

const server = spawn(
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

const waitForServer = async () => {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      if ((await fetch(`${origin}/api/threads`, { headers })).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('local Chat AX did not start');
};

const mcpResult = async (name, args = {}) => {
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
  return { response, body };
};

const mcp = async (name, args = {}) => {
  const { response, body } = await mcpResult(name, args);
  assert(response.ok && !body.error, `${name} failed`);
  return body.result.structuredContent;
};

const denied = async (name, args = {}) => {
  const { body } = await mcpResult(name, args);
  assert(body.error || body.result?.isError, `${name} was unexpectedly allowed`);
};

const create = async (parentId, title) => {
  const response = await fetch(`${origin}/api/threads`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ parentId, title }),
  });
  assert.equal(response.status, 201, `${title} was not created`);
  return (await response.json()).node;
};

const snapshot = async (agentId) => {
  const response = await fetch(`${origin}/api/messages?threadId=${encodeURIComponent(agentId)}`, {
    headers,
  });
  assert.equal(response.status, 200, `snapshot unavailable for ${agentId}`);
  return response.json();
};

const setPosture = async (mode) => {
  const response = await fetch(`${origin}/api/orchestration`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ mode }),
  });
  assert.equal(response.status, 200, `could not set ${mode} posture`);
};

try {
  await waitForServer();
  const initial = await mcp('list_agents');
  const root = initial.agents.find((agent) => agent.parentId === null);
  assert(root?.id, 'root agent is missing');

  const commander = await create(root.id, 'A2A Army Commander');
  commanderId = commander.id;
  const army = [commander];
  army.push(
    ...(await Promise.all(
      Array.from({ length: 8 }, (_, offset) =>
        create(commander.id, `A2A Unit ${String(offset + 1).padStart(2, '0')}`),
      ),
    )),
  );
  assert.equal(
    (await mcp('list_agents')).agents.filter((agent) => army.some((unit) => unit.id === agent.id))
      .length,
    9,
  );
  for (let index = 9; index < 33; index += 1) {
    const parent = army[1 + ((index - 9) % 8)];
    army.push(await create(parent.id, `A2A Unit ${String(index).padStart(2, '0')}`));
  }
  for (let index = 33; index < 65; index += 1) {
    const parent = army[9 + ((index - 33) % 24)];
    army.push(await create(parent.id, `A2A Unit ${String(index).padStart(2, '0')}`));
  }
  assert.equal(army.length, 65);
  assert(
    Math.max(
      ...army.map((agent) => {
        let depth = 0;
        let current = agent;
        while (current.parentId && current.id !== commander.id) {
          depth += 1;
          current = army.find((candidate) => candidate.id === current.parentId) ?? commander;
        }
        return depth;
      }),
    ) >= 3,
  );

  const turnAgents = army.filter((_, index) => index > 0 && index % 8 === 1).slice(0, 8);
  const turnMarkers = new Map(
    turnAgents.map((agent, index) => [agent.id, `independent-turn-${index}-${agent.id}`]),
  );
  const submittedTurns = await Promise.all(
    turnAgents.map(async (agent) => {
      const response = await fetch(`${origin}/api/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: turnMarkers.get(agent.id), threadId: agent.id }),
      });
      assert.equal(response.status, 202);
      return (await response.json()).message.id;
    }),
  );
  const deadline = Date.now() + 30_000;
  let completedTurns = [];
  while (Date.now() < deadline) {
    completedTurns = await Promise.all(turnAgents.map((agent) => snapshot(agent.id)));
    if (
      completedTurns.every((value, index) =>
        value.messages.some(
          (message) =>
            message.role === 'assistant' &&
            message.replyTo === submittedTurns[index] &&
            (message.status === 'complete' || message.status === 'error'),
        ),
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const [index, value] of completedTurns.entries()) {
    assert(
      value.messages.some(
        (message) => message.role === 'assistant' && message.replyTo === submittedTurns[index],
      ),
    );
    for (const [agentId, marker] of turnMarkers)
      assert.equal(
        value.messages.some((message) => message.text === marker),
        agentId === turnAgents[index].id,
      );
  }

  for (const target of army.slice(1)) {
    const marker = `vertical-${target.id}`;
    await mcp('send_agent_message', {
      fromAgentId: target.parentId,
      toAgentId: target.id,
      message: marker,
    });
    assert((await snapshot(target.id)).messages.some((message) => message.text === marker));
  }

  const siblingA = army[1];
  const siblingB = army[2];
  await denied('send_agent_message', {
    fromAgentId: siblingA.id,
    toAgentId: siblingB.id,
    message: 'strict-lateral-denied',
  });
  assert(
    !(await snapshot(siblingB.id)).messages.some(
      (message) => message.text === 'strict-lateral-denied',
    ),
  );

  await setPosture('mesh');
  const messageGrant = (
    await mcp('grant_agent_communication', {
      fromAgentId: siblingA.id,
      toAgentId: siblingB.id,
      actions: ['message'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
  ).grant;
  const racedMessages = await Promise.all([
    mcpResult('send_agent_message', {
      fromAgentId: siblingA.id,
      toAgentId: siblingB.id,
      message: 'mesh-race-one',
    }),
    mcpResult('send_agent_message', {
      fromAgentId: siblingA.id,
      toAgentId: siblingB.id,
      message: 'mesh-race-two',
    }),
  ]);
  assert.equal(racedMessages.filter(({ body }) => !body.error && !body.result?.isError).length, 1);
  const siblingMessages = (await snapshot(siblingB.id)).messages;
  assert.equal(
    siblingMessages.filter((message) => ['mesh-race-one', 'mesh-race-two'].includes(message.text))
      .length,
    1,
  );
  await denied('transfer_agent_file', {
    fromAgentId: siblingA.id,
    toAgentId: siblingB.id,
    fileId: 'not-authorized',
  });

  const upload = new FormData();
  upload.set('file', new File(['army-file-contents'], 'army.txt', { type: 'text/plain' }));
  const uploadedResponse = await fetch(
    `${origin}/api/files?threadId=${encodeURIComponent(siblingA.id)}`,
    {
      method: 'POST',
      headers: {
        'x-dev-user-email': headers['x-dev-user-email'],
        'x-dev-user-name': headers['x-dev-user-name'],
      },
      body: upload,
    },
  );
  assert.equal(uploadedResponse.status, 201);
  const uploaded = (await uploadedResponse.json()).file;
  const fileGrant = (
    await mcp('grant_agent_communication', {
      fromAgentId: siblingA.id,
      toAgentId: siblingB.id,
      actions: ['file'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
  ).grant;
  const transferred = await mcp('transfer_agent_file', {
    fromAgentId: siblingA.id,
    toAgentId: siblingB.id,
    fileId: uploaded.id,
  });
  const destinationFile = (await snapshot(siblingB.id)).files.find(
    (file) => file.id === transferred.file.id,
  );
  assert(destinationFile);
  assert.notEqual(destinationFile.objectKey, uploaded.objectKey);
  const contentResponse = await fetch(
    `${origin}/api/files/${encodeURIComponent(destinationFile.id)}/content?threadId=${encodeURIComponent(siblingB.id)}`,
    { headers },
  );
  assert.equal(await contentResponse.text(), 'army-file-contents');

  const jobResponse = await fetch(
    `${origin}/api/jobs?threadId=${encodeURIComponent(siblingA.id)}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Source-only job',
        prompt: 'private scheduled prompt',
        intervalSeconds: 3600,
        maxRuns: 1,
      }),
    },
  );
  assert.equal(jobResponse.status, 201);
  const job = (await jobResponse.json()).job;
  const jobGrant = (
    await mcp('grant_agent_communication', {
      fromAgentId: siblingA.id,
      toAgentId: siblingB.id,
      actions: ['job-summary'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
  ).grant;
  const summary = await mcp('inspect_agent_job', {
    fromAgentId: siblingA.id,
    toAgentId: siblingB.id,
    jobId: job.id,
  });
  assert.equal(summary.job.name, 'Source-only job');
  assert.equal('prompt' in summary.job, false);
  const jobDestination = await snapshot(siblingB.id);
  assert.equal(
    jobDestination.jobs.some((candidate) => candidate.id === job.id),
    false,
  );
  const deliveredSummary = jobDestination.messages.find((message) =>
    message.text.startsWith('Job summary:'),
  );
  assert(deliveredSummary);
  assert.equal(deliveredSummary.text.includes('private scheduled prompt'), false);

  await mcp('revoke_agent_communication', { grantId: messageGrant.id });
  await denied('send_agent_message', {
    fromAgentId: siblingA.id,
    toAgentId: siblingB.id,
    message: 'revoked-message-denied',
  });
  const expiredGrant = (
    await mcp('grant_agent_communication', {
      fromAgentId: siblingA.id,
      toAgentId: siblingB.id,
      actions: ['message'],
      expiresAt: new Date(Date.now() + 150).toISOString(),
    })
  ).grant;
  assert(expiredGrant.id);
  await new Promise((resolve) => setTimeout(resolve, 250));
  await denied('send_agent_message', {
    fromAgentId: siblingA.id,
    toAgentId: siblingB.id,
    message: 'expired-message-denied',
  });
  await mcp('revoke_agent_communication', { grantId: fileGrant.id });
  await mcp('revoke_agent_communication', { grantId: jobGrant.id });

  const eventsResponse = await fetch(`${origin}/api/dev/communication-events`, { headers });
  const events = (await eventsResponse.json()).events;
  assert(events.some((event) => event.type === 'communication.sent'));
  assert(events.some((event) => event.type === 'communication.delivered'));
  assert(events.some((event) => event.type === 'communication.failed'));
  const serializedEvents = JSON.stringify(events);
  for (const privateValue of [
    'mesh-race-one',
    'mesh-race-two',
    'strict-lateral-denied',
    'army-file-contents',
    'private scheduled prompt',
  ]) {
    assert.equal(serializedEvents.includes(privateValue), false);
  }

  await setPosture('strict');
  const toolDiagnosticsResponse = await fetch(`${origin}/api/dev/a2a-diagnostics`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ agentIds: army.map((agent) => agent.id) }),
  });
  assert.equal(toolDiagnosticsResponse.status, 200);
  assert.equal((await toolDiagnosticsResponse.json()).requesterBoundToolRuntimes, 65);

  await mcp('delete_agent', { agentId: commander.id });
  commanderId = undefined;
  const finalFleet = await mcp('list_agents');
  assert.equal(
    finalFleet.agents.some((agent) => army.some((unit) => unit.id === agent.id)),
    false,
  );
  for (const agent of army) {
    await denied('get_agent_context', { agentId: agent.id });
  }
  const diagnosticsResponse = await fetch(`${origin}/api/dev/a2a-diagnostics`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ agentIds: army.map((agent) => agent.id) }),
  });
  assert.equal(diagnosticsResponse.status, 200);
  const diagnostics = await diagnosticsResponse.json();
  const [deletionOrder] = diagnostics.deletionOrders;
  assert.equal(deletionOrder.length, 65);
  const deletionIndex = new Map(deletionOrder.map((agentId, index) => [agentId, index]));
  for (const agent of army.filter((unit) => deletionIndex.has(unit.parentId)))
    assert(deletionIndex.get(agent.id) < deletionIndex.get(agent.parentId));
  assert.deepEqual(
    { ...diagnostics, deletionOrders: undefined },
    {
      initializedRuntimes: 0,
      deletingRuntimes: 0,
      requesterBoundToolRuntimes: 0,
      objects: 0,
      grants: 0,
      plans: 0,
      results: 1,
      deletionOrders: undefined,
    },
  );
  console.log('A2A_ARMY_PASS');
} finally {
  if (commanderId) {
    try {
      await setPosture('strict');
      await mcp('delete_agent', { agentId: commanderId });
    } catch {}
  }
  server.kill('SIGTERM');
  await rm(persist, { recursive: true, force: true });
}
