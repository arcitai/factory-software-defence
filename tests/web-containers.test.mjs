import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const helperURL = pathToFileURL(join(root, 'factory/web/containers.mjs')).href;

test('preview and browser use separate non-root mounts and a real deadline removes both exact containers', t => {
  const temp = mkdtempSync(join(root, '.web-containers-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const bin = join(temp, 'bin'), stateDir = join(temp, 'state'), workspace = join(temp, 'workspace');
  const attemptDir = join(temp, 'attempt'), scratch = join(attemptDir, 'check-workspace');
  for (const path of [bin, stateDir, workspace, attemptDir, scratch, join(scratch, 'check')])
    mkdirSync(path, { recursive: true, mode: 0o700 });
  const cache = join(scratch, 'check', 'readonly-cache'), blockedFile = join(cache, 'partial.txt');
  const outside = join(temp, 'outside.txt');
  mkdirSync(cache, { mode: 0o700 });
  writeFileSync(blockedFile, 'owned scratch');
  writeFileSync(outside, 'outside remains unchanged');
  symlinkSync(outside, join(cache, 'outside-link'));
  chmodSync(blockedFile, 0);
  chmodSync(cache, 0);
  const statePath = join(temp, 'docker.json');
  writeFileSync(statePath, JSON.stringify({ containers: {}, runs: [] }), { mode: 0o600 });
  const docker = join(bin, 'docker');
  writeFileSync(docker, `#!${process.execPath}
import { readFileSync, writeFileSync } from 'node:fs';
const path = process.env.SDF_WEB_DOCKER_STATE;
const state = JSON.parse(readFileSync(path, 'utf8'));
const [command, ...args] = process.argv.slice(2);
let input = '';
for await (const part of process.stdin) input += part;
const save = () => writeFileSync(path, JSON.stringify(state));
const out = value => process.stdout.write(value ? value + '\\n' : '');
const find = value => Object.values(state.containers).find(item => item.name === value || item.id === value);
if (command === 'run') {
  const name = args[args.indexOf('--name') + 1];
  const roleLabel = args.find(value => value.startsWith('sdf.role='));
  const role = roleLabel?.slice('sdf.role='.length);
  const labels = Object.fromEntries(args.flatMap(value => value === '--label' ? [] : []));
  const collected = {};
  for (let i = 0; i < args.length - 1; i++) if (args[i] === '--label') { const [key, ...rest] = args[i + 1].split('='); collected[key] = rest.join('='); }
  const entrypoint = args.indexOf('--entrypoint');
  const image = args[entrypoint + 2];
  const id = role === 'web-preview' ? 'preview-fixture-id' : 'browser-fixture-id';
  const item = { name, id, role, image, labels: collected, running: true, present: true };
  state.containers[name] = item; state.runs.push({ role, args }); save();
  if (role === 'web-preview') { out(id); process.exit(0); }
  await new Promise(resolve => setInterval(resolve, 10000));
}
if (command === 'ps') {
  const filter = args[args.indexOf('--filter') + 1] || '';
  const items = Object.values(state.containers).filter(item => item.present &&
    (filter === 'name=^/' + item.name + '$' || filter === 'label=sdf.factory=' + item.labels['sdf.factory']));
  out(items.map(item => item.id).join('\\n')); process.exit(0);
}
if (command === 'inspect') {
  const item = find(args[0]);
  if (!item || !item.present) { process.stderr.write('No such object\\n'); process.exit(1); }
  out(JSON.stringify([{ Name: '/' + item.name, Id: item.id, Image: item.image, Config: { Labels: item.labels }, State: { Running: item.running } }])); process.exit(0);
}
if (command === 'rm') {
  const item = find(args.at(-1));
  if (!item || !item.present) { process.stderr.write('No such container\\n'); process.exit(1); }
  item.present = false; item.running = false; save(); out(item.id); process.exit(0);
}
process.stderr.write('Unexpected controlled Docker command\\n'); process.exit(42);
`, { mode: 0o700 });
  chmodSync(docker, 0o700);

  const task = `import { runWebContainers } from ${JSON.stringify(helperURL)};
const state=process.argv[1],workspace=process.argv[2],scratch=process.argv[3],attemptDir=process.argv[4];
const web={image:'sha256:${'b'.repeat(64)}',previewCommand:['node','server.mjs'],port:4173};
const config={image:'sha256:${'a'.repeat(64)}',memoryMiB:512,cpus:1,pidsLimit:64};
const result=await runWebContainers({state,job:'job_${'c'.repeat(24)}',attempt:'run_${'d'.repeat(24)}',config,web,workspace,scratch,attemptDir,input:'{}',deadlineAt:Date.now()+350});
process.stdout.write(JSON.stringify(result));`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', task, stateDir, workspace, scratch, attemptDir], {
    encoding: 'utf8', timeout: 10_000, env: { ...process.env, PATH: bin, SDF_WEB_DOCKER_STATE: statePath },
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);
  assert.equal(result.timedOut, true);
  assert.equal(result.error, 'Browser verification wall-clock deadline expired');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.deepEqual(Object.values(state.containers).map(item => item.role).sort(), ['web-browser', 'web-preview']);
  assert(Object.values(state.containers).every(item => item.present === false && item.running === false),
    'both containers are confirmed absent before the helper returns');

  const preview = state.runs.find(item => item.role === 'web-preview').args;
  const browser = state.runs.find(item => item.role === 'web-browser').args;
  for (const args of [preview, browser]) {
    assert.equal(args[args.indexOf('--user') + 1], `${process.getuid()}:${process.getgid()}`);
    assert(args.includes('--read-only'));
    assert(args.includes('--cap-drop=ALL'));
    assert.equal(args.some(value => value.startsWith('--cap-add')), false);
    assert.equal(args.includes('--privileged'), false);
    assert.equal(args.some(value => value.includes('docker.sock')), false);
    assert.equal(args.some(value => value.startsWith('--env-file')), false);
  }
  assert(preview.includes('--network=none'));
  assert(preview.some(value => value.includes('target=/workspace,readonly')));
  assert(preview.some(value => value.includes('target=/scratch')));
  assert.equal(preview.some(value => value.includes('target=/browser-output')), false);
  assert(browser.includes('container:' + state.containers[Object.keys(state.containers).find(name => name.endsWith('-web-preview'))].name));
  assert(browser.some(value => value.includes('target=/browser-output')));
  assert.equal(browser.some(value => value.includes('target=/workspace') || value.includes('target=/scratch')), false);
  assert.notEqual(lstatSync(blockedFile).mode & 0o600, 0, 'controller-owned readonly check scratch becomes writable without adding container capabilities');
  assert.equal(lstatSync(join(cache, 'outside-link')).isSymbolicLink(), true, 'scratch permission repair does not follow candidate symlinks');
  assert.equal(readFileSync(outside, 'utf8'), 'outside remains unchanged');
  assert.match(readFileSync(result.logPath, 'utf8'), /wall-clock deadline expired/);
});
