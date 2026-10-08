import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const baseUrl = (option('--base-url') ?? '').replace(/\/$/, '');
const receiptPath = option('--receipt');
const videoDir = option('--video-dir');
assert(baseUrl, '--base-url is required');
assert(receiptPath, '--receipt is required');
const production = new URL(baseUrl).protocol === 'https:';

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

function accessToken() {
  if (!production) return undefined;
  if (process.env.CF_ACCESS_TOKEN) return process.env.CF_ACCESS_TOKEN;
  try {
    return execFileSync('cloudflared', ['access', 'token', `-app=${baseUrl}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error(`Testing a deployed URL needs an Access token. Run \`cloudflared access login ${baseUrl}\` or set CF_ACCESS_TOKEN.`);
  }
}

const token = accessToken();
const browser = await chromium.launch({ headless: true, executablePath: headlessShell() });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  ...(token ? { extraHTTPHeaders: { 'cf-access-token': token } } : {}),
  ...(videoDir ? { recordVideo: { dir: videoDir, size: { width: 1440, height: 1000 } } } : {}),
});
const page = await context.newPage();
const api = async (route, init = {}) =>
  page.evaluate(async ({ route, init }) => {
    const response = await fetch(route, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { route, init });
const mcp = async (name, values) => {
  const result = await api('/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: values } }) });
  assert.equal(result.body?.error, undefined, result.body?.error?.message);
  return result.body.result.structuredContent;
};

const created = [];
const steps = [];
const step = (name, detail = {}) => steps.push({ name, ...detail });
try {
  await page.goto(`${baseUrl}/?fleet-drag-proof=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button[aria-label="Open agent fleet"]', { timeout: 30_000 });
  const fleet = (await api('/api/fleet')).body;
  const root = fleet.agents.find((agent) => agent.parentId === null);
  assert(root, 'A root agent is required');
  for (const title of ['Drag proof A', 'Drag proof B']) {
    const agent = (await mcp('create_agent', { parentId: root.id, title: `${title} ${Date.now()}` })).agent;
    created.push(agent.id);
  }
  await page.click('button[aria-label="Open agent fleet"]');
  await page.waitForSelector('.workspace.map-ready', { timeout: 30_000 });
  const node = (id) => page.locator(`.node[data-agent-id="${id}"]`);
  await node(created[0]).waitFor({ state: 'visible', timeout: 30_000 });
  const centre = async (id) => {
    const box = await node(id).boundingBox();
    assert(box, `Agent ${id} is not on screen`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const transformOf = (id) => node(id).getAttribute('transform');
  const parse = (transform) => transform.match(/translate\(([-\d.]+),([-\d.]+)\)/).slice(1).map(Number);
  const dragged = created[0];

  const start = await centre(dragged);
  const offset = { x: 9, y: -7 };
  await page.mouse.move(start.x + offset.x, start.y + offset.y);
  await page.mouse.down();
  const beforeThreshold = parse(await transformOf(dragged));
  await page.mouse.move(start.x + offset.x + 2, start.y + offset.y + 1);
  assert.deepEqual(parse(await transformOf(dragged)), beforeThreshold, 'A tiny jitter below the drag threshold does not move the agent');
  const target = { x: start.x + 180, y: start.y + 120 };
  for (let index = 1; index <= 12; index += 1)
    await page.mouse.move(start.x + offset.x + (180 * index) / 12, start.y + offset.y + (120 * index) / 12);
  const lifted = await node(dragged).evaluate((element) => element.classList.contains('lifted') && element === element.parentElement.lastElementChild);
  assert.equal(lifted, true, 'The dragged agent is lifted and painted on top');
  const cursor = await page.locator('.map').evaluate((element) => getComputedStyle(element).cursor);
  assert.equal(cursor, 'grabbing', 'The map shows a grabbing cursor while dragging');
  await page.mouse.up();
  const end = await centre(dragged);
  assert(Math.abs(end.x - target.x) <= 3 && Math.abs(end.y - target.y) <= 3, `Agent follows the pointer without jumping (${JSON.stringify({ end, target })})`);
  const afterDrop = parse(await transformOf(dragged));
  assert.notDeepEqual(afterDrop, beforeThreshold, 'Agent moved');
  const dialogOpen = await page.locator('[role="dialog"][aria-labelledby="fleet-title"]').count();
  assert.equal(dialogOpen, 1, 'Dropping does not open or close anything');
  step('drag-follows-pointer', { end, target });

  const selectedAfterDrop = await node(dragged).evaluate((element) => element.classList.contains('selected'));
  step('drop-does-not-click-select', { selectedAfterDrop });

  let saved;
  for (let attempt = 0; attempt < 40 && !saved; attempt += 1) {
    const candidate = (await api('/api/fleet/layout')).body.positions?.[dragged];
    if (candidate && Math.abs(candidate.x - afterDrop[0]) < 0.5 && Math.abs(candidate.y - afterDrop[1]) < 0.5) saved = candidate;
    else await page.waitForTimeout(250);
  }
  assert(saved, 'Drop position was saved');
  assert.deepEqual(parse(await transformOf(dragged)), afterDrop, 'A fleet refresh after the drop does not snap the agent back');
  assert(Math.abs(saved.x - afterDrop[0]) < 0.5 && Math.abs(saved.y - afterDrop[1]) < 0.5, 'Saved position matches the drop');
  step('drop-persists', { saved });

  const zoomIn = page.locator('button[aria-label="Zoom in"]');
  await zoomIn.click();
  await zoomIn.click();
  const mapBox = await page.locator('.map').boundingBox();
  const mapCentre = { x: mapBox.x + mapBox.width / 2, y: mapBox.y + mapBox.height / 2 };
  const zoomedStart = await centre(dragged);
  const visible = zoomedStart.x > mapBox.x + 40 && zoomedStart.x < mapBox.x + mapBox.width - 40 && zoomedStart.y > mapBox.y + 40 && zoomedStart.y < mapBox.y + mapBox.height - 40;
  if (!visible) {
    await page.mouse.move(mapBox.x + 30, mapBox.y + 30);
    await page.mouse.down();
    await page.mouse.move(mapBox.x + 30 + (mapCentre.x - zoomedStart.x), mapBox.y + 30 + (mapCentre.y - zoomedStart.y), { steps: 8 });
    await page.mouse.up();
  }
  const grab = await centre(dragged);
  const zoomedTarget = { x: mapCentre.x - 90, y: mapCentre.y + 50 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(zoomedTarget.x, zoomedTarget.y, { steps: 10 });
  await page.mouse.up();
  const zoomedEnd = await centre(dragged);
  assert(Math.abs(zoomedEnd.x - zoomedTarget.x) <= 3 && Math.abs(zoomedEnd.y - zoomedTarget.y) <= 3, `Dragging tracks the pointer while zoomed (${JSON.stringify({ grab, zoomedTarget, zoomedEnd })})`);
  step('drag-while-zoomed', { zoomedStart, zoomedEnd });
  await page.locator('button[aria-label="Fit fleet to view"]').click();

  const beforeCancel = parse(await transformOf(dragged));
  const cancelStart = await centre(dragged);
  await page.mouse.move(cancelStart.x, cancelStart.y);
  await page.mouse.down();
  for (let index = 1; index <= 6; index += 1) await page.mouse.move(cancelStart.x + 20 * index, cancelStart.y);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(parse(await transformOf(dragged)), beforeCancel, 'Escape puts the agent back');
  assert.equal(await page.locator('[aria-labelledby="fleet-title"]').count(), 1, 'Escape during a drag does not close the map');
  step('escape-cancels-drag');

  const other = created[1];
  const otherBefore = parse(await transformOf(other));
  const panTarget = await page.evaluate(() => {
    const map = document.querySelector('.map').getBoundingClientRect();
    return { x: map.left + 40, y: map.bottom - 40 };
  });
  await page.mouse.move(panTarget.x, panTarget.y);
  await page.mouse.down();
  for (let index = 1; index <= 6; index += 1) await page.mouse.move(panTarget.x + 15 * index, panTarget.y - 10 * index);
  await page.mouse.up();
  const panTransform = await page.locator('svg g[transform^="translate("]').first().getAttribute('transform');
  assert.notEqual(panTransform, 'translate(0 0) scale(1)', 'Dragging empty canvas pans');
  assert.deepEqual(parse(await transformOf(other)), otherBefore, 'Panning does not move agents');
  step('empty-canvas-pans', { panTransform });

  const clickStart = await centre(other);
  const wasSelected = await node(other).evaluate((element) => element.classList.contains('selected'));
  if (wasSelected) {
    const draggedCentre = await centre(dragged);
    await page.mouse.click(draggedCentre.x, draggedCentre.y);
  }
  assert.equal(await node(other).evaluate((element) => element.classList.contains('selected')), false, 'Precondition: the agent is not selected yet');
  await page.mouse.click(clickStart.x, clickStart.y);
  assert.equal(await node(other).evaluate((element) => element.classList.contains('selected')), true, 'A plain click still selects');
  assert.deepEqual(parse(await transformOf(other)), otherBefore, 'A plain click does not move the agent');
  step('click-selects-without-moving');

  await node(other).focus();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const keyed = parse(await transformOf(other));
  assert(Math.abs(keyed[0] - (otherBefore[0] + 24)) < 0.5 && Math.abs(keyed[1] - (otherBefore[1] + 24)) < 0.5, 'Shift plus arrows moves the selected agent');
  step('keyboard-move', { from: otherBefore, to: keyed });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = (await api('/api/fleet/layout')).body.positions?.[other];
    if (candidate && Math.abs(candidate.x - keyed[0]) < 0.5 && Math.abs(candidate.y - keyed[1]) < 0.5) break;
    await page.waitForTimeout(250);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.click('button[aria-label="Open agent fleet"]');
  await page.waitForSelector('.workspace.map-ready', { timeout: 30_000 });
  await node(dragged).waitFor({ state: 'visible' });
  const reloadedOther = parse(await transformOf(other));
  assert(Math.abs(reloadedOther[0] - keyed[0]) < 0.5 && Math.abs(reloadedOther[1] - keyed[1]) < 0.5, 'Positions survive a reload');
  step('positions-survive-reload', { reloadedOther });

  const reopenTarget = await centre(other);
  await page.mouse.dblclick(reopenTarget.x, reopenTarget.y);
  await page.waitForSelector('[aria-labelledby="fleet-title"]', { state: 'detached', timeout: 10_000 });
  step('double-click-opens-conversation');

  await page.evaluate(() => localStorage.setItem('chat-ax-theme', 'dark'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button[aria-label="Open command palette"]', { timeout: 30_000 });
  await page.click('button[aria-label="Open command palette"]');
  await page.waitForSelector('aside.open', { timeout: 10_000 });
  await page.waitForTimeout(400);
  const overlay = await page.evaluate(() => {
    const luminance = (color) => {
      const [r, g, b] = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => {
        const channel = value / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const scrim = getComputedStyle(document.querySelector('.scrim'));
    const panel = getComputedStyle(document.querySelector('aside.open'));
    const page = getComputedStyle(document.querySelector('main'));
    return {
      theme: document.documentElement.dataset.theme,
      scrimBorder: scrim.borderTopWidth,
      scrimBorderColor: scrim.borderTopColor,
      scrimOutline: scrim.outlineStyle,
      panelShadow: panel.boxShadow,
      panelLuminance: luminance(panel.backgroundColor),
      pageLuminance: luminance(page.backgroundColor),
    };
  });
  assert.equal(overlay.theme, 'dark');
  assert.equal(overlay.scrimBorder, '0px', 'The dark-mode scrim has no border');
  assert.equal(overlay.scrimOutline, 'none', 'The dark-mode scrim has no outline');
  assert.notEqual(overlay.panelShadow, 'none', 'The settings modal casts a shadow');
  const panelBox = await page.locator('aside.open').boundingBox();
  const shot = await page.screenshot({ type: 'png', ...(videoDir ? { path: path.join(fs.mkdirSync(videoDir, { recursive: true }) ?? videoDir, 'settings-dark.png') } : {}) });
  const rendered = await page.evaluate(async ({ data, panel }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height });
    const drawing = canvas.getContext('2d');
    drawing.drawImage(image, 0, 0);
    const scale = image.width / innerWidth;
    const luminanceAt = (x, y) => {
      const [r, g, b] = drawing.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;
      const linear = (value) => {
        const channel = value / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    };
    const edges = [[2, 2], [innerWidth - 3, 2], [2, innerHeight - 3], [innerWidth - 3, innerHeight - 3]].map(([x, y]) => luminanceAt(x, y));
    return {
      panel: luminanceAt(panel.x + 24, panel.y + panel.height - 24),
      backdrop: luminanceAt(panel.x - 40, panel.y + panel.height + 60),
      screenEdgeMax: Math.max(...edges),
    };
  }, { data: shot.toString('base64'), panel: panelBox });
  overlay.rendered = rendered;
  assert(rendered.screenEdgeMax < 0.05, `No bright border around the screen in dark mode (${JSON.stringify(rendered)})`);
  assert((rendered.panel + 0.05) / (rendered.backdrop + 0.05) >= 1.25, `The settings modal is visibly raised above the dimmed page (${JSON.stringify(rendered)})`);
  step('settings-modal-dark-depth', overlay);
  await page.evaluate(() => localStorage.setItem('chat-ax-theme', 'light'));

  const receipt = {
    result: 'pass',
    baseUrl,
    build: production ? (await api('/api/production-readiness')).body?.build : 'local',
    steps,
    verifiedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`CHAT_AX_FLEET_DRAG_PASS ${baseUrl} steps=${steps.length}`);
} finally {
  for (const id of created) await mcp('delete_agent', { agentId: id }).catch(() => undefined);
  await context.close();
  await browser.close();
}
