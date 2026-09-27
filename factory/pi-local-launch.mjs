// Mounted read-only beside the single selected registry. Pi 0.73.1 JSON mode
// may exit zero after a provider error; preserve the stream but fail the job.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
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
env.PI_CODING_AGENT_DIR = directory;
const child = spawn('pi', args, { env, stdio: ['inherit', 'pipe', 'inherit'] });
let pending = '', failed = false, completed = false;
const event = line => {
  if (!line.trim()) return;
  try {
    const value = JSON.parse(line);
    if (value.type === 'message_end' && value.message?.role === 'assistant'
      && ['error', 'aborted'].includes(value.message.stopReason)) failed = true;
    if (value.type === 'agent_end') completed = true;
  } catch { failed = true; }
};
child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
  process.stdout.write(chunk);
  pending += chunk;
  let end;
  while ((end = pending.indexOf('\n')) !== -1) { event(pending.slice(0, end)); pending = pending.slice(end + 1); }
  if (pending.length > 1024 * 1024) { failed = true; pending = ''; }
});
child.on('error', error => { console.error(`Local Pi launch failed: ${error.message}`); process.exitCode = 1; });
child.on('close', code => {
  if (pending) event(pending);
  if (failed || !completed) console.error('Local Pi did not complete successfully; inspect the private log. No fallback was selected.');
  process.exitCode = code === 0 && !failed && completed ? 0 : (Number.isInteger(code) && code > 0 ? code : 1);
});
