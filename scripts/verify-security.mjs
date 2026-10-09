import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const unitSuites = [
  ['Sign-in is mandatory and only your Access application gets in', 'src/setup-page.test.ts src/access-verification.test.ts src/auth.test.ts'],
  ['Each turn carries the verified person who sent it', 'src/turn-authority.test.ts'],
  ['Connectors stay personal; tools run as the turn author', 'src/capability-policy.test.ts'],
  ['Another person’s connector needs their approval for that exact call, once', 'src/mcp-approval.test.ts src/connector-approvals.test.ts'],
  ['Every connector call leaves a receipt without tokens', 'src/mcp-receipts.test.ts'],
  ['Agents talk only within their tree unless granted', 'src/agent-orchestration-policy.test.ts src/agent-communication.test.ts'],
  ['Person requests are visible only to requester and recipient', 'src/person-requests.test.ts'],
  ['Agent capabilities are bound to a key, request, scope and lifetime', 'src/agent-capability.test.ts'],
  ['Push only reaches the intended person', 'src/web-push.test.ts'],
];
const runtimeSuites = [
  ['Boundary attacks against a real MCP server with two accounts', 'node scripts/e2e-security-boundary.mjs --receipt receipts/security-boundary.json'],
  ['Restarted mid-reply, the same reply finishes', 'node scripts/e2e-kill-mid-reply.mjs'],
];
const quick = process.argv.includes('--quick');
mkdirSync('receipts', { recursive: true });
const results = [];

function run(label, command) {
  const started = Date.now();
  const attempt = () => {
    const result = spawnSync(command, { shell: true, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' } });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  };
  const devServerCrashed = (output) => output.includes('Network connection lost') || output.includes('ECONNREFUSED 127.0.0.1');
  let { status, output } = attempt();
  let retriedAfterDevServerCrash = false;
  if (status !== 0 && devServerCrashed(output)) {
    retriedAfterDevServerCrash = true;
    ({ status, output } = attempt());
  }
  const ok = status === 0;
  results.push({ label, command, ok, retriedAfterDevServerCrash, ms: Date.now() - started, tail: output.trim().split('\n').slice(-6).join('\n') });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (${((Date.now() - started) / 1000).toFixed(1)}s)\n      ${command}`);
  if (!ok) console.log(output.trim().split('\n').slice(-15).map((line) => `      ${line}`).join('\n'));
}

for (const [label, files] of unitSuites) run(label, `bun test ${files}`);
if (!quick) {
  spawnSync('npm', ['run', 'build'], { stdio: 'ignore' });
  for (const [label, command] of runtimeSuites) run(label, command);
}
const failed = results.filter((result) => !result.ok);
writeFileSync('receipts/security.json', `${JSON.stringify({ ok: failed.length === 0, quick, checkedAt: new Date().toISOString(), results }, null, 2)}\n`);
console.log(`\n${failed.length === 0 ? 'CHAT_AX_SECURITY_VERIFIED' : 'CHAT_AX_SECURITY_FAILED'} ${results.length - failed.length}/${results.length} · receipts/security.json`);
process.exit(failed.length === 0 ? 0 : 1);
