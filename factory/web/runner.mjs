import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const OUTPUT = '/browser-output';
const RESULT = join(OUTPUT, 'result.json');
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_POLICY_BYTES = 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const packageVersion = JSON.parse(readFileSync(join(process.cwd(), 'node_modules/playwright/package.json'), 'utf8')).version;
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
let policyBytes = Buffer.alloc(0);
for await (const chunk of process.stdin) {
  policyBytes = Buffer.concat([policyBytes, chunk]);
  if (policyBytes.length > MAX_POLICY_BYTES) throw new Error('Trusted browser policy exceeded its input bound');
}
const policy = JSON.parse(policyBytes.toString('utf8'));
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const locator = (page, step) => page.getByRole(step.role, { name: step.name, exact: true });
const remaining = () => Math.max(0, Number(policy.deadlineAt) - Date.now());
let retainedScreenshotBytes = 0;

function boundedMessage(error) {
  return String(error?.message || error || 'Browser verification failed')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').slice(0, 1000);
}

function writeResult(result) {
  const bytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
  if (bytes.length > MAX_OUTPUT_BYTES) throw new Error('Browser result exceeded its output bound');
  const temporary = join(OUTPUT, `.result-${process.pid}-${Date.now()}.tmp`);
  writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, RESULT);
}

function failedStories(status, message) {
  return policy.stories.map(story => ({ id: story.id, contentHash: story.contentHash, status,
    durationMs: 0, trace: [], message }));
}

async function waitForPreview() {
  const deadline = Math.min(Number(policy.deadlineAt), Date.now() + 15_000);
  const url = `http://127.0.0.1:${policy.port}${policy.stories[0].path}`;
  while (Date.now() < deadline) {
    const timeout = Math.max(1, Math.min(500, deadline - Date.now()));
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
      if (response.ok) { await response.body?.cancel(); return; }
      await response.body?.cancel();
    } catch { /* A not-yet-ready local preview is expected during this bounded wait. */ }
    await delay(Math.min(100, Math.max(1, deadline - Date.now())));
  }
  throw new Error('The project preview did not become ready on its isolated loopback port within 15 seconds');
}

function millisecondsLeft(limit = 5000) {
  const value = Math.min(limit, remaining());
  if (value <= 0) throw new Error('Browser verification wall-clock deadline expired');
  return value;
}

async function operation(page, step) {
  if (step.op === 'click') return locator(page, step).click({ timeout: millisecondsLeft() });
  if (step.op === 'expect-visible') return locator(page, step).waitFor({ state: 'visible', timeout: millisecondsLeft() });
  if (step.op === 'expect-enabled' || step.op === 'expect-disabled') {
    const target = locator(page, step), deadline = Math.min(Date.now() + 5000, Number(policy.deadlineAt));
    while (Date.now() < deadline) {
      const enabled = await target.isEnabled({ timeout: millisecondsLeft(250) });
      if (step.op === 'expect-enabled' ? enabled : !enabled) return;
      await delay(Math.min(step.op === 'expect-enabled' ? 50 : 25, Math.max(1, deadline - Date.now())));
    }
    throw new Error(`Expected ${step.role} “${step.name}” to become ${step.op === 'expect-enabled' ? 'enabled' : 'disabled'}`);
  }
  if (step.op === 'expect-text') {
    const target = locator(page, step);
    await target.waitFor({ state: 'visible', timeout: millisecondsLeft() });
    const deadline = Math.min(Date.now() + 5000, Number(policy.deadlineAt));
    while (Date.now() < deadline) {
      if ((await target.innerText({ timeout: millisecondsLeft(250) })).trim() === step.text) return;
      await delay(Math.min(50, Math.max(1, deadline - Date.now())));
    }
    throw new Error(`Expected ${step.role} “${step.name}” to contain the configured result text`);
  }
  if (step.op === 'press') return page.keyboard.press(step.key, { timeout: millisecondsLeft() });
  if (step.op === 'expect-focused') {
    if (!(await locator(page, step).evaluate(element => document.activeElement === element, { timeout: millisecondsLeft() })))
      throw new Error(`Expected ${step.role} “${step.name}” to have keyboard focus`);
    return;
  }
  throw new Error(`Unsupported browser operation ${step.op}`);
}

function traceEntry(step, index, status, durationMs, message) {
  return {
    index, op: step.op,
    ...(step.op === 'press' ? { key: step.key } : { role: step.role, name: step.name }),
    ...(step.op === 'expect-text' ? { expectedText: step.text } : {}),
    status, durationMs: Math.max(0, Math.min(durationMs, Number(policy.timeoutSeconds) * 1000)),
    ...(message ? { message: boundedMessage(message) } : {}),
  };
}

async function runStory(browser, story) {
  const started = Date.now();
  const result = { id: story.id, contentHash: story.contentHash, status: 'passed', durationMs: 0, trace: [] };
  let context, page;
  try {
    const viewport = story.viewport === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 };
    context = await browser.newContext({ viewport, colorScheme: story.theme });
    page = await context.newPage();
    page.setDefaultTimeout(millisecondsLeft());
    await page.route('**/*', route => {
      try {
        const url = new URL(route.request().url());
        return url.origin === `http://127.0.0.1:${policy.port}` ? route.continue() : route.abort('blockedbyclient');
      } catch { return route.abort('blockedbyclient'); }
    });
    await page.goto(`http://127.0.0.1:${policy.port}${story.path}`, {
      waitUntil: 'domcontentloaded', timeout: millisecondsLeft(15_000),
    });
    for (let index = 0; index < story.steps.length; index++) {
      const step = story.steps[index], stepStarted = Date.now();
      try {
        await operation(page, step);
        result.trace.push(traceEntry(step, index, 'passed', Date.now() - stepStarted));
      } catch (error) {
        result.trace.push(traceEntry(step, index, 'failed', Date.now() - stepStarted, error));
        result.status = 'failed';
        result.message = boundedMessage(error);
        break;
      }
    }
  } catch (error) {
    result.status = 'failed';
    result.message = boundedMessage(error);
  }

  if (page) {
    try {
      const png = await page.screenshot({ type: 'png', fullPage: false, animations: 'disabled', timeout: millisecondsLeft(5000) });
      if (png.length > MAX_SCREENSHOT_BYTES || retainedScreenshotBytes + png.length > MAX_TOTAL_SCREENSHOT_BYTES
        || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        throw new Error('Browser screenshot was not a bounded PNG image');
      const file = `web-story-${story.id}.png`;
      writeFileSync(join(OUTPUT, file), png, { mode: 0o600, flag: 'wx' });
      retainedScreenshotBytes += png.length;
      result.screenshot = { file, sha256: digest(png), bytes: png.length };
    } catch (error) {
      result.message = [result.message, `Screenshot could not be retained: ${boundedMessage(error)}`].filter(Boolean).join(' ');
      if (result.status === 'passed') result.status = 'inconclusive';
    }
  } else if (result.status === 'passed') {
    result.status = 'inconclusive';
    result.message = 'The browser page was not available for screenshot capture.';
  }

  result.durationMs = Math.max(0, Math.min(Date.now() - started, Number(policy.timeoutSeconds) * 1000));
  try { await context?.close(); }
  catch (error) {
    if (result.status === 'passed') result.status = 'inconclusive';
    result.message = [result.message, `Browser context cleanup failed: ${boundedMessage(error)}`].filter(Boolean).join(' ');
  }
  return result;
}

const initial = {
  version: 1, job: policy.job, attempt: policy.attempt, head: policy.head, tree: policy.tree,
  policyHash: policy.policyHash, webPolicyHash: policy.webPolicyHash,
  tool: { adapter: policy.adapter, version: packageVersion, browser: 'chromium', image: policy.image,
    platform: 'linux-container', coverage: 'web' },
  stories: failedStories('inconclusive', 'The story did not finish before the browser runner stopped.'),
};

function currentStatus(final = false) {
  if (!final) return 'inconclusive';
  return initial.stories.every(story => story.status === 'passed') ? 'passed'
    : initial.stories.some(story => story.status === 'failed') ? 'failed' : 'inconclusive';
}

mkdirSync('/tmp/browser-home', { recursive: true, mode: 0o700 });
mkdirSync('/tmp/browser-home/cache', { recursive: true, mode: 0o700 });
if (process.platform !== 'linux' || packageVersion !== policy.version) {
  initial.stories = failedStories('unavailable', 'Configured Playwright version or Linux browser capability is unavailable.');
  writeResult({ ...initial, status: 'unavailable' });
  process.exit(0);
}

let browser;
let browserCloseFailure = null;
try {
  browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath(),
    env: { ...process.env, HOME: '/tmp/browser-home', XDG_CACHE_HOME: '/tmp/browser-home/cache' },
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  initial.tool.browserVersion = browser.version();
} catch (error) {
  initial.stories = failedStories('unavailable', `Chromium could not start: ${boundedMessage(error)}`);
  writeResult({ ...initial, status: 'unavailable' });
  process.exit(0);
}

try {
  await waitForPreview();
  for (let index = 0; index < policy.stories.length; index++) {
    initial.stories[index] = await runStory(browser, policy.stories[index]);
    writeResult({ ...initial, status: currentStatus() });
    if (remaining() <= 0) break;
  }
} catch (error) {
  const message = boundedMessage(error);
  for (const story of initial.stories) {
    if (story.status === 'inconclusive' && !story.message) story.message = message;
  }
  if (!initial.stories.some(story => story.status === 'failed')) {
    for (let index = 0; index < policy.stories.length; index++) {
      if (initial.stories[index].status === 'inconclusive') {
        initial.stories[index].status = 'failed';
        initial.stories[index].message = message;
      }
    }
  }
} finally {
  try { await browser.close(); }
  catch (error) { browserCloseFailure = boundedMessage(error); }
}

if (browserCloseFailure) {
  for (const story of initial.stories) {
    if (story.status === 'passed') story.status = 'inconclusive';
    story.message = [story.message, `Chromium cleanup failed: ${browserCloseFailure}`].filter(Boolean).join(' ').slice(0, 1000);
  }
}
writeResult({ ...initial, status: currentStatus(true) });
