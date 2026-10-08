import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const requestedOrigin = process.env.CHAT_AX_ORIGIN?.replace(/\/$/, '');
const headers = {
  'content-type': 'application/json',
  'x-dev-user-email': 'pi-proof@example.com',
  'x-dev-user-name': 'Pi Proof',
  ...(process.env.CHAT_AX_DEV_PROOF_TOKEN ? { 'x-dev-proof-token': process.env.CHAT_AX_DEV_PROOF_TOKEN } : {}),
};

let origin = requestedOrigin ?? '';
let server;
let workspace;

async function request(path, options = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers ?? {}) },
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!response.ok) throw new Error(`${path} ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  return body;
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok || response.status === 401) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Wrangler development server did not become ready');
}

async function startLocalServer() {
  workspace = await mkdtemp(join(tmpdir(), 'chat-ax-pi-e2e-'));
  const envFile = join(workspace, 'dev.vars');
  const persistence = join(workspace, 'state');
  const port = 50_000 + Math.floor(Math.random() * 10_000);
  origin = `http://127.0.0.1:${port}`;
  await writeFile(
    envFile,
    ['ENVIRONMENT=dev', 'DEV_USER_EMAIL=pi-proof@example.com', 'MINIFLARE=1'].join('\n'),
  );
  server = spawn(
    'npx',
    ['wrangler', 'dev', '--local', '--port', String(port), '--env-file', envFile, '--persist-to', persistence],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  await waitForServer(origin);
}

async function runProof() {
  const before = await request('/api/messages');
  if (before.engine !== 'pi') throw new Error(`active engine is ${before.engine}, expected pi`);
  const marker = `pi-room-proof-${Date.now()}`;
  const submitted = await request('/api/messages', {
    method: 'POST',
    body: JSON.stringify({ text: `Use the write_preview tool to set the preview to ${marker}.` }),
  });
  const messageId = submitted.message?.id;
  if (!messageId) throw new Error('message submission did not return a message id');

  let state;
  let preview;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    state = await request('/api/messages');
    const reply = state.messages.find((message) => message.replyTo === messageId);
    preview = await request('/api/preview');
    if (reply?.status === 'complete' && preview.text === marker) break;
  }
  const reply = state.messages.find((message) => message.replyTo === messageId);
  if (!reply || reply.status !== 'complete') throw new Error('Pi reply did not complete');
  if (preview.text !== marker) throw new Error(`preview mismatch: ${JSON.stringify(preview)}`);
  if (!reply.tools?.some((tool) => tool.name === 'write_preview')) throw new Error('write_preview tool event missing');

  const afterReload = await request('/api/messages');
  const recoveredPreview = await request('/api/preview');
  if (!afterReload.messages.some((message) => message.id === messageId)) throw new Error('transcript did not recover');
  if (recoveredPreview.text !== marker) throw new Error('preview did not recover');

  const compaction = await request('/api/pi/compact', { method: 'POST' });
  if (!compaction.accepted) throw new Error('Pi did not accept native compaction');
  const afterCompactionReload = await request('/api/messages');
  if (!afterCompactionReload.messages.some((message) => message.id === messageId)) throw new Error('room history changed during Pi compaction');

  const receiptState = await request('/api/dev/capabilities/receipts');
  if (!receiptState.receipts?.some((receipt) => receipt.capability === 'room.preview.write' && receipt.status === 'succeeded')) {
    throw new Error('successful room.preview.write receipt missing');
  }

  console.log(JSON.stringify({
    ok: true,
    engine: afterReload.engine,
    messageId,
    tool: 'write_preview',
    preview: recoveredPreview.text,
    transcriptRecovered: true,
    previewRecovered: true,
    receipt: 'room.preview.write',
    piCompactionAccepted: true,
    roomHistoryPreserved: true,
  }));
}

try {
  if (!requestedOrigin) await startLocalServer();
  else origin = requestedOrigin;
  await runProof();
} finally {
  if (server) {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
  }
  if (workspace) await rm(workspace, { recursive: true, force: true });
}
