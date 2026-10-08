#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

const usage = `Usage: npm run setup [-- --allow <emails-or-@domain> --account <account-id> --name <worker-name>]

Deploys Chat AX to your Cloudflare account behind Cloudflare Access, in one go:

  1. Signs you in with the cf CLI and picks an account.
  2. Builds and deploys the Worker. It refuses every request until step 4.
  3. Creates a Cloudflare Access application for its workers.dev URL that admits
     only the people you allow.
  4. Saves that application on the Worker, which then admits signed-in people.

Run it again at any time. It reuses what already exists.

  --allow    Who can sign in: comma-separated emails and/or @domains,
             for example "you@gmail.com,@acme.com". Asked for if omitted.
  --account  Cloudflare account ID. Asked for if you have more than one.
  --name     Worker name. Defaults to "name" in wrangler.jsonc.`;

const { values } = parseArgs({
  options: {
    allow: { type: 'string' },
    account: { type: 'string' },
    name: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(usage);
  process.exit(0);
}

const prompt = createInterface({ input: process.stdin, output: process.stdout });

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

function step(message) {
  console.log(`\n  ${message}`);
}

function done(message) {
  console.log(`    ✓ ${message}`);
}

function run(command, args, { input, quiet = false, env = {} } = {}) {
  const result = spawnSync(command, args, {
    input,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: [input === undefined ? 'inherit' : 'pipe', 'pipe', quiet ? 'pipe' : 'inherit'],
  });
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

let accountId = values.account ?? process.env.CLOUDFLARE_ACCOUNT_ID;

function cf(args, options = {}) {
  const result = run('npx', ['--no-install', 'cf', ...args], {
    ...options,
    quiet: true,
    env: accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {},
  });
  if (!result.ok) return { ok: false, error: result.stderr.trim() || result.stdout.trim() };
  try {
    return { ok: true, data: JSON.parse(result.stdout) };
  } catch {
    return { ok: false, error: `Unexpected output from cf ${args.join(' ')}` };
  }
}

function listOf(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.result)) return data.result;
  return [];
}

async function signIn() {
  step('Signing in to Cloudflare');
  let whoami = cf(['auth', 'whoami']);
  if (!whoami.ok || !whoami.data?.authenticated) {
    if (!run('npx', ['--no-install', 'cf', 'auth', 'login']).ok) fail('Sign-in did not complete. Run `npx cf auth login` and try again.');
    whoami = cf(['auth', 'whoami']);
  }
  if (!whoami.ok || !whoami.data?.authenticated) fail('Could not confirm your Cloudflare sign-in.');
  done(`Signed in as ${whoami.data.email}`);
  return whoami.data;
}

async function chooseAccount(accounts) {
  if (accountId) {
    if (accounts.length && !accounts.some((account) => account.id === accountId)) fail(`Account ${accountId} is not available to this sign-in.`);
    return;
  }
  if (accounts.length === 1) {
    accountId = accounts[0].id;
  } else if (accounts.length > 1) {
    accounts.forEach((account, index) => console.log(`    ${index + 1}. ${account.name}`));
    const picked = Number(await prompt.question('    Which account? '));
    if (!Number.isInteger(picked) || picked < 1 || picked > accounts.length) fail('No account chosen.');
    accountId = accounts[picked - 1].id;
  } else {
    fail('This sign-in has no Cloudflare accounts.');
  }
  done(`Using account ${accounts.find((account) => account.id === accountId)?.name ?? accountId}`);
}

function parseAllowList(raw, fallbackEmail) {
  const entries = (raw ?? '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const list = entries.length ? entries : [fallbackEmail];
  for (const entry of list) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(entry) && !/^@[^@\s]+\.[^@\s]+$/.test(entry)) fail(`"${entry}" is not an email address or @domain.`);
  }
  return list;
}

async function chooseAllowList(email) {
  if (values.allow) return parseAllowList(values.allow, email);
  console.log('\n  Who should be able to sign in? Enter emails and/or @domains, separated by commas.');
  return parseAllowList(await prompt.question(`    [${email}] `), email);
}

function accessRules(allowList) {
  return allowList.map((entry) => (entry.startsWith('@') ? { email_domain: { domain: entry.slice(1) } } : { email: { email: entry } }));
}

function workerName() {
  if (values.name) return values.name;
  return fs.readFileSync('wrangler.jsonc', 'utf8').match(/"name"\s*:\s*"([^"]+)"/)?.[1] ?? 'chat-ax';
}

function filesBucket() {
  return fs.readFileSync('wrangler.jsonc', 'utf8').match(/"bucket_name"\s*:\s*"([^"]+)"/)?.[1] ?? 'chat-ax-files';
}

function ensureBucket(bucket) {
  step('Creating file storage');
  const listed = cf(['r2', 'buckets', 'list']).data;
  const existing = listOf(listed?.buckets ?? listed);
  if (existing.some((entry) => entry.name === bucket)) {
    done(`R2 bucket ${bucket} already exists`);
    return;
  }
  const result = cf(['r2', 'buckets', 'create', '--name', bucket]);
  if (!result.ok) fail(`Could not create the R2 bucket ${bucket}: ${result.error}. R2 must be enabled once in the dashboard (it's free).`);
  done(`Created R2 bucket ${bucket}`);
}

function bannedHosts() {
  const rulesFile = `${process.env.HOME}/.config/guardrail/local-rules`;
  if (!fs.existsSync(rulesFile)) return [];
  return fs
    .readFileSync(rulesFile, 'utf8')
    .split('\n')
    .map((line) => line.split('=')[0].trim())
    .filter((pattern) => pattern.startsWith('*.') && pattern.endsWith('.workers.dev'));
}

function refuseBannedHost(hostname) {
  const banned = bannedHosts().find((pattern) => hostname.endsWith(pattern.slice(1)));
  if (!banned) return;
  run('npx', ['wrangler', 'delete', '--name', hostname.split('.')[0], '--force'], { env: { CLOUDFLARE_ACCOUNT_ID: accountId } });
  fail(`${hostname} matches your guardrail ban rule ${banned}, so the Worker was removed again. Choose another account with --account.`);
}

function deploy(name) {
  step('Building and deploying the Worker');
  if (!run('npm', ['run', 'build']).ok) fail('The build failed.');
  const builtConfig = JSON.parse(fs.readFileSync('dist/chat_ax/wrangler.json', 'utf8'));
  const deployConfig = 'dist/chat_ax/wrangler.setup.json';
  fs.writeFileSync(deployConfig, JSON.stringify({ ...builtConfig, workers_dev: true }));
  const result = spawnSync('npx', ['wrangler', 'deploy', '--config', deployConfig, '--name', name, '--var', `WORKER_NAME:${name}`], {
    encoding: 'utf8',
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId },
    stdio: ['inherit', 'pipe', 'inherit'],
  });
  process.stdout.write(result.stdout ?? '');
  if (result.status !== 0) fail('wrangler deploy failed. If it asked you to sign in, run `npx wrangler login` and try again.');
  const url = result.stdout.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0];
  if (!url) fail('Deployed, but could not find the workers.dev URL in the output. Is workers_dev enabled in wrangler.jsonc?');
  const hostname = new URL(url).hostname;
  refuseBannedHost(hostname);
  done(`Deployed to ${url}`);
  return hostname;
}

function accessTeam() {
  step('Checking your Cloudflare Access team');
  const organization = cf(['zero-trust', 'organization', 'get']);
  const authDomain = organization.ok ? organization.data?.auth_domain : undefined;
  if (!authDomain) {
    fail(
      'This account has no Cloudflare Access team yet. Open https://one.dash.cloudflare.com, choose a team name and the Free plan, then run `npm run setup` again.',
    );
  }
  done(`Access team ${authDomain}`);
  return `https://${authDomain}`;
}

function accessApplication(hostname, allowList) {
  step('Putting the Worker behind sign-in');
  const name = `Chat AX (${hostname.split('.')[0]})`;
  const body = {
    type: 'self_hosted',
    name,
    domain: hostname,
    session_duration: '24h',
    app_launcher_visible: false,
    policies: [{ name: 'Chat AX members', decision: 'allow', include: accessRules(allowList) }],
  };
  const existing = listOf(cf(['zero-trust', 'access', 'applications', 'list', '--domain', hostname]).data).find(
    (application) => application.domain === hostname,
  );
  const result = existing
    ? cf(['zero-trust', 'access', 'applications', 'update', existing.id, '--body', JSON.stringify(body)])
    : cf(['zero-trust', 'access', 'applications', 'create', '--body', JSON.stringify(body)]);
  if (!result.ok) fail(`Could not ${existing ? 'update' : 'create'} the Access application: ${result.error}`);
  const audience = result.data?.aud ?? result.data?.result?.aud ?? existing?.aud;
  if (!audience) fail('The Access application has no audience tag.');
  done(`${existing ? 'Updated' : 'Created'} Access application "${name}" for ${allowList.join(', ')}`);
  return audience;
}

function lockWorker(name, issuer, audience) {
  step('Locking the Worker to that Access application');
  const secrets = { CF_ACCESS_ISS: issuer, CF_ACCESS_AUD: audience };
  for (const [key, value] of Object.entries(secrets)) {
    const result = cf(['workers', 'secrets', 'update', key, '--worker', name, '--type', 'secret_text', '--text', value]);
    if (!result.ok) fail(`Could not save ${key} on the Worker: ${result.error}`);
  }
  const saved = new Set(listOf(cf(['workers', 'secrets', 'list', '--worker', name]).data).map((secret) => secret.name));
  const missing = Object.keys(secrets).filter((key) => !saved.has(key));
  if (missing.length) fail(`The Worker is missing ${missing.join(' and ')} after saving. Run \`npm run setup\` again.`);
  done('Saved and verified CF_ACCESS_ISS and CF_ACCESS_AUD');
}

const identity = await signIn();
await chooseAccount(identity.accounts ?? []);
const allowList = await chooseAllowList(identity.email);
prompt.close();
const name = workerName();
const issuer = accessTeam();
ensureBucket(filesBucket());
const hostname = deploy(name);
const audience = accessApplication(hostname, allowList);
lockWorker(name, issuer, audience);
console.log(`\n  Chat AX is ready: https://${hostname}\n  Share that URL. People you allowed sign in with a one-time code sent to their email.\n`);
