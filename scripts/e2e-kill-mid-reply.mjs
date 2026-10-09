import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = await new Promise((resolve) => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1', () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
const inspectorPort = await new Promise((resolve) => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1', () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
const base = `http://127.0.0.1:${port}`;
const persistence = mkdtempSync(join(tmpdir(), 'chat-ax-kill-'));
let server;

function start() {
  server = spawn('npx', ['wrangler', 'dev', '--config', 'wrangler.test.jsonc', '--port', String(port), '--inspector-port', String(inspectorPort), '--persist-to', persistence], { stdio: ['ignore', 'ignore', 'pipe'], detached: true, env: { ...process.env, WRANGLER_REGISTRY_PATH: mkdtempSync(join(tmpdir(), 'chat-ax-registry-')) } });
  return waitUntilServing();
}

async function waitUntilServing() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/messages`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('local runtime did not start');
}

function killHard() {
  process.kill(-server.pid, 'SIGKILL');
  let listeners = [];
  try {
    listeners = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {}
  for (const pid of listeners) {
    try {
      process.kill(Number(pid), 'SIGKILL');
    } catch {}
  }
}

async function reply(threadId, messageId) {
  const snapshot = await (await fetch(`${base}/api/messages?threadId=${encodeURIComponent(threadId)}`)).json();
  return snapshot.messages.find((message) => message.replyTo === messageId);
}

try {
  await start();
  const { threadTree } = await (await fetch(`${base}/api/messages`)).json();
  const agentId = threadTree.rootId;
  const sent = await (await fetch(`${base}/api/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId: agentId, text: 'DURABLE_RECOVERY_PROOF' }) })).json();
  const messageId = sent.message.id;
  let midTurn;
  for (let attempt = 0; attempt < 60 && !midTurn; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const current = await reply(agentId, messageId);
    if (current?.status === 'active' && current.tools?.some((tool) => tool.name === 'durable_wait' && tool.status === 'running')) midTurn = current;
  }
  assert(midTurn, 'the turn never reached its long-running tool');
  killHard();
  const killedAt = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  await start();
  let finished;
  for (let attempt = 0; attempt < 120 && !finished; attempt += 1) {
    const current = await reply(agentId, messageId);
    if (current?.status === 'complete' || current?.status === 'error') finished = current;
    else await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(finished, 'the turn did not finish after restart');
  assert.equal(finished.status, 'complete');
  assert.equal(finished.id, midTurn.id, 'recovery created a different reply instead of finishing the same one');
  assert.match(finished.text, /recovered and finished/);
  console.log(`CHAT_AX_KILL_MID_REPLY_PASS reply=${finished.id} recoveredMs=${Date.now() - killedAt} text=${JSON.stringify(finished.text)}`);
} finally {
  if (server) {
    try {
      killHard();
    } catch {}
  }
  rmSync(persistence, { recursive: true, force: true });
}
