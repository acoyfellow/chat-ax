import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const baseUrl = (option('--base-url') ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const historyEvents = Number(option('--history') ?? 300);
const maximumFleetRequests = 12;

function headlessShell() {
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const shells = fs.existsSync(cache) ? fs.readdirSync(cache).filter((name) => name.startsWith('chromium_headless_shell-')).sort() : [];
  for (const shell of shells.reverse()) {
    for (const platform of fs.readdirSync(path.join(cache, shell))) {
      const binary = path.join(cache, shell, platform, 'chrome-headless-shell');
      if (fs.existsSync(binary)) return binary;
    }
  }
  return undefined;
}

async function api(method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.ok, true, `${method} ${pathname} returned ${response.status}`);
  return response.json();
}

const fleet = await api('GET', '/api/fleet');
const root = fleet.agents.find((agent) => agent.parentId === null);
assert(root, 'root agent missing');
const children = [];
for (let index = 0; index < 3; index += 1) {
  const created = await api('POST', '/api/threads', { parentId: root.id, title: `Load child ${index}` });
  children.push(created.node.id);
}
for (let index = 0; index < historyEvents; index += 1)
  await api('PUT', '/api/fleet/layout', { positions: { [root.id]: { x: index % 400, y: 10 } } });

const browser = await chromium.launch({ headless: true, executablePath: headlessShell() });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const fleetRequests = [];
page.on('request', (request) => {
  const url = new URL(request.url());
  if (url.pathname === '/api/fleet/operations' || url.pathname === '/api/fleet/layout' || url.pathname === '/api/fleet' || url.pathname === '/api/threads')
    fleetRequests.push(url.pathname);
});
await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2_000);
const beforeMap = fleetRequests.length;
await page.locator('button[aria-label="Open agent fleet"]').click();
await page.waitForSelector('[aria-label="Fleet canvas"]');
await page.waitForTimeout(3_000);
const mapRequests = fleetRequests.length - beforeMap;
assert(mapRequests <= maximumFleetRequests, `opening the fleet map made ${mapRequests} fleet requests`);
await page.locator('button[aria-label="Close fleet map"]').click();

const target = children[1];
const burst = Promise.all(
  Array.from({ length: 60 }, (_, index) =>
    api('PUT', '/api/fleet/layout', { positions: { [root.id]: { x: index, y: 20 } } }),
  ),
);
for (const id of [children[0], target]) {
  await page.locator('button[aria-label="Open agent fleet"]').click();
  await page.waitForSelector('[aria-label="Fleet canvas"]');
  await page.locator(`#fleet-node-${id}`).click();
  await page.locator('button.open:has-text("Open conversation")').click();
  await page.waitForFunction((expected) => new URL(location.href).searchParams.get('thread') === expected, id, { timeout: 10_000 });
}
await burst;
await page.waitForTimeout(2_000);
const opened = await page.evaluate(() => new URL(location.href).searchParams.get('thread'));
const shownTitle = await page.locator('.agent-name-title').innerText();
assert.match(shownTitle, /Load child 1/, `the open conversation snapped back: ${shownTitle.slice(0, 120)}`);
assert.equal(opened, target, 'switching conversations did not open the selected agent');
const idleStart = fleetRequests.length;
await page.waitForTimeout(3_000);
const idleRequests = fleetRequests.length - idleStart;
assert(idleRequests <= 2, `idle page made ${idleRequests} fleet requests in 3s`);
await browser.close();
console.log(`CHAT_AX_FLEET_LOAD_PASS history=${historyEvents} mapRequests=${mapRequests} idleRequests=${idleRequests}`);
