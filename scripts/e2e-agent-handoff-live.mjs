import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import WebSocket from 'ws';

const base = (process.env.CHAT_AX_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const production = base.startsWith('https:');
const token = production
  ? process.env.CF_ACCESS_TOKEN ?? execFileSync('cloudflared', ['access', 'token', `-app=${base}`], { encoding: 'utf8' }).trim()
  : '';
const auth = production ? { 'cf-access-token': token } : {};
const headers = { ...auth, 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
let rpcId = 0;
async function tool(name, args) {
  const response = await fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) });
  const body = await response.json();
  if (body.error) throw new Error(`${name}: ${body.error.message}`);
  return body.result.structuredContent;
}
function watch(path) {
  const frames = [];
  const socket = new WebSocket(`${base.replace(/^http/, 'ws')}${path}`, { headers: auth });
  socket.on('message', (data) => frames.push({ at: Date.now(), frame: JSON.parse(String(data)) }));
  return { frames, opened: new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); }), close: () => socket.close() };
}

const { agents } = await tool('list_agents', {});
const from = process.env.FROM_AGENT ?? agents.find((agent) => agent.parentId === null).id;
const to = process.env.TO_AGENT ?? agents.find((agent) => agent.parentId === from)?.id ?? (await tool('create_agent', { parentId: from })).agent.id;
const marker = `handoff-${Date.now()}`;
const fleet = watch('/api/fleet/events?after=latest');
const receiver = watch(`/api/agents/${encodeURIComponent(to)}/live`);
await Promise.all([fleet.opened, receiver.opened]);
const started = Date.now();
const sent = await tool('send_agent_message', { fromAgentId: from, toAgentId: to, message: `${marker}: reply with one short sentence.` });
assert.equal(sent.event.type, 'communication.delivered');
const deadline = Date.now() + 90_000;
let reply;
while (Date.now() < deadline && !reply) {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const snapshot = await (await fetch(`${base}/api/messages?threadId=${encodeURIComponent(to)}`, { headers: auth })).json();
  const index = snapshot.messages.findIndex((message) => message.text?.includes(marker));
  reply = index >= 0 ? snapshot.messages.slice(index + 1).find((message) => message.role === 'assistant' && message.status === 'complete') : undefined;
}
fleet.close();
receiver.close();
assert(reply, 'the receiving agent never replied');
const fleetFrame = fleet.frames.find(({ frame }) => frame.type === 'fleet' && frame.event.type === 'agent.communication' && frame.event.agentId === to);
assert(fleetFrame, 'the fleet socket never announced the handoff');
const progress = receiver.frames.filter(({ frame }) => frame.type === 'progress').length;
console.log(`CHAT_AX_HANDOFF_LIVE_PASS fleetFrameMs=${fleetFrame.at - started} replyMs=${Date.now() - started} progressFrames=${progress} reply=${JSON.stringify(reply.text.slice(0, 60))}`);
