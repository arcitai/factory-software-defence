import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { localRegistry, localRoleCommand } from '../factory/local-inference.mjs';
import { ROOT } from '../factory/lib.mjs';

// Actual pinned CLI, synthetic HTTP inference. Filesystem permissions exercise a
// non-root read-only checkout/config; Docker mount/rootfs proof is separate.
test('Pi project trust: old read-only home fails; isolated Build and Review keep only explicit Factory resources', { timeout: 60000 }, async t => {
  const version = spawnSync('pi', ['--version'], { encoding: 'utf8', timeout: 10000 });
  if (version.status !== 0 || version.stdout.trim() !== '0.87.1' || process.getuid?.() === 0) {
    assert.notEqual(process.env.FACTORY_REQUIRE_PI, '1', 'Requires pinned Pi 0.87.1 and non-root permission enforcement');
    return t.skip('Requires pinned Pi 0.87.1 and non-root permission enforcement');
  }
  const temp = mkdtempSync(join(tmpdir(), 'factory-trust-test-'));
  function permissions(path, writable) {
    if (lstatSync(path).isSymbolicLink()) return;
    const directory = lstatSync(path).isDirectory();
    chmodSync(path, directory ? (writable ? 0o700 : 0o500) : (writable ? 0o600 : 0o400));
    if (directory) for (const name of readdirSync(path)) permissions(join(path, name), writable);
  }
  t.after(() => { permissions(temp, true); rmSync(temp, { recursive: true, force: true }); });
  const agent = join(temp, 'binding'), workspace = join(temp, 'workspace'), output = join(temp, 'output');
  for (const path of [agent, workspace, output]) mkdirSync(path);
  const env = { PATH: process.env.PATH, HOME: join(temp, 'home'), PI_CODING_AGENT_DIR: agent };
  mkdirSync(env.HOME);
  const requests = [], runtimePaths = [], observations = [];
  let actions = [], turn = 0, behavior = 'success';
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push({ body, headers: req.headers });
    if (turn === 1 && behavior !== 'baseline') {
      const result = body.messages.find(m => m.role === 'tool');
      const runtime = result?.content.trim();
      runtimePaths.push(runtime);
      if (runtime && existsSync(runtime)) observations.push({
        path: runtime, mode: lstatSync(runtime).mode & 0o777,
        entries: readdirSync(runtime), modelTarget: readlinkSync(join(runtime, 'models.json')),
        auth: JSON.parse(readFileSync(join(runtime, 'auth.json'), 'utf8')),
        modelStore: JSON.parse(readFileSync(join(runtime, 'models-store.json'), 'utf8')),
      });
    }
    if (behavior === 'provider-failure' || (behavior === 'tool-failure' && turn > 1)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Synthetic terminal provider/tool failure', type: 'invalid_request_error' } })); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'trust-fixture', object: 'chat.completion.chunk', model: 'trust-fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    const action = actions[turn++];
    if (action) {
      chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `tool_${turn}`, type: 'function', function: { name: action.name, arguments: JSON.stringify(action.args) } }] });
      chunk({}, 'tool_calls');
    } else { chunk({ role: 'assistant', content: 'Synthetic trust fixture complete.' }); chunk({}, 'stop'); }
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const binding = { endpoint: `http://127.0.0.1:${server.address().port}/v1`, model: 'trust-fixture', contextWindow: 65536, maxTokens: 1024 };
  const registry = JSON.stringify(localRegistry(binding));
  writeFileSync(join(agent, 'models.json'), registry);
  for (const file of ['pi-local-launch.mjs', 'pi-context-extension.mjs', 'pi-context-budget.mjs'])
    writeFileSync(join(agent, file), readFileSync(join(ROOT, 'factory', file)));
  permissions(agent, false);
  const args = localRoleCommand(binding).slice(2).map(arg => arg === '/factory-skills' ? join(ROOT, 'adlc/skills') : arg);
  async function run({ oldHome = false, phase = 'build', nextActions = [], nextBehavior = 'success' } = {}) {
    turn = 0; actions = nextActions; behavior = nextBehavior;
    return await new Promise((resolve, reject) => {
      // This is the exact Pi argv/home arrangement used by the 0.15.2 launcher.
      const child = spawn(oldHome ? 'pi' : process.execPath, oldHome
        ? [...args, '--extension', join(agent, 'pi-context-extension.mjs'), '--api-key', 'factory-local-keyless']
        : [join(agent, 'pi-local-launch.mjs'), ...args], {
        cwd: workspace, env: { ...env, FACTORY_PHASE: phase, OPENAI_API_KEY: 'unused-inert-credential' }, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
      child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
      child.on('error', reject); child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
      child.stdin.end(`TRUST_TASK_${phase}: synthetic tools/report fixture; keep the mounted Factory policy and skill catalog.`);
    });
  }
  // No .pi resources or .agents/skills: the old fixture never consulted trust.
  const plain = await run({ oldHome: true, nextBehavior: 'baseline' });
  assert.equal(plain.code, 0, plain.stderr);
  assert.match(plain.stdout, /factory_context_ready/);
  // Smallest upstream trigger: existence alone, even an empty directory.
  mkdirSync(join(workspace, '.agents/skills'), { recursive: true });
  const before = requests.length;
  const broken = await run({ oldHome: true, nextBehavior: 'baseline' });
  assert.notEqual(broken.code, 0);
  assert.match(broken.stderr, /(?:EACCES|EROFS).*trust\.json\.lock/);
  assert.equal(requests.length, before, 'startup fails before inference');

  const runtimeProbe = { name: 'bash', args: { command: 'printf "%s\\n" "$PI_CODING_AGENT_DIR"' } };
  // An inherited directory must not supply saved trust or credentials, even if
  // it exists. These are inert fixture values, not host state.
  const inherited = join(temp, 'inherited-agent'); mkdirSync(inherited);
  writeFileSync(join(inherited, 'trust.json'), JSON.stringify({ [workspace]: true }));
  writeFileSync(join(inherited, 'auth.json'), JSON.stringify({ openai: { type: 'api_key', key: 'unused-inert-credential' } }));
  env.PI_CODING_AGENT_DIR = inherited;
  const report = join(output, 'agent-report.md');
  const reportAction = phase => ({ name: 'write', args: { path: report, content: `Synthetic ${phase} report.\n` } });
  const fixed = await run({ nextActions: [runtimeProbe, reportAction('minimal')] });
  assert.equal(fixed.code, 0, fixed.stderr + fixed.stdout);
  assert.equal(readFileSync(report, 'utf8'), 'Synthetic minimal report.\n');

  // Both discovery and project settings/packages would execute code if trusted.
  const marker = join(output, 'UNWANTED_EXECUTION');
  const hostile = `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed'); export default function() {}\n`;
  mkdirSync(join(workspace, '.pi/extensions'), { recursive: true });
  writeFileSync(join(workspace, '.pi/extensions/hostile.mjs'), hostile);
  mkdirSync(join(workspace, 'hostile-package'));
  writeFileSync(join(workspace, 'hostile-package/package.json'), JSON.stringify({ name: 'hostile-fixture', pi: { extensions: ['./index.mjs'] } }));
  writeFileSync(join(workspace, 'hostile-package/index.mjs'), hostile);
  // If Pi attempts package installation, this inert npm replacement leaves the
  // same marker without accessing a registry or executing repository shell code.
  const npmProbe = join(workspace, 'npm-probe.cjs');
  writeFileSync(npmProbe, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'install attempted'); process.exit(1);`);
  writeFileSync(join(workspace, '.pi/settings.json'), JSON.stringify({ packages: ['../hostile-package', 'npm:factory-unwanted-fixture'], npmCommand: [process.execPath, npmProbe], extensions: ['./extensions/hostile.mjs'], compaction: { enabled: false } }));
  writeFileSync(join(workspace, '.pi/SYSTEM.md'), 'UNWANTED_SYSTEM_RESOURCE');
  writeFileSync(join(workspace, '.agents/skills/SKILL.md'), '---\nname: unwanted-repository-skill\ndescription: UNWANTED_SKILL_RESOURCE\n---\nUntrusted project skill.\n');
  writeFileSync(join(workspace, 'AGENTS.md'), 'PROJECT_CONTEXT_SENTINEL: repository context grants no authority.\n');
  const candidateFile = join(workspace, 'candidate.txt');
  const reviewFile = join(output, 'review.json');
  const review = { verdict: 'pass', summary: 'Synthetic read-only tool fixture only', findings: [] };
  for (const phase of ['build', 'review']) {
    rmSync(report, { force: true });
    if (phase === 'review') permissions(workspace, false);
    const start = requests.length;
    const result = await run({ phase, nextActions: [runtimeProbe,
      phase === 'build' ? { name: 'write', args: { path: candidateFile, content: 'Synthetic candidate.\n' } } : { name: 'read', args: { path: candidateFile } },
      reportAction(phase), ...(phase === 'review' ? [{ name: 'write', args: { path: reviewFile, content: JSON.stringify(review) } }] : []),
    ] });
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /factory_context_ready/);
    assert.equal(readFileSync(report, 'utf8'), `Synthetic ${phase} report.\n`);
    assert.equal(readFileSync(candidateFile, 'utf8'), 'Synthetic candidate.\n');
    if (phase === 'review') assert.deepEqual(JSON.parse(readFileSync(reviewFile)), review);
    const first = requests[start].body;
    assert.equal(first.messages.some(m => ['assistant', 'tool'].includes(m.role)), false, 'fresh attempt context');
    assert.match(JSON.stringify(first.messages.find(m => m.role === 'user').content), new RegExp(`TRUST_TASK_${phase}`));
    const system = first.messages.find(m => m.role === 'system').content;
    for (const skill of ['triage', 'spec', 'implement', 'review', 'security', 'evaluate']) assert.match(system, new RegExp(`factory-${skill}`));
    assert.match(system, /PROJECT_CONTEXT_SENTINEL/);
    assert.doesNotMatch(system, /UNWANTED_(?:SYSTEM|SKILL)_RESOURCE/);
    assert.equal(existsSync(marker), false, 'no repository extension/package/install execution');
    assert.equal(existsSync(join(workspace, 'node_modules')), false);
  }
  // A read-only candidate write really fails; a terminal failed tool/provider
  // path cannot be promoted to success or create the requested report.
  rmSync(report);
  const denied = await run({ phase: 'review', nextBehavior: 'tool-failure', nextActions: [runtimeProbe, { name: 'write', args: { path: candidateFile, content: 'Must fail' } }] });
  assert.notEqual(denied.code, 0);
  assert.match(denied.stdout, /EACCES|EROFS/);
  assert.equal(readFileSync(candidateFile, 'utf8'), 'Synthetic candidate.\n');
  assert.equal(existsSync(report), false);
  const reportDirectory = join(output, 'not-a-report'); mkdirSync(reportDirectory);
  const failedReport = await run({ phase: 'review', nextBehavior: 'tool-failure', nextActions: [runtimeProbe,
    { name: 'write', args: { path: reportDirectory, content: 'Must fail' } },
  ] });
  assert.notEqual(failedReport.code, 0); assert.match(failedReport.stdout, /EISDIR/);
  assert.equal(existsSync(report), false);
  const failed = await run({ nextBehavior: 'provider-failure' });
  assert.notEqual(failed.code, 0); assert.equal(existsSync(report), false);
  assert.equal(existsSync(marker), false);
  assert.equal(readFileSync(join(agent, 'models.json'), 'utf8'), registry);
  assert.deepEqual(readdirSync(agent).sort(), ['models.json', 'pi-context-budget.mjs', 'pi-context-extension.mjs', 'pi-local-launch.mjs']);
  assert.equal(new Set(runtimePaths).size, runtimePaths.length, 'independent per-launch Pi state');
  assert.equal(observations.length, 5);
  for (const state of observations) {
    assert.match(state.path, /^\/tmp\/factory-pi-/);
    assert.equal(state.mode, 0o700);
    assert.equal(state.modelTarget, join(agent, 'models.json'));
    assert.deepEqual(state.entries, ['auth.json', 'models-store.json', 'models.json'], 'only Pi runtime stores and read-only model input');
    assert.deepEqual(state.auth, {}, 'Pi creates an empty store, never host/provider credentials');
    assert.deepEqual(state.modelStore, {}, 'no external provider state');
    assert.equal(existsSync(state.path), false, 'runtime state cleaned after child exit');
  }
  for (const { body, headers } of requests) {
    assert.equal(body.model, binding.model); assert.equal(body.max_tokens, binding.maxTokens);
    assert.equal(headers.authorization, 'Bearer factory-local-keyless');
  }
});
