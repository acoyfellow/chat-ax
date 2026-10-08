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
assert(baseUrl, '--base-url is required');
assert(receiptPath, '--receipt is required');
let rpcId = 0;
const request = (url, options = {}) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
const rpc = async (method, params = {}) => {
  const response = await request(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const body = await response.json();
  assert.equal(body.error, undefined, body.error?.message);
  return body.result;
};
const call = async (name, values = {}) =>
  (await rpc('tools/call', { name, arguments: values })).structuredContent;
const read = async (uri) => {
  const result = await rpc('resources/read', { uri });
  return JSON.parse(result.contents[0].text);
};
const fleet = await read('chat-ax://fleet/agents');
const rootId = fleet.agents.find((agent) => agent.parentId === null)?.id;
assert(rootId);
const suffix = crypto.randomUUID().slice(0, 8);
const source = (await call('create_agent', { parentId: rootId, title: `Native source ${suffix}` }))
  .agent;
let child;
let sibling;
try {
  sibling = (await call('create_agent', { parentId: rootId, title: `Native sibling ${suffix}` }))
    .agent;
  child = (await call('create_agent', { parentId: source.id, title: `Native child ${suffix}` }))
    .agent;
} catch (error) {
  await call('delete_agent', { agentId: source.id });
  throw error;
}
const expectedTools = [
  'list_state',
  'create_state',
  'update_state',
  'delete_state',
  'list_jobs',
  'create_job',
  'update_job',
  'pause_job',
  'resume_job',
  'delete_job',
  'list_skills',
  'read_skill',
  'create_skill',
  'update_skill',
  'delete_skill',
  'list_files',
  'read_file',
  'create_file',
  'delete_file',
  'read_settings',
  'update_settings',
  'list_work',
  'list_subagents',
  'send_subagent_test_message',
];
const submit = async (text) => {
  const response = await request(`${baseUrl}/api/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ threadId: source.id, text }),
  });
  assert.equal(response.ok, true);
  const submitted = await response.json();
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const snapshot = await (
      await request(`${baseUrl}/api/messages?threadId=${encodeURIComponent(source.id)}`)
    ).json();
    const reply = snapshot.messages.find((message) => message.replyTo === submitted.message.id);
    if (reply?.status === 'complete') return reply.text;
    if (reply?.status === 'error') throw new Error(`Agent turn failed: ${reply.text}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Agent turn timed out');
};
const prompt = (toolName, arguments_) =>
  submit(`NATIVE_TOOL_PROOF ${toolName} ${JSON.stringify(arguments_)}`);
try {
  const diagnosticResponse = await request(`${baseUrl}/api/dev/a2a-diagnostics`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentIds: [source.id, sibling.id] }),
  });
  assert.equal(diagnosticResponse.ok, true);
  const diagnostics = await diagnosticResponse.json();
  assert.equal(diagnostics.initializedRuntimes, 2);
  assert.equal(diagnostics.nativeResourceToolRuntimes, 2);
  const capabilityResponse = (await submit('NATIVE_CAPABILITY_PROOF')).toLowerCase();
  await prompt('list_subagents', {});
  const marker = `native-subagent-${suffix}`;
  await prompt('send_subagent_test_message', { toAgentId: child.id, message: marker });
  const childConversation = await read(
    `chat-ax://agents/${encodeURIComponent(child.id)}/conversation`,
  );
  assert(JSON.stringify(childConversation).includes(marker));
  for (const category of ['state', 'jobs', 'skills', 'files', 'settings', 'work'])
    assert(capabilityResponse.includes(category), `Capability response omitted ${category}`);
  assert(capabilityResponse.includes('connector mcp'));

  await prompt('create_state', { key: `native-${suffix}`, value: 'source-only' });
  let snapshot = await read(`chat-ax://agents/${encodeURIComponent(source.id)}`);
  const stateId = snapshot.state.find((entry) => entry.key === `native-${suffix}`).id;
  const siblingSnapshot = await read(`chat-ax://agents/${encodeURIComponent(sibling.id)}`);
  assert(!siblingSnapshot.state.some((entry) => entry.id === stateId));
  await prompt('list_state', {});
  await prompt('update_state', { id: stateId, key: `native-${suffix}`, value: 'updated' });
  await prompt('delete_state', { id: stateId });

  await prompt('create_job', {
    name: `native-${suffix}`,
    prompt: 'Say proof',
    intervalSeconds: 3600,
    maxRuns: 2,
  });
  snapshot = await read(`chat-ax://agents/${encodeURIComponent(source.id)}`);
  const jobId = snapshot.jobs.find((job) => job.name === `native-${suffix}`).id;
  assert(
    !(await read(`chat-ax://agents/${encodeURIComponent(sibling.id)}`)).jobs.some(
      (job) => job.id === jobId,
    ),
  );
  await prompt('list_jobs', {});
  await prompt('update_job', {
    id: jobId,
    name: `native-${suffix}-updated`,
    prompt: 'Say proof',
    intervalSeconds: 3600,
    maxRuns: 2,
  });
  await prompt('pause_job', { id: jobId });
  await prompt('resume_job', { id: jobId });
  await prompt('delete_job', { id: jobId });

  await prompt('create_skill', {
    name: 'native-proof-skill',
    description: 'Temporary proof skill',
    body: 'Use this temporary proof skill.',
  });
  assert(
    !(await read(`chat-ax://agents/${encodeURIComponent(sibling.id)}`)).skills.some(
      (skill) => skill.name === 'native-proof-skill',
    ),
  );
  await prompt('list_skills', {});
  await prompt('read_skill', { name: 'native-proof-skill' });
  await prompt('update_skill', {
    name: 'native-proof-skill',
    description: 'Updated temporary proof skill',
  });
  await prompt('delete_skill', { name: 'native-proof-skill' });

  await prompt('create_file', {
    name: `native-${suffix}.txt`,
    mime: 'text/plain',
    content: suffix,
  });
  snapshot = await read(`chat-ax://agents/${encodeURIComponent(source.id)}`);
  const fileId = snapshot.files.find((file) => file.name === `native-${suffix}.txt`).id;
  assert(
    !(await read(`chat-ax://agents/${encodeURIComponent(sibling.id)}`)).files.some(
      (file) => file.id === fileId,
    ),
  );
  await prompt('list_files', {});
  await prompt('read_file', { id: fileId });
  await prompt('delete_file', { id: fileId });
  await prompt('read_settings', {});
  await prompt('update_settings', { agentAvatarSeed: `native-${suffix}` });
  assert.notEqual(
    (await read(`chat-ax://agents/${encodeURIComponent(sibling.id)}`)).settings.agentAvatarSeed,
    `native-${suffix}`,
  );
  await prompt('list_work', {});

  const agentReceipts = await read(`chat-ax://agents/${encodeURIComponent(source.id)}/receipts`);
  const succeeded = new Set(
    agentReceipts.receipts
      .filter((entry) => entry.status === 'succeeded')
      .map((entry) => entry.toolName),
  );
  for (const toolName of expectedTools)
    assert(succeeded.has(toolName), `Missing successful native receipt for ${toolName}`);
  snapshot = await read(`chat-ax://agents/${encodeURIComponent(source.id)}`);
  assert(!snapshot.state.some((entry) => entry.key === `native-${suffix}`));
  assert(!snapshot.jobs.some((job) => job.name.includes(suffix)));
  assert(!snapshot.skills.some((skill) => skill.name === 'native-proof-skill'));
  assert(!snapshot.files.some((file) => file.name === `native-${suffix}.txt`));
  const receipt = {
    result: 'pass',
    sourceAgentId: source.id,
    siblingAgentId: sibling.id,
    nativeResourceToolRuntimes: diagnostics.nativeResourceToolRuntimes,
    successfulNativeTools: [...succeeded].filter((name) => expectedTools.includes(name)).sort(),
    siblingStateIsolated: true,
    residue: { state: 0, jobs: 0, skills: 0, files: 0 },
    verifiedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.log('CHAT_AX_NATIVE_AGENT_TOOLS_LOCAL_PASS');
} finally {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await Promise.allSettled([
      call('delete_agent', { agentId: sibling.id }),
      call('delete_agent', { agentId: child.id }),
      call('delete_agent', { agentId: source.id }),
    ]);
    const remaining = (await read('chat-ax://fleet/agents')).agents.filter(
      (agent) => agent.id === sibling.id || agent.id === child.id || agent.id === source.id,
    );
    if (!remaining.length) break;
    if (attempt === 2) throw new Error('Local proof agent cleanup failed');
  }
}
