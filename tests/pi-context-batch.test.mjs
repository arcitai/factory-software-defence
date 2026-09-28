import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { localRegistry, localRoleCommand } from '../factory/local-inference.mjs';
import { ROOT } from '../factory/lib.mjs';

const task = 'BATCH_TASK: preserve this exact task; use the six files, re-read omitted lines, and write the required report.';
// Independent wire oracle: one token per UTF-8 byte, plus template/record headroom
// and full configured output. Includes tools and arguments, unlike chars/4.
const budget = body => Buffer.byteLength(JSON.stringify(body)) + 1024 + 64 * (body.messages.length + (body.tools?.length || 0));
for (const scenario of ['unprotected', 'six-read', 'larger-output', 'completion-tokens', 'small-window', 'too-small', 'summary-failure', 'provider-failure', 'length-failure', 'required-text-overflow']) {
  test(`Pi same-message six-result batch: ${scenario}`, { timeout: 60000 }, async t => {
    const detected = spawnSync('pi', ['--version'], { encoding: 'utf8', timeout: 10000 });
    if (detected.status !== 0 || detected.stdout.trim() !== '0.87.1') {
      assert.notEqual(process.env.FACTORY_REQUIRE_PI, '1', 'Qualification requires pinned Pi 0.87.1');
      return t.skip('Requires pinned Pi 0.87.1');
    }
    const temp = mkdtempSync(join(tmpdir(), 'factory-pi-batch-'));
    t.after(() => rmSync(temp, { recursive: true, force: true }));
    const agent = join(temp, 'agent'), workspace = join(temp, 'workspace');
    mkdirSync(agent); mkdirSync(workspace);
    // Attempted repository extension must never execute despite our explicit one.
    mkdirSync(join(workspace, '.pi/extensions'), { recursive: true });
    writeFileSync(join(workspace, '.pi/extensions/hostile.js'), 'throw new Error("REPOSITORY_EXTENSION_LOADED");');
    const window = scenario === 'small-window' ? 16384 : scenario === 'completion-tokens' ? 32768 : scenario === 'too-small' ? 4096 : 65536;
    const output = scenario === 'larger-output' ? 16384 : scenario === 'required-text-overflow' ? 32000
      : scenario === 'completion-tokens' ? 4096 : window < 65536 ? 1024 : 8192;
    const maxTokensField = scenario === 'completion-tokens' ? 'max_completion_tokens' : 'max_tokens';
    const reasoningEffort = scenario === 'completion-tokens' ? 'high' : 'none';
    const files = Array.from({ length: 6 }, (_, i) => join(workspace, `payload-${i}.txt`));
    const sources = files.map((path, i) => {
      // Exactly 44,629 bytes and 551 lines, each below Pi's individual ceiling.
      const lines = Array.from({ length: 551 }, (_, j) => `${i}:${String(j + 1).padStart(3, '0')} ` + 'aB7?!_-'.repeat(10));
      lines[400] = `REREAD_SENTINEL_${i}`;
      let text = lines.join('\n');
      text += 'z'.repeat(44629 - Buffer.byteLength(text));
      assert.equal(Buffer.byteLength(text), 44629); assert.equal(text.split('\n').length, 551);
      writeFileSync(path, text); return text;
    });
    const report = join(workspace, 'agent-report.md');
    const requests = [], errors = [];
    let phase = 0, summaries = 0, resumed = false, originalUser, originalSystem, originalTools;
    let proactive = false, eventBuffer = '';
    const emittedCalls = new Map();
    const server = createServer(async (req, res) => {
      try {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw), summary = !body.tools?.length;
        const allowance = body.max_tokens ?? body.max_completion_tokens;
        requests.push({ summary, projected: budget(body), allowance, body });
        assert.equal(body.model, 'fixture-batch');
        assert(body.messages.some(m => m.role === 'system'));
        assert(body.messages.some(m => m.role === 'user'));
        assert(Number.isSafeInteger(allowance) && allowance > 0 && allowance <= output);
        assert.equal(body[maxTokensField], allowance);
        assert.equal(Object.hasOwn(body, maxTokensField === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens'), false);
        assert.equal(body.reasoning_effort, reasoningEffort);
        const fail = message => { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message } })); };
        if (requests.length > 16) return fail('Fixture request limit');
        if (summary) {
          summaries++;
          // Upstream turn-prefix and proactive history summaries have distinct
          // pinned caps. Match the observed lifecycle, never the generation cap.
          assert.equal(allowance, proactive ? Math.floor(0.8 * Math.min(16384, output)) : Math.min(8192, output));
          if (scenario === 'summary-failure') return fail('Controlled summary failure');
        } else {
          originalUser ??= body.messages.find(m => m.role === 'user');
          originalSystem ??= body.messages.filter(m => m.role === 'system');
          originalTools ??= body.tools;
          if (scenario !== 'unprotected') {
            assert(JSON.stringify(originalUser).includes(task));
            assert(body.messages.some(m => JSON.stringify(m) === JSON.stringify(originalUser)), 'exact original task survives');
            assert.deepEqual(body.messages.filter(m => m.role === 'system'), originalSystem, 'full system/policy survives');
            assert.deepEqual(body.tools, originalTools, 'full tool definitions survive');
          }
          const pending = [];
          for (const message of body.messages) {
            if (message.tool_calls) {
              assert.equal(pending.length, 0); pending.push(...message.tool_calls.map(c => c.id));
              for (const call of message.tool_calls) assert.deepEqual(call.function, emittedCalls.get(call.id), 'tool names and arguments survive');
            }
            if (message.role === 'tool') assert.equal(message.tool_call_id, pending.shift(), 'tool identity and order survive');
          }
          assert.equal(pending.length, 0);
        }
        if (budget(body) + output > window) {
          assert.equal(scenario, 'unprotected', 'protected requests must fit before transport');
          return fail('Controlled request exceeds allocation after compaction');
        }
        if (scenario === 'provider-failure' && phase >= 2 && !summary) return fail('Controlled terminal provider failure');
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const chunk = (delta, finish_reason = null, usage) => res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: body.model,
          choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`);
        // Deterministic output units (UTF-8 bytes/4) are fixture accounting,
        // not a tokenizer claim. Never emit a complete response above the wire
        // allowance, especially the old post-compaction max_tokens:1 request.
        const answer = (delta, finish) => {
          const required = Math.ceil(Buffer.byteLength(JSON.stringify(delta)) / 4);
          if (required > allowance || (scenario === 'length-failure' && resumed)) {
            chunk({ role: 'assistant', content: 'x' }); chunk({}, 'length');
          } else { chunk(delta); chunk({}, finish); }
        };
        const calls = list => answer({ role: 'assistant', tool_calls: list.map(([id, name, args], index) => {
          const fn = { name, arguments: JSON.stringify(args) }; emittedCalls.set(id, fn);
          return { index, id, type: 'function', function: fn };
        }) }, 'tool_calls');
        if (summary) answer({ role: 'assistant', content: 'Synthetic summary: resume useful work by reading omitted line 401, then write the report.' }, 'stop');
        else if (phase++ === 0) calls([['warmup', 'read', { path: files[0], limit: 2 }]]);
        else if (phase === 2) {
          if (scenario === 'required-text-overflow') calls([['large-write', 'write', { path: join(workspace, 'unfinished.txt'), content: 'Q'.repeat(70000) }]]);
          else calls(files.map((path, i) => [`batch-${i}`, 'read', { path }]));
        } else if (!resumed) {
          const results = body.messages.filter(m => m.role === 'tool' && m.tool_call_id.startsWith('batch-'));
          assert.equal(results.length, 6, 'one assistant group retained all six results');
          for (const [i, result] of results.entries()) {
            assert.match(result.content, /Factory context projection/);
            assert.match(result.content, /offset\/limit/);
            assert(result.content.startsWith(`${i}:001`));
            assert(!result.content.includes(`REREAD_SENTINEL_${i}`), 'required re-read evidence was omitted');
          }
          resumed = true;
          calls([['reread', 'read', { path: files[0], offset: 401, limit: 1 }]]);
        } else if (!existsSync(report)) {
          assert(body.messages.some(m => m.role === 'tool' && m.tool_call_id === 'reread' && m.content.includes('REREAD_SENTINEL_0')));
          calls([['report', 'write', { path: report, content: 'Synthetic transport only: REREAD_SENTINEL_0\n' }]]);
        } else answer({ role: 'assistant', content: 'Synthetic transport completed with re-read and report.' }, 'stop');
        // Realistic pre-burst usage; the raw six-result batch must independently
        // trigger compaction. These fixture numbers never enter usage analytics.
        chunk({}, null, { prompt_tokens: 6108, completion_tokens: 64, total_tokens: 6172 });
        res.end('data: [DONE]\n\n');
      } catch (error) { errors.push(error.stack); res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: error.message } })); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
    const binding = { endpoint: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture-batch', contextWindow: window, maxTokens: output,
      compat: { maxTokensField }, reasoningEffort };
    writeFileSync(join(agent, 'models.json'), JSON.stringify(localRegistry(binding)));
    for (const file of ['pi-local-launch.mjs', 'pi-context-extension.mjs', 'pi-context-budget.mjs'])
      writeFileSync(join(agent, file === 'pi-local-launch.mjs' ? 'launch.mjs' : file), readFileSync(join(ROOT, 'factory', file)));
    const args = localRoleCommand(binding).slice(2).map(arg => arg === '/factory-skills' ? join(ROOT, 'kit/skills') : arg);
    const unprotected = scenario === 'unprotected';
    const result = await new Promise((resolve, reject) => {
      const child = spawn(unprotected ? 'pi' : process.execPath, unprotected ? [...args, '--api-key', 'factory-local-keyless'] : [join(agent, 'launch.mjs'), ...args], {
        env: { PATH: process.env.PATH, HOME: temp, PI_CODING_AGENT_DIR: agent }, cwd: workspace, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '', timedOut = false;
      const timer = setTimeout(() => { timedOut = true; process.kill(-child.pid, 'SIGKILL'); }, 45000);
      child.stdout.on('data', data => {
        stdout += data; eventBuffer += data;
        let end;
        while ((end = eventBuffer.indexOf('\n')) !== -1) {
          const line = eventBuffer.slice(0, end); eventBuffer = eventBuffer.slice(end + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === 'factory_context_recovery') proactive = event.phase === 'start';
        }
      }); child.stderr.on('data', data => stderr += data);
      child.on('error', reject); child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
      child.stdin.end(task);
    });
    assert.equal(result.timedOut, false); assert.deepEqual(errors, [], result.stderr);
    assert(!result.stderr.includes('REPOSITORY_EXTENSION_LOADED'));
    const events = result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const compactionEnd = events.findIndex(e => e.type === 'compaction_end' && e.result);
    t.diagnostic(JSON.stringify({ scenario, requests: requests.map(({ summary, projected, allowance }) => ({ summary, projected, allowance })) }));
    if (['six-read', 'larger-output', 'completion-tokens', 'small-window'].includes(scenario)) {
      assert(requests.filter(r => !r.summary).every(r => r.allowance === output), 'every generation must retain its configured output allowance');
      assert.equal(result.code, 0, result.stderr + result.stdout.slice(-2000));
      assert(summaries > 0); assert(resumed); assert(compactionEnd > 0);
      assert.equal(readFileSync(report, 'utf8'), 'Synthetic transport only: REREAD_SENTINEL_0\n');
      assert(events.slice(compactionEnd + 1).some(e => e.type === 'tool_execution_start' && e.toolCallId === 'reread'));
      const batch = events.filter(e => e.type === 'message_end' && e.message?.role === 'toolResult' && e.message.toolCallId.startsWith('batch-'));
      assert.equal(batch.length, 6);
      batch.forEach((event, i) => assert.equal(event.message.content[0].text, sources[i], 'raw results remain intact'));
    } else if (unprotected) {
      assert(compactionEnd > 0, 'upstream summarized before sending oversized retained group');
      const oversized = requests.find(r => !r.summary && r.projected + output > window);
      assert(oversized); assert.equal(oversized.body.messages.filter(m => m.role === 'tool' && m.tool_call_id.startsWith('batch-')).length, 6);
      assert(oversized.body.messages.some(m => m.role === 'user'), 'fixture does not pretend to prove Ollama removed user');
      assert.equal(existsSync(report), false);
    } else {
      assert.notEqual(result.code, 0, result.stderr);
      if (scenario === 'summary-failure') {
        assert.match(result.stdout + result.stderr, /Controlled summary failure/);
        assert.equal(readFileSync(report, 'utf8'), 'Synthetic transport only: REREAD_SENTINEL_0\n', 'a real tool-written report must not hide failed compaction');
      }
      else assert.equal(existsSync(report), false);
      if (scenario === 'too-small') { assert.equal(requests.length, 0); assert.match(result.stderr, /cannot fit required instructions/); }
      if (scenario === 'required-text-overflow') {
        assert.match(result.stderr, /cannot fit required instructions/);
        assert.equal(readFileSync(join(workspace, 'unfinished.txt'), 'utf8'), 'Q'.repeat(70000));
      }
      if (scenario === 'length-failure') assert(events.some(e => e.type === 'message_end' && e.message?.stopReason === 'length'));
    }
    for (const [i, path] of files.entries()) assert.equal(readFileSync(path, 'utf8'), sources[i]);
    t.diagnostic(JSON.stringify({ pi: '0.87.1', scenario, synthetic: true, window, output, summaries, resumed, exit: result.code,
      requests: requests.map(({ summary, projected, allowance }) => ({ summary, projected, allowance })) }));
  });
}
