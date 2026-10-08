import assert from 'node:assert/strict';

const origin = process.env.CHAT_AX_URL ?? 'http://127.0.0.1:8791';
let requestId = 0;

async function mcp(method, params = {}) {
  const response = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dev-user-email': 'e2e-fleet@example.com', 'x-dev-user-name': 'E2E Fleet' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
  });
  const body = await response.json();
  assert.equal(response.ok, true, `${method}: HTTP ${response.status}`);
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

const scenarios = [
  'Given an empty fleet, list_agents returns no agents except the root',
  'When the root sends one message, the MCP response contains the assistant reply',
  'When the root creates one child, create_agent returns the child parent relationship',
  'When the child receives a direct message, the response is scoped to the child',
  'When the root delegates a message to the child, the delegation receipt names both agents',
  'Then the child cannot address a sibling in strict mode',
  'When mesh mode is enabled, a valid expiring message grant permits the sibling message',
  'Then an expired or exhausted grant is rejected',
  'When the root deletes the child, the child context and messages are no longer listed',
];
console.log('Reusable Gherkin scenarios:');
for (const scenario of scenarios) console.log(`- ${scenario}`);
const listed = await mcp('tools/list');
const names = new Set((listed.tools ?? []).map((tool) => tool.name));
for (const required of ['list_agents', 'create_agent', 'delegate_to_agent']) assert(names.has(required), `MCP tool is not registered: ${required}`);
console.log('PASS MCP agent fleet tool registration');
