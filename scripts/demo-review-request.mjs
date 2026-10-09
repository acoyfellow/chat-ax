import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const base = (process.env.CHAT_AX_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const pauseMs = Number(process.env.DEMO_PAUSE_MS ?? 1_400);
const headless = process.argv.includes('--headless');
const decision = process.argv.includes('--decline') ? 'Decline' : 'Accept';
const reviewUrl = process.env.DEMO_REVIEW_URL ?? 'https://gitlab.example.com/team/app/-/merge_requests/42';
const sam = { email: 'sam@example.com', name: 'Sam' };
const jordan = { email: 'jordan@example.com', name: 'Jordan' };
const width = 760;
const height = 900;

if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('The solo demo plays two people and only runs against local dev.');

function browserExecutable() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const desktop = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!headless && fs.existsSync(desktop)) return desktop;
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const shell = fs.readdirSync(cache).filter((name) => name.startsWith('chromium_headless_shell-')).sort().at(-1);
  const platform = fs.readdirSync(path.join(cache, shell)).find((entry) => fs.existsSync(path.join(cache, shell, entry, 'chrome-headless-shell')));
  return path.join(cache, shell, platform, 'chrome-headless-shell');
}

async function personWindow(person, x) {
  const browser = await chromium.launch({
    headless,
    executablePath: browserExecutable(),
    args: [`--window-position=${x},40`, `--window-size=${width},${height + 90}`, '--no-first-run', '--no-default-browser-check'],
  });
  const context = await browser.newContext({
    viewport: { width, height },
    extraHTTPHeaders: { 'x-dev-user-email': person.email, 'x-dev-user-name': person.name },
  });
  await context.grantPermissions(['notifications'], { origin: base });
  await context.addInitScript(() => {
    const shown = [];
    Object.defineProperty(window, 'chatAxShownNotifications', { value: shown });
    const NativeNotification = window.Notification;
    if (!NativeNotification) return;
    class RecordedNotification extends NativeNotification {
      static get permission() {
        return 'granted';
      }
      static requestPermission() {
        return Promise.resolve('granted');
      }
      constructor(title, options) {
        super(title, options);
        shown.push({ title, body: options?.body ?? '' });
      }
    }
    window.Notification = RecordedNotification;
    const nativeShow = ServiceWorkerRegistration.prototype.showNotification;
    ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
      shown.push({ title, body: options?.body ?? '', actions: (options?.actions ?? []).map((action) => action.title) });
      return nativeShow.call(this, title, options);
    };
  });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Message the agent').waitFor();
  return { browser, page };
}

const beat = (ms = pauseMs) => new Promise((resolve) => setTimeout(resolve, ms));
async function typeSlowly(page, text) {
  const box = page.getByLabel('Message the agent');
  await box.click();
  await box.pressSequentially(text, { delay: 28 });
  await beat(500);
  await box.press('Enter');
}

const left = await personWindow(sam, 0);
const right = await personWindow(jordan, width + 8);
try {
  await beat();
  await typeSlowly(left.page, `Ask ${jordan.email} to review ${reviewUrl}`);
  const request = right.page.locator('section.person-request').last();
  await right.page.waitForFunction(() => window.chatAxShownNotifications.some((notification) => notification.title.includes('sent you a request')), null, { timeout: 30_000 });
  const notification = await right.page.evaluate(() => window.chatAxShownNotifications.at(-1));
  console.log(`notified ${jordan.email}: "${notification.title}" — ${notification.body}`);
  const samNotified = await left.page.evaluate(() => window.chatAxShownNotifications.length);
  if (samNotified !== 0) throw new Error('The requester received the recipient notification.');
  await request.waitFor({ timeout: 30_000 });
  await beat(pauseMs * 2);
  await left.page.locator('section.person-request').last().waitFor({ timeout: 30_000 });
  await beat(pauseMs);
  const crossCheck = await left.page.locator('section.person-request button').count();
  if (crossCheck !== 0) throw new Error('The requester was offered the recipient decision.');
  await right.page.getByRole('button', { name: decision === 'Accept' ? 'Accept review request' : 'Decline review request' }).last().click();
  const expected = decision === 'Accept' ? /Reviewing|Accepted/ : /declined/;
  await left.page.locator('section.person-request [role=status]').last().filter({ hasText: expected }).waitFor({ timeout: 30_000 });
  await beat(pauseMs * 2);
  console.log(`CHAT_AX_REVIEW_DEMO_PASS decision=${decision.toLowerCase()} requester=${sam.email} recipient=${jordan.email}`);
  if (!headless) await beat(Number(process.env.DEMO_HOLD_MS ?? 6_000));
} finally {
  await left.browser.close();
  await right.browser.close();
}
