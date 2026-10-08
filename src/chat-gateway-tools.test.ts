import { test, expect } from 'bun:test';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { Type } from 'typebox';
import { chatGatewayProvider } from './chat-model-provider';
import { durableObjectStorageStandIn } from './pi/durable/test-storage';
import { DurableTurnRuntime } from './pi/durable/turn-runtime';
test('terra receives the tool list through the durable runtime', async () => {
  const bodies: any[] = [];
  const done = (out: any[]) => `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: 'r', status: 'completed', output: out, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } })}\n\n`;
  const ai: any = { run: async (_m: string, body: any) => { bodies.push(body); return new Response(done([{ type: 'message', id: 'm', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }]), { headers: { 'content-type': 'text/event-stream' } }); }, gateway: () => ({ run: async () => new Response('') }) };
  const models = createModels(); models.setProvider(chatGatewayProvider(ai, 'ax'));
  const runtime = new DurableTurnRuntime({ storage: durableObjectStorageStandIn(), models, model: { provider: 'cloudflare', modelId: 'openai/gpt-5.6-terra' }, instructions: async () => 'x',
    tools: () => [{ name: 'list_state', description: 'd', parameters: Type.Object({}), execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }] });
  await runtime.prompt('hi', { operationId: 'a' });
  expect(bodies[0]?.tools?.map((t: any) => t.name)).toEqual(['list_state']);
  await runtime.close();
});
