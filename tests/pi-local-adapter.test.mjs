import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, chmodSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { localRegistry, localRoleCommand } from '../factory/local-inference.mjs';
import { resolveRoleProfiles } from '../factory/role-definition.mjs';
import { PiUsageParser } from '../factory/pi-usage.mjs';
import { ROOT } from '../factory/lib.mjs';

// Native pinned adapter + controlled loopback responses, never live inference.
// CI images without Pi retain schema/container tests and report this as skipped.
test('pinned Pi consumes the generated registry, calls a tool, returns its result, and fails closed on unavailable model', { timeout: 90000 }, async t => {
  const temp = mkdtempSync(join(tmpdir(), 'factory-pi-native-'));
  t.after(() => { if (existsSync(join(temp, 'agent'))) chmodSync(join(temp, 'agent'), 0o700); rmSync(temp, { recursive: true, force: true }); });
  const env = { PATH: process.env.PATH, HOME: temp, PI_CODING_AGENT_DIR: join(temp, 'agent') };
  const version = spawnSync('pi', ['--version'], { env, encoding: 'utf8', timeout: 10000 });
  const expectedVersion = '0.87.1';
  if (version.status !== 0 || (version.stdout + version.stderr).trim() !== expectedVersion) {
    assert.notEqual(process.env.FACTORY_REQUIRE_PI, '1', `Qualification requires pinned Pi ${expectedVersion} on PATH`);
    return t.skip(`Requires installed pinned Pi ${expectedVersion}; no install or live inference performed`);
  }
  mkdirSync(env.PI_CODING_AGENT_DIR); const workspace = join(temp, 'workspace'); mkdirSync(workspace);
  const report = join(workspace, 'agent-report.md'), requests = [];
  let missing = false, unsupported = false;
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push({ path: req.url, headers: req.headers, body });
    if (unsupported) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Fixture endpoint does not support reasoning_effort', type: 'invalid_request_error' } })); return; }
    if (missing) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Selected fixture model missing', type: 'not_found' } })); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture/model:small', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (requests.length === 1) {
      chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_fixture', type: 'function', function: { name: 'write', arguments: JSON.stringify({ path: report, content: 'Synthetic tool/report compatibility only.\n' }) } }] });
      chunk({}, 'tool_calls');
    } else { chunk({ role: 'assistant', content: 'Synthetic fixture complete.' }); chunk({}, 'stop'); }
    res.write(`data: ${JSON.stringify({ choices: [], usage: {prompt_tokens:123,completion_tokens:9,total_tokens:132,prompt_tokens_details:{cached_tokens:40,cache_write_tokens:7}} })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const binding = { endpoint: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture/model:small', contextWindow: 65536, maxTokens: 1024 };
  const registryPath = join(env.PI_CODING_AGENT_DIR, 'models.json');
  writeFileSync(registryPath, JSON.stringify(localRegistry(binding)));
  const launcher = join(env.PI_CODING_AGENT_DIR, 'launch.mjs');
  writeFileSync(launcher, readFileSync(join(ROOT, 'factory/pi-local-launch.mjs')));
  for (const file of ['pi-context-extension.mjs', 'pi-context-budget.mjs'])
    writeFileSync(join(env.PI_CODING_AGENT_DIR, file), readFileSync(join(ROOT, 'factory', file)));
  const args = [launcher, ...localRoleCommand(binding).slice(2).map(arg => arg === '/factory-skills' ? join(ROOT, 'adlc/skills') : arg)];
  async function run(argsOverride = args) {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, argsOverride, { cwd: workspace, env, stdio: ['pipe', 'pipe', 'pipe'] });
      const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
      const usageParser = new PiUsageParser();
      let stdout = '', stderr = ''; child.stdout.on('data', b => { usageParser.write(b); stdout += b; }); child.stderr.on('data', b => stderr += b);
      child.on('error', reject); child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, usage: usageParser.finish() }); });
      child.stdin.end('Synthetic fixture: use the write tool and return.');
    });
  }
  chmodSync(env.PI_CODING_AGENT_DIR, 0o500);
  const result = await run();
  assert.equal(result.code, 0, result.stderr + result.stdout);
  assert.equal(readFileSync(report, 'utf8'), 'Synthetic tool/report compatibility only.\n');
  assert.equal(requests.length, 2);
  // Independent fixed provider totals: two calls, each 123 inclusive input + 9 output.
  assert.deepEqual(result.usage, {input_tokens:'246',output_tokens:'18',cached_input_tokens:'80',cache_write_input_tokens:'14',source:'pi_jsonl',coverage:'partial'});
  const aggregateOnly = new PiUsageParser();
  for (const event of result.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)))
    if (event.type === 'agent_end') aggregateOnly.write(JSON.stringify(event)+'\n');
  assert.deepEqual(aggregateOnly.finish(), result.usage);
  assert.equal(existsSync(join(env.PI_CODING_AGENT_DIR, 'auth.json')), false, 'read-only registry needs no credential store');
  for (const { path, headers, body } of requests) {
    assert.equal(path, '/v1/chat/completions'); assert.equal(body.model, binding.model);
    assert.equal(body.max_tokens, 1024); assert.equal(body.reasoning_effort, undefined);
    assert.equal(headers.authorization, 'Bearer factory-local-keyless');
    assert(body.tools.some(tool => tool.function.name === 'write'));
    assert.match(body.messages[0].content, /factory-implement/);
  }
  assert(requests[1].body.messages.some(message => message.role === 'tool' && message.tool_call_id === 'call_fixture'));
  // Each role starts a separate Pi process/context from the frozen resolver's
  // command. Rotate the choices to observe the actual wire field independently.
  const roles = ['implement', 'review', 'investigate'];
  for (const choices of [['default', 'none', 'low'], ['none', 'low', 'default'], ['low', 'default', 'none'], ['medium', 'high', undefined]]) {
    const bindings = Object.fromEntries(roles.map((role, i) => [role, { ...binding, ...(choices[i] === undefined ? {} : { reasoningEffort: choices[i] }) }]));
    const profiles = resolveRoleProfiles({ localBindings: bindings }, { version: 1,
      roles: Object.fromEntries(roles.map(role => [role, { harness: 'pi', localBinding: role }])) });
    for (const [i, role] of roles.entries()) {
      chmodSync(env.PI_CODING_AGENT_DIR, 0o700);
      writeFileSync(registryPath, JSON.stringify(localRegistry(bindings[role])));
      chmodSync(env.PI_CODING_AGENT_DIR, 0o500);
      const roleArgs = [launcher, ...profiles[role].command.slice(2).map(arg => arg === '/factory-skills' ? join(ROOT, 'adlc/skills') : arg)];
      const start = requests.length, result = await run(roleArgs);
      assert.equal(result.code, 0, `${role}/${choices[i]}: ${result.stderr}${result.stdout}`);
      assert.equal(requests.length, start + 1);
      const { body } = requests.at(-1);
      assert.equal(body.reasoning_effort, choices[i] === 'default' ? undefined : choices[i], `${role} wire request`);
      assert.equal(body.model, binding.model); assert.equal(body.max_tokens, 1024);
      assert.equal(body.messages.some(message => ['assistant', 'tool'].includes(message.role)), false, 'independent role context');
      assert.equal(body.enable_thinking, undefined); assert.equal(body.thinking, undefined);
    }
  }
  // Unsupported semantics must propagate as failure, never retry without the request.
  chmodSync(env.PI_CODING_AGENT_DIR, 0o700);
  const none = { ...binding, reasoningEffort: 'none' };
  writeFileSync(registryPath, JSON.stringify(localRegistry(none)));
  const mismatchedThinking = args.slice(); mismatchedThinking[mismatchedThinking.indexOf('--thinking') + 1] = 'low';
  const beforeMismatch = requests.length;
  assert.notEqual((await run(mismatchedThinking)).code, 0); assert.equal(requests.length, beforeMismatch);
  rmSync(report); unsupported = true;
  const unsupportedResult = await run();
  assert.notEqual(unsupportedResult.code, 0); assert.match(unsupportedResult.stdout + unsupportedResult.stderr, /does not support reasoning_effort/);
  assert.equal(requests.at(-1).body.reasoning_effort, 'none'); assert.equal(existsSync(report), false);
  unsupported = false;
  writeFileSync(registryPath, JSON.stringify(localRegistry(binding)));
  missing = true;
  const before = readFileSync(registryPath);
  const unavailable = await run();
  assert.notEqual(unavailable.code, 0, unavailable.stdout);
  assert.match(unavailable.stdout + unavailable.stderr, /Selected fixture model missing/);
  assert.equal(existsSync(report), false); assert.deepEqual(readFileSync(registryPath), before);
  assert(requests.every(request => request.body.model === binding.model));
  const count = requests.length;
  chmodSync(env.PI_CODING_AGENT_DIR, 0o700);
  writeFileSync(registryPath, JSON.stringify(localRegistry({ ...binding, model: 'different' })));
  const mismatch = await run(); assert.notEqual(mismatch.code, 0); assert.equal(requests.length, count);
  writeFileSync(registryPath, JSON.stringify(localRegistry(binding)));
  rmSync(join(env.PI_CODING_AGENT_DIR, 'pi-context-extension.mjs'));
  const missingAdapter = await run(); assert.notEqual(missingAdapter.code, 0); assert.equal(requests.length, count, 'missing protection fails before transport');
  rmSync(registryPath);
  const absent = await run(); assert.notEqual(absent.code, 0); assert.equal(requests.length, count, 'no fallback on missing registry');
});
