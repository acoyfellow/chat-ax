import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
import * as v from 'valibot';

const MessageSchema = v.object({
  id: v.string(),
  authorId: v.string(),
  text: v.string(),
  status: v.string(),
  replyTo: v.optional(v.string()),
});
const StateSchema = v.object({
  messages: v.array(MessageSchema),
  files: v.array(v.object({ id: v.string(), name: v.string(), kind: v.string() })),
  agentState: v.array(
    v.object({ id: v.string(), key: v.string(), value: v.string(), updatedBy: v.string() }),
  ),
  jobs: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      status: v.string(),
      runCount: v.number(),
    }),
  ),
  notifications: v.array(v.object({ id: v.string(), href: v.string() })),
});
const CreatedFileSchema = v.object({ file: v.object({ id: v.string() }) });
const EntrySchema = v.object({ entry: v.object({ id: v.string() }) });
const JobSchema = v.object({ job: v.object({ id: v.string() }) });

type State = v.InferOutput<typeof StateSchema>;

const workspace = await mkdtemp(join(tmpdir(), 'chat-ax-features-'));
const envFile = join(workspace, 'dev.env');
const persistence = join(workspace, 'state');
const port = 41_000 + Math.floor(Math.random() * 7000);
const origin = `http://127.0.0.1:${port}`;
const personA = { 'x-dev-user-email': 'alex@example.com', 'x-dev-user-name': 'Alex Rivera' };
const personB = { 'x-dev-user-email': 'sam@example.com', 'x-dev-user-name': 'Sam Chen' };

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
  const textFile = await upload(
    personA,
    new File(['The document token is NIGHTJAR_913.'], 'brief.txt', { type: 'text/plain' }),
  );
  const imageFile = await upload(
    personB,
    new File([redPixelPng()], 'red-pixel.png', { type: 'image/png' }),
  );
  let state = await roomState(personA);
  assert(state.files.length === 2, 'shared file catalog did not retain both uploads');

  const createdEntry = v.parse(
    EntrySchema,
    await jsonRequest(personA, 'POST', '/api/agent-state', {
      key: 'project.codename',
      value: 'BLUE_HARBOR',
    }),
  ).entry;
  await jsonRequest(personB, 'PUT', `/api/agent-state/${createdEntry.id}`, {
    key: 'project.codename',
    value: 'BLUE_HARBOR_VERIFIED',
  });
  state = await roomState(personA);
  assert(
    state.agentState.some(
      (entry) =>
        entry.value === 'BLUE_HARBOR_VERIFIED' && entry.updatedBy === 'dev-sam@example.com',
    ),
    'second participant could not update shared agent state',
  );

  await selectModel(personA, '@cf/zai-org/glm-5.3');
  const message = await sendMessage(
    personA,
    'Read the attached text and image plus shared agent state. Reply with the project codename, document token, and predominant image color.',
    [textFile, imageFile],
  );
  const reply = await waitForReply(message.id, personA, 240_000);
  const answer = reply.text.toUpperCase();
  assert(answer.includes('BLUE_HARBOR_VERIFIED'), 'agent did not read shared state');
  assert(answer.includes('NIGHTJAR_913'), 'agent did not read the text attachment');
  assert(answer.includes('RED'), 'agent did not read the image attachment');

  const createdJob = v.parse(
    JobSchema,
    await jsonRequest(personA, 'POST', '/api/jobs', {
      name: 'One-shot check',
      prompt: 'Reply with exactly JOB_FIRED_731.',
      intervalSeconds: 3,
      maxRuns: 1,
    }),
  ).job;
  await jsonRequest(personB, 'POST', `/api/jobs/${createdJob.id}/pause`, {});
  await Bun.sleep(3500);
  state = await roomState(personA);
  assert(
    state.jobs.some(
      (job) => job.id === createdJob.id && job.status === 'paused' && job.runCount === 0,
    ),
    'paused job fired',
  );
  await jsonRequest(personA, 'POST', `/api/jobs/${createdJob.id}/resume`, {});
  await jsonRequest(personB, 'PUT', `/api/jobs/${createdJob.id}`, {
    name: 'One-shot shared check',
  });
  const completed = await waitFor(
    async () => {
      const current = await roomState(personB);
      const job = current.jobs.find((candidate) => candidate.id === createdJob.id);
      const jobMessage = current.messages.find(
        (candidate) => candidate.authorId === `job:${createdJob.id}`,
      );
      const jobReply = jobMessage
        ? current.messages.find((candidate) => candidate.replyTo === jobMessage.id)
        : undefined;
      return job?.status === 'complete' && job.runCount === 1 && jobReply?.status === 'complete'
        ? { current, jobMessage, jobReply }
        : false;
    },
    'recurring job did not fire exactly once',
    240_000,
  );
  assert(
    completed.current.messages.filter((item) => item.authorId === `job:${createdJob.id}`).length ===
      1,
    'one-shot job fired more than once',
  );
  assert(completed.jobReply.text.includes('JOB_FIRED_731'), 'job result did not use the agent');
  assert(completed.current.notifications.length >= 2, 'agent outcomes were not durably cataloged');
  assert(
    completed.current.notifications.every((notification) =>
      notification.href.startsWith('/?message='),
    ),
    'notification does not open authoritative room state',
  );

  await jsonRequest(personB, 'DELETE', `/api/agent-state/${createdEntry.id}`);
  await jsonRequest(personA, 'DELETE', `/api/jobs/${createdJob.id}`);
  await jsonRequest(personB, 'DELETE', `/api/files/${textFile}`);
  state = await roomState(personA);
  assert(state.agentState.length === 0, 'agent state delete did not persist');
  assert(state.jobs.length === 0, 'job delete did not persist');
  assert(state.files.length === 1, 'file delete did not update the catalog');

  console.log(
    JSON.stringify(
      {
        participants: ['Alex Rivera', 'Sam Chen'],
        attachmentsRead: ['text', 'image'],
        durableFiles: 2,
        sharedStateCrud: true,
        recurringJobRuns: 1,
        durableNotifications: completed.current.notifications.length,
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

async function upload(headers: Record<string, string>, file: File): Promise<string> {
  const form = new FormData();
  form.set('file', file);
  const response = await fetch(`${origin}/api/files`, { method: 'POST', headers, body: form });
  const result = await response.json<JsonValue>();
  assert(response.ok, `upload failed for ${file.name}: ${JSON.stringify(result)}`);
  return v.parse(CreatedFileSchema, result).file.id;
}

async function roomState(headers: Record<string, string>): Promise<State> {
  const response = await fetch(`${origin}/api/messages`, { headers });
  assert(response.ok, 'room state failed');
  return v.parse(StateSchema, await response.json());
}

async function jsonRequest(
  headers: Record<string, string>,
  method: string,
  path: string,
  body?: JsonValue,
): Promise<JsonValue> {
  const requestHeaders = new Headers(headers);
  if (body !== undefined) requestHeaders.set('content-type', 'application/json');
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json<JsonValue>();
  assert(response.ok, `${method} ${path} failed: ${JSON.stringify(result)}`);
  return result;
}

async function selectModel(headers: Record<string, string>, modelId: string): Promise<void> {
  await jsonRequest(headers, 'PUT', '/api/settings', { modelId });
}

async function sendMessage(
  headers: Record<string, string>,
  text: string,
  attachmentIds: string[],
): Promise<{ id: string }> {
  const result = await jsonRequest(headers, 'POST', '/api/messages', { text, attachmentIds });
  return v.parse(v.object({ message: v.object({ id: v.string() }) }), result).message;
}

async function waitForReply(
  messageId: string,
  headers: Record<string, string>,
  timeout: number,
): Promise<v.InferOutput<typeof MessageSchema>> {
  return waitFor(
    async () => {
      const state = await roomState(headers);
      const reply = state.messages.find((message) => message.replyTo === messageId);
      return reply?.status === 'complete' ? reply : false;
    },
    'agent did not complete attachment turn',
    timeout,
  );
}

async function waitForServer(): Promise<void> {
  await waitFor(async () => {
    try {
      return (await fetch(`${origin}/api/messages`, { headers: personA })).ok;
    } catch {
      return false;
    }
  }, 'local worker did not start');
}

async function waitFor<T>(
  check: () => Promise<T | false>,
  message: string,
  timeout = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result !== false) return result;
    await Bun.sleep(250);
  }
  throw new Error(message);
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function redPixelPng(): Uint8Array {
  return Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nS8AAAAASUVORK5CYII=',
    ),
    (character) => character.charCodeAt(0),
  );
}
