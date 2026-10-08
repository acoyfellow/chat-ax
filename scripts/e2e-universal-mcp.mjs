import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const baseUrl = option('--base-url')?.replace(/\/$/, '');
const receiptPath = option('--receipt');
const production = args.includes('--production');
assert(baseUrl, '--base-url is required');
assert(receiptPath, '--receipt is required');

let rpcId = 0;
const rpc = async (method, params = {}, expectError = false) => {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const body = await response.json();
  if (expectError) {
    assert(body.error, `${method} should fail`);
    return body.error;
  }
  assert.equal(body.error, undefined, `${method}: ${body.error?.message}`);
  return body.result;
};
const call = async (name, values = {}, expectError = false) =>
  rpc('tools/call', { name, arguments: values }, expectError);
const structured = (result) => result.structuredContent;
const runSuffix = crypto.randomUUID().slice(0, 8);
const invocation = (() => {
  let index = 0;
  return (label) => `universal-${runSuffix}-${label}-${String(++index).padStart(3, '0')}`;
})();
const called = new Set();
const invoke = async (name, values = {}, expectError = false) => {
  called.add(name);
  return call(name, values, expectError);
};

const toolsResult = await rpc('tools/list');
const resourcesResult = await rpc('resources/list');
const templatesResult = await rpc('resources/templates/list');
const eventsResult = await rpc('events/list');
const tools = toolsResult.tools;
const toolNames = tools.map((tool) => tool.name);
assert.equal(new Set(toolNames).size, toolNames.length);
for (const tool of tools) assert.notEqual(tool.inputSchema?.additionalProperties, true);
assert(resourcesResult.resources.length >= 6);
assert(templatesResult.resourceTemplates.length >= 4);
assert.equal(eventsResult.events.length, 1);

const read = async (uri) => {
  const result = await rpc('resources/read', { uri });
  assert.equal(result.contents[0].uri, uri);
  return JSON.parse(result.contents[0].text);
};
const fleet = await read('chat-ax://fleet/agents');
assert.equal((await fetch(`${baseUrl}/api/fleet/events?after=0`)).status, 426);
const eventSocket = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/api/fleet/events?after=0`);
const firstEventFrame = await new Promise((resolve, reject) => {
  eventSocket.addEventListener('message', (event) => resolve(JSON.parse(event.data)), { once: true });
  eventSocket.addEventListener('error', reject, { once: true });
});
assert.equal(firstEventFrame.type, 'ready');
const fleetFrames = [];
eventSocket.addEventListener('message', (event) => fleetFrames.push(JSON.parse(event.data)));
const rootId = fleet.agents.find((agent) => agent.parentId === null)?.id;
assert(rootId);
for (const uri of [
  'chat-ax://room',
  'chat-ax://fleet/activity',
  'chat-ax://fleet/deletions',
  'chat-ax://orchestration',
  'chat-ax://reviews',
  'chat-ax://receipts',
  'chat-ax://proof/readiness',
  `chat-ax://agents/${rootId}`,
  `chat-ax://agents/${rootId}/conversation`,
  `chat-ax://agents/${rootId}/work`,
  `chat-ax://agents/${rootId}/receipts`,
])
  await read(uri);

const proofState = structured(
  await invoke('agent_state_create', {
    invocationId: invocation('state-create'),
    agentId: rootId,
    key: 'universal-proof',
    value: 'created',
  }),
);
const stateId = proofState.result.entry.id;
const replay = structured(
  await call('agent_state_create', {
    invocationId: proofState.invocationId,
    agentId: rootId,
    key: 'universal-proof',
    value: 'created',
  }),
);
assert.equal(replay.replayed, true);
assert.equal(replay.receiptId, proofState.receiptId);
const changedReplayDenial = await call(
  'agent_state_create',
  {
    invocationId: proofState.invocationId,
    agentId: rootId,
    key: 'universal-proof',
    value: 'changed',
  },
  true,
);
assert.equal(changedReplayDenial.message, 'Invocation identity is bound to different arguments');
const deniedArguments = {
  invocationId: invocation('denied-target'),
  agentId: 'missing-universal-proof-agent',
  key: 'universal-proof',
  value: 'denied',
};
const denied = await call('agent_state_create', deniedArguments, true);
const deniedReplay = await call('agent_state_create', deniedArguments, true);
assert.equal(deniedReplay.message, denied.message);

if (production) {
  await invoke('agent_state_delete', {
    invocationId: invocation('state-delete'),
    agentId: rootId,
    id: stateId,
  });
  const receipts = await read('chat-ax://receipts');
  assert(receipts.receipts.some((receipt) => receipt.id === proofState.receiptId));
} else {
  const faultInvocationId = invocation('outcome-unknown');
  const faultResponse = await fetch(`${baseUrl}/api/dev/universal-mcp/fail-after-admission`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ invocationId: faultInvocationId }),
  });
  assert.equal(faultResponse.ok, true);
  const faultArguments = {
    invocationId: faultInvocationId,
    agentId: rootId,
    key: 'universal-proof-fault',
    value: 'must-not-execute',
  };
  await call('agent_state_create', faultArguments, true);
  const unknownReplay = await call('agent_state_create', faultArguments, true);
  assert.equal(unknownReplay.message, 'Operation outcome is unknown; do not retry');

  await invoke('agent_state_update', {
    invocationId: invocation('state-update'),
    agentId: rootId,
    id: stateId,
    key: 'universal-proof',
    value: 'updated',
  });
  await invoke('agent_state_delete', {
    invocationId: invocation('state-delete'),
    agentId: rootId,
    id: stateId,
  });

  await invoke('ui_open_conversation', {
    invocationId: invocation('ui-conversation'),
    agentId: rootId,
  });
  await invoke('agent_settings_update', {
    invocationId: invocation('settings'),
    agentId: rootId,
    settings: { thinkingLevel: 'xhigh', agentAvatarSeed: 'universal-proof-avatar' },
  });
  await invoke('chat_send_message', {
    invocationId: invocation('message'),
    agentId: rootId,
    text: 'Universal MCP local proof message.',
  });
  await invoke('chat_cancel_message', {
    invocationId: invocation('cancel'),
    agentId: rootId,
    messageId: 'universal-proof-missing-message',
  });
  await invoke('chat_clear_history', {
    invocationId: invocation('clear'),
    agentId: rootId,
  });
  const compactInvocationId = invocation('compact');
  const compacted = structured(
    await invoke('chat_compact_context', { invocationId: compactInvocationId, agentId: rootId }),
  );
  const compactReplay = structured(
    await call('chat_compact_context', { invocationId: compactInvocationId, agentId: rootId }),
  );
  assert.equal(compactReplay.replayed, true);
  assert.equal(compactReplay.receiptId, compacted.receiptId);

  await invoke('agent_skill_create', {
    invocationId: invocation('skill-create'),
    agentId: rootId,
    name: 'universal-proof-skill',
    description: 'Proof skill',
    body: 'Return bounded proof output.',
  });
  await invoke('agent_skill_update', {
    invocationId: invocation('skill-update'),
    agentId: rootId,
    name: 'universal-proof-skill',
    description: 'Updated proof skill',
    body: 'Return updated bounded proof output.',
  });
  await invoke('agent_skill_delete', {
    invocationId: invocation('skill-delete'),
    agentId: rootId,
    name: 'universal-proof-skill',
  });

  const job = structured(
    await invoke('agent_job_create', {
      invocationId: invocation('job-create'),
      agentId: rootId,
      name: 'Universal proof job',
      prompt: 'Do not execute during proof.',
      intervalSeconds: 3600,
      repeat: true,
    }),
  ).result.job;
  await invoke('agent_job_update', {
    invocationId: invocation('job-update'),
    agentId: rootId,
    id: job.id,
    name: 'Universal proof job updated',
    prompt: 'Remain idle during proof.',
    intervalSeconds: 7200,
    repeat: true,
  });
  await invoke('agent_job_pause', {
    invocationId: invocation('job-pause'),
    agentId: rootId,
    id: job.id,
  });
  await invoke('agent_job_resume', {
    invocationId: invocation('job-resume'),
    agentId: rootId,
    id: job.id,
  });

  const file = structured(
    await invoke('agent_file_upload', {
      invocationId: invocation('file-upload'),
      agentId: rootId,
      name: `universal-proof-${runSuffix}.txt`,
      mediaType: 'text/plain',
      text: 'bounded proof file',
    }),
  ).result.file;
  const fileContent = await read(`chat-ax://agents/${rootId}/files/${file.id}`);
  assert.equal(fileContent.file.text, 'bounded proof file');
  const redactedSnapshot = await read(`chat-ax://agents/${rootId}`);
  assert.equal(JSON.stringify(redactedSnapshot).includes('objectKey'), false);

  await invoke('orchestration_update', {
    invocationId: invocation('orchestration-mesh'),
    mode: 'mesh',
  });
  await invoke('orchestration_update', {
    invocationId: invocation('orchestration-strict'),
    mode: 'strict',
  });

  await invoke('list_agents');
  const childA = structured(
    await invoke('create_agent', { parentId: rootId, title: `Universal proof A ${runSuffix}` }),
  ).agent;
  const childB = structured(
    await invoke('create_agent', { parentId: rootId, title: `Universal proof B ${runSuffix}` }),
  ).agent;
  const observedFleetEvent = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 10_000);
    const seen = (frame) =>
      frame.type === 'fleet' && (frame.event.agentId === childA.id || frame.event.agentId === childB.id);
    if (fleetFrames.some(seen)) {
      clearTimeout(timer);
      resolve(true);
      return;
    }
    eventSocket.addEventListener('message', (event) => {
      if (!seen(JSON.parse(event.data))) return;
      clearTimeout(timer);
      resolve(true);
    });
  });
  assert.equal(observedFleetEvent, true);
  await invoke('rename_agent', {
    agentId: childA.id,
    title: `Universal proof A renamed ${runSuffix}`,
  });
  const context = structured(await invoke('get_agent_context', { agentId: childA.id })).context;
  await invoke('update_agent_context', { agentId: childA.id, context });
  await invoke('delegate_to_agent', {
    message: {
      messageId: 'universal-delegation-1',
      fromAgentId: rootId,
      toAgentId: childA.id,
      roomId: 'default',
      taskId: 'universal-proof-task',
      payload: { kind: 'proof' },
      requestedCapabilities: [],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  });
  await invoke('send_agent_message', {
    fromAgentId: rootId,
    toAgentId: childA.id,
    message: 'Parent to child proof.',
  });
  await invoke('transfer_agent_file', {
    fromAgentId: rootId,
    toAgentId: childA.id,
    fileId: file.id,
  });
  await invoke('inspect_agent_job', {
    fromAgentId: rootId,
    toAgentId: childA.id,
    jobId: job.id,
  });
  const grant = structured(
    await invoke('grant_agent_communication', {
      fromAgentId: childA.id,
      toAgentId: childB.id,
      actions: ['message'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
  ).grant;
  await invoke('revoke_agent_communication', { grantId: grant.id });

  const requested = structured(
    await invoke('request_person', {
      recipientEmail: 'universal-proof-recipient@example.invalid',
      recipientName: 'Proof recipient',
      title: 'Universal MCP proof request',
      details: 'Local disposable request.',
    }),
  ).request;
  await invoke('list_my_requests');
  await invoke('get_request', { requestId: requested.id });
  await invoke(
    'respond_to_request',
    {
      requestId: requested.id,
      action: 'accept',
      response: 'Accepted locally.',
    },
    true,
  );
  const cancellable = structured(
    await invoke('request_person', {
      recipientEmail: 'universal-proof-recipient@example.invalid',
      recipientName: 'Proof recipient',
      title: 'Universal MCP cancellable request',
      details: 'Local disposable request.',
    }),
  ).request;
  await invoke('cancel_request', { requestId: cancellable.id });

  await invoke('delete_agent', { agentId: childB.id });
  await invoke('delete_agent', { agentId: childA.id });
  await invoke('agent_file_delete', {
    invocationId: invocation('file-delete'),
    agentId: rootId,
    fileId: file.id,
  });
  await invoke('agent_job_delete', {
    invocationId: invocation('job-delete'),
    agentId: rootId,
    id: job.id,
  });

  const missing = toolNames.filter((name) => !called.has(name));
  assert.deepEqual(missing, []);
}

eventSocket.close();
const readinessResponse = await fetch(`${baseUrl}/api/production-readiness`);
const readiness = { status: readinessResponse.status, body: await readinessResponse.json() };
if (production) {
  assert.equal(readiness.status, 200);
  assert.equal(readiness.body.status, 'ready');
}
const receipt = {
  marker: 'CHAT_AX_UNIVERSAL_MCP_PASS',
  mode: production ? 'production' : 'local',
  build: readiness.body.build,
  manifest: {
    tools: toolNames,
    resources: resourcesResult.resources.map((resource) => resource.uri),
    resourceTemplates: templatesResult.resourceTemplates.map((resource) => resource.uriTemplate),
    events: eventsResult.events.map((event) => event.name),
  },
  coverage: {
    called: [...called].sort(),
    unexercisedTools: toolNames.filter((name) => !called.has(name)),
  },
  replay: {
    receiptId: proofState.receiptId,
    sameReceipt: replay.receiptId === proofState.receiptId,
    changedArgumentsDenied: changedReplayDenial.message,
    terminalDenialReplayed: deniedReplay.message === denied.message,
  },
  readiness,
  verifiedAt: new Date().toISOString(),
};
fs.mkdirSync(path.dirname(receiptPath), { recursive: true, mode: 0o700 });
fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
console.log(`CHAT_AX_UNIVERSAL_MCP_PASS mode=${receipt.mode} tools=${toolNames.length}`);
