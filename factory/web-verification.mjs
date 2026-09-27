import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PLAYWRIGHT_VERSION = '1.63.0';
export const WEB_STORY_STATUSES = Object.freeze(['passed', 'failed', 'unavailable', 'inconclusive']);
export const MAX_WEB_SCREENSHOT_BYTES = 2 * 1024 * 1024;
export const MAX_WEB_SCREENSHOT_TOTAL_BYTES = 8 * 1024 * 1024;
const SHA256_IMAGE = /^sha256:[a-f0-9]{64}$/;
const REQUIRED_STORIES = Object.freeze(['busy-disabled', 'result', 'failure-retry', 'keyboard-focus']);
const ROLES = new Set(['alert', 'button', 'checkbox', 'heading', 'link', 'option', 'radio', 'status', 'tab', 'textbox']);
const KEYS = new Set(['Tab', 'Enter', 'Space', 'Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);
const OPS = new Set(['click', 'expect-visible', 'expect-enabled', 'expect-disabled', 'expect-text', 'press', 'expect-focused']);
const digest = value => createHash('sha256').update(value).digest('hex');
const screenshotName = id => `web-story-${id}.png`;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function text(value, where, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value))
    throw new Error(`webVerification ${where} must be a nonempty string under ${max} characters`);
}

function onlyKeys(value, keys, where) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error(`webVerification ${where} contains an unsupported field`);
}

function locatorStep(step, where) {
  if (!step || typeof step !== 'object' || Array.isArray(step) || !OPS.has(step.op))
    throw new Error(`webVerification ${where} uses an unsupported story operation`);
  onlyKeys(step, step.op === 'press' ? ['op', 'key'] : step.op === 'expect-text'
    ? ['op', 'role', 'name', 'text'] : ['op', 'role', 'name'], where);
  if (step.op === 'press') {
    if (!KEYS.has(step.key)) throw new Error(`webVerification ${where} uses an unsupported keyboard key`);
    return;
  }
  if (!ROLES.has(step.role)) throw new Error(`webVerification ${where} uses an unsupported accessibility role`);
  text(step.name, `${where}.name`);
  if (step.op === 'expect-text') text(step.text, `${where}.text`);
}

function has(story, op, after = -1) {
  return story.steps.findIndex((step, index) => index > after && step.op === op);
}

function validateStory(story, index) {
  const where = `stories[${index}]`;
  if (!story || typeof story !== 'object' || Array.isArray(story)) throw new Error(`webVerification ${where} must be an object`);
  onlyKeys(story, ['id', 'viewport', 'theme', 'path', 'steps'], where);
  text(story.id, `${where}.id`, 64);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(story.id)) throw new Error(`webVerification ${where}.id is invalid`);
  if (!['desktop', 'narrow'].includes(story.viewport)) throw new Error(`webVerification ${where}.viewport must be desktop or narrow`);
  if (!['light', 'dark'].includes(story.theme)) throw new Error(`webVerification ${where}.theme must be light or dark`);
  if (typeof story.path !== 'string' || !story.path.startsWith('/') || story.path.startsWith('//')
    || story.path.includes('\\') || story.path.length > 1024 || /[\u0000-\u001f\u007f]/.test(story.path))
    throw new Error(`webVerification ${where}.path must be a local path`);
  if (!Array.isArray(story.steps) || story.steps.length < 1 || story.steps.length > 24)
    throw new Error(`webVerification ${where}.steps must contain 1–24 operations`);
  story.steps.forEach((step, stepIndex) => locatorStep(step, `${where}.steps[${stepIndex}]`));
  return story;
}

export function validateWebVerification(value) {
  if (value === undefined) return { enabled: false };
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.enabled !== 'boolean')
    throw new Error('webVerification must be an object with enabled: true or false');
  if (!value.enabled) {
    if (Object.keys(value).some(key => key !== 'enabled'))
      throw new Error('Disabled webVerification accepts only enabled: false');
    return { enabled: false };
  }
  onlyKeys(value, ['enabled', 'adapter', 'version', 'image', 'previewCommand', 'port', 'timeoutSeconds', 'themes', 'stories'], 'configuration');
  if (typeof value.adapter !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(value.adapter))
    throw new Error('webVerification.adapter must be a tool name');
  if (typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.version))
    throw new Error('webVerification.version must be an exact semantic version');
  if (typeof value.image !== 'string' || !SHA256_IMAGE.test(value.image))
    throw new Error('webVerification.image must be an immutable local Docker image ID (sha256:...)');
  if (!Array.isArray(value.previewCommand) || value.previewCommand.length < 1 || value.previewCommand.length > 32
    || !value.previewCommand.every(arg => typeof arg === 'string' && arg.length > 0 && arg.length <= 512 && !arg.includes('\0')))
    throw new Error('webVerification.previewCommand must be a bounded argument array');
  if (!Number.isInteger(value.port) || value.port < 1024 || value.port > 65535)
    throw new Error('webVerification.port must be an integer from 1024 to 65535');
  if (!Number.isInteger(value.timeoutSeconds) || value.timeoutSeconds < 30 || value.timeoutSeconds > 600)
    throw new Error('webVerification.timeoutSeconds must be 30–600');
  if (!Array.isArray(value.themes) || value.themes.length < 1 || value.themes.length > 2
    || value.themes.some(theme => !['light', 'dark'].includes(theme)) || new Set(value.themes).size !== value.themes.length)
    throw new Error('webVerification.themes must select light and/or dark');
  if (!Array.isArray(value.stories) || value.stories.length < value.themes.length * 2 + REQUIRED_STORIES.length || value.stories.length > 16)
    throw new Error('webVerification.stories must include the required named stories');
  const stories = value.stories.map(validateStory);
  const ids = new Set(stories.map(story => story.id));
  if (ids.size !== stories.length) throw new Error('webVerification story IDs must be unique');
  for (const theme of value.themes) {
    for (const viewport of ['desktop', 'narrow']) {
      const id = `${viewport}-${theme}`;
      const story = stories.find(item => item.id === id && item.viewport === viewport && item.theme === theme);
      const action = story ? has(story, 'click') : -1;
      if (!story || action < 0 || has(story, 'expect-text', action) < 0)
        throw new Error(`webVerification requires an interactive ${id} story`);
    }
  }
  const semanticTheme = value.themes[0];
  const busy = stories.find(story => story.id === 'busy-disabled');
  const result = stories.find(story => story.id === 'result');
  const retry = stories.find(story => story.id === 'failure-retry');
  const focus = stories.find(story => story.id === 'keyboard-focus');
  if ([busy, result, retry, focus].some(story => !story || story.viewport !== 'desktop' || story.theme !== semanticTheme))
    throw new Error('webVerification semantic interaction stories must use the first configured theme at desktop size');
  const busyClick = has(busy, 'click'), busyDisabled = has(busy, 'expect-disabled', busyClick);
  const busyEnabled = has(busy, 'expect-enabled', busyDisabled);
  if (busyClick < 0 || busyDisabled < 0 || busyEnabled < 0 || has(busy, 'expect-text', busyEnabled) < 0)
    throw new Error('webVerification busy-disabled story must click, observe disabled and enabled states, and check a result');
  const resultClick = has(result, 'click');
  if (resultClick < 0 || has(result, 'expect-text', resultClick) < 0)
    throw new Error('webVerification result story must click an action and assert its resulting text');
  const retryClicks = retry?.steps.map((step, index) => step.op === 'click' ? index : -1).filter(index => index >= 0) || [];
  if (retryClicks.length < 2 || !retry.steps.some((step, index) => index < retryClicks[1] && step.op === 'expect-text' && step.role === 'alert')
    || !retry.steps.some((step, index) => index > retryClicks[1] && step.op === 'expect-text' && step.role === 'status'))
    throw new Error('webVerification failure-retry story must assert an alert, retry, and assert a status result');
  const pressed = has(focus, 'press');
  if (pressed < 0 || has(focus, 'expect-focused', pressed) < 0)
    throw new Error('webVerification keyboard-focus story must press a key and assert focus');
  return { enabled: true };
}

export function webPolicyHash(webVerification) {
  return digest(JSON.stringify(webVerification));
}

export function webStoryHash(story) {
  return digest(JSON.stringify(story));
}

export function expectedWebStories(webVerification) {
  return webVerification.stories.map(story => ({ id: story.id, contentHash: webStoryHash(story) }));
}

export function makeUnavailableWebEvidence({ job, attempt, meta, policyHash, webVerification, reason, status = 'unavailable' }) {
  const expected = expectedWebStories(webVerification);
  return {
    version: 1, status, job, attempt, head: meta.head, tree: meta.tree, policyHash,
    webPolicyHash: webPolicyHash(webVerification), tool: {
      adapter: webVerification.adapter, version: webVerification.version, browser: 'chromium',
      image: webVerification.image, platform: 'linux-container', coverage: 'web',
    }, stories: expected.map(story => ({ ...story, status, trace: [], message: String(reason).slice(0, 1000) })),
  };
}

export function assertWebStoryTrace(configuration, actual) {
  const story = configuration.stories.find(item => item.id === actual.id);
  if (!story || !Array.isArray(actual.trace) || actual.trace.length > story.steps.length)
    throw new Error('Required browser action trace is missing or malformed');
  for (let index = 0; index < actual.trace.length; index++) {
    const event = actual.trace[index], expected = story.steps[index];
    const allowed = ['index', 'op', 'role', 'name', 'key', 'expectedText', 'status', 'durationMs', 'message'];
    if (!event || typeof event !== 'object' || Array.isArray(event) || Object.keys(event).some(key => !allowed.includes(key))
      || event.index !== index || event.op !== expected.op || !['passed', 'failed', 'inconclusive'].includes(event.status)
      || !Number.isFinite(event.durationMs) || event.durationMs < 0)
      throw new Error('Required browser action trace is missing or malformed');
    if (expected.op === 'press') {
      if (event.key !== expected.key || event.role !== undefined || event.name !== undefined || event.expectedText !== undefined)
        throw new Error('Browser action trace does not match its frozen story');
    } else if (event.role !== expected.role || event.name !== expected.name || event.key !== undefined
      || (expected.op === 'expect-text' ? event.expectedText !== expected.text : event.expectedText !== undefined))
      throw new Error('Browser action trace does not match its frozen story');
    if (event.message !== undefined && (typeof event.message !== 'string' || event.message.length > 1000))
      throw new Error('Browser action trace message is malformed');
  }
  if (actual.status === 'passed' && (actual.trace.length !== story.steps.length
    || actual.trace.some(event => event.status !== 'passed')))
    throw new Error('Passing browser evidence does not contain every successful configured action');
  if (actual.status === 'failed' && actual.trace.length
    && (actual.trace.at(-1).status !== 'failed' || actual.trace.slice(0, -1).some(event => event.status !== 'passed')))
    throw new Error('Failed browser evidence does not match its action trace');
  if (actual.status === 'unavailable' && actual.trace.length)
    throw new Error('Unavailable browser evidence cannot contain executed actions');
  const requiresScreenshot = actual.status === 'passed' || actual.trace.length > 0;
  if (actual.screenshot === undefined) {
    if (requiresScreenshot) throw new Error('Browser screenshot evidence is missing');
    return;
  }
  const screenshot = actual.screenshot;
  if (!screenshot || typeof screenshot !== 'object' || Array.isArray(screenshot)
    || Object.keys(screenshot).some(key => !['file', 'sha256', 'bytes'].includes(key))
    || screenshot.file !== screenshotName(actual.id) || !/^[a-f0-9]{64}$/.test(screenshot.sha256 || '')
    || !Number.isSafeInteger(screenshot.bytes) || screenshot.bytes < pngSignature.length
    || screenshot.bytes > MAX_WEB_SCREENSHOT_BYTES)
    throw new Error('Browser screenshot evidence is missing or malformed');
}

export function assertCurrentWebArtifacts(webVerification, evidence, artifactDirectory) {
  if (!webVerification?.enabled) return;
  assertCurrentWebEvidence(webVerification, evidence, { job: evidence?.job, attempt: evidence?.attempt,
    meta: { head: evidence?.head, tree: evidence?.tree }, policyHash: evidence?.policyHash });
  const directory = lstatSync(artifactDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Browser artifact directory is missing or unsafe');
  let totalBytes = 0;
  for (const story of evidence.stories) {
    if (!story.screenshot) continue;
    const path = join(artifactDirectory, story.screenshot.file), stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== story.screenshot.bytes
      || stat.size > MAX_WEB_SCREENSHOT_BYTES) throw new Error('Browser screenshot artifact is missing or unsafe');
    const bytes = readFileSync(path);
    if (!bytes.subarray(0, pngSignature.length).equals(pngSignature) || digest(bytes) !== story.screenshot.sha256)
      throw new Error('Browser screenshot artifact does not match its retained evidence hash');
    totalBytes += bytes.length;
    if (totalBytes > MAX_WEB_SCREENSHOT_TOTAL_BYTES) throw new Error('Browser screenshot evidence exceeds its retained size bound');
  }
}

export function assertCurrentWebEvidence(webVerification, evidence, { job, attempt, meta, policyHash }) {
  if (!webVerification?.enabled) return;
  validateWebVerification(webVerification);
  const expected = expectedWebStories(webVerification);
  if (!evidence || evidence.version !== 1 || evidence.status !== 'passed'
    || evidence.job !== job || evidence.attempt !== attempt
    || !/^run_[a-z0-9]+$/.test(evidence.attempt || '')
    || evidence.head !== meta.head || evidence.tree !== meta.tree || evidence.policyHash !== policyHash
    || evidence.webPolicyHash !== webPolicyHash(webVerification)
    || evidence.tool?.adapter !== webVerification.adapter || evidence.tool?.version !== webVerification.version
    || evidence.tool?.browser !== 'chromium' || evidence.tool?.image !== webVerification.image
    || evidence.tool?.platform !== 'linux-container' || evidence.tool?.coverage !== 'web'
    || typeof evidence.tool?.browserVersion !== 'string' || !evidence.tool.browserVersion.trim()
    || !Array.isArray(evidence.stories) || evidence.stories.length !== expected.length)
    throw new Error('Required browser evidence is missing, stale or malformed for this candidate and policy');
  for (let index = 0; index < expected.length; index++) {
    const actual = evidence.stories[index], required = expected[index];
    if (actual?.id !== required.id || actual?.contentHash !== required.contentHash || actual?.status !== 'passed'
      || !Number.isFinite(actual.durationMs) || actual.durationMs < 0)
      throw new Error('Required browser story evidence is missing, stale or non-passing');
    assertWebStoryTrace(webVerification, actual);
  }
}

export function webEvidenceSummary(evidence) {
  if (!evidence || !WEB_STORY_STATUSES.includes(evidence.status)) return null;
  return {
    status: evidence.status, candidate: evidence.head, attempt: evidence.attempt, policyHash: evidence.policyHash,
    adapter: evidence.tool?.adapter || null, version: evidence.tool?.version || null,
    browser: evidence.tool?.browser || null, browser_version: evidence.tool?.browserVersion || null,
    platform: evidence.tool?.platform || null,
    coverage: evidence.tool?.coverage || null,
    stories: Array.isArray(evidence.stories) ? evidence.stories.map(story => ({
      id: story.id, contentHash: story.contentHash, status: WEB_STORY_STATUSES.includes(story.status) ? story.status : 'inconclusive',
      ...(Array.isArray(story.trace) ? { trace: story.trace.map(event => ({ ...event })) } : {}),
      ...(story.screenshot ? { screenshot: { ...story.screenshot } } : {}),
      ...(typeof story.message === 'string' ? { message: story.message.slice(0, 1000) } : {}),
    })) : [],
  };
}
