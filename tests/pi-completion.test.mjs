import test from 'node:test';
import assert from 'node:assert/strict';
import { PiCompletion } from '../factory/pi-local-launch.mjs';

const assistant = (stopReason = 'stop') => ({ role: 'assistant', stopReason, content: [{ type: 'text', text: 'Finished.' }] });
const endMessage = message => ({ type: 'message_end', message });
const good = assistant(), bad = assistant('error');
const end = { type: 'agent_end', messages: [good], willRetry: false };
const settled = { type: 'agent_settled' };
const success = [endMessage(good), end, settled];
const compactStart = { type: 'compaction_start', reason: 'overflow' };
const compactEnd = { type: 'compaction_end', reason: 'overflow', aborted: false, willRetry: true, result: { summary: 'Retained task.' } };
const retryStart = { type: 'auto_retry_start', attempt: 1 };
const retryEnd = { type: 'auto_retry_end', success: true };
function accepts(events, suffix = '\n') {
  const parser = new PiCompletion();
  // Exercise arbitrary transport chunk boundaries as well as JSONL framing.
  const stream = events.map(e => typeof e === 'string' ? e : JSON.stringify(e)).join('\n') + suffix;
  for (let i = 0; i < stream.length; i += 4093) parser.write(stream.slice(i, i + 4093));
  return parser.finish();
}
for (const [name, events] of [
  ['ordinary completion', success],
  ['legacy completion without settlement event', [endMessage(good), { type: 'agent_end', messages: [good] }]],
  ['retry with successful assistant and settlement', [endMessage(bad), retryStart, endMessage(good), retryEnd, end, settled]],
  ['overflow compaction and successful continuation', [endMessage(bad), compactStart, compactEnd, ...success]],
  ['threshold compaction after completed response', [...success.slice(0, 2), { ...compactStart, reason: 'threshold' }, { ...compactEnd, reason: 'threshold', willRetry: false }, settled]],
]) test(`Pi completion accepts ${name}`, () => assert.equal(accepts(events), true));

for (const [name, events] of [
  ['empty stream', []],
  ['agent_end alone', [end, settled]],
  ['missing agent_end', [endMessage(good), settled]],
  ['modern stream missing settlement', success.slice(0, 2)],
  ['terminal provider error despite exit zero', [endMessage(bad), { type: 'agent_end', messages: [bad] }, settled]],
  ['success without explicit error recovery', [endMessage(bad), ...success]],
  ['truncated output', [endMessage(assistant('length')), { type: 'agent_end', messages: [assistant('length')] }, settled]],
  ['abort followed by success', [endMessage(assistant('aborted')), ...success]],
  ['retry exhausted followed by success', [endMessage(bad), retryStart, { ...retryEnd, success: false }, ...success]],
  ['retry still pending', [endMessage(bad), retryStart, ...success]],
  ['compaction still pending', [compactStart, ...success]],
  ['failed compaction followed by completion', [compactStart, { ...compactEnd, result: undefined, errorMessage: 'Failed.' }, ...success]],
  ['aborted compaction followed by completion', [compactStart, { ...compactEnd, aborted: true }, ...success]],
  ['missing compaction result', [compactStart, { ...compactEnd, result: undefined }, ...success]],
  ['unpaired compaction result', [compactEnd, ...success]],
  ['legacy failed compaction alias', [{ ...compactStart, type: 'auto_compaction_start' }, { ...compactEnd, type: 'auto_compaction_end', aborted: true }, ...success]],
  ['compaction without resumed assistant', [endMessage(bad), compactStart, compactEnd, end, settled]],
  ['agent still requesting retry', [endMessage(good), { ...end, willRetry: true }, settled]],
  ['mismatched final aggregate', [endMessage(good), { ...end, messages: [assistant('toolUse')] }, settled]],
  ['tool call without final response', [endMessage(assistant('toolUse')), { ...end, messages: [assistant('toolUse')] }, settled]],
  ['malformed line before completion', ['{', ...success]],
  ['settlement before final aggregate', [endMessage(good), settled, end]],
  ['malformed retry flag', [endMessage(good), { ...end, willRetry: 'false' }, settled]],
  ['mismatched compaction reason', [compactStart, { ...compactEnd, reason: 'threshold', willRetry: false }, ...success]],
  ['malformed assistant event', [{ type: 'message_end', message: { role: 'assistant' } }, ...success]],
  ['invalid event shape', [null, ...success]],
  ['oversized line', ['x'.repeat(8 * 1024 * 1024 + 1), ...success]],
  ['later incomplete run', [...success, { type: 'agent_start' }]],
]) test(`Pi completion rejects ${name}`, () => assert.equal(accepts(events), false));

test('Pi completion requires the last JSONL record delimiter', () => assert.equal(accepts(success, ''), false));

const proactiveStart = { type: 'factory_context_recovery', phase: 'start', recovery: 1 };
const proactiveEnd = { ...proactiveStart, phase: 'complete' };
test('Pi completion requires paired bounded proactive recovery', () => {
  assert.equal(accepts([proactiveStart, proactiveEnd, ...success]), true);
  for (const events of [[proactiveStart], [proactiveEnd], [proactiveStart, proactiveStart, proactiveEnd],
    [proactiveStart, { ...proactiveEnd, recovery: 2 }], [{ ...proactiveStart, recovery: 17 }, { ...proactiveEnd, recovery: 17 }],
    [proactiveStart, { ...proactiveEnd, phase: 'failed' }]])
    assert.equal(accepts([...events, ...success]), false);
});
