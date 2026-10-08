import { DurableObject } from 'cloudflare:workers';
import { executeMcpOnce } from '../../src/mcp-execution';

export class ActionProof extends DurableObject {
  async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (path === '/prepare') {
      await this.ctx.storage.put('execution', { status: 'not-executed' });
      await this.ctx.storage.sync();
      return Response.json({ prepared: true });
    }
    if (path === '/state') return Response.json(await this.ctx.storage.get('execution'));
    if (path === '/execute' || path === '/after-dispatch' || path === '/before-result' || path === '/after-result') {
      const storage = path === '/before-result' ? new Proxy(this.ctx.storage, {
        get: (target, property) => {
          if (property === 'put') return async (key: string, value: { status: string }) => {
            if (value.status === 'succeeded') this.ctx.abort('Injected crash before result persistence');
            return target.put(key, value);
          };
          const value = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }) : this.ctx.storage;
      try {
        const result = await executeMcpOnce(storage, 'execution', async () => {
          const response = await fetch((this.env as { COUNTER_URL: string }).COUNTER_URL, { method: 'POST' });
          const text = await response.text();
          if (path === '/after-dispatch') this.ctx.abort('Injected crash after external effect');
          return text;
        });
        if (path === '/after-result') this.ctx.abort('Injected crash after durable result');
        return Response.json(result);
      } catch {
        return Response.json({ error: 'interrupted or already dispatched' }, { status: 409 });
      }
    }
    return new Response('Not found', { status: 404 });
  }
}

export default {
  fetch(request: Request, env: { ACTION: DurableObjectNamespace }) {
    const url = new URL(request.url);
    const id = env.ACTION.idFromName(url.searchParams.get('case') ?? 'default');
    return env.ACTION.get(id).fetch(request);
  },
};
