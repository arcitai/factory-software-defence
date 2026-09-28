import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, chmodSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { localRegistry, localRoleCommand } from '../factory/local-inference.mjs';
import { PiUsageParser } from '../factory/pi-usage.mjs';
import { ROOT } from '../factory/lib.mjs';
import { PiCompletion } from '../factory/pi-local-launch.mjs';

// Actual CLI, deterministic loopback transport. Byte-based request bounds and
// scripted threshold-triggering usage are NOT inference usage or model quality.
// The old baseline retains its original characters/4 budget. None enters analytics.
const window = 65536, output = 8192;
const marker = 'CONTEXT_BOUNDARY_TASK';
const reportText = 'Synthetic transport qualification only; no model judgment.\n';
for (const scenario of (process.env.FACTORY_PI_BASELINE === '1' ? ['complete']
  : ['complete', 'aggregate', 'transient', 'overflow-recovery', 'early-overflow', 'compaction-failure', 'provider-failure', 'retry-exhaustion'])) {
  test(`Pi context boundary: ${scenario}`, { timeout: 60000 }, async t => {
    const temp = mkdtempSync(join(tmpdir(), 'factory-pi-context-'));
    const agent = join(temp, 'agent'), workspace = join(temp, 'workspace');
    mkdirSync(agent); mkdirSync(workspace);
    t.after(() => { chmodSync(agent, 0o700); rmSync(temp, { recursive: true, force: true }); });
    const env = { PATH: process.env.PATH, HOME: temp, PI_CODING_AGENT_DIR: agent };
    const detected = spawnSync('pi', ['--version'], { env, encoding: 'utf8', timeout: 10000 });
    const version = ((detected.stdout || '') + (detected.stderr || '')).trim();
    const baseline = process.env.FACTORY_PI_BASELINE === '1';
    if (detected.status !== 0 || version !== (baseline ? '0.73.1' : '0.87.1')) {
      assert.notEqual(process.env.FACTORY_REQUIRE_PI, '1', 'Qualification requires pinned Pi on PATH');
      return t.skip('Requires Pi 0.87.1 or explicit 0.73.1 baseline on PATH');
    }
    const targetReads = scenario === 'aggregate' ? 24 : 7;
    const requestLimit = scenario === 'aggregate' ? 40 : 24;
    const requests = [], violations = [];
    let expectedInput = 0, expectedOutput = 0;
    let reads = 0, summaries = 0, injected = false, lastSummaryReads = 0;
    const report = join(workspace, 'agent-report.md');
    // Every read stays below Pi's 50 KB tool truncation ceiling; cumulative
    // trailing results cross the default 49,152-token compaction threshold.
    writeFileSync(join(workspace, 'payload.txt'), 'bounded fixture data '.repeat(2200));
    const server = createServer(async (req, res) => {
      try {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        const summary = !body.tools?.length;
        const tokens = baseline ? Math.ceil(JSON.stringify(body.messages).length / 4)
          : Buffer.byteLength(JSON.stringify(body)) + 1024 + 64 * (body.messages.length + (body.tools?.length || 0));
        requests.push({ summary, tokens, maxTokens: body.max_tokens, model: body.model });
        const check = (condition, message) => { if (!condition) violations.push(message); };
        check(req.url === '/v1/chat/completions', 'unexpected endpoint');
        check(body.model === 'fixture-context', 'model fallback');
        check(body.max_tokens > 0 && body.max_tokens <= output, 'output budget');
        check(body.messages.some(m => m.role === 'system'), 'missing system');
        check(body.messages.some(m => m.role === 'user'), 'missing user');
        if (!summary) {
          check(body.messages.some(m => m.role === 'user' && JSON.stringify(m.content).includes(marker)), 'lost task');
          const calls = new Set();
          for (const m of body.messages) {
            for (const call of m.tool_calls || []) calls.add(call.id);
            if (m.role === 'tool') check(calls.delete(m.tool_call_id), 'orphan/duplicate tool result');
          }
          check(calls.size === 0, 'missing tool result');
          check(body.tools.some(tool => tool.function.name === 'write'), 'missing tools after compaction');
        }
        const fail = (status, message) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message, type: 'fixture_error' } }));
        };
        if (requests.length > requestLimit) return fail(400, 'Fixture request bound exceeded');
        if (scenario === 'provider-failure') return fail(400, 'Fixture terminal provider failure');
        if (scenario === 'retry-exhaustion') return fail(500, 'Fixture persistent server error');
        if (((scenario === 'overflow-recovery' && reads === 2) || (scenario === 'early-overflow' && reads === 1)) && !injected && !summary) {
          injected = true; return fail(400, 'maximum context length exceeded');
        }
        if (scenario === 'transient' && reads === 1 && !injected && !summary) {
          injected = true; return fail(500, 'Fixture temporary server error');
        }
        if (summary) {
          summaries++; lastSummaryReads = reads;
          if (scenario === 'compaction-failure') return fail(400, 'Fixture terminal summarization failure');
        }
        // The old CLI sends its next uncompressed request beyond this explicit
        // synthetic allocation. Do not model the unproven Ollama error cause.
        if (tokens + body.max_tokens > window) return fail(400, 'Fixture allocated context exceeded');
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const chunk = (delta, finish_reason = null, usage) => res.write(`data: ${JSON.stringify({
          id: 'fixture', object: 'chat.completion.chunk', model: body.model,
          choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}),
        })}\n\n`);
        if (summary) {
          chunk({ role: 'assistant', content: `${marker}: Continue reading payload.txt until ${targetReads} reads, then use write to create ${report}. Keep tools and produce the required final report.` });
          chunk({}, 'stop');
        } else if (reads < targetReads) {
          reads++;
          chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `read_${reads}`, type: 'function', function: {
            name: 'read', arguments: JSON.stringify({ path: join(workspace, 'payload.txt') }),
          } }] }); chunk({}, 'tool_calls');
        } else if (!existsSync(report)) {
          chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'report', type: 'function', function: {
            name: 'write', arguments: JSON.stringify({ path: report, content: reportText }),
          } }] }); chunk({}, 'tool_calls');
        } else { chunk({ role: 'assistant', content: 'Synthetic transport completed.' }); chunk({}, 'stop'); }
        const usageTokens = baseline ? tokens : 6000 + (reads - lastSummaryReads) * 14000;
        if (!summary) { expectedInput += usageTokens; expectedOutput += 64; }
        chunk({}, null, { prompt_tokens: usageTokens, completion_tokens: 64, total_tokens: usageTokens + 64 });
        res.end('data: [DONE]\n\n');
      } catch (error) { violations.push(error.message); res.destroy(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
    const binding = { endpoint: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture-context', contextWindow: window, maxTokens: output };
    writeFileSync(join(agent, 'models.json'), JSON.stringify(localRegistry(binding)));
    const launcher = join(agent, 'launch.mjs');
    writeFileSync(launcher, readFileSync(join(ROOT, 'factory/pi-local-launch.mjs')));
    for (const file of ['pi-context-extension.mjs', 'pi-context-budget.mjs'])
      writeFileSync(join(agent, file), readFileSync(join(ROOT, 'factory', file)));
    chmodSync(agent, 0o500);
    const args = [launcher, ...localRoleCommand(binding).slice(2).map(arg => arg === '/factory-skills' ? join(ROOT, 'kit/skills') : arg)];
    const result = await new Promise((resolve, reject) => {
      const child = spawn(baseline ? 'pi' : process.execPath, baseline ? args.slice(1) : args, { env, cwd: workspace, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const usageParser = new PiUsageParser();
      let stdout = '', stderr = '', timedOut = false;
      const timer = setTimeout(() => { timedOut = true; process.kill(-child.pid, 'SIGKILL'); }, 45000);
      child.stdout.on('data', b => { usageParser.write(b); stdout += b; }); child.stderr.on('data', b => stderr += b);
      child.on('error', reject); child.on('close', code => {
        clearTimeout(timer);
        const completion = new PiCompletion(); completion.write(stdout);
        resolve({ code: baseline && code === 0 && !completion.finish() ? 1 : code, stdout, stderr, timedOut, usage: usageParser.finish() });
      });
      child.stdin.end(`${marker}: Read payload.txt ${targetReads} times with tools, then write ${report} and finish. Synthetic transport only.`);
    });
    if (!baseline) {
      if (expectedInput) assert.deepEqual(result.usage, {input_tokens:String(expectedInput),output_tokens:String(expectedOutput),cached_input_tokens:'0',cache_write_input_tokens:'0',source:'pi_jsonl',coverage:'partial'});
      else assert.equal(result.usage, null, 'failed requests with no reported tokens remain unknown');
    }
    assert.equal(result.timedOut, false, 'bounded CLI must terminate itself');
    assert.deepEqual(violations, []);
    assert(requests.length <= requestLimit);
    const events = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    const compactStart = events.findIndex(e => ['compaction_start', 'auto_compaction_start'].includes(e.type));
    const compactEnd = events.findIndex(e => ['compaction_end', 'auto_compaction_end'].includes(e.type));
    if (!baseline && ['complete', 'aggregate', 'transient', 'overflow-recovery'].includes(scenario)) {
      assert.equal(result.code, 0, result.stderr + result.stdout.slice(-6000));
      assert.equal(readFileSync(report, 'utf8'), reportText);
      assert.equal(reads, targetReads);
      if (scenario === 'aggregate') assert(result.stdout.split('\n').some(line => line.length > 1024 * 1024), 'exercise the large final aggregate');
      assert(summaries > 0);
      assert(requests.every(r => r.tokens + r.maxTokens <= window), JSON.stringify(requests));
      assert(compactStart > 0 && compactEnd > compactStart);
      assert.equal(events[compactStart].reason, scenario === 'overflow-recovery' ? 'overflow' : 'threshold');
      assert(events.slice(0, compactStart).filter(e => e.type === 'tool_execution_end').length >= (scenario === 'overflow-recovery' ? 1 : 3));
      assert(events.slice(compactEnd + 1).some(e => e.type === 'tool_execution_start'));
      assert(events.some(e => e.type === 'agent_settled'));
      if (scenario === 'transient') {
        assert(events.some(e => e.type === 'message_end' && e.message?.stopReason === 'error'));
        assert(events.some(e => e.type === 'auto_retry_end' && e.success));
      }
    } else {
      assert.notEqual(result.code, 0, result.stdout.slice(-2000));
      if (scenario !== 'compaction-failure') assert.equal(existsSync(report), false, 'unfinished turn must not invent a report');
      assert.equal(readFileSync(join(workspace, 'payload.txt'), 'utf8'), 'bounded fixture data '.repeat(2200));
      if (scenario === 'early-overflow') {
        assert.equal(requests.length, 2); assert.equal(summaries, 0);
        assert.match(result.stdout.slice(-6000), /maximum context length exceeded/);
      }
      if (scenario === 'retry-exhaustion') {
        assert.equal(requests.length, 4, 'Pi default permits three retries');
        assert(events.some(e => e.type === 'auto_retry_end' && e.success === false));
      }
      if (scenario === 'compaction-failure') assert(events.some(e => e.type === 'compaction_end' && /Fixture terminal summarization failure/.test(e.errorMessage)));
      if (baseline && ['complete', 'transient'].includes(scenario)) {
        assert.match(result.stdout.slice(-6000) + result.stderr, /Fixture allocated context exceeded/);
        assert(requests.some(r => !r.summary && r.tokens + r.maxTokens > window));
        assert.equal(events.slice(0, compactStart < 0 ? undefined : compactStart).some(e => e.type === 'agent_end'), true,
          'baseline compacts only after the long run ends');
      }
    }
    t.diagnostic(JSON.stringify({ pi: version, scenario, synthetic: true, window, output, reads, summaries, requests, exit: result.code }));
  });
}
