// Mounted read-only beside the single selected registry. Keep all JSON evidence;
// process exit alone does not establish a successfully completed Pi turn.
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

// A long run can emit a multi-megabyte agent_end aggregate even after compaction.
// Bound parsing separately from the much smaller retained diagnostic log.
const MAX_EVENT_CHARACTERS = 8 * 1024 * 1024;

// Pi 0.73.1 and 0.87.1 print JSONL. Errors can precede explicit recovery, but
// aborted/failed compaction, invalid framing and incomplete recovery stay fatal.
export class PiCompletion {
  pending = '';
  failed = false;
  error = false;
  retry = false;
  compacting = false;
  compactionReason = null;
  recovery = false;
  completed = false;
  modern = false;
  settled = false;
  lastAssistant = null;
  contextReady = false;
  proactiveRecovery = false;
  proactiveCount = 0;

  write(chunk) {
    this.pending += chunk;
    let end;
    while ((end = this.pending.indexOf('\n')) !== -1) {
      const line = this.pending.slice(0, end);
      this.pending = this.pending.slice(end + 1);
      if (line.length > MAX_EVENT_CHARACTERS) this.failed = true;
      else if (line.trim()) {
        try { this.event(JSON.parse(line)); } catch { this.failed = true; }
      }
    }
    if (this.pending.length > MAX_EVENT_CHARACTERS) { this.failed = true; this.pending = ''; }
  }

  event(value) {
    if (!value || typeof value.type !== 'string') { this.failed = true; return; }
    if (value.type === 'factory_context_ready' && value.version === 1) this.contextReady = true;
    if (value.type === 'factory_context_recovery') {
      if (value.phase === 'start') {
        if (this.proactiveRecovery || value.recovery !== this.proactiveCount + 1 || value.recovery > 16) this.failed = true;
        this.proactiveCount = value.recovery;
        this.proactiveRecovery = true;
        this.settled = false;
      } else if (value.phase === 'complete') {
        if (!this.proactiveRecovery || value.recovery !== this.proactiveCount) this.failed = true;
        this.proactiveRecovery = false;
      } else this.failed = true;
    }
    if (value.type === 'agent_start' || value.type === 'message_start') {
      this.completed = false; this.settled = false;
    }
    if (value.type === 'message_end' && (!value.message || typeof value.message.role !== 'string')) this.failed = true;
    if (value.type === 'message_end' && value.message?.role === 'assistant') {
      this.completed = false;
      this.settled = false;
      this.lastAssistant = value.message;
      if (!['stop', 'toolUse', 'length', 'error', 'aborted'].includes(value.message.stopReason) || !Array.isArray(value.message.content)) this.failed = true;
      if (value.message.stopReason === 'aborted') this.failed = true;
      else if (['error', 'length'].includes(value.message.stopReason)) { this.error = true; this.recovery = false; }
      else if (['stop', 'toolUse'].includes(value.message.stopReason)) {
        if (this.error && (this.retry || this.recovery)) this.error = false;
        this.recovery = false;
      }
    }
    if (value.type === 'auto_retry_start') { this.retry = true; this.completed = false; this.settled = false; }
    if (value.type === 'auto_retry_end') {
      if (!this.retry || value.success !== true) this.failed = true;
      this.retry = false;
    }
    // Both audited versions use compaction_*; retain the older public alias
    // defensively so failed compaction never disappears as an ignored event.
    if (['compaction_start', 'auto_compaction_start'].includes(value.type)) {
      if (this.compacting || !['manual', 'threshold', 'overflow'].includes(value.reason)) this.failed = true;
      this.compactionReason = value.reason;
      this.compacting = true; this.settled = false;
    }
    if (['compaction_end', 'auto_compaction_end'].includes(value.type)) {
      if (!this.compacting || value.reason !== this.compactionReason || typeof value.willRetry !== 'boolean'
        || value.aborted !== false || value.errorMessage
        || !value.result || typeof value.result.summary !== 'string' || !value.result.summary.trim()) this.failed = true;
      this.compacting = false;
      if (value.reason === 'overflow' && value.willRetry === true && !this.failed) this.recovery = true;
    }
    if (value.type === 'agent_end') {
      this.settled = false;
      if (Object.hasOwn(value, 'willRetry')) {
        this.modern = true;
        if (typeof value.willRetry !== 'boolean') this.failed = true;
      }
      const last = value.messages?.at(-1);
      this.completed = value.willRetry !== true && last?.role === 'assistant' && last.stopReason === 'stop'
        && this.lastAssistant?.stopReason === 'stop'
        && JSON.stringify(last) === JSON.stringify(this.lastAssistant)
        && Array.isArray(last.content) && last.content.some(part => part.type === 'text' && part.text?.trim())
        && !last.content.some(part => part.type === 'toolCall');
    }
    if (value.type === 'agent_settled') this.settled = true;
  }

  finish() {
    return !this.pending && !this.failed && !this.error && !this.retry && !this.compacting && !this.recovery
      && !this.proactiveRecovery && this.completed && (!this.modern || this.settled);
  }
}

function launch() {
  const directory = dirname(fileURLToPath(import.meta.url));
  const registry = JSON.parse(readFileSync(join(directory, 'models.json'), 'utf8'));
  const provider = registry.providers?.['factory-local'];
  const args = process.argv.slice(2);
  const selected = flag => args.filter(arg => arg === flag).length === 1 ? args[args.indexOf(flag) + 1] : null;
  const model = provider?.models?.[0];
  const thinking = selected('--thinking');
  const validThinking = model?.reasoning && model?.thinkingLevelMap?.off !== 'none'
    ? ['low', 'medium', 'high'].includes(thinking) : thinking === 'off';
  if (Object.keys(registry.providers || {}).length !== 1 || provider?.models?.length !== 1
    || selected('--provider') !== 'factory-local' || selected('--model') !== provider.models[0].id
    || selected('--mode') !== 'json' || !validThinking)
    throw new Error('Local Pi registry and explicit selection do not match; refusing fallback');
  // Never inherit credential inputs, provider overrides, NODE_OPTIONS or external
  // Pi directories. The runtime image supplies binaries; the repository supplies data.
  const env = Object.fromEntries(['PATH', 'HOME', 'LANG', 'TMPDIR', 'FACTORY_PHASE'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  for (const file of ['pi-context-extension.mjs', 'pi-context-budget.mjs']) readFileSync(join(directory, file));
  const version = spawnSync('pi', ['--version'], { env, encoding: 'utf8', timeout: 10000 });
  if (version.status !== 0 || version.stdout.trim() !== '0.87.1')
    throw new Error('Local context protection requires pinned Pi 0.87.1; qualify and select the worker image while idle. No fallback.');
  // Pi's home is mutable runtime state (including trust-store locks), not the
  // operator-owned binding. Each launch gets a private directory in the existing
  // sandbox tmpfs; no host trust/auth/settings are copied. Keep model input linked
  // to its read-only mount, and load the adapter directly from that mount.
  const runtimeDirectory = mkdtempSync('/tmp/factory-pi-');
  const cleanup = () => rmSync(runtimeDirectory, { recursive: true, force: true });
  process.on('exit', cleanup); // Container teardown also clears interrupted runs.
  symlinkSync(join(directory, 'models.json'), join(runtimeDirectory, 'models.json'));
  env.PI_CODING_AGENT_DIR = runtimeDirectory;
  // Denying project trust also prevents project settings/packages and dependency
  // installation, which --no-extensions alone does not prevent. Explicit CLI
  // resources remain available in pinned Pi: only our adapter and mounted skills.
  const child = spawn('pi', [...args, '--no-approve', '--no-extensions', '--no-skills', '--no-prompt-templates',
    '--extension', join(directory, 'pi-context-extension.mjs'), '--api-key', 'factory-local-keyless'], { env, stdio: ['inherit', 'pipe', 'inherit'] });
  const completion = new PiCompletion();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    process.stdout.write(chunk);
    completion.write(chunk);
  });
  child.on('error', error => { console.error(`Local Pi launch failed: ${error.message}`); process.exitCode = 1; });
  child.on('close', code => {
    const completed = completion.contextReady && completion.finish();
    if (!completed) console.error('Local Pi did not complete successfully; inspect the private log. No fallback was selected.');
    process.exitCode = code === 0 && completed ? 0 : (Number.isInteger(code) && code > 0 ? code : 1);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) launch();
