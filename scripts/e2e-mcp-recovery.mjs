import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

let effects = 0;
const counter = createServer((_request, response) => { effects++; response.end(`effect-${effects}`); });
await new Promise(resolve => counter.listen(0, '127.0.0.1', resolve));
const directory = await mkdtemp(join(tmpdir(), 'mcp-recovery-'));
const bundle = await build({ entryPoints: ['scripts/fixtures/mcp-recovery-worker.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
let runtime;
const start = () => new Miniflare({ ...convertV4MiniflareOptions({ workers: [{ name: 'proof', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-04-21',
  durableObjects: { ACTION: { className: 'ActionProof', useSQLite: true } },
  bindings: { COUNTER_URL: `http://127.0.0.1:${counter.address().port}` },
}] }), resourcePersistencePath: directory });
const request = (path, name) => runtime.dispatchFetch(`http://proof${path}?case=${name}`, { method: path === '/state' ? 'GET' : 'POST' });
try {
  runtime = start();
  for (const [name, path, expected, count] of [
    ['before-dispatch', null, 'not-executed', 0],
    ['after-dispatch', '/after-dispatch', 'outcome-unknown', 1],
    ['before-result', '/before-result', 'outcome-unknown', 1],
    ['after-result', '/after-result', 'succeeded', 1],
  ]) {
    const before = effects;
    assert.equal((await request('/prepare', name)).status, 200);
    if (path) { try { await request(path, name); } catch {} }
    await runtime.dispose();
    runtime = start();
    const state = await (await request('/state', name)).json();
    assert.equal(state.status, expected);
    assert.equal(effects - before, count);
    if (expected !== 'not-executed') {
      assert.equal((await request('/execute', name)).status, 409);
      assert.equal(effects - before, 1, 'duplicate external execution');
    }
    if (expected === 'succeeded') assert.match(state.result, /^effect-/);
    console.log(JSON.stringify({ scenario: name, status: state.status, externalEffects: effects - before, restartVerified: true }));
  }
  const before = effects;
  await request('/prepare', 'concurrent');
  const replies = await Promise.all([request('/execute', 'concurrent'), request('/execute', 'concurrent')]);
  assert.deepEqual(replies.map(r => r.status).sort(), [200, 409]);
  assert.equal(effects - before, 1);
  console.log('Concurrent dispatch: one external effect, one rejected duplicate.');
} finally {
  await runtime?.dispose();
  counter.close();
  await rm(directory, { recursive: true, force: true });
}
