import { chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const SCRATCH = '/scratch/check';
const PREVIEW_UID = 65532;
const PREVIEW_GID = 65532;
const BROWSER_UID = 65533;
const BROWSER_GID = 65533;
const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_POLICY_BYTES = 1024 * 1024;
const packageVersion = JSON.parse(readFileSync(join(process.cwd(), 'node_modules/playwright/package.json'), 'utf8')).version;
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
let policyBytes = Buffer.alloc(0);
for await (const chunk of process.stdin) {
  policyBytes = Buffer.concat([policyBytes, chunk]);
  if (policyBytes.length > MAX_POLICY_BYTES) throw new Error('Trusted browser policy exceeded its input bound');
}
const policy = JSON.parse(policyBytes.toString('utf8'));
if (!/^[a-f0-9]{32}$/.test(policy.outputToken || '')) throw new Error('Trusted browser result token is malformed');
const OUTPUT = `/tmp/factory-web-result-${policy.outputToken}.json`;
const locator = (page, step) => page.getByRole(step.role, { name: step.name, exact: true });

function boundedMessage(error) {
  const message = String(error?.message || error || 'Browser verification failed').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ');
  return message.slice(0, 1000);
}

function writeResult(result) {
  const bytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
  if (bytes.length > MAX_OUTPUT_BYTES) throw new Error('Browser result exceeded its output bound');
  writeFileSync(OUTPUT, bytes, { mode: 0o644, flag: 'wx' });
}

function failedStories(status, message) {
  return policy.stories.map(story => ({ id: story.id, contentHash: story.contentHash, status, durationMs: 0, message }));
}

function startPreview() {
  const child = spawn(policy.previewCommand[0], policy.previewCommand.slice(1), {
    cwd: join(SCRATCH, 'check'),
    env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      HOME: '/tmp/preview-home', NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(policy.port) },
    detached: true, stdio: 'ignore', uid: PREVIEW_UID, gid: PREVIEW_GID,
  });
  child.spawnError = null;
  child.on('error', error => { child.spawnError = error; });
  return child;
}

async function waitForPreview(child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.spawnError) throw new Error(`Preview command could not start: ${child.spawnError.message}`);
    if (child.exitCode !== null) throw new Error(`Preview command exited ${child.exitCode} before becoming ready`);
    try {
      const response = await fetch(`http://127.0.0.1:${policy.port}${policy.stories[0].path}`, { signal: AbortSignal.timeout(500) });
      if (response.ok) { await response.body?.cancel(); return; }
    } catch { /* A not-yet-ready local preview is expected during this bounded wait. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Preview command did not become ready on its local port within 15 seconds');
}

async function stopPreview(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  const deadline = Date.now() + 1000;
  while (child.exitCode === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  if (child.exitCode === null) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}

function exposeDisposableScratch(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    chmodSync(path, 0o777);
    for (const name of readdirSync(path)) exposeDisposableScratch(join(path, name));
  } else if (stat.isFile()) {
    chmodSync(path, (stat.mode & 0o111) | 0o666);
  }
}

async function operation(page, step) {
  if (step.op === 'click') return locator(page, step).click();
  if (step.op === 'expect-visible') return locator(page, step).waitFor({ state: 'visible' });
  if (step.op === 'expect-enabled') {
    const target = locator(page, step), deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await target.isEnabled()) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Expected ${step.role} “${step.name}” to become enabled`);
  }
  if (step.op === 'expect-disabled') {
    const target = locator(page, step), deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (!(await target.isEnabled())) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Expected ${step.role} “${step.name}” to become disabled`);
  }
  if (step.op === 'expect-text') {
    const target = locator(page, step);
    await target.waitFor({ state: 'visible' });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if ((await target.innerText()).trim() === step.text) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Expected ${step.role} “${step.name}” to contain the configured result text`);
  }
  if (step.op === 'press') return page.keyboard.press(step.key);
  if (step.op === 'expect-focused') {
    if (!(await locator(page, step).evaluate(element => document.activeElement === element)))
      throw new Error(`Expected ${step.role} “${step.name}” to have keyboard focus`);
    return;
  }
  throw new Error(`Unsupported browser operation ${step.op}`);
}

async function launchBrowser() {
  mkdirSync('/tmp/browser-home', { recursive: true, mode: 0o777 });
  process.env.FACTORY_CHROMIUM_EXECUTABLE = chromium.executablePath();
  return chromium.launch({ headless: true, executablePath: '/opt/factory-web/launch-chromium.sh',
    env: { ...process.env, HOME: '/tmp/browser-home', FACTORY_BROWSER_UID: String(BROWSER_UID),
      FACTORY_BROWSER_GID: String(BROWSER_GID) }, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
}

const initial = {
  version: 1, job: policy.job, attempt: policy.attempt, head: policy.head, tree: policy.tree,
  policyHash: policy.policyHash, webPolicyHash: policy.webPolicyHash,
  tool: { adapter: policy.adapter, version: packageVersion, browser: 'chromium', image: policy.image,
    platform: 'linux-container', coverage: 'web' },
  stories: [],
};

if (process.platform !== 'linux' || packageVersion !== policy.version) {
  writeResult({ ...initial, status: 'unavailable', stories: failedStories('unavailable', 'Configured Playwright version or Linux browser capability is unavailable.') });
  process.exit(0);
}

let browser;
try {
  browser = await launchBrowser();
} catch (error) {
  writeResult({ ...initial, status: 'unavailable', stories: failedStories('unavailable', `Chromium could not start: ${boundedMessage(error)}`) });
  process.exit(0);
}
initial.tool.browserVersion = browser.version();

let preview;
try {
  exposeDisposableScratch('/scratch');
  mkdirSync('/tmp/preview-home', { recursive: true, mode: 0o777 });
  preview = startPreview();
  await waitForPreview(preview);
  for (const story of policy.stories) {
    const started = Date.now();
    let context;
    try {
      const viewport = story.viewport === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 };
      context = await browser.newContext({ viewport, colorScheme: story.theme });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        return url.origin === `http://127.0.0.1:${policy.port}` ? route.continue() : route.abort('blockedbyclient');
      });
      await page.goto(`http://127.0.0.1:${policy.port}${story.path}`, { waitUntil: 'domcontentloaded' });
      for (const step of story.steps) await operation(page, step);
      initial.stories.push({ id: story.id, contentHash: story.contentHash, status: 'passed', durationMs: Date.now() - started });
    } catch (error) {
      initial.stories.push({ id: story.id, contentHash: story.contentHash, status: 'failed', durationMs: Date.now() - started, message: boundedMessage(error) });
    } finally { await context?.close(); }
  }
  const status = initial.stories.every(story => story.status === 'passed') ? 'passed' : 'failed';
  writeResult({ ...initial, status });
} catch (error) {
  const alreadyRun = new Set(initial.stories.map(story => story.id));
  const stories = [...initial.stories, ...policy.stories.filter(story => !alreadyRun.has(story.id)).map(story => ({
    id: story.id, contentHash: story.contentHash, status: 'failed', durationMs: 0, message: boundedMessage(error),
  }))];
  writeResult({ ...initial, status: 'failed', stories });
} finally {
  await stopPreview(preview);
  await browser.close();
}
