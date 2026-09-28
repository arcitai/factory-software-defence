import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { localRegistry, localRoleCommand } from '../factory/local-inference.mjs';
import { PiUsageParser } from '../factory/pi-usage.mjs';
import { ROOT } from '../factory/lib.mjs';

// Actual pinned CLI, scripted endpoint only. No model-quality claim.
// FACTORY_PI_HISTORY_BASELINE=1 disables only the recent-marker oracle so the
// pre-repair adapter can run to budget exhaustion; completion must still fail.
const window = 65536, output = 8192, marker = 'SHORT_HISTORY_TASK';
for (const scenario of ['complete', 'discovery', 'retry', 'summary-retry', 'summary-failure', 'summary-exhaustion', 'summary-empty', 'no-progress', 'recovery-limit', 'cancel']) {
  test(`Pi many short turns: ${scenario}`, { timeout: 60000 }, async t => {
    const version = spawnSync('pi', ['--version'], { encoding: 'utf8' });
    if (version.status !== 0 || version.stdout.trim() !== '0.87.1') {
      assert.notEqual(process.env.FACTORY_REQUIRE_PI, '1', 'Requires pinned Pi');
      return t.skip('Requires Pi 0.87.1');
    }
    const temp = mkdtempSync(join(tmpdir(), 'factory-pi-history-'));
    const agent = join(temp, 'agent'), workspace = join(temp, 'workspace');
    mkdirSync(agent); mkdirSync(workspace);
    t.after(() => rmSync(temp, { recursive: true, force: true }));
    const report = join(workspace, 'result.txt');
    const target = scenario === 'recovery-limit' ? 350 : 75;
    if (scenario === 'discovery') writeFileSync(join(workspace, 'discovery.txt'), 'DISCOVERY_SENTINEL\n');
    let turns = 0, summaries = 0, retried = false, child, cancelTimer;
    const requests = [], errors = [], seen = new Map();
    let system, task, tools, previous;
    let stablePrefixes = 0, changedPrefixes = 0;
    const started = Date.now();
    const server = createServer(async (req, res) => {
      try {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw), summary = !body.tools?.length;
        const projected = Buffer.byteLength(JSON.stringify(body)) + 1024 + 64 * (body.messages.length + (body.tools?.length || 0));
        requests.push({ summary, projected, turns, allowance: body.max_tokens });
        assert(requests.length <= (scenario === 'recovery-limit' ? 400 : 100), 'bounded requests');
        assert.equal(body.model, 'fixture-history');
        assert(projected + output <= window);
        assert(body.max_tokens > 0 && body.max_tokens <= output);
        const fail = (status, message) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message } })); };
        if (summary) {
          summaries++;
          if (scenario === 'summary-exhaustion') return fail(500, 'Controlled summary server error');
          if (scenario === 'summary-retry' && !retried) { retried = true; return fail(500, 'Controlled summary retry'); }
          if (scenario === 'summary-failure') return fail(400, 'Controlled summary failure');
          if (scenario === 'cancel') {
            cancelTimer = setTimeout(() => process.kill(-child.pid, 'SIGTERM'), 50);
            return;
          }
        } else {
          assert.equal(body.max_tokens, output);
          if (previous) {
            if (JSON.stringify(body.messages.slice(0, previous.length)) === JSON.stringify(previous)) stablePrefixes++;
            else changedPrefixes++;
          }
          previous = body.messages;
          system ??= body.messages.filter(m => m.role === 'system');
          task ??= body.messages.find(m => m.role === 'user'); tools ??= body.tools;
          assert.deepEqual(body.messages.filter(m => m.role === 'system'), system);
          assert(body.messages.some(m => JSON.stringify(m) === JSON.stringify(task)));
          assert(JSON.stringify(task).includes(marker)); assert.deepEqual(body.tools, tools);
          const pending = new Set();
          for (const m of body.messages) {
            for (const call of m.tool_calls || []) {
              assert.equal(pending.has(call.id), false); pending.add(call.id);
              assert.deepEqual(call.function, seen.get(call.id));
            }
            if (m.role === 'tool') assert(pending.delete(m.tool_call_id));
          }
          assert.equal(pending.size, 0);
          if (process.env.FACTORY_PI_HISTORY_BASELINE !== '1' && turns > 0 && turns <= target) assert(body.messages.some(m => m.role === 'tool' && m.content.includes(`TURN_${turns - 1}\n`)), 'newest short discovery remains useful');
          if (scenario === 'retry' && turns === 20 && !retried) { retried = true; return fail(500, 'Controlled retry'); }
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const chunk = (delta, finish_reason = null, usage) => res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: body.model,
          choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`);
        const call = (id, name, args) => {
          const fn = { name, arguments: JSON.stringify(args) }; seen.set(id, fn);
          chunk({ role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: fn }] }); chunk({}, 'tool_calls');
        };
        if (summary) { chunk({ role: 'assistant', content: scenario === 'summary-empty' ? '' : scenario === 'no-progress' ? 'X'.repeat(24000) : 'Synthetic checkpoint: continue the short discovery fixture, then write result.txt. No model judgment.' }); chunk({}, 'stop'); }
        else if (turns < target) {
          const n = turns++;
          call(`turn_${n}`, 'bash', { command: `printf 'TURN_${n}\\n'; printf '%0500d\\n' 0${scenario === 'discovery' ? '; ls -1; cat discovery.txt' : ''}` });
        } else if (!existsSync(report)) call('report', 'write', { path: report, content: 'Controlled fixture completed\n' });
        else { chunk({ role: 'assistant', content: 'Controlled fixture completed.' }); chunk({}, 'stop'); }
        chunk({}, null, { prompt_tokens: 12000, completion_tokens: 40, total_tokens: 12040, prompt_tokens_details: { cached_tokens: 3000 } });
        res.end('data: [DONE]\n\n');
      } catch (error) { errors.push(error.stack); res.destroy(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { clearTimeout(cancelTimer); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
    const binding = { endpoint: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture-history', contextWindow: window, maxTokens: output };
    writeFileSync(join(agent, 'models.json'), JSON.stringify(localRegistry(binding)));
    for (const file of ['pi-local-launch.mjs', 'pi-context-extension.mjs', 'pi-context-budget.mjs'])
      writeFileSync(join(agent, file), readFileSync(join(ROOT, 'factory', file)));
    const args = localRoleCommand(binding).slice(2).map(arg => arg === '/factory-skills' ? join(ROOT, 'kit/skills') : arg);
    const result = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, [join(agent, 'pi-local-launch.mjs'), ...args], {
        env: { PATH: process.env.PATH, HOME: temp }, cwd: workspace, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '', timedOut = false;
      const timer = setTimeout(() => { timedOut = true; process.kill(-child.pid, 'SIGKILL'); }, 45000);
      child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
      child.on('error', reject); child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
      child.stdin.end(`${marker}: Perform ${target} short tool discoveries then write result.txt. Synthetic transport only.`);
    });
    const events = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    const raw = events.filter(e => e.type === 'message_end' && e.message?.role === 'toolResult' && e.message.toolCallId.startsWith('turn_'));
    raw.forEach((e, n) => assert.equal(e.message.content[0].text, `TURN_${n}\n${'0'.repeat(500)}\n${scenario === 'discovery' ? 'discovery.txt\nDISCOVERY_SENTINEL\n' : ''}`, 'raw evidence unchanged'));
    t.diagnostic(JSON.stringify({ scenario, turns, summaries, exit: result.code, elapsedMs: Date.now() - started,
      rawToolEventBytes: Buffer.byteLength(JSON.stringify(raw)), rawMessageBytes: Buffer.byteLength(JSON.stringify(events.filter(e => e.type === 'message_end').map(e => e.message))), stablePrefixes, changedPrefixes, recoveries: events.filter(e => e.type === 'factory_context_recovery'), maxProjected: Math.max(...requests.map(r => r.projected)), requests }));
    assert.equal(result.timedOut, false); assert.deepEqual(errors, []);
    if (['complete', 'discovery', 'retry', 'summary-retry'].includes(scenario)) {
      assert.equal(result.code, 0, result.stderr + result.stdout.slice(-1500));
      assert.equal(turns, target);
      const usage = new PiUsageParser(); usage.write(result.stdout);
      assert.deepEqual(usage.finish(), { input_tokens: '924000', output_tokens: '3080', cached_input_tokens: '231000', cache_write_input_tokens: '0', source: 'pi_jsonl', coverage: 'partial' });
      assert(stablePrefixes > 50); assert(changedPrefixes > 0 && changedPrefixes < 10);
      assert.equal(events.filter(e => e.type === 'factory_context_recovery' && e.phase === 'start').length, events.filter(e => e.type === 'factory_context_recovery' && e.phase === 'complete').length); assert(summaries > 0 && summaries < 10);
      assert.equal(readFileSync(report, 'utf8'), 'Controlled fixture completed\n');
    } else {
      assert.notEqual(result.code, 0); assert.equal(summaries, scenario === 'summary-exhaustion' ? 3 : scenario === 'recovery-limit' ? 16 : 1); assert.equal(existsSync(report), false);
      if (scenario === 'recovery-limit') assert.match(result.stderr, /recovery limit/);
      if (scenario === 'no-progress') assert.match(result.stderr, /did not free enough budget/);
      if (scenario === 'summary-empty') assert.match(result.stderr, /empty summary/);
      if (scenario === 'summary-failure') assert.match(result.stderr + result.stdout, /Controlled summary failure/);
    }
  });
}
