import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as v from 'valibot';

const requestSchema = v.object({
  id: v.string(),
  requesterId: v.string(),
  recipientEmail: v.string(),
  recipientId: v.optional(v.string()),
  status: v.string(),
  response: v.optional(v.string()),
});
const snapshotSchema = v.object({
  personRequests: v.array(requestSchema),
  notifications: v.array(
    v.object({ id: v.string(), recipientEmail: v.optional(v.string()), body: v.string() }),
  ),
});
const rpcSchema = v.object({
  result: v.optional(
    v.object({
      resultType: v.optional(v.string()),
      task: v.optional(v.object({ taskId: v.string(), status: v.string() })),
      status: v.optional(v.string()),
      result: v.optional(v.object({ request: requestSchema })),
      structuredContent: v.optional(v.object({ request: requestSchema })),
    }),
  ),
  error: v.optional(v.object({ code: v.number(), message: v.string() })),
});

const workspace = await mkdtemp(join(tmpdir(), 'chat-ax-person-requests-'));
const envFile = join(workspace, 'dev.env');
const persistence = join(workspace, 'state');
const port = 48_000 + Math.floor(Math.random() * 1_000);
const origin = `http://127.0.0.1:${port}`;
const sam = { 'x-dev-user-email': 'sam@example.com', 'x-dev-user-name': 'Sam Example' };
const jordan = {
  'x-dev-user-email': 'jordan@example.com',
  'x-dev-user-name': 'Jordan Example',
};
const michelle = {
  'x-dev-user-email': 'michelle@example.com',
  'x-dev-user-name': 'Michelle Example',
};
const modernMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {
    extensions: { 'io.modelcontextprotocol/tasks': {} },
  },
};

await writeFile(
  envFile,
  ['ENVIRONMENT=dev', 'DEV_USER_EMAIL=e2e@example.com', 'MINIFLARE=1'].join('\n'),
);

const server = Bun.spawn({
  cmd: [
    'npx',
    'wrangler',
    'dev',
    '--port',
    String(port),
    '--env-file',
    envFile,
    '--persist-to',
    persistence,
  ],
  cwd: process.cwd(),
  stdout: 'ignore',
  stderr: 'pipe',
});

try {
  await waitForServer();
  const created = await mcp(sam, 'tools/call', {
    _meta: modernMeta,
    name: 'request_person',
    arguments: {
      recipientEmail: 'jordan@example.com',
      recipientName: 'Jordan Example',
      title: 'Create an MR for ISSUE-123',
      details: 'Please prepare and open the agreed merge request.',
    },
  });
  assert(created.result?.resultType === 'task', 'Tasks-capable client did not receive a task');
  const taskId = created.result.task?.taskId;
  assert(taskId !== undefined, 'task did not include a durable ID');

  const jordanAfterReconnect = await mcp(jordan, 'tasks/get', {
    _meta: modernMeta,
    taskId,
  });
  assert(
    jordanAfterReconnect.result?.status === 'input_required',
    'recipient did not resume the waiting task',
  );

  const hidden = await mcp(michelle, 'tasks/get', { _meta: modernMeta, taskId });
  assert(hidden.error?.message === 'Task not found', 'unrelated person could read the task');

  const jordanState = await snapshot(jordan);
  const samState = await snapshot(sam);
  const michelleState = await snapshot(michelle);
  assert(jordanState.personRequests.length === 1, 'recipient did not receive the durable request');
  assert(samState.personRequests.length === 1, 'requester lost the durable request');
  assert(
    michelleState.personRequests.length === 0,
    'request leaked into another participant state',
  );
  assert(
    jordanState.notifications.some(
      (notification) => notification.recipientEmail === 'jordan@example.com',
    ),
    'recipient did not receive a targeted durable notification',
  );
  assert(
    !samState.notifications.some(
      (notification) => notification.recipientEmail === 'jordan@example.com',
    ),
    'recipient notification leaked to requester',
  );

  await mcp(jordan, 'tasks/update', {
    _meta: modernMeta,
    taskId,
    inputResponses: {
      decision: { action: 'accept', content: { action: 'accept' } },
    },
  });
  const completed = await mcp(jordan, 'tools/call', {
    name: 'respond_to_request',
    arguments: {
      requestId: taskId,
      action: 'complete',
      response: 'MR !42 is ready for review.',
    },
  });
  assert(
    completed.result?.structuredContent?.request.status === 'completed',
    'normal-tool fallback could not complete the task',
  );
  const final = await mcp(sam, 'tasks/get', { _meta: modernMeta, taskId });
  assert(final.result?.status === 'completed', 'requester did not observe task completion');
  assert(
    final.result.result?.request.response === 'MR !42 is ready for review.',
    'completed task lost the recipient response',
  );

  const fallback = await mcp(sam, 'tools/call', {
    name: 'request_person',
    arguments: {
      recipientEmail: 'jordan@example.com',
      title: 'Create a second MR',
      details: 'This verifies clients without Tasks support.',
    },
  });
  assert(
    fallback.result?.resultType === 'complete',
    'fallback client unexpectedly received a task',
  );
  const fallbackId = fallback.result.structuredContent?.request.id;
  assert(fallbackId !== undefined, 'fallback response omitted its request ID');
  const cancelled = await mcp(sam, 'tasks/cancel', {
    _meta: modernMeta,
    taskId: fallbackId,
  });
  assert(cancelled.result?.resultType === 'complete', 'cancel request was not acknowledged');
  const afterCancellation = await mcp(sam, 'tasks/get', {
    _meta: modernMeta,
    taskId: fallbackId,
  });
  assert(
    afterCancellation.result?.status === 'cancelled',
    'requester could not cancel durable work',
  );

  console.log(
    JSON.stringify(
      {
        actors: ['Sam Example', 'Jordan Example', 'Michelle Example'],
        durableTask: taskId,
        offlineResume: true,
        tasksNegotiated: true,
        fallbackToolResult: true,
        targetedNotification: true,
        crossUserDenied: true,
        recipientCompleted: true,
        requesterCancelled: true,
      },
      null,
      2,
    ),
  );
} finally {
  server.kill();
  await server.exited;
  await rm(workspace, { recursive: true, force: true });
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/.well-known/oauth-protected-resource/mcp`);
      if (response.ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error('local Chat AX server did not start');
}

type Headers = Record<string, string>;
type RpcParams = {
  _meta?: typeof modernMeta;
  name?: string;
  arguments?: {
    recipientEmail?: string;
    recipientName?: string;
    title?: string;
    details?: string;
    requestId?: string;
    action?: string;
    response?: string;
  };
  taskId?: string;
  inputResponses?: {
    decision: { action: 'accept'; content: { action: 'accept' } };
  };
};

async function mcp(headers: Headers, method: string, params: RpcParams) {
  const response = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
  });
  assert(response.ok, `MCP ${method} returned ${response.status}`);
  return v.parse(rpcSchema, await response.json());
}

async function snapshot(headers: Headers) {
  const response = await fetch(`${origin}/api/messages`, { headers });
  assert(response.ok, `snapshot returned ${response.status}`);
  return v.parse(snapshotSchema, await response.json());
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
